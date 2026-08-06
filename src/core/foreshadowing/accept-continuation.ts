/**
 * Accept draft prose into branch + commit foreshadowing ledger from realized only.
 */
import {
  appendBranchContent,
  ensureMainBranch,
  getBranch,
  getBranchChapterMeta,
  getBranchProse,
  getForeshadowingLedger,
  getNovelForm,
  rebuildBranchChapterMetaFromText,
  resolveBranchText,
  saveBranchChapterMeta,
  saveForeshadowingLedger,
} from "@/lib/db";
import {
  getForeshadowRealization,
  getProse,
  saveProse,
  getChapterTitle,
  clearChapterTitle,
  commitPendingIdeasOnAccept,
  awaitPendingCharacterRels,
  clearPendingCharacters,
} from "@/core/agents/intermediate-store";
import { commitPendingCharactersToNovel } from "@/core/agents/agents/character-intro-tools";
import { commitRealization } from "@/core/foreshadowing/commit";
import type { ForeshadowingRealization } from "@/core/foreshadowing/types";
import type { ChapterCatalogEntry } from "@/types";
import { extractChapterCatalog } from "@/core/form/chapter-catalog";

export interface AcceptContinuationInput {
  userId: string;
  novelId: string;
  branchId: string;
  /** Optional explicit prose; default from store save_prose */
  content?: string;
  fromOffset?: number;
}

export interface AcceptContinuationResult {
  ok: boolean;
  error?: string;
  code?: string;
  branchText?: string;
  branchId?: string;
  realizationPass?: boolean | null;
  foreshadowNote?: string;
  activeCount?: number;
  ledgerVersion?: number;
  charactersAdded?: number;
  characterNames?: string[];
}

function emptyRealization(
  novelId: string,
  branchId: string,
): ForeshadowingRealization {
  return {
    novelId,
    branchId,
    reviewedAt: new Date().toISOString(),
    pass: true,
    findings: [],
    realized: { planted: [], advanced: [], revealed: [], abandoned: [] },
    gaps: { planNotRealized: [], realizedNotInPlan: [] },
  };
}

/**
 * Always commits ledger from realized (actual text), never pretends plan was fully done.
 * Missing realization → empty realized (no false plant/reveal).
 */
export async function acceptContinuation(
  input: AcceptContinuationInput,
): Promise<AcceptContinuationResult> {
  const { userId, novelId } = input;
  const branchId = input.branchId || "main";
  let content = (input.content || "").trim() || (getProse(novelId, branchId) || "").trim();

  if (!novelId) return { ok: false, error: "novelId required", code: "NO_NOVEL" };

  ensureMainBranch(userId, novelId);
  const existing = getBranch(userId, novelId, branchId);
  if (!existing && branchId !== "main") {
    return { ok: false, error: "分支不存在", code: "NO_BRANCH" };
  }

  // Compare against resolved full body (CoW-safe)
  const resolvedBefore = getBranchProse(userId, novelId, branchId).text || "";
  if (resolvedBefore && content.length > resolvedBefore.length + 20) {
    if (
      content.startsWith(resolvedBefore.slice(0, Math.min(500, resolvedBefore.length))) &&
      content.startsWith(resolvedBefore)
    ) {
      content = content.slice(resolvedBefore.length).replace(/^\s+/, "");
    }
  }

  if (!content || content.length < 50) {
    return {
      ok: false,
      error: "没有可接受的正文草稿（请先完成 writer）",
      code: "NO_DRAFT",
    };
  }

  // Prepend chapter title from chapter_title_generator (outline/writer must not invent titles)
  const titleDraft = getChapterTitle(novelId, branchId);
  const titleLine = String(titleDraft?.final_title || "").trim();
  if (titleLine) {
    const head = content.slice(0, Math.min(120, content.length));
    const alreadyHas =
      head.startsWith(titleLine) ||
      /^第[^\n]{0,40}章/.test(head) ||
      head.split("\n")[0]?.trim() === titleLine;
    if (!alreadyHas) {
      content = `${titleLine}\n\n${content}`;
    }
  }

  const storedRealization = getForeshadowRealization(novelId, branchId);
  const realization = storedRealization || emptyRealization(novelId, branchId);

  const gaps = realization.gaps?.planNotRealized?.length || 0;
  const pass = realization.pass;
  let foreshadowNote: string;
  if (!storedRealization) {
    foreshadowNote = "无伏笔结算记录，账本按空 realized（无假回收）";
  } else if (pass) {
    foreshadowNote = "伏笔审查 pass；账本按 realized 更新";
  } else {
    foreshadowNote =
      `伏笔未按 plan 全落实（gaps≈${gaps}）；账本只按 realized 实际落实更新，未假装完成 plan`;
  }

  appendBranchContent(
    userId,
    novelId,
    branchId,
    content,
    Number.isFinite(input.fromOffset as number) ? input.fromOffset : undefined,
  );
  const afterText = resolveBranchText(userId, novelId, branchId);

  // Rebuild chapter catalog from full branch text (new 第N章 titles + tip endOffset)
  try {
    updateChapterMetaAfterAccept(userId, novelId, branchId, content, afterText);
  } catch (e) {
    console.warn("[accept] chapter meta update failed:", (e as Error).message);
  }

  const ledger = getForeshadowingLedger(userId, novelId, branchId);
  const next = commitRealization(ledger, realization);
  saveForeshadowingLedger(next);
  saveProse(novelId, branchId, "");
  clearChapterTitle(novelId, branchId);
  // Ideas only count as used after final accept
  const committedIdeas = commitPendingIdeasOnAccept(novelId, branchId);

  // Wait for async character relationship jobs, then merge pending intros into novel cast
  try {
    await awaitPendingCharacterRels(novelId, branchId, 25_000);
  } catch (e) {
    console.warn(
      "[accept] await character rels:",
      (e as Error).message || e,
    );
  }
  let charCommit = { added: 0, total: 0, names: [] as string[] };
  try {
    charCommit = commitPendingCharactersToNovel(userId, novelId, branchId);
    clearPendingCharacters(novelId, branchId);
  } catch (e) {
    console.warn(
      "[accept] commit pending characters failed:",
      (e as Error).message || e,
    );
  }

  return {
    ok: true,
    // Length only needed by callers; avoid shipping multi-MB strings in tool results
    branchText: afterText,
    branchId,
    realizationPass: getForeshadowRealization(novelId, branchId) ? !!pass : null,
    foreshadowNote:
      foreshadowNote +
      (committedIdeas.length
        ? `；点子已消耗 ${committedIdeas.length} 条`
        : "") +
      (charCommit.added
        ? `；新角色入库 ${charCommit.added}：${charCommit.names.join("、")}`
        : ""),
    activeCount: next.active.length,
    ledgerVersion: next.version,
    charactersAdded: charCommit.added,
    characterNames: charCommit.names,
  };
}

/**
 * Rebuild chapter catalog after accept.
 * Skip only when form explicitly disables chaptering.
 */
function updateChapterMetaAfterAccept(
  userId: string,
  novelId: string,
  branchId: string,
  draftChunk: string,
  fullText: string,
): void {
  const form = getNovelForm(userId, novelId);
  // Explicit false only — missing form still try rebuild from headings
  if (form?.chaptering?.enabled === false) return;

  const before = getBranchChapterMeta(userId, novelId, branchId);
  const beforeN = before.chapters?.length || 0;
  const tipLen = fullText.length;

  // 1) Full-text program catalog (preferred)
  rebuildBranchChapterMetaFromText(userId, novelId, branchId, fullText);
  let chapters = getBranchChapterMeta(userId, novelId, branchId).chapters || [];

  // 2) Extract found nothing but we already had a TOC: keep it and stretch last endOffset
  if (!chapters.length && before.chapters?.length) {
    chapters = stretchCatalogToTip(before.chapters, tipLen);
    saveTipMeta(userId, novelId, branchId, chapters, tipLen);
    chapters = getBranchChapterMeta(userId, novelId, branchId).chapters || [];
  }

  // 3) Still empty: scan draft chunk for 第N章 and append after previous catalog
  if (!chapters.length && draftChunk.trim()) {
    const draftCatalog = extractChapterCatalog(draftChunk, form?.chaptering);
    if (draftCatalog.length) {
      const anchor = draftChunk.trim().slice(0, 48);
      let baseLen = tipLen - draftChunk.length;
      if (anchor) {
        const idx = fullText.lastIndexOf(anchor);
        if (idx >= 0) baseLen = idx;
      }
      baseLen = Math.max(0, Math.min(baseLen, tipLen));
      const mapped: ChapterCatalogEntry[] = draftCatalog.map((c) => ({
        ...c,
        startOffset: baseLen + c.startOffset,
        endOffset:
          c.endOffset != null ? baseLen + c.endOffset : tipLen,
        source: "accept",
      }));
      const prevKept = (before.chapters || []).filter((c) => c.startOffset < baseLen);
      chapters = stretchCatalogToTip([...prevKept, ...mapped], tipLen);
      saveTipMeta(userId, novelId, branchId, chapters, tipLen);
      chapters = getBranchChapterMeta(userId, novelId, branchId).chapters || [];
    }
  }

  // 4) Always stretch tip endOffset (接本章 without new title still moves the tip)
  if (chapters.length) {
    const stretched = stretchCatalogToTip(chapters, tipLen);
    saveTipMeta(userId, novelId, branchId, stretched, tipLen);
  }

  const afterN = getBranchChapterMeta(userId, novelId, branchId).chapters?.length || 0;
  console.log(
    `[accept] chapter-meta ${novelId}/${branchId}: ${beforeN} → ${afterN} units, textLen=${tipLen}`,
  );
}

function stretchCatalogToTip(
  chapters: ChapterCatalogEntry[],
  tipLen: number,
): ChapterCatalogEntry[] {
  if (!chapters.length) return [];
  const sorted = [...chapters].sort((a, b) => a.startOffset - b.startOffset);
  for (let i = 0; i < sorted.length; i++) {
    sorted[i] = {
      ...sorted[i],
      endOffset:
        i + 1 < sorted.length ? sorted[i + 1].startOffset : tipLen,
    };
  }
  return sorted;
}

function saveTipMeta(
  userId: string,
  novelId: string,
  branchId: string,
  chapters: ChapterCatalogEntry[],
  tipLen: number,
): void {
  const last = chapters.length ? chapters[chapters.length - 1] : undefined;
  const lastMain = [...chapters]
    .reverse()
    .find((c) => !c.track || c.track === "main");
  saveBranchChapterMeta(userId, {
    novelId,
    branchId,
    chapters,
    lastClosedChapter: last
      ? {
          number: last.number,
          title: last.title,
          endOffset: last.endOffset ?? tipLen,
          track: last.track || "main",
        }
      : undefined,
    lastMainChapter: lastMain
      ? {
          number: lastMain.number,
          title: lastMain.title,
          endOffset: lastMain.endOffset ?? tipLen,
          track: "main",
        }
      : undefined,
  });
}

export function formatAcceptHint(r: AcceptContinuationResult): string {
  if (!r.ok) return `接受续写失败：${r.error}`;
  const charNote =
    r.charactersAdded && r.charactersAdded > 0
      ? `新角色入库 ${r.charactersAdded}：${(r.characterNames || []).join("、")}。`
      : "";
  return (
    `已接受续写，写入分支 \`${r.branchId}\`（正文约 ${r.branchText?.length ?? 0} 字）。\n` +
    `${r.foreshadowNote}。活跃伏笔 ${r.activeCount ?? "?"} 条。` +
    (charNote ? `\n${charNote}` : "") +
    `（章名草案已消费/清空）`
  );
}
