/**
 * Modular analysis (UI: 分析). Product default: run all modules.
 * Optional modules[] for API/ops; omitted/empty → ALL modules.
 *
 * Parallelism:
 * - Phase 1: story / characters / style / ideas / form
 * - Phase 2: timeline after unit split (and characters if needed)
 */
import { parseNovel } from "@/core/parser/novel-parser";
import { CharacterExtractor } from "@/core/extractor/character-extractor";
import { StoryExtractor } from "@/core/extractor/story-extractor";
import { extractWritingStyle } from "@/core/extractor/style-extractor";
import { extractIdeas } from "@/core/extractor/idea-extractor";
import { analyzeNovelForm } from "@/core/form/form-analyzer";
import { startTimelineJob } from "@/core/form/timeline-job";
import {
  saveNovel, saveStoryInfo, saveCharacters,
  getStoryInfo, getCharacters, getTimeline, getChapterStates, getNovel,
  saveGenerationLog, saveTimeline,
  upsertExtractedStyle, replaceExtractedIdeas, listStyles, listIdeas,
  saveNovelForm, getNovelForm,
  saveBranchChapterMeta, getBranchChapterMeta, ensureMainBranch,
} from "@/lib/db";
import { createLLMProvider } from "@/core/llm/factory";
import { runWithTokenContext } from "@/lib/token-usage-context";
import type {
  ExtractModule, StoryInfo, CharacterProfile, ChapterTimeline,
  CharacterChapterState, StyleLibraryEntry, IdeaLibraryEntry, WritingStyle,
  NovelFormProfile,
} from "@/types";

const ALL: ExtractModule[] = ["story", "characters", "form", "timeline", "style", "ideas"];

export interface ModularExtractInput {
  userId: string;
  novelId: string;
  text?: string;
  modules?: ExtractModule[];
  forceRefresh?: boolean;
  branchId?: string;
}

export interface ModularExtractResult {
  storyInfo?: StoryInfo | null;
  characters?: CharacterProfile[];
  timeline?: ChapterTimeline | null;
  lastChapterStates?: CharacterChapterState[];
  styles?: StyleLibraryEntry[];
  ideas?: IdeaLibraryEntry[];
  form?: NovelFormProfile | null;
  chapterCatalogCount?: number;
  /** Async timeline job id when timeline module selected */
  timelineJobId?: string;
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
    : [...ALL];

  // Empty selection → full analysis (product default; partial pick is ops-only later)
  if (modules.length === 0) {
    modules = [...ALL];
  }
  const branchId = input.branchId || "main";

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
  type Phase1Key = "story" | "characters" | "style" | "ideas" | "form";
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

  if (want("form")) {
    const cached = !forceRefresh ? getNovelForm(userId, novelId) : null;
    if (cached) {
      result.form = cached;
      result.skipped.push({ module: "form", reason: "已有缓存" });
    } else {
      runPhase1.push("form");
    }
  } else {
    result.form = getNovelForm(userId, novelId);
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

    if (mod === "form") {
      console.log("[Extract] form (chaptering / architecture)...");
      const llm = createLLMProvider("analysis");
      const formResult = await runWithTokenContext({ agentId: "extract_form" }, () =>
        analyzeNovelForm(novelId, text, llm),
      );
      saveNovelForm(userId, novelId, formResult.profile);
      ensureMainBranch(userId, novelId);
      // Always seed/overwrite main catalog when program found chapters
      // (don't leave a previous bad 1-chapter meta after force re-analyze)
      if (formResult.catalog.length > 0) {
        const existing = getBranchChapterMeta(userId, novelId, branchId);
        saveBranchChapterMeta(userId, {
          ...existing,
          novelId,
          branchId,
          chapters: formResult.catalog,
          chapterBoundary: existing?.chapterBoundary || "closed",
        });
        // Catalog length change invalidates timeline (was often 1 chapter from old job)
        const prevTl = getTimeline(userId, novelId, branchId);
        const prevN = prevTl?.chapters?.length || 0;
        const nextN = formResult.catalog.length;
        if (prevN > 0 && prevN !== nextN) {
          console.log(
            `[Extract] form catalog ${prevN}→${nextN}: clear stale timeline`,
          );
          saveTimeline(
            userId,
            novelId,
            {
              novelId,
              branchId,
              totalChapters: 0,
              chapters: [],
            },
            branchId,
          );
        }
      }
      return {
        mod,
        form: formResult.profile,
        chapterCatalogCount: formResult.catalog.length,
      } as const;
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
    } else if (r.mod === "form") {
      result.form = r.form;
      result.chapterCatalogCount = r.chapterCatalogCount;
      result.ran.push("form");
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

  // ---- Phase 2: timeline (async full job — does not block HTTP) ----
  if (want("timeline")) {
    // Hard dependency (D7): form/catalog before timeline units when possible
    if (!result.form) {
      result.form = getNovelForm(userId, novelId);
    }
    if (!result.form) {
      // Auto-run form once when missing (e.g. timeline-only selection).
      // Soft-fail: timeline still starts with scene/window units (D8).
      try {
        console.log("[Extract] timeline requires form first — analyzing form...");
        const llm = createLLMProvider("analysis");
        const formResult = await runWithTokenContext({ agentId: "extract_form" }, () =>
          analyzeNovelForm(novelId, text, llm),
        );
        saveNovelForm(userId, novelId, formResult.profile);
        ensureMainBranch(userId, novelId);
        if (formResult.catalog.length > 0) {
          const existing = getBranchChapterMeta(userId, novelId, branchId);
          saveBranchChapterMeta(userId, {
            ...existing,
            novelId,
            branchId,
            chapters: formResult.catalog,
            chapterBoundary: existing?.chapterBoundary || "closed",
          });
        }
        result.form = formResult.profile;
        result.chapterCatalogCount = formResult.catalog.length;
        if (!result.ran.includes("form")) result.ran.push("form");
      } catch (e) {
        console.warn("[Extract] auto form before timeline failed:", (e as Error).message);
        result.skipped.push({
          module: "form",
          reason: (e as Error).message || "形态分析失败，时间线将按场景/窗口切分",
        });
      }
    }

    // Units come from form catalog when chaptering enabled — must match catalog length
    const meta = getBranchChapterMeta(userId, novelId, branchId);
    const formEnabled = !!result.form?.chaptering?.enabled;
    const catalogN = formEnabled ? (meta.chapters?.length || 0) : 0;

    const cached = !forceRefresh ? getTimeline(userId, novelId, branchId) : null;
    const cachedN = cached?.chapters?.length || 0;
    // Stale when catalog was fixed (e.g. 3章) but timeline still from old 1-unit job
    const timelineStale =
      !!cached &&
      catalogN > 0 &&
      cachedN > 0 &&
      cachedN !== catalogN;

    if (cached && cachedN > 0 && !forceRefresh && !timelineStale) {
      result.timeline = cached;
      result.lastChapterStates = getChapterStates(userId, novelId, branchId);
      result.skipped.push({ module: "timeline", reason: "已有缓存" });
    } else {
      try {
        if (timelineStale) {
          console.log(
            `[Extract] timeline stale: catalog=${catalogN} vs timeline=${cachedN} → re-run`,
          );
        }
        console.log("[Extract] timeline → async job");
        const job = startTimelineJob({ userId, novelId, branchId });
        result.timelineJobId = job.id;
        result.ran.push("timeline");
        saveGenerationLog({
          id: crypto.randomUUID(),
          userId,
          novelId,
          category: "extract",
          label: "时间线异步任务",
          inputSummary: text.slice(0, 200),
          outputPreview: `job=${job.id} units=${job.total}${timelineStale ? " stale-rebuild" : ""}`,
          fullOutput: JSON.stringify({
            jobId: job.id,
            total: job.total,
            catalogN,
            cachedN,
            timelineStale,
          }),
        });
      } catch (e) {
        console.warn("[Extract] timeline job failed to start:", (e as Error).message);
        result.skipped.push({
          module: "timeline",
          reason: (e as Error).message || "启动失败",
        });
      }
    }
    if (!result.timeline) {
      result.timeline = getTimeline(userId, novelId, branchId);
      result.lastChapterStates = getChapterStates(userId, novelId, branchId);
    }
  } else {
    result.timeline = getTimeline(userId, novelId, branchId);
    result.lastChapterStates = getChapterStates(userId, novelId, branchId);
  }

  result.styles = listStyles(userId);
  result.ideas = listIdeas(userId);
  return result;
}
