import { NextRequest } from "next/server";
import { createLLMProvider } from "@/core/llm/factory";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import { getAgent } from "@/core/agents/agent-registry";
import { initRegistry } from "@/core/agents/init";

export const dynamic = "force-dynamic";

let initialized = false;
function ensureInit() { if (!initialized) { initRegistry(); initialized = true; } }

export async function POST(request: NextRequest) {
  ensureInit();
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "agent_run", { windowMs: 60_000, maxRequests: 20 });
  if (!rate.allowed) return new Response(JSON.stringify({ error: rateLimitMessage(rate) }), { status: 429, headers: { "Content-Type": "application/json" } });

  const { agent_type, prompt, context } = await request.json();
  if (!agent_type || !prompt) {
    return new Response(JSON.stringify({ error: "agent_type and prompt are required" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const agentDef = getAgent(agent_type);
  if (!agentDef) {
    return new Response(JSON.stringify({ error: `Unknown agent: ${agent_type}` }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const llm = createLLMProvider();
  const encoder = new TextEncoder();
  const toolCallId = Math.random().toString(36).slice(2);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        send({ type: "tool_call", tool: agent_type, status: "running", toolCallId });

        const result = await agentDef.execute(
          {
            prompt,
            ...(context || {}),
            novelText: context?.novelText || "",
            characters: context?.characters || [],
          },
          llm,
          (text) => send({ type: "tool_chunk", toolCallId, content: text })
        );

        send({ type: "tool_call", tool: agent_type, status: "done", toolCallId, result: result.content.slice(0, 5000), messages: result.messages });
      } catch (e) {
        send({ type: "error", message: (e as Error).message });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
