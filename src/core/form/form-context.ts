/**
 * Stable agent-facing view of novel form (骨) + branch chapter meta.
 * Pure: no DB, no LLM.
 */
import type { BranchChapterMeta, NovelFormProfile, UnitPresence } from "@/types";

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
  /** Truncated catalog for prompt size */
  catalogTail: Array<{ number?: number; title: string; startOffset: number }>;
  catalogCount: number;
  /** One-line human hint for prompts */
  summaryLine: string;
}

const DEFAULT_NO_CHAPTER_RULES = [
  "形态未分析或弱分章：除非用户明确要求分章，不要添加「第N章」标题。",
];

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
  const catalogTail = chapters.slice(-12).map((c) => ({
    number: c.number,
    title: c.title,
    startOffset: c.startOffset,
  }));

  const chapterBoundary = meta?.chapterBoundary ?? "unknown";
  const forbidInventChapterTitles = !enabled;

  let summaryLine: string;
  if (!form) {
    summaryLine = "未找到形态分析：按弱分章处理，禁止发明第N章。";
  } else if (enabled) {
    summaryLine = `分章开启（confidence=${confidence.toFixed(2)}）；边界=${chapterBoundary}；目录 ${chapters.length} 条；样例：${samples.slice(0, 2).join(" / ") || "无"}`;
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
    catalogTail,
    catalogCount: chapters.length,
    summaryLine,
  };
}

export function formatFormAgentContextForTool(ctx: FormAgentContext): string {
  return JSON.stringify(ctx, null, 2);
}
