/**
 * Accept draft prose into branch + commit foreshadowing ledger from realized only.
 */
import {
  appendBranchContent,
  ensureMainBranch,
  getBranch,
  getBranchProse,
  getForeshadowingLedger,
  resolveBranchText,
  saveForeshadowingLedger,
} from "@/lib/db";
import {
  getForeshadowRealization,
  getProse,
  saveProse,
} from "@/core/agents/intermediate-store";
import { commitRealization } from "@/core/foreshadowing/commit";
import type { ForeshadowingRealization } from "@/core/foreshadowing/types";

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
export function acceptContinuation(input: AcceptContinuationInput): AcceptContinuationResult {
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
      error: "没有可接受的正文草稿（请先完成 write_prose）",
      code: "NO_DRAFT",
    };
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

  const ledger = getForeshadowingLedger(userId, novelId, branchId);
  const next = commitRealization(ledger, realization);
  saveForeshadowingLedger(next);
  saveProse(novelId, branchId, "");

  return {
    ok: true,
    // Length only needed by callers; avoid shipping multi-MB strings in tool results
    branchText: afterText,
    branchId,
    realizationPass: getForeshadowRealization(novelId, branchId) ? !!pass : null,
    foreshadowNote,
    activeCount: next.active.length,
    ledgerVersion: next.version,
  };
}

export function formatAcceptHint(r: AcceptContinuationResult): string {
  if (!r.ok) return `接受续写失败：${r.error}`;
  return (
    `已接受续写，写入分支 \`${r.branchId}\`（正文约 ${r.branchText?.length ?? 0} 字）。\n` +
    `${r.foreshadowNote}。活跃伏笔 ${r.activeCount ?? "?"} 条。`
  );
}
