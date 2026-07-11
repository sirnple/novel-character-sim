import { NextRequest } from "next/server";
import { createLLMProvider } from "@/core/llm/factory";
import { renderPrompt } from "@/core/prompts/renderer";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "agent_chat", { windowMs: 60_000, maxRequests: 10 });
  if (!rate.allowed) {
    return new Response(
      JSON.stringify({ error: rateLimitMessage(rate) }),
      { status: 429, headers: { "Content-Type": "application/json" } }
    );
  }

  const { agentId, messages, context } = await request.json();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendChunk = (text: string) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "chunk", content: text })}\n\n`));
      };
      const sendData = (data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "data", data })}\n\n`));
      };
      const sendError = (message: string) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message })}\n\n`));
      };

      try {
        if (agentId === "outline") {
          const llm = createLLMProvider();
          const systemPrompt = renderPrompt("outline-system.md", {});

          const fullPrompt = `以下是与大纲 Agent 的对话。请根据人类的反馈修改大纲。

## 上下文
- 续写起点：${context.continueFromLabel || "未知"}
${context.novelText ? `- 原文总长度：${context.novelText.length} 字` : ""}

## 对话历史
${messages.map((m: any) => `[${m.role === "user" ? "人类" : "大纲Agent"}]: ${m.content}`).join("\n\n")}

请根据对话历史的最后一条人类反馈，生成修改后的大纲。如果是第一次对话（没有人类反馈），请根据上下文生成初始大纲。`;

          await llm.chatStream(
            [
              { role: "system", content: systemPrompt },
              { role: "user", content: fullPrompt },
            ],
            (accumulated) => {
              sendChunk(accumulated);
            },
            { temperature: 0.4, maxTokens: 2048 }
          );
        } else if (agentId === "writer") {
          const llm = createLLMProvider();
          const fullPrompt = `以下是与 Writer Agent 的对话。请根据人类的反馈修改 prose。

## 上下文
${context.novelText ? `原文（最近部分）：\n${context.novelText.slice(-10000)}` : "无原文"}

## 对话历史
${messages.map((m: any) => `[${m.role === "user" ? "人类" : "Writer"}]: ${m.content}`).join("\n\n")}

请根据对话历史的最后一条人类反馈修改 prose。直接输出修改后的正文。`;

          await llm.chatStream(
            [{ role: "user", content: fullPrompt }],
            (accumulated) => sendChunk(accumulated),
            { temperature: 0.6, maxTokens: 16384 }
          );
        } else if (agentId === "review") {
          sendChunk("审查 Agent 的对话功能正在开发中。目前可以通过右上角的「审查详情」按钮查看审查结果。");
        }

        controller.close();
      } catch (e) {
        sendError((e as Error).message);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
