import { NextRequest } from "next/server";
import { createLLMProvider } from "@/core/llm/factory";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import { logSession } from "@/lib/session-log";
import { getTool, buildToolSchemas } from "@/core/agents/registry";
import { initRegistry } from "@/core/agents/init";
import type { LLMMessage, ToolSchema } from "@/types";

export const dynamic = "force-dynamic";

let initialized = false;
function ensureInit() {
  if (!initialized) { initRegistry(); initialized = true; }
}

const SYSTEM_PROMPT = `你是小说创作的主编Agent。你可以调用工具来完成创作任务。

## 工作方式
1. 先获取上下文（get_characters, get_novel_context等）
2. 把关键信息写入prompt，调用agent工具执行创作任务
3. agent返回后，根据结果决定下一步

## 工具调用规则
- agent工具需要 agent_type 和 prompt 参数，prompt里放完整的任务描述和上下文
- 内置工具一般不需要参数

## 重要
- 所有回复用中文
- 直接对用户说话，不要输出思考过程`;

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
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      const sendChunk = (text: string) => send({ type: "chunk", content: text });
      let currentToolCallId = "";
      const sendToolChunk = (text: string) => {
        send({ type: "tool_chunk", toolCallId: currentToolCallId, content: text });
      };
      const sendTool = (tool: string, status: string, toolCallId: string, result?: string, msgs?: any[]) => {
        send({ type: "tool_call", tool, status, toolCallId, result, messages: msgs });
      };

      try {
        const sessionId = Math.random().toString(36).slice(2, 10);
        const toolCallLogs: Record<string, unknown>[] = [];
        const conversation: LLMMessage[] = [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages.map((m: any) => ({ role: m.role === "agent" ? "assistant" : m.role, content: m.content })),
        ];

        let maxSteps = 15;
        while (maxSteps-- > 0) {
          const eventStream = llm.chatWithTools(conversation, toolSchemas, { temperature: 0.4, maxTokens: 4096 });

          let hasToolUse = false;
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
              sendChunk(event.text);
            } else if (event.type === "tool_use") {
              if (thinkingTimer) { clearTimeout(thinkingTimer); thinkingTimer = null; }
              hasToolUse = true;
              const toolDef = getTool(event.name);
              if (!toolDef) {
                conversation.push({ role: "user", content: `工具 ${event.name} 不存在` });
                continue;
              }

              currentToolCallId = Math.random().toString(36).slice(2);
              sendTool(event.name, "running", currentToolCallId);

              const result = await toolDef.execute(event.args, context, llm, sendToolChunk);

              conversation.push({
                role: "assistant",
                content: `[调用 ${event.name}(${JSON.stringify(event.args)})]`,
              });
              conversation.push({
                role: "user",
                content: `工具 ${event.name} 返回:\n${result.content.slice(0, 3000)}`,
              });

              sendTool(event.name, "done", currentToolCallId, result.content.slice(0, 2000), result.messages);
              toolCallLogs.push({ tool: event.name, args: event.args, result: result.content.slice(0, 500) });
              logSession({
                ts: new Date().toISOString(), sessionId, type: "tool_exec",
                userId, tool: event.name, args: event.args, resultPreview: result.content.slice(0, 500),
              });
            }
          }

          if (thinkingTimer) clearTimeout(thinkingTimer);
          if (!hasToolUse) break;
        }

        if (maxSteps <= 0) {
          logSession({ ts: new Date().toISOString(), sessionId, type: "master_agent", status: "max_steps" });
        }
      } catch (e) {
        logSession({ ts: new Date().toISOString(), type: "error", error: (e as Error).message });
        send({ type: "error", message: (e as Error).message });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
