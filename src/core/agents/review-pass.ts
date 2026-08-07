/**
 * Shared gate: when is outline/prose review "passed"?
 *
 * Rules (product):
 * 1. Any critical / major → fail
 * 2. Too many minor overall → fail
 * 3. AI-taste (ai_taste) minors are stricter — fewer allowed
 *
 * Used by outline-review pass marker, get_findings summary, master/auto-pass docs.
 */

import type { ReviewFindings } from "./intermediate-store";
import { normalizeFindingDimension } from "./intermediate-store";

/** Max minor findings across all dimensions (outline or full prose set). */
export const REVIEW_MAX_MINOR_TOTAL = 5;

/**
 * Max minor in ai_taste alone. AI 痕迹堆叠即使标 minor 也不应放行。
 */
export const REVIEW_MAX_MINOR_AI_TASTE = 2;

/** Max minor within any single non-AI dimension. */
export const REVIEW_MAX_MINOR_PER_DIM = 4;

export type ReviewPassVerdict = {
  pass: boolean;
  reasons: string[];
  counts: {
    critical: number;
    major: number;
    minor: number;
    aiTasteMinor: number;
    byDimension: Record<string, { critical: number; major: number; minor: number }>;
  };
};

function sevOf(f: { severity?: string }): string {
  return String(f.severity || "minor").toLowerCase().trim();
}

function dimOf(f: { dimension?: string }): string {
  return normalizeFindingDimension(f.dimension);
}

/**
 * Evaluate findings for pass/fail.
 * @param findings full set (outline-only for outline gate; all dims for prose)
 */
export function evaluateReviewPass(
  findings: Array<{ severity?: string; dimension?: string }>,
): ReviewPassVerdict {
  const list = findings || [];
  const byDimension: ReviewPassVerdict["counts"]["byDimension"] = {};
  let critical = 0;
  let major = 0;
  let minor = 0;
  let aiTasteMinor = 0;

  for (const f of list) {
    const sev = sevOf(f);
    const dim = dimOf(f);
    if (!byDimension[dim]) {
      byDimension[dim] = { critical: 0, major: 0, minor: 0 };
    }
    if (sev === "critical") {
      critical++;
      byDimension[dim].critical++;
    } else if (sev === "major") {
      major++;
      byDimension[dim].major++;
    } else {
      // treat unknown as minor (store defaults to minor)
      minor++;
      byDimension[dim].minor++;
      if (dim === "ai_taste") aiTasteMinor++;
    }
  }

  const reasons: string[] = [];
  if (critical > 0) {
    reasons.push(`存在 ${critical} 条 fatal/critical`);
  }
  if (major > 0) {
    reasons.push(`存在 ${major} 条 major`);
  }
  if (minor > REVIEW_MAX_MINOR_TOTAL) {
    reasons.push(
      `次要问题过多（minor=${minor} > ${REVIEW_MAX_MINOR_TOTAL}）`,
    );
  }
  if (aiTasteMinor > REVIEW_MAX_MINOR_AI_TASTE) {
    reasons.push(
      `AI痕迹次要过多（ai_taste minor=${aiTasteMinor} > ${REVIEW_MAX_MINOR_AI_TASTE}）`,
    );
  }
  for (const [dim, c] of Object.entries(byDimension)) {
    if (dim === "ai_taste") continue; // already covered
    if (c.minor > REVIEW_MAX_MINOR_PER_DIM) {
      reasons.push(
        `${dim} 维次要过多（minor=${c.minor} > ${REVIEW_MAX_MINOR_PER_DIM}）`,
      );
    }
  }

  return {
    pass: reasons.length === 0,
    reasons,
    counts: { critical, major, minor, aiTasteMinor, byDimension },
  };
}

/** Convenience for outline gate (outline dimension only). */
export function outlineReviewFailedFromFindings(
  findings: Array<{ severity?: string; dimension?: string }>,
): boolean {
  return !evaluateReviewPass(findings).pass;
}

/** One-line Chinese summary for tools / master. */
export function formatReviewPassLine(verdict: ReviewPassVerdict): string {
  const { counts } = verdict;
  const tally = `critical=${counts.critical} major=${counts.major} minor=${counts.minor} ai_taste_minor=${counts.aiTasteMinor}`;
  if (verdict.pass) {
    return `【审查通过】${tally}`;
  }
  return `【审查未通过】${tally}；原因：${verdict.reasons.join("；")}`;
}
