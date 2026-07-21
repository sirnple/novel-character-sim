/**
 * Stable agent-facing view of novel form (骨) + branch chapter meta.
 * Pure: no DB, no LLM.
 */
import type {
  BranchChapterMeta,
  ChapterCatalogEntry,
  ChapterTrack,
  NovelFormProfile,
  UnitPresence,
} from "@/types";
import {
  catalogTrackStats,
  CONTINUATION_TRACK_OPTIONS,
  effectiveTrack,
  lastMainChapter,
  lastPhysicalChapter,
  mainlineChapters,
  needsContinuationTrackChoice,
  trackLabelZh,
} from "./chapter-track";

export interface FormAgentContext {
  novelId: string;
  branchId: string;
  /** Whether analysis found usable chaptering */
  chapteringEnabled: boolean;
  chapteringConfidence: number;
  formType: string;
  unitHierarchy: {
    volume: UnitPresence;
    chapter: UnitPresence;
    section: UnitPresence;
  };
  /** When true, writer/outline must not invent 第N章 unless user asks */
  forbidInventChapterTitles: boolean;
  chapterTitleSamples: string[];
  titlePattern: string;
  numbering: string;
  continuationRules: string[];
  chapterBoundary: "open" | "closed" | "unknown";
  openChapter?: { number?: number; title?: string; startedAtOffset: number };
  lastClosedChapter?: { number?: number; title?: string; endOffset: number };
  /** Last mainline chapter (for 第N章 planning) */
  lastMainChapter?: {
    number?: number;
    title: string;
    endOffset?: number;
    track: ChapterTrack;
  };
  /** Physical last catalog entry (may be 番外) */
  lastPhysicalChapter?: {
    number?: number;
    title: string;
    endOffset?: number;
    track: ChapterTrack;
  };
  trackStats: {
    main: number;
    extra: number;
    front_matter: number;
    back_matter: number;
    volume: number;
    total: number;
  };
  /**
   * When true (分章开启且书末非主线)，主编必须 ask_question 再大纲/正文。
   * Options: CONTINUATION_TRACK_OPTIONS
   */
  needsContinuationTrackChoice: boolean;
  continuationTrackOptions: string[];
  /** Truncated catalog for prompt size (includes track) */
  catalogTail: Array<{
    number?: number;
    title: string;
    startOffset: number;
    track: ChapterTrack;
  }>;
  catalogCount: number;
  mainCatalogCount: number;
  /** One-line human hint for prompts */
  summaryLine: string;
}

const DEFAULT_NO_CHAPTER_RULES = [
  "形态未分析或弱分章：除非用户明确要求分章，不要添加「第N章」标题。",
];

function slimChapter(c: ChapterCatalogEntry) {
  return {
    number: c.number,
    title: c.title,
    endOffset: c.endOffset,
    track: effectiveTrack(c),
  };
}

export function buildFormAgentContext(input: {
  form: NovelFormProfile | null;
  chapterMeta: BranchChapterMeta | null;
  novelId: string;
  branchId: string;
}): FormAgentContext {
  const { novelId, branchId } = input;
  const form = input.form;
  const meta = input.chapterMeta;

  const enabled = !!form?.chaptering?.enabled;
  const confidence = form?.chaptering?.confidence ?? 0;
  const samples = form?.chaptering?.samples?.slice(0, 8) || [];
  const rules =
    form?.continuationRules?.filter(Boolean).slice(0, 8) ||
    DEFAULT_NO_CHAPTER_RULES;

  const chapters = meta?.chapters || [];
  const stats = catalogTrackStats(chapters);
  const main = mainlineChapters(chapters);
  const lastMain = lastMainChapter(chapters);
  const lastPhys = lastPhysicalChapter(chapters);
  const needChoice = needsContinuationTrackChoice(enabled, chapters);

  const catalogTail = chapters.slice(-12).map((c) => ({
    number: c.number,
    title: c.title,
    startOffset: c.startOffset,
    track: effectiveTrack(c),
  }));

  const chapterBoundary = meta?.chapterBoundary ?? "unknown";
  const forbidInventChapterTitles = !enabled;

  let summaryLine: string;
  if (!form) {
    summaryLine = "未找到形态分析：按弱分章处理，禁止发明第N章。";
  } else if (enabled) {
    summaryLine =
      `分章开启（confidence=${confidence.toFixed(2)}）；边界=${chapterBoundary}；` +
      `目录 ${chapters.length}（主线 ${stats.main}` +
      (stats.extra ? ` · 番外 ${stats.extra}` : "") +
      (stats.front_matter + stats.back_matter
        ? ` · 序尾 ${stats.front_matter + stats.back_matter}`
        : "") +
      `）；样例：${samples.slice(0, 2).join(" / ") || "无"}`;
    if (needChoice && lastPhys) {
      summaryLine +=
        ` 【须先 ask】书末是${trackLabelZh(effectiveTrack(lastPhys))}「${lastPhys.title}」，` +
        `勿直接当主线下一章。`;
    }
  } else {
    summaryLine = `弱分章/不分章（formType=${form.formType}）：禁止发明第N章，除非用户要求。`;
  }

  return {
    novelId,
    branchId,
    chapteringEnabled: enabled,
    chapteringConfidence: confidence,
    formType: form?.formType || "unknown",
    unitHierarchy: form?.unitHierarchy || {
      volume: "absent",
      chapter: "absent",
      section: "absent",
    },
    forbidInventChapterTitles,
    chapterTitleSamples: samples,
    titlePattern: form?.chaptering?.titlePattern || "",
    numbering: form?.chaptering?.numbering || "none",
    continuationRules: rules,
    chapterBoundary,
    openChapter: meta?.openChapter,
    lastClosedChapter: meta?.lastClosedChapter,
    lastMainChapter: lastMain ? slimChapter(lastMain) : undefined,
    lastPhysicalChapter: lastPhys ? slimChapter(lastPhys) : undefined,
    trackStats: stats,
    needsContinuationTrackChoice: needChoice,
    continuationTrackOptions: [...CONTINUATION_TRACK_OPTIONS],
    catalogTail,
    catalogCount: chapters.length,
    mainCatalogCount: main.length,
    summaryLine,
  };
}

export function formatFormAgentContextForTool(ctx: FormAgentContext): string {
  return JSON.stringify(ctx, null, 2);
}
