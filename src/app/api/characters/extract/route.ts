import { NextRequest, NextResponse } from "next/server";
import { parseNovel } from "@/core/parser/novel-parser";
import { CharacterExtractor } from "@/core/extractor/character-extractor";
import { StoryExtractor } from "@/core/extractor/story-extractor";
import { saveNovel, saveStoryInfo, saveCharacters, getStoryInfo, getCharacters } from "@/lib/db";
import { checkRateLimit, getClientIP, rateLimitMessage } from "@/lib/rate-limit";
import type { StoryInfo, CharacterProfile } from "@/types";

export async function POST(request: NextRequest) {
  // Extract is very expensive (5+ LLM calls). Strict limit.
  const ip = getClientIP(request);
  const rate = checkRateLimit(ip, "extract", { windowMs: 300_000, maxRequests: 3 });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: rateLimitMessage(rate) },
      { status: 429 }
    );
  }

  try {
    const { sessionId, text, forceRefresh } = await request.json();

    if (!text) {
      return NextResponse.json({ error: "Novel text is required" }, { status: 400 });
    }

    const parsed = parseNovel(text);
    const novelId = sessionId || "default";

    // Check if cached results exist and refresh not forced
    if (!forceRefresh) {
      const cachedStory = getStoryInfo(novelId);
      const cachedChars = getCharacters(novelId);
      if (cachedStory && cachedChars.length > 0) {
        console.log(`[Extract] Using cached data for ${novelId}`);
        return NextResponse.json({ storyInfo: cachedStory, characters: cachedChars, fromCache: true });
      }
    }

    // Save novel text
    saveNovel(novelId, parsed.title, text);

    // Extract story/world info
    console.log("[Extract] Starting story extraction...");
    const storyExtractor = new StoryExtractor(parsed);
    const storyInfo: StoryInfo = await storyExtractor.extract();
    saveStoryInfo(novelId, storyInfo);

    // Extract characters
    console.log("[Extract] Starting character extraction...");
    const charExtractor = new CharacterExtractor(parsed);
    const characters: CharacterProfile[] = await charExtractor.extractAll();
    saveCharacters(novelId, characters);

    return NextResponse.json({ storyInfo, characters, fromCache: false });
  } catch (error) {
    console.error("Extraction error:", error);
    const message = error instanceof Error ? error.message : "Failed to extract";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
