import { NextRequest, NextResponse } from "next/server";
import { saveChatHistory, getChatHistory } from "@/lib/db";
import { getUserId } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const { characterId, messages } = await request.json();
  if (!characterId || !messages) {
    return NextResponse.json({ error: "characterId and messages required" }, { status: 400 });
  }
  saveChatHistory(userId, characterId, messages);
  return NextResponse.json({ success: true });
}

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const characterId = request.nextUrl.searchParams.get("characterId");
  if (!characterId) {
    return NextResponse.json({ error: "characterId required" }, { status: 400 });
  }
  const data = getChatHistory(userId, characterId);
  return NextResponse.json(data ? { messages: data } : { messages: null });
}
