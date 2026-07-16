/**
 * Modular extraction: user selects which modules to run.
 * modules: story | characters | timeline | style | ideas
 */
import { parseNovel } from "@/core/parser/novel-parser";
import { CharacterExtractor } from "@/core/extractor/character-extractor";
import { StoryExtractor } from "@/core/extractor/story-extractor";
import { TimelineExtractor } from "@/core/extractor/timeline-extractor";
import { extractWritingStyle } from "@/core/extractor/style-extractor";
import { extractIdeas } from "@/core/extractor/idea-extractor";
import {
  saveNovel, saveStoryInfo, saveCharacters, saveTimeline, saveChapterStates,
  getStoryInfo, getCharacters, getTimeline, getChapterStates, getNovel,
  saveGenerationLog,
  upsertExtractedStyle, replaceExtractedIdeas, listStyles, listIdeas,
} from "@/lib/db";
import { runWithTokenContext } from "@/lib/token-usage-context";
import type { ExtractModule, StoryInfo, CharacterProfile, ChapterTimeline, CharacterChapterState, StyleLibraryEntry, IdeaLibraryEntry } from "@/types";

const ALL: ExtractModule[] = ["story", "characters", "timeline", "style", "ideas"];

export interface ModularExtractInput {
  userId: string;
  novelId: string;
  text?: string;
  modules?: ExtractModule[];
  forceRefresh?: boolean;
}

export interface ModularExtractResult {
  storyInfo?: StoryInfo | null;
  characters?: CharacterProfile[];
  timeline?: ChapterTimeline | null;
  lastChapterStates?: CharacterChapterState[];
  styles?: StyleLibraryEntry[];
  ideas?: IdeaLibraryEntry[];
  ran: ExtractModule[];
  skipped: { module: ExtractModule; reason: string }[];
}

export async function runModularExtract(input: ModularExtractInput): Promise<ModularExtractResult> {
  const { userId } = input;
  const novelId = input.novelId || "default";

  return runWithTokenContext(
    { userId, novelId, category: "extract", agentId: "extract" },
    () => runModularExtractInner(input),
  );
}

async function runModularExtractInner(input: ModularExtractInput): Promise<ModularExtractResult> {
  const { userId } = input;
  const novelId = input.novelId || "default";
  const forceRefresh = !!input.forceRefresh;
  let modules: ExtractModule[] = Array.isArray(input.modules)
    ? input.modules.filter((m) => ALL.includes(m))
    : ["story", "characters"];

  if (modules.length === 0) {
    throw new Error("请至少选择一个拆解模块");
  }

  const existingNovel = getNovel(userId, novelId);
  let text = input.text;
  if (!text) {
    if (!existingNovel?.text) throw new Error("小说文本不存在，请先导入");
    text = existingNovel.text;
  }

  const parsed = parseNovel(text);
  // Prefer title from import (LLM / filename). Don't overwrite with first-line heuristic.
  const title =
    (existingNovel?.title && existingNovel.title.trim() && existingNovel.title !== "未命名小说"
      ? existingNovel.title.trim()
      : "") ||
    parsed.title ||
    "未命名小说";
  parsed.title = title;
  // Keep source text; do not wipe main if it already has continuations
  saveNovel(userId, novelId, title, text);

  const result: ModularExtractResult = { ran: [], skipped: [] };

  if (modules.includes("timeline") && !modules.includes("characters")) {
    const existing = getCharacters(userId, novelId);
    if (existing.length === 0) modules = ["characters", ...modules];
  }

  if (modules.includes("story")) {
    const cached = !forceRefresh ? getStoryInfo(userId, novelId) : null;
    if (cached) {
      result.storyInfo = cached;
      result.skipped.push({ module: "story", reason: "已有缓存" });
    } else {
      console.log("[Extract] story...");
      const storyInfo = await runWithTokenContext({ agentId: "extract_story" }, () =>
        new StoryExtractor(parsed).extract(),
      );
      saveStoryInfo(userId, novelId, storyInfo);
      saveGenerationLog({
        id: crypto.randomUUID(), userId, novelId, category: "extract", label: "故事信息提取",
        inputSummary: text.slice(0, 200),
        outputPreview: storyInfo.plotSummary?.slice(0, 300) || "",
        fullOutput: JSON.stringify(storyInfo),
      });
      result.storyInfo = storyInfo;
      result.ran.push("story");
    }
  } else {
    result.storyInfo = getStoryInfo(userId, novelId);
  }

  if (modules.includes("characters")) {
    const cached = !forceRefresh ? getCharacters(userId, novelId) : [];
    if (cached.length > 0 && !forceRefresh) {
      result.characters = cached;
      result.skipped.push({ module: "characters", reason: "已有缓存" });
    } else {
      console.log("[Extract] characters...");
      const characters = await runWithTokenContext({ agentId: "extract_characters" }, () =>
        new CharacterExtractor(parsed).extractAll(),
      );
      saveCharacters(userId, novelId, characters);
      saveGenerationLog({
        id: crypto.randomUUID(), userId, novelId, category: "extract", label: "角色提取",
        inputSummary: text.slice(0, 200),
        outputPreview: characters.map(c => c.name).join(", "),
        fullOutput: JSON.stringify(characters),
      });
      result.characters = characters;
      result.ran.push("characters");
    }
  } else {
    result.characters = getCharacters(userId, novelId);
  }

  if (modules.includes("timeline")) {
    const cached = !forceRefresh ? getTimeline(userId, novelId) : null;
    if (cached && !forceRefresh) {
      result.timeline = cached;
      result.lastChapterStates = getChapterStates(userId, novelId);
      result.skipped.push({ module: "timeline", reason: "已有缓存" });
    } else {
      console.log("[Extract] timeline...");
      const names = (result.characters || getCharacters(userId, novelId)).map(c => c.name);
      const timeline = await runWithTokenContext({ agentId: "extract_timeline" }, () =>
        new TimelineExtractor(parsed, names).extract(),
      );
      saveTimeline(userId, novelId, timeline);
      const lastChapterStates = timeline.chapters.length > 0
        ? timeline.chapters[timeline.chapters.length - 1].characterStates
        : [];
      saveChapterStates(userId, novelId, lastChapterStates);
      saveGenerationLog({
        id: crypto.randomUUID(), userId, novelId, category: "extract", label: "时间线提取",
        inputSummary: text.slice(0, 200),
        outputPreview: `${timeline.totalChapters}章`,
        fullOutput: JSON.stringify(timeline),
      });
      result.timeline = timeline;
      result.lastChapterStates = lastChapterStates;
      result.ran.push("timeline");
    }
  } else {
    result.timeline = getTimeline(userId, novelId);
    result.lastChapterStates = getChapterStates(userId, novelId);
  }

  if (modules.includes("style")) {
    console.log("[Extract] style...");
    let writingStyle = result.storyInfo?.writingStyle;
    try {
      writingStyle = await runWithTokenContext({ agentId: "extract_style" }, () =>
        extractWritingStyle(parsed),
      );
      if (result.storyInfo) {
        result.storyInfo = { ...result.storyInfo, writingStyle };
        saveStoryInfo(userId, novelId, result.storyInfo);
      }
    } catch (e) {
      console.warn("[Extract] dedicated style failed", (e as Error).message);
    }
    const novel = getNovel(userId, novelId);
    upsertExtractedStyle(userId, novelId, novel?.title || parsed.title, writingStyle);
    result.ran.push("style");
  }

  if (modules.includes("ideas")) {
    console.log("[Extract] ideas...");
    const novel = getNovel(userId, novelId);
    const title = novel?.title || parsed.title;
    const ideas = await runWithTokenContext({ agentId: "extract_ideas" }, () =>
      extractIdeas(parsed, novelId, title),
    );
    if (ideas.length > 0) replaceExtractedIdeas(userId, novelId, ideas);
    result.ran.push("ideas");
  }

  result.styles = listStyles(userId);
  result.ideas = listIdeas(userId);
  return result;
}
