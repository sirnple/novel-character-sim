import { NextRequest, NextResponse } from "next/server";
import { createLLMProvider } from "@/core/llm/factory";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import { runWithTokenContext } from "@/lib/token-usage-context";

const CHAT_SCHEMA = {
  name: "character_chat_response",
  description: "What the character says in conversation",
  parameters: {
    type: "object",
    properties: {
      dialogue: { type: "string", description: "What the character says" },
    },
    required: ["dialogue"],
  },
};

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "chat", { windowMs: 60_000, maxRequests: 20 });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: rateLimitMessage(rate) },
      { status: 429 }
    );
  }

  try {
    const { systemPrompt, messages } = await request.json();
    if (!systemPrompt || !messages) {
      return NextResponse.json({ error: "Missing prompt or messages" }, { status: 400 });
    }

    const llm = createLLMProvider("write");
    const result = await runWithTokenContext(
      { userId, agentId: "character_chat", category: "chat" },
      () =>
        llm.chatWithTool<{ dialogue: string }>(
          [{ role: "system", content: systemPrompt }, ...messages],
          CHAT_SCHEMA,
          { temperature: 0.9, maxTokens: 800 },
        ),
    );

    return NextResponse.json({ reply: result.dialogue });
  } catch (error) {
    console.error("Chat error:", error);
    return NextResponse.json({ error: "Chat failed" }, { status: 500 });
  }
}
