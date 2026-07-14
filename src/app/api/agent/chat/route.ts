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


export async function POST(request: NextRequest) {
  ensureInit();

  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "agent_chat", { windowMs: 60_000, maxRequests: 10 });
  if (!rate.allowed) return new Response(JSON.stringify({ error: rateLimitMessage(rate) }), { status: 429, headers: { "Content-Type": "application/json" } });

  const { messages, branchId, novelId } = await request.json();
  if (!branchId || !novelId) return new Response(JSON.stringify({ error: "branchId and novelId required" }), { status: 400, headers: { "Content-Type": "application/json" } });

  const llm = createLLMProvider();
  const encoder = new TextEncoder();
  const toolSchemas: ToolSchema[] = buildToolSchemas();
  const sysPrompt = `你是小说创作主编。按以下流程工作。

## 当前绑定分支
- novelId = ${novelId}
- branchId = ${branchId}（"main" 代表主线，其他为 IF 分支）

## 标准续写流程（顺序不可跳过）

1. 必要时调 get_branch_text / get_branch_characters 了解当前分支
2. 大纲：agent(agent_type="generate_outline")，prompt 写用户要求 + 分支
3. 看大纲：调 get_outline 看到内容、展示给用户。等用户反馈："改"→重调 2、"继续"/"写"/"确认"→下一步
4. 写正文：agent(agent_type="write_prose")，prompt 以 "[MODE:create]" 开头，后面写用户要求。writer 会自己 get_outline
5. 审查六维（串行、一次一个 agent）：
   agent(agent_type="review_character")，prompt "请审查"
   agent(agent_type="review_continuity")，prompt "请审查"
   agent(agent_type="review_foreshadowing")，prompt "请审查"
   agent(agent_type="review_style")，prompt "请审查"
   agent(agent_type="review_world")，prompt "请审查"
   agent(agent_type="review_pacing")，prompt "请审查"
6. 收完六个 hint 后，调 get_findings 取完整审查清单、汇总各维度问题数给用户。**等用户确认**：
   - 用户说"改"→下一步
   - 用户说"算了"→跳到 8（不清 store、可反悔）
7. 改正文：agent(agent_type="write_prose")，prompt 以 "[MODE:rewrite]" 开头。writer 会自己 get_findings
8. 汇报最终结果给用户

## 可用工具
- agent(agent_type, prompt): 可调用下面任一 agent
- 分支查询: get_branch_text, get_branch_characters, get_branch_timeline, get_branch_world, get_branch_meta
- 中间数据读取: get_outline, get_prose, get_findings（save_* 是子 agent 专属，你不调）
- clear_findings（用户明确说"算了不修改"可调用）

## 规则
- 一次一个工具
- **工具返回是权威的**：看到 hint 如"大纲已存"、"N findings 已存储"，不要因内容短就重调生成类 agent（generate_outline/write_prose/review_*）。如需看本体请调 get_ 工具
- 中文回复`;

  const stream = new ReadableStream({
    async start(controller) {
      const signal = request.signal;
      const checkAbort = () => { if (signal.aborted) throw new Error("ABORTED"); };
      const send = (data: Record<string, unknown>) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch { /* stream closed */ }
      };
      const sendChunk = (text: string) => send({ type: "chunk", content: text });
      const sendTool = (tool: string, status: string, toolCallId: string, result?: string, msgs?: any[]) => {
        send({ type: "tool_call", tool, status, toolCallId, result, messages: msgs });
      };

      const runAgent = async (agentType: string, prompt: string, toolCallId: string) => {
        sendTool(agentType, "running", toolCallId);
        const agentDef = getAgent(agentType);
        if (!agentDef) throw new Error(`Unknown agent: ${agentType}`);
        const t0 = Date.now();
        const onChunk = (text: string) => {
          send({ type: "tool_chunk", toolCallId, content: text, tool: agentType });
        };
        const result = await agentDef.execute(
          { prompt, novelId, branchId, userId },
          llm,
          onChunk,
        );
        logSession({ ts: new Date().toISOString(), type: "tool_exec", tool: agentType, elapsed: Date.now() - t0, resultPreview: result.content.slice(0, 300) });
        sendTool(agentType, "done", toolCallId, result.content.slice(0, 5000), result.messages);
        return result;
      };

      const runDataTool = async (name: string, toolCallId: string) => {
        sendTool(name, "running", toolCallId);
        const toolDef = getTool(name);
        if (!toolDef) throw new Error(`Unknown tool: ${name}`);
        const result = await toolDef.execute({ novelId, branchId }, { novelId, branchId, userId }, llm);
        sendTool(name, "done", toolCallId, result.content.slice(0, 2000), result.messages);
        return result;
      };

      try {
        const conversation: LLMMessage[] = [
          { role: "system", content: sysPrompt } as SystemMessage,
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

        let maxSteps = 3000;
        while (maxSteps-- > 0) {
          checkAbort();
          const eventStream = llm.chatWithTools(conversation, toolSchemas, { temperature: 0.4, maxTokens: 4096 });

          let hasToolUse = false;
          let fullText = "";
          let preToolText = "";
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
              if (!hasToolUse) preToolText = fullText;
              sendChunk(fullText);
            } else if (event.type === "tool_use") {
              if (thinkingTimer) { clearTimeout(thinkingTimer); thinkingTimer = null; }
              hasToolUse = true;
              const toolName = event.name;
              const toolId = event.id;
              const args = event.args as Record<string, any>;

              // Push any preceding text so the LLM sees its own reasoning on next turn
              if (preToolText) {
                conversation.push({ role: "assistant", content: preToolText } as AssistantMessage);
                preToolText = "";
              }

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

                const result = await runAgent(agentType, prompt, toolId);
                conversation.push({
                  role: "user",
                  content: [{ type: "tool_result", tool_use_id: toolId, content: result.content.slice(0, 5000) }],
                });
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
