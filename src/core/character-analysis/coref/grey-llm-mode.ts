/**
 * Grey-zone LLM routing: oneshot vs deep (multi-turn agent).
 *
 * Grey band is (autoReject, autoMerge). Inside it:
 * - near autoReject / autoMerge edges → oneshot (rules almost decided; one LLM pass)
 * - middle → deep (true ambiguity; richer context / multi-turn)
 *
 * Edge strength uses **asymmetric** Gaussians in normalized u-space:
 *   u = (score - T_reject) / (T_merge - T_reject)  ∈ (0,1)
 *   e_reject = exp( -u² / (2 σ_reject²) )           // high near reject edge
 *   e_merge  = exp( -(1-u)² / (2 σ_merge²) )       // high near merge edge
 * oneshot if max(e_reject, e_merge) ≥ tau; else deep
 *
 * Larger σ → wider oneshot band on that edge (deep mid shrinks from that side).
 * Default: σ_reject ≥ σ_merge → wider oneshot near reject; deep extends closer
 * to auto_merge (false-merge side still gets more deep coverage).
 */

import type { PairFeatures, Stage3CorefConfig } from "./types";

export type GreyLlmMode = "oneshot" | "deep";

export interface GreyLlmModeResult {
  mode: GreyLlmMode;
  /** Normalized position in grey band (0=reject edge, 1=merge edge). */
  u: number;
  /** Edge strength near autoReject. */
  edgeReject: number;
  /** Edge strength near autoMerge. */
  edgeMerge: number;
  /** max(edgeReject, edgeMerge) */
  edgeMax: number;
  reason: string;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Select oneshot vs deep for a grey-zone score.
 * Scores outside grey should not call this (caller routes auto_merge/reject first).
 */
export function selectGreyLlmMode(
  score: number,
  config: Stage3CorefConfig,
  features?: PairFeatures | null,
): GreyLlmModeResult {
  const lo = config.autoRejectThreshold;
  const hi = config.autoMergeThreshold;
  const width = Math.max(1e-6, hi - lo);
  const u = clamp01((score - lo) / width);

  const sigR = Math.max(1e-4, config.greySigmaReject);
  const sigM = Math.max(1e-4, config.greySigmaMerge);
  const tau = clamp01(config.greyEdgeTau);

  const edgeReject = Math.exp(-(u * u) / (2 * sigR * sigR));
  const edgeMerge = Math.exp(-((1 - u) * (1 - u)) / (2 * sigM * sigM));
  const edgeMax = Math.max(edgeReject, edgeMerge);

  // Edge → oneshot; mid-grey → deep (compute follows uncertainty, not threshold risk)
  let mode: GreyLlmMode = edgeMax >= tau ? "oneshot" : "deep";
  let reason =
    edgeMax >= tau
      ? edgeMerge >= edgeReject
        ? `near-merge edgeMax=${edgeMax.toFixed(3)}≥τ=${tau} → oneshot`
        : `near-reject edgeMax=${edgeMax.toFixed(3)}≥τ=${tau} → oneshot`
      : `mid-grey edgeMax=${edgeMax.toFixed(3)}<τ=${tau} → deep`;

  // Optional: mid-band without identity-strong share stays deep even if slightly
  // into the merge-edge oneshot skirt (legacy flag name kept for config compat).
  // When false (default), pure score routing applies.
  if (
    config.greyForceDeepNearMergeNoStrong === true &&
    features &&
    features.sharedStrongSurfaces.length === 0 &&
    u >= 0.35 &&
    u <= 0.85 &&
    mode === "oneshot" &&
    edgeMerge >= edgeReject
  ) {
    mode = "deep";
    reason = `mid/near-merge no-strong u=${u.toFixed(3)} force deep (${reason})`;
  }

  return {
    mode,
    u,
    edgeReject,
    edgeMerge,
    edgeMax,
    reason,
  };
}
