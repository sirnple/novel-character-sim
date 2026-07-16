import { NextRequest } from "next/server";
import { createLLMProvider } from "@/core/llm/factory";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import { getAgent } from "@/core/agents/agent-registry";
import { initRegistry } from "@/core/agents/init";
import { runWithTokenContext } from "@/lib/token-usage-context";

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

  const novelId = String(context?.novelId || "");
  const branchId = String(context?.branchId || "");
  const llm = createLLMProvider();
  const encoder = new TextEncoder();
  const toolCallId = Math.random().toString(36).slice(2);

  const stream = new ReadableStream({
    async start(controller) {
      await runWithTokenContext(
        {
          userId: context?.userId || userId,
          novelId,
          branchId,
          agentId: agent_type,
          category: "agent",
        },
        async () => {
          const send = (data: Record<string, unknown>) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          };

          try {
            send({ type: "tool_call", tool: agent_type, status: "running", toolCallId });

            const result = await agentDef.execute(
              {
                prompt,
                ...(context || {}),
                userId: context?.userId || userId,
                novelId,
                branchId,
                novelText: context?.novelText || "",
                characters: context?.characters || [],
              },
              llm,
              (text) => send({ type: "tool_chunk", toolCallId, content: text }),
              (messages) => send({ type: "tool_trail", toolCallId, messages, tool: agent_type }),
            );

            send({ type: "tool_call", tool: agent_type, status: "done", toolCallId, result: result.content.slice(0, 5000), messages: result.messages });
          } catch (e) {
            send({ type: "error", message: (e as Error).message });
          }
          controller.close();
        },
      );
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
