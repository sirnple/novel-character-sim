import { NextRequest, NextResponse } from "next/server";
import { createLLMProvider } from "@/core/llm/factory";
import { checkRateLimit, getClientIP } from "@/lib/rate-limit";

const CHAT_SCHEMA = {
  name: "character_chat_response",
  description: "Character's response in a free-form chat",
  parameters: {
    type: "object",
    properties: {
      dialogue: { type: "string", description: "What the character says" },
      actions: { type: "string", description: "Character actions / body language (can be empty)" },
      innerThoughts: { type: "string", description: "Inner thoughts (can be empty)" },
    },
    required: ["dialogue"],
  },
};

export async function POST(request: NextRequest) {
  const ip = getClientIP(request);
  const rate = checkRateLimit(ip, "chat", { windowMs: 60_000, maxRequests: 20 });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: `请求太频繁，请 ${Math.ceil((rate.resetAt - Date.now()) / 1000)} 秒后重试` },
      { status: 429 }
    );
  }

  try {
    const { systemPrompt, messages } = await request.json();
    if (!systemPrompt || !messages) {
      return NextResponse.json({ error: "Missing prompt or messages" }, { status: 400 });
    }

    const llm = createLLMProvider();
    const result = await llm.chatWithTool<{
      dialogue: string;
      actions?: string;
      innerThoughts?: string;
    }>(
      [{ role: "system", content: systemPrompt }, ...messages],
      CHAT_SCHEMA,
      { temperature: 0.9, maxTokens: 800 }
    );

    // Format into a natural-looking message for the UI
    const parts: string[] = [result.dialogue];
    if (result.actions) parts.push("\n\n_" + result.actions + "_");
    if (result.innerThoughts) parts.push("\n\n💭 " + result.innerThoughts);

    return NextResponse.json({ reply: parts.join("") });
  } catch (error) {
    console.error("Chat error:", error);
    return NextResponse.json({ error: "Chat failed" }, { status: 500 });
  }
}
