import { NextRequest, NextResponse } from "next/server";
import { appendNovelContent, saveTimeline } from "@/lib/db";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import type { ChapterTimeline } from "@/types";

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "writer_save", { windowMs: 60_000, maxRequests: 20 });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }

  try {
    const { novelId, content, chapterNumber, chapterTitle } = await request.json();
    if (!novelId || !content) {
      return NextResponse.json({ error: "novelId and content are required" }, { status: 400 });
    }

    // Append generated prose to the novel text
    appendNovelContent(userId, novelId, content);

    // If timeline data is provided, update it
    // (for now, save is the core action)

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Writer save error:", error);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}
