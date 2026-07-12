import { NextRequest } from "next/server";
import { createLLMProvider } from "@/core/llm/factory";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import { logSession } from "@/lib/session-log";
import { getTool } from "@/core/agents/registry";
import { getAgent } from "@/core/agents/agent-registry";
import { initRegistry } from "@/core/agents/init";
import type { LLMMessage } from "@/types";

export const dynamic = "force-dynamic";

let initialized = false;
function ensureInit() {
  if (!initialized) { initRegistry(); initialized = true; }
}

const REVIEW_TYPES = [
  "review_character", "review_continuity", "review_foreshadowing",
  "review_style", "review_world", "review_pacing",
];

export async function POST(request: NextRequest) {
  ensureInit();

  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "agent_chat", { windowMs: 60_000, maxRequests: 10 });
  if (!rate.allowed) return new Response(JSON.stringify({ error: rateLimitMessage(rate) }), { status: 429, headers: { "Content-Type": "application/json" } });

  const { messages, context } = await request.json();
  const llm = createLLMProvider();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const signal = request.signal;
      const aborted = () => signal.aborted;
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      const sendChunk = (text: string) => send({ type: "chunk", content: text });
      let currentToolCallId = "";
      const sendToolChunk = (text: string) => {
        send({ type: "tool_chunk", toolCallId: currentToolCallId, content: text, tool: currentToolName });
      };
      let currentToolName = "";
      const sendTool = (tool: string, status: string, toolCallId: string, result?: string, msgs?: any[]) => {
        send({ type: "tool_call", tool, status, toolCallId, result, messages: msgs });
      };

      const runAgent = async (agentType: string, prompt: string) => {
        const id = Math.random().toString(36).slice(2);
        currentToolCallId = id;
        currentToolName = agentType;
        sendTool(agentType, "running", id);
        const agentDef = getAgent(agentType);
        if (!agentDef) throw new Error(`Unknown agent: ${agentType}`);
        const t0 = Date.now();
        const result = await agentDef.execute(
          { prompt, ...context, novelText: context.novelText || "", characters: context.characters || [] },
          llm,
          sendToolChunk,
        );
        logSession({ ts: new Date().toISOString(), type: "tool_exec", tool: agentType, elapsed: Date.now() - t0, resultPreview: result.content.slice(0, 300) });
        sendTool(agentType, "done", id, result.content.slice(0, 2000), result.messages);
        return result;
      };

      const runDataTool = async (name: string) => {
        const id = Math.random().toString(36).slice(2);
        sendTool(name, "running", id);
        const toolDef = getTool(name);
        if (!toolDef) throw new Error(`Unknown tool: ${name}`);
        const result = await toolDef.execute({}, context, llm);
        sendTool(name, "done", id, result.content.slice(0, 2000), result.messages);
        return result;
      };

      try {
        const userMessage = messages[messages.length - 1]?.content || "";

        const checkAbort = () => { if (signal.aborted) throw new Error("ABORTED"); };

        // Step 1: Get context
        checkAbort();
        sendChunk("正在获取上下文...");
        const [novelCtx, chars] = await Promise.all([
          runDataTool("get_novel_context"),
          runDataTool("get_characters"),
        ]);

        // Step 2: Outline
        checkAbort();
        sendChunk("正在规划续写大纲...");
        const outlinePrompt = [
          "请根据以下信息设计续写大纲。",
          "## 用户要求",
          userMessage,
          "## 前文",
          novelCtx.content,
          "## 角色",
          chars.content,
        ].join("\n\n");
        const outline = await runAgent("generate_outline", outlinePrompt);

        // Step 3: Write
        checkAbort();
        sendChunk("正在撰写正文...");
        const initialWritePrompt = [
          "请根据以下大纲撰写正文。",
          "## 大纲",
          outline.content,
          "## 前文（原文全文，注意其中所有设定和事件）",
          novelCtx.content,
          "## 角色",
          chars.content,
          "直接输出正文，不要JSON包裹。",
        ].join("\n\n");

        const writeSystem = `你是小说续写作家。根据大纲和前文创作续写正文。
## 核心规则
1. 严格遵循大纲的情节走向
2. 保持与原文一致的叙事风格和人物性格
3. 直接输出正文，不要JSON包裹，不要写"以下是续写"之类的引导语`;

        const rewriteSystem = `你是小说修改编辑。你的任务是修复审查发现的具体问题。
## 核心规则
1. **只修改审查指出的问题**，未提及的部分一字不改
2. 每个修改要精确、最小化——改一个字能解决的不要改一句
3. 保持原文的叙事节奏、对话风格、描写方式完全不变
4. 输出完整修改后的正文，不要任何解释或标记`;

        // Build writer conversation
        const writerMessages: LLMMessage[] = [
          { role: "system", content: writeSystem },
          { role: "user", content: initialWritePrompt },
        ];

        let prose = "";
        const writerId1 = Math.random().toString(36).slice(2);
        currentToolCallId = writerId1;
        currentToolName = "write_prose";
        sendTool("write_prose", "running", writerId1);
        await llm.chatStream(
          writerMessages,
          (acc) => { prose = acc; sendToolChunk(acc); },
          { temperature: 0.7, maxTokens: 16384 }
        );
        writerMessages.push({ role: "assistant", content: prose });
        sendTool("write_prose", "done", writerId1, prose.slice(0, 2000), [
          { role: "assistant", content: prose.slice(0, 500) + "..." },
        ]);

        // Step 4: Review loop
        let prevFindingCount = Infinity;
        let stallCount = 0;
        for (let round = 0; round < 5; round++) {
          checkAbort();
          sendChunk(`审查轮次 ${round + 1}...`);
          const allFindings: { dimension: string; severity: string; description: string; suggestion: string }[] = [];
          let allConverged = true;

          for (const reviewType of REVIEW_TYPES) {
            const r = await runAgent(reviewType, prose);
            try {
              const parsed = JSON.parse(r.content) as { converged: boolean; findings: typeof allFindings };
              if (!parsed.converged) allConverged = false;
              allFindings.push(...parsed.findings);
            } catch {
              if (!r.content.includes("未发现问题") && !r.content.includes("审查完成，未发现")) {
                allConverged = false;
                allFindings.push({ dimension: reviewType, severity: "major", description: r.content.slice(0, 500), suggestion: "" });
              }
            }
          }

          const criticalCount = allFindings.filter(f => f.severity === "critical").length;
          const majorCount = allFindings.filter(f => f.severity === "major").length;
          const totalCount = allFindings.length;

          // Build per-dimension summary
          const dimSummary = REVIEW_TYPES.map(dim => {
            const dimFindings = allFindings.filter(f => f.dimension === dim ||
              (dim === "review_character" && f.dimension === "角色一致性") ||
              (dim === "review_continuity" && f.dimension === "连贯性") ||
              (dim === "review_foreshadowing" && f.dimension === "伏笔") ||
              (dim === "review_style" && f.dimension === "风格") ||
              (dim === "review_world" && f.dimension === "世界观") ||
              (dim === "review_pacing" && f.dimension === "节奏")
            );
            const dimName = dim.replace("review_", "");
            if (dimFindings.length === 0) return `- ✓ ${dimName}: 0`;
            const c = dimFindings.filter(f => f.severity === "critical").length;
            const m = dimFindings.filter(f => f.severity === "major").length;
            const parts = [c > 0 ? `${c} critical` : "", m > 0 ? `${m} major` : ""].filter(Boolean).join(", ");
            return `- ✗ ${dimName}: ${dimFindings.length}个 (${parts})`;
          }).join("\n");
          sendChunk(`### 第${round + 1}轮审查\n${dimSummary}\n**共${totalCount}个问题**`);

          if (allConverged || totalCount === 0) {
            logSession({ ts: new Date().toISOString(), type: "review_converged", round, totalFindings: totalCount });
            sendChunk("审查通过，未发现问题。创作完成！");
            break;
          }

          if (totalCount >= prevFindingCount) {
            stallCount++;
            if (stallCount >= 2) {
              logSession({ ts: new Date().toISOString(), type: "review_stalled", round, totalFindings: totalCount, prevCount: prevFindingCount, stallCount });
              sendChunk(`审查停滞（连续${stallCount}轮未减少），停止迭代。`);
              break;
            }
            sendChunk(`问题数未减少（${totalCount}），再试一轮...`);
          } else {
            stallCount = 0;
          }
          prevFindingCount = totalCount;

          sendChunk(`发现 ${totalCount} 个问题（critical: ${criticalCount}, major: ${majorCount}），正在修改...`);
          const fixPrompt = [
            "请修复以下审查发现的问题。只修改问题相关部分，其余内容保持原样。",
            "",
            ...allFindings.map((f, i) =>
              `${i + 1}. [${f.dimension}][${f.severity}] ${f.description}\n   建议: ${f.suggestion || "请根据上下文修改"}`
            ),
          ].join("\n");

          // Continue writer conversation for rewrite
          const rewriteMessages: LLMMessage[] = [
            { role: "system", content: rewriteSystem },
            ...writerMessages.slice(1), // skip original system, use rewrite system
            { role: "user", content: fixPrompt },
          ];

          const writerId2 = Math.random().toString(36).slice(2);
          currentToolCallId = writerId2;
          currentToolName = "write_prose";
          sendTool("write_prose", "running", writerId2);
          await llm.chatStream(
            rewriteMessages,
            (acc) => { prose = acc; sendToolChunk(acc); },
            { temperature: 0.5, maxTokens: 16384 }
          );
          writerMessages.push({ role: "user", content: fixPrompt }, { role: "assistant", content: prose });
          sendTool("write_prose", "done", writerId2, prose.slice(0, 2000), [
            { role: "assistant", content: prose.slice(0, 500) + "..." },
          ]);
        }
      } catch (e) {
        if ((e as Error).message === "ABORTED") {
          send({ type: "stopped" });
        } else {
          logSession({ ts: new Date().toISOString(), type: "error", error: (e as Error).message });
          send({ type: "error", message: (e as Error).message });
        }
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
