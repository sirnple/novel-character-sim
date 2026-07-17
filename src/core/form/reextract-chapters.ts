/**
 * Standalone chapter catalog re-scan (program-first, no LLM required).
 * Updates branch meta + form.chaptering; invalidates stale timeline when count changes.
 */
import type {
  BranchChapterMeta,
  ChapterCatalogEntry,
  NovelFormProfile,
} from "@/types";
import {
  extractChapterCatalog,
  inferChapteringFromCatalog,
} from "./chapter-catalog";
import { emptyFormProfile } from "./form-analyzer";
import {
  ensureMainBranch,
  getBranchChapterMeta,
  getBranchProse,
  getNovelForm,
  getTimeline,
  saveBranchChapterMeta,
  saveNovelForm,
  saveTimeline,
} from "@/lib/db";

export interface ReextractChaptersInput {
  userId: string;
  novelId: string;
  branchId?: string;
  /** If omitted, load branch prose from DB */
  text?: string;
  /**
   * When catalog length changes vs saved timeline:
   * - "clear" (default): wipe timeline so UI doesn't show wrong chapter count
   * - "keep": leave timeline (caller may rebuild)
   */
  onTimelineMismatch?: "clear" | "keep";
}

export interface ReextractChaptersResult {
  catalog: ChapterCatalogEntry[];
  meta: BranchChapterMeta;
  form: NovelFormProfile;
  previousCatalogCount: number;
  timelineCleared: boolean;
  /** Hint for UI: suggest re-running timeline module */
  suggestTimelineRerun: boolean;
}

export function reextractChapters(
  input: ReextractChaptersInput,
): ReextractChaptersResult {
  const branchId = input.branchId || "main";
  const { userId, novelId } = input;
  ensureMainBranch(userId, novelId);

  let text = input.text;
  if (!text?.trim()) {
    const prose = getBranchProse(userId, novelId, branchId);
    text = prose.text || "";
  }
  if (!text.trim()) {
    throw new Error("正文为空，无法扫描章节");
  }

  const existing = getBranchChapterMeta(userId, novelId, branchId);
  const previousCatalogCount = existing.chapters?.length || 0;

  const catalog = extractChapterCatalog(text);
  // Always recompute endOffset chain for jump safety
  for (let i = 0; i < catalog.length; i++) {
    catalog[i].endOffset =
      i + 1 < catalog.length
        ? catalog[i + 1].startOffset
        : text.length;
  }

  const chaptering = inferChapteringFromCatalog(text, catalog);

  const meta: BranchChapterMeta = {
    ...existing,
    novelId,
    branchId,
    chapters: catalog,
    chapterBoundary: existing.chapterBoundary || "closed",
    updatedAt: new Date().toISOString(),
  };
  saveBranchChapterMeta(userId, meta);

  // Merge chaptering into form; keep narrativeArchitecture / formType if present
  const prevForm = getNovelForm(userId, novelId) || emptyFormProfile(novelId);
  const form: NovelFormProfile = {
    ...prevForm,
    novelId,
    chaptering: {
      ...prevForm.chaptering,
      ...chaptering,
    },
    unitHierarchy: {
      ...prevForm.unitHierarchy,
      chapter: chaptering.enabled
        ? "present"
        : catalog.length === 1
          ? "weak"
          : prevForm.unitHierarchy?.chapter || "absent",
    },
    continuationRules:
      chaptering.enabled && catalog.length >= 2
        ? [
            "本书分章：新开章时使用与 samples 一致的章标题格式。",
            "续写同一章时不要无故新起「第N章」。",
            `章名样例：${chaptering.samples.slice(0, 3).join(" / ") || "（无）"}`,
            ...(prevForm.continuationRules || []).filter(
              (r) => !r.includes("分章") && !r.includes("第N章") && !r.includes("章名样例"),
            ).slice(0, 5),
          ]
        : prevForm.continuationRules || emptyFormProfile(novelId).continuationRules,
    updatedAt: new Date().toISOString(),
  };
  saveNovelForm(userId, novelId, form);

  let timelineCleared = false;
  const onMismatch = input.onTimelineMismatch || "clear";
  const tl = getTimeline(userId, novelId, branchId);
  const tlN = tl?.chapters?.length || 0;
  const catalogN = catalog.length;
  const mismatch =
    tlN > 0 && catalogN > 0 && tlN !== catalogN;

  if (mismatch && onMismatch === "clear") {
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
    timelineCleared = true;
  }

  return {
    catalog,
    meta,
    form,
    previousCatalogCount,
    timelineCleared,
    suggestTimelineRerun:
      timelineCleared ||
      (catalogN >= 2 && (tlN === 0 || mismatch)),
  };
}
