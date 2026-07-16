/**
 * Modular extraction: user selects which modules to run.
 * modules: story | characters | timeline | style | ideas
 *
 * Parallelism:
 * - Phase 1 (independent): story / characters / style / ideas in Promise.all
 * - Phase 2 (depends on character names): timeline after characters ready
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
import type {
  ExtractModule, StoryInfo, CharacterProfile, ChapterTimeline,
  CharacterChapterState, StyleLibraryEntry, IdeaLibraryEntry, WritingStyle,
} from "@/types";

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
  const title =
    (existingNovel?.title && existingNovel.title.trim() && existingNovel.title !== "未命名小说"
      ? existingNovel.title.trim()
      : "") ||
    parsed.title ||
    "未命名小说";
  parsed.title = title;
  saveNovel(userId, novelId, title, text);

  const result: ModularExtractResult = { ran: [], skipped: [] };

  // timeline needs character names
  if (modules.includes("timeline") && !modules.includes("characters")) {
    const existing = getCharacters(userId, novelId);
    if (existing.length === 0) modules = ["characters", ...modules];
  }

  const want = (m: ExtractModule) => modules.includes(m);

  // ---- resolve cache / skip for phase-1 modules ----
  type Phase1Key = "story" | "characters" | "style" | "ideas";
  const runPhase1: Phase1Key[] = [];

  if (want("story")) {
    const cached = !forceRefresh ? getStoryInfo(userId, novelId) : null;
    if (cached) {
      result.storyInfo = cached;
      result.skipped.push({ module: "story", reason: "已有缓存" });
    } else {
      runPhase1.push("story");
    }
  } else {
    result.storyInfo = getStoryInfo(userId, novelId);
  }

  if (want("characters")) {
    const cached = !forceRefresh ? getCharacters(userId, novelId) : [];
    if (cached.length > 0 && !forceRefresh) {
      result.characters = cached;
      result.skipped.push({ module: "characters", reason: "已有缓存" });
    } else {
      runPhase1.push("characters");
    }
  } else {
    result.characters = getCharacters(userId, novelId);
  }

  if (want("style")) {
    // style always re-runs when selected (no cheap cache key); still parallel-safe
    runPhase1.push("style");
  }

  if (want("ideas")) {
    runPhase1.push("ideas");
  }

  console.log(
    `[Extract] phase1 parallel: [${runPhase1.join(", ") || "none"}] ` +
      `then timeline=${want("timeline")}`,
  );

  // ---- Phase 1: independent LLM extracts in parallel ----
  const phase1Jobs = runPhase1.map(async (mod) => {
    if (mod === "story") {
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
      return { mod, storyInfo } as const;
    }

    if (mod === "characters") {
      console.log("[Extract] characters...");
      const characters = await runWithTokenContext({ agentId: "extract_characters" }, () =>
        new CharacterExtractor(parsed).extractAll(),
      );
      saveCharacters(userId, novelId, characters);
      saveGenerationLog({
        id: crypto.randomUUID(), userId, novelId, category: "extract", label: "角色提取",
        inputSummary: text.slice(0, 200),
        outputPreview: characters.map((c) => c.name).join(", "),
        fullOutput: JSON.stringify(characters),
      });
      return { mod, characters } as const;
    }

    if (mod === "style") {
      console.log("[Extract] style...");
      let writingStyle: WritingStyle | undefined;
      try {
        writingStyle = await runWithTokenContext({ agentId: "extract_style" }, () =>
          extractWritingStyle(parsed),
        );
      } catch (e) {
        console.warn("[Extract] dedicated style failed", (e as Error).message);
      }
      return { mod, writingStyle } as const;
    }

    // ideas
    console.log("[Extract] ideas...");
    const novel = getNovel(userId, novelId);
    const bookTitle = novel?.title || parsed.title;
    const ideas = await runWithTokenContext({ agentId: "extract_ideas" }, () =>
      extractIdeas(parsed, novelId, bookTitle),
    );
    if (ideas.length > 0) replaceExtractedIdeas(userId, novelId, ideas);
    return { mod, ideas } as const;
  });

  const phase1Results = await Promise.all(phase1Jobs);

  for (const r of phase1Results) {
    if (r.mod === "story") {
      result.storyInfo = r.storyInfo;
      result.ran.push("story");
    } else if (r.mod === "characters") {
      result.characters = r.characters;
      result.ran.push("characters");
    } else if (r.mod === "style") {
      const writingStyle = r.writingStyle;
      if (writingStyle && result.storyInfo) {
        result.storyInfo = { ...result.storyInfo, writingStyle };
        saveStoryInfo(userId, novelId, result.storyInfo);
      } else if (writingStyle && !result.storyInfo) {
        // story not in this run — still persist style library
        const existing = getStoryInfo(userId, novelId);
        if (existing) {
          result.storyInfo = { ...existing, writingStyle };
          saveStoryInfo(userId, novelId, result.storyInfo);
        }
      }
      const novel = getNovel(userId, novelId);
      upsertExtractedStyle(userId, novelId, novel?.title || parsed.title, writingStyle);
      result.ran.push("style");
    } else if (r.mod === "ideas") {
      result.ran.push("ideas");
    }
  }

  // ---- Phase 2: timeline (needs character names) ----
  if (want("timeline")) {
    const cached = !forceRefresh ? getTimeline(userId, novelId) : null;
    if (cached && !forceRefresh) {
      result.timeline = cached;
      result.lastChapterStates = getChapterStates(userId, novelId);
      result.skipped.push({ module: "timeline", reason: "已有缓存" });
    } else {
      console.log("[Extract] timeline...");
      const names = (result.characters || getCharacters(userId, novelId)).map((c) => c.name);
      const timeline = await runWithTokenContext({ agentId: "extract_timeline" }, () =>
        new TimelineExtractor(parsed, names).extract(),
      );
      saveTimeline(userId, novelId, timeline);
      const lastChapterStates =
        timeline.chapters.length > 0
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

  result.styles = listStyles(userId);
  result.ideas = listIdeas(userId);
  return result;
}
