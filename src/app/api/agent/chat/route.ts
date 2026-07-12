import { NextRequest } from "next/server";
import { createLLMProvider } from "@/core/llm/factory";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import { logSession } from "@/lib/session-log";
import { getTool, buildToolSchemas } from "@/core/agents/registry";
import { getAgent } from "@/core/agents/agent-registry";
import { initRegistry } from "@/core/agents/init";
import type { LLMMessage, SystemMessage, UserMessage, AssistantMessage, ToolMessage, ToolSchema } from "@/types";

export const dynamic = "force-dynamic";

let initialized = false;
function ensureInit() {
  if (!initialized) { initRegistry(); initialized = true; }
}

const SYSTEM_PROMPT = `你是小说创作主编。按以下流程工作。

## 续写流程
1. 获取上下文: get_novel_context, get_characters
2. 规划大纲: agent(agent_type="generate_outline")，prompt里放前文+角色+用户要求
3. 展示大纲并等待用户反馈。用户说"改"/"修改"时重新调generate_outline，说"写"/"继续"/"确认"时进入下一步
4. 写作: agent(agent_type="write_prose")，prompt里放大纲全文+前文+角色。写作后系统会自动审查修改
5. 汇报最终结果

## 可用工具
- agent(agent_type, prompt): agent_type可选 generate_outline, write_prose, review_character, review_continuity, review_foreshadowing, review_style, review_world, review_pacing
- 数据工具: get_novel_context, get_characters, get_timeline, get_codex, get_world_bible

## 规则
- 一次一个工具
- prompt字段写完整上下文
- 中文回复`;

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
  const toolSchemas: ToolSchema[] = buildToolSchemas();

  const stream = new ReadableStream({
    async start(controller) {
      const signal = request.signal;
      const checkAbort = () => { if (signal.aborted) throw new Error("ABORTED"); };
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      const sendChunk = (text: string) => send({ type: "chunk", content: text });
      let currentToolCallId = "";
      let currentToolName = "";
      const sendToolChunk = (text: string) => {
        send({ type: "tool_chunk", toolCallId: currentToolCallId, content: text, tool: currentToolName });
      };
      const sendTool = (tool: string, status: string, toolCallId: string, result?: string, msgs?: any[]) => {
        send({ type: "tool_call", tool, status, toolCallId, result, messages: msgs });
      };

      const runAgent = async (agentType: string, prompt: string, toolCallId: string) => {
        currentToolCallId = toolCallId;
        currentToolName = agentType;
        sendTool(agentType, "running", toolCallId);
        const agentDef = getAgent(agentType);
        if (!agentDef) throw new Error(`Unknown agent: ${agentType}`);
        const t0 = Date.now();
        const result = await agentDef.execute(
          { prompt, ...context, novelText: context.novelText || "", characters: context.characters || [] },
          llm,
          sendToolChunk,
        );
        logSession({ ts: new Date().toISOString(), type: "tool_exec", tool: agentType, elapsed: Date.now() - t0, resultPreview: result.content.slice(0, 300) });
        sendTool(agentType, "done", toolCallId, result.content.slice(0, 5000), result.messages);
        return result;
      };

      const runDataTool = async (name: string, toolCallId: string) => {
        sendTool(name, "running", toolCallId);
        const toolDef = getTool(name);
        if (!toolDef) throw new Error(`Unknown tool: ${name}`);
        const result = await toolDef.execute({}, context, llm);
        sendTool(name, "done", toolCallId, result.content.slice(0, 2000), result.messages);
        return result;
      };

      try {
        const conversation: LLMMessage[] = [
          { role: "system", content: SYSTEM_PROMPT } as SystemMessage,
          ...messages.map((m: any) => {
            if (m.role === "tool" && m.tool_call_id) {
              return { role: "tool", content: m.content, tool_call_id: m.tool_call_id } as ToolMessage;
            }
            if (m.tool_calls) {
              return { role: "assistant", content: m.content, tool_calls: m.tool_calls } as AssistantMessage;
            }
            return { role: m.role === "agent" ? "assistant" : m.role, content: m.content } as UserMessage | AssistantMessage;
          }),
        ];

        let maxSteps = 15;
        while (maxSteps-- > 0) {
          checkAbort();
          const eventStream = llm.chatWithTools(conversation, toolSchemas, { temperature: 0.4, maxTokens: 4096 });

          let hasToolUse = false;
          let fullText = "";
          let thinkingTimer: ReturnType<typeof setTimeout> | null = null;
          let hasTextOutput = false;

          thinkingTimer = setTimeout(() => {
            if (!hasTextOutput) send({ type: "thinking", status: "deciding" });
          }, 2000);

          for await (const event of eventStream) {
            if (event.type === "text_delta") {
              if (!hasTextOutput) {
                hasTextOutput = true;
                if (thinkingTimer) { clearTimeout(thinkingTimer); thinkingTimer = null; }
              }
              fullText += event.text;
              sendChunk(fullText);
            } else if (event.type === "tool_use") {
              if (thinkingTimer) { clearTimeout(thinkingTimer); thinkingTimer = null; }
              hasToolUse = true;
              const toolName = event.name;
              const toolId = event.id;
              const args = event.args as Record<string, any>;

              // Build assistant message with tool_use content block
              conversation.push({
                role: "assistant",
                content: [{ type: "tool_use", id: toolId, name: toolName, input: args }],
              } as AssistantMessage);

              if (toolName === "agent") {
                const agentType = args.agent_type as string;
                const prompt = args.prompt as string;
                if (!agentType || !prompt) {
                  conversation.push({
                    role: "user",
                    content: [{ type: "tool_result", tool_use_id: toolId, content: "错误: agent_type 和 prompt 都是必需的", is_error: true }],
                  });
                  continue;
                }

                if (agentType === "write_prose") {
                  let prose = (await runAgent("write_prose", prompt, toolId)).content;
                  checkAbort();

                  // Auto review loop (parallel)
                  let prevCount = Infinity;
                  let stallCount = 0;
                  for (let round = 0; round < 5; round++) {
                    checkAbort();
                    sendChunk(`### 审查轮次 ${round + 1}`);

                    const results = await Promise.all(
                      REVIEW_TYPES.map(rt => runAgent(rt, prose, toolId))
                    );

                    const allFindings: { dimension: string; severity: string; description: string; suggestion: string }[] = [];
                    let allConverged = true;
                    for (let i = 0; i < REVIEW_TYPES.length; i++) {
                      try {
                        const parsed = JSON.parse(results[i].content) as { converged: boolean; findings: typeof allFindings };
                        if (!parsed.converged) allConverged = false;
                        allFindings.push(...parsed.findings);
                      } catch {
                        if (!results[i].content.includes("未发现")) {
                          allConverged = false;
                          allFindings.push({ dimension: REVIEW_TYPES[i], severity: "major", description: results[i].content.slice(0, 500), suggestion: "" });
                        }
                      }
                    }

                    const total = allFindings.length;
                    const dimSummary = REVIEW_TYPES.map(dim => {
                      const dfs = allFindings.filter(f =>
                        f.dimension === dim || f.dimension === dim.replace("review_", "")
                      );
                      const dname = dim.replace("review_", "");
                      if (dfs.length === 0) return `- ✓ ${dname}: 0`;
                      const c = dfs.filter(f => f.severity === "critical").length;
                      const m = dfs.filter(f => f.severity === "major").length;
                      const parts = [c > 0 ? `${c}c` : "", m > 0 ? `${m}m` : ""].filter(Boolean).join(",");
                      return `- ✗ ${dname}: ${dfs.length} (${parts})`;
                    }).join("\n");
                    sendChunk(`\n${dimSummary}\n**共${total}个问题**`);

                    if (allConverged || total === 0) {
                      logSession({ ts: new Date().toISOString(), type: "review_converged", round, totalFindings: total });
                      sendChunk("✓ 审查通过，无需修改。");
                      break;
                    }

                    if (total >= prevCount) {
                      stallCount++;
                      if (stallCount >= 2) {
                        logSession({ ts: new Date().toISOString(), type: "review_stalled", round, total, prevCount, stallCount });
                        sendChunk(`审查停滞（连续${stallCount}轮未减少），停止迭代。`);
                        break;
                      }
                      sendChunk(`问题数未减少（${total}），再试一轮...`);
                    } else {
                      stallCount = 0;
                    }
                    prevCount = total;

                    const fixPrompt = allFindings.map((f, i) =>
                      `修改${i + 1}: ${f.suggestion || f.description}`
                    ).join("\n");
                    prose = (await runAgent("write_prose", `请对以下正文进行精确修改...`, toolId)).content;
                  }

                  conversation.push({
                    role: "user",
                    content: [{ type: "tool_result", tool_use_id: toolId, content: `写作结果:\n${prose.slice(0, 5000)}` }],
                  });
                } else {
                  const result = await runAgent(agentType, prompt, toolId);
                  conversation.push({
                    role: "user",
                    content: [{ type: "tool_result", tool_use_id: toolId, content: result.content.slice(0, 5000) }],
                  });
                }
              } else {
                const result = await runDataTool(toolName, toolId);
                conversation.push({
                  role: "user",
                  content: [{ type: "tool_result", tool_use_id: toolId, content: result.content.slice(0, 5000) }],
                });
              }
            }
          }

          if (thinkingTimer) clearTimeout(thinkingTimer);
          if (!hasToolUse) break;
        }

        if (maxSteps <= 0) {
          logSession({ ts: new Date().toISOString(), type: "master_agent", status: "max_steps" });
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
