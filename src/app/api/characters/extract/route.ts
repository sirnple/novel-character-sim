import { NextRequest, NextResponse } from "next/server";
import { parseNovel } from "@/core/parser/novel-parser";
import { CharacterExtractor } from "@/core/extractor/character-extractor";
import { StoryExtractor } from "@/core/extractor/story-extractor";
import { TimelineExtractor } from "@/core/extractor/timeline-extractor";
import { saveNovel, saveStoryInfo, saveCharacters, saveTimeline, saveChapterStates, getStoryInfo, getCharacters, getTimeline, getChapterStates, saveGenerationLog } from "@/lib/db";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import type { StoryInfo, CharacterProfile, ChapterTimeline, CharacterChapterState } from "@/types";

export async function POST(request: NextRequest) {
  // Extract is very expensive (5+ LLM calls). Strict limit.
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "extract", { windowMs: 300_000, maxRequests: 3 });
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
      const cachedStory = getStoryInfo(userId, novelId);
      const cachedChars = getCharacters(userId, novelId);
      if (cachedStory && cachedChars.length > 0) {
        console.log(`[Extract] Using cached data for ${novelId}`);
        const cachedTimeline = getTimeline(userId, novelId);
        const cachedLastStates = getChapterStates(userId, novelId);
        return NextResponse.json({ storyInfo: cachedStory, characters: cachedChars, timeline: cachedTimeline, lastChapterStates: cachedLastStates, fromCache: true });
      }
    }

    // Save novel text
    saveNovel(userId, novelId, parsed.title, text);

    // Extract story/world info
    console.log("[Extract] Starting story extraction...");
    const storyExtractor = new StoryExtractor(parsed);
    const storyInfo: StoryInfo = await storyExtractor.extract();
    saveStoryInfo(userId, novelId, storyInfo);
    saveGenerationLog({
      id: crypto.randomUUID(),
      userId,
      novelId,
      category: "extract",
      label: "故事信息提取",
      inputSummary: text.slice(0, 200),
      outputPreview: storyInfo.plotSummary?.slice(0, 300) || "",
      fullOutput: JSON.stringify(storyInfo),
    });

    // Extract characters
    console.log("[Extract] Starting character extraction...");
    const charExtractor = new CharacterExtractor(parsed);
    const characters: CharacterProfile[] = await charExtractor.extractAll();
    saveCharacters(userId, novelId, characters);
    saveGenerationLog({
      id: crypto.randomUUID(),
      userId,
      novelId,
      category: "extract",
      label: "角色提取",
      inputSummary: text.slice(0, 200),
      outputPreview: characters.map(ch => ch.name).join(", "),
      fullOutput: JSON.stringify(characters),
    });

    // Extract timeline and last-chapter character states
    console.log("[Extract] Starting timeline extraction...");
    const timelineExtractor = new TimelineExtractor(parsed, characters.map(c => c.name));
    const timeline: ChapterTimeline = await timelineExtractor.extract();
    saveTimeline(userId, novelId, timeline);

    const lastChapterStates: CharacterChapterState[] = timeline.chapters.length > 0
      ? timeline.chapters[timeline.chapters.length - 1].characterStates
      : [];
    saveChapterStates(userId, novelId, lastChapterStates);
    saveGenerationLog({
      id: crypto.randomUUID(),
      userId,
      novelId,
      category: "extract",
      label: "时间线提取",
      inputSummary: text.slice(0, 200),
      outputPreview: `${timeline.totalChapters}章, ${timeline.chapters.reduce((sum,ch) => sum + ch.events.length, 0)}个事件`,
      fullOutput: JSON.stringify(timeline),
    });

    return NextResponse.json({ storyInfo, characters, timeline, lastChapterStates, fromCache: false });
  } catch (error) {
    console.error("Extraction error:", error);
    const message = error instanceof Error ? error.message : "Failed to extract";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
