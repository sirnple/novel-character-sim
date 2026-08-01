/**
 * AnalysisSession — deep facade over staging workspace + character extract.
 *
 * Product rules:
 * - Results stay in session until user confirms save (commit).
 * - One-click analyze is always mode "full" (all domains re-run from scratch).
 * - Multi-turn after full keeps the same session until commit (do not drop full mode).
 *
 * Callers should prefer this module over juggling forceRefresh / beginWorkspace.
 */
import {
  beginNovelAnalysisWorkspace,
  getNovelAnalysisWorkspace,
  patchNovelAnalysisWorkspace,
  type NovelAnalysisWorkspace,
} from "@/core/extractor/novel-analysis-workspace";
import {
  clearCharacterExtractWorkspace,
  getCharacterExtractWorkspace,
} from "@/core/character-analysis/runtime/character-extract-workspace";
import { buildFormDraftFromText } from "@/core/form/form-analyzer";
import { buildNameScanUnits } from "@/core/character-analysis/runtime/character-name-units";
import { getBranchProse, getNovel } from "@/lib/db";

/** full = 一键从头；continue = 同一会话续聊（不 wipe，也不清 full 标记） */
export type AnalysisSessionMode = "full" | "continue";

export type AnalysisSessionIds = {
  userId: string;
  novelId: string;
  branchId?: string;
};

function ids(input: AnalysisSessionIds) {
  return {
    userId: input.userId || "guest",
    novelId: input.novelId,
    branchId: input.branchId || "main",
  };
}

function loadFullText(
  userId: string,
  novelId: string,
  branchId: string,
  explicit?: string,
): string {
  if (explicit?.trim()) return explicit.trim();
  const ws = getNovelAnalysisWorkspace(userId, novelId, branchId);
  if (ws?.fullText?.trim()) return ws.fullText.trim();
  const { text } = getBranchProse(userId, novelId, branchId);
  if (text?.trim()) return text.trim();
  return (getNovel(userId, novelId)?.text || "").trim();
}

/**
 * Whether this session only counts staged drafts as "done"
 * (full re-run; published DB must not short-circuit status/commit).
 */
export function isFullAnalysisSession(input: AnalysisSessionIds): boolean {
  const { userId, novelId, branchId } = ids(input);
  return !!getNovelAnalysisWorkspace(userId, novelId, branchId)?.forceRefresh;
}

/** Seed program form/units so wave-2 agents have units without multi-step form LLM. */
function seedFormIntoSession(
  userId: string,
  novelId: string,
  branchId: string,
  fullText: string,
): { units: number; catalog: number } {
  const built = buildFormDraftFromText(novelId, fullText);
  const units = buildNameScanUnits(fullText);
  const catalog = built.catalog.map((c, i, arr) => ({
    ...c,
    endOffset:
      i + 1 < arr.length ? arr[i + 1]!.startOffset : fullText.length,
  }));
  patchNovelAnalysisWorkspace(userId, novelId, branchId, {
    form: built.profile,
    formDraft: built.profile,
    formCatalog: catalog,
    formCatalogHints: built.catalogHints,
    units,
  });
  return { units: units.length, catalog: catalog.length };
}

/**
 * Ensure analysis session exists for this novel/branch.
 *
 * - mode "full": wipe staging + character extract, mark full, seed form.
 * - mode "continue": keep staging; by default **exit full** so status uses DB again.
 * - preserveFull: true keeps full semantics without wipe (一键多轮续聊).
 */
export function ensureAnalysisSession(
  input: AnalysisSessionIds & {
    mode: AnalysisSessionMode;
    fullText?: string;
    /**
     * Only for mode=continue: keep full-session flag (status ignores DB).
     * Default false — ordinary chat must see published domains as done.
     */
    preserveFull?: boolean;
  },
): {
  mode: AnalysisSessionMode;
  full: boolean;
  seededForm: boolean;
  fullTextLen: number;
} {
  const { userId, novelId, branchId } = ids(input);
  const fullText = loadFullText(userId, novelId, branchId, input.fullText);

  if (input.mode === "full") {
    beginNovelAnalysisWorkspace(userId, novelId, branchId, {
      fullText,
      forceRefresh: true,
    });
    clearCharacterExtractWorkspace(userId, novelId, branchId);
    let seededForm = false;
    if (fullText) {
      try {
        seedFormIntoSession(userId, novelId, branchId, fullText);
        seededForm = true;
      } catch (e) {
        console.warn(
          "[analysis-session] form seed failed:",
          (e as Error).message,
        );
      }
    }
    console.log(
      `[analysis-session] full start user=${userId} novel=${novelId} seededForm=${seededForm}`,
    );
    return {
      mode: "full",
      full: true,
      seededForm,
      fullTextLen: fullText.length,
    };
  }

  // continue: create if missing; never wipe
  const existing = getNovelAnalysisWorkspace(userId, novelId, branchId);
  if (!existing) {
    beginNovelAnalysisWorkspace(userId, novelId, branchId, {
      fullText,
      forceRefresh: false,
    });
  } else {
    const patch: { fullText?: string; forceRefresh?: boolean } = {};
    if (fullText) patch.fullText = fullText;
    // 非一键续聊：退出 full，status 重新认已入库结果
    if (!input.preserveFull && existing.forceRefresh) {
      patch.forceRefresh = false;
      console.log(
        `[analysis-session] exit full → continue user=${userId} novel=${novelId}`,
      );
    }
    if (Object.keys(patch).length) {
      patchNovelAnalysisWorkspace(userId, novelId, branchId, patch);
    }
  }

  const full = isFullAnalysisSession({ userId, novelId, branchId });
  return {
    mode: "continue",
    full,
    seededForm: false,
    fullTextLen: fullText.length,
  };
}

/**
 * Minimum domains that must be staged before commit in a full session.
 * Empty for continue sessions that may only promote partial staging.
 */
export function fullSessionCommitGaps(input: AnalysisSessionIds): string[] {
  if (!isFullAnalysisSession(input)) return [];
  const { userId, novelId, branchId } = ids(input);
  const ws = getNovelAnalysisWorkspace(userId, novelId, branchId);
  const cws = getCharacterExtractWorkspace(userId, novelId, branchId);
  const missing: string[] = [];
  if (!(ws?.form || ws?.formDraft)) missing.push("章法");
  if (!(cws?.entities?.length || ws?.charactersDraft?.length)) {
    missing.push("角色名单");
  }
  if (!ws?.storyInfo?.plotSummary) missing.push("故事");
  return missing;
}

export function getSessionWorkspace(
  input: AnalysisSessionIds,
): NovelAnalysisWorkspace | null {
  const { userId, novelId, branchId } = ids(input);
  return getNovelAnalysisWorkspace(userId, novelId, branchId);
}
