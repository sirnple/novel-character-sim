import { NextRequest, NextResponse } from "next/server";
import { createLLMProvider } from "@/core/llm/factory";

export async function POST(request: NextRequest) {
  try {
    const { systemPrompt, messages } = await request.json();
    if (!systemPrompt || !messages) {
      return NextResponse.json({ error: "Missing prompt or messages" }, { status: 400 });
    }

    const llm = createLLMProvider();
    const reply = await llm.chat(
      [{ role: "system", content: systemPrompt }, ...messages],
      { temperature: 0.9, maxTokens: 800 }
    );

    return NextResponse.json({ reply });
  } catch (error) {
    console.error("Chat error:", error);
    return NextResponse.json({ error: "Chat failed" }, { status: 500 });
  }
}
