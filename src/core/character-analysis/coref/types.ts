/**
 * Stage ③ co-occurrence / agent coref — types for rule scoring + dispatch.
 */

import type { MergedCharacter } from "../merge-adjacent";
import type { AnalysisWindow } from "../types";

/** Features derived once per unordered pair (for rules + agent prompt). */
export interface PairFeatures {
  idA: string;
  idB: string;
  surfacesA: string[];
  surfacesB: string[];
  /** Intersection of normalized surfaces */
  sharedSurfaces: string[];
  /**
   * Shared identity-strong surfaces (kind proper | personal_nick on both sides).
   * Generic epithets (这小子) / titles / kinship are NOT strong.
   */
  sharedStrongSurfaces: string[];
  /** Shared surfaces with kind=proper on both sides */
  sharedProperSurfaces: string[];
  /** Surfaces only in A / only in B that are identity-strong */
  exclusiveStrongA: string[];
  exclusiveStrongB: string[];
  /** Surfaces only in A / only in B with kind=proper */
  exclusiveProperA: string[];
  exclusiveProperB: string[];
  /**
   * Shared surfaces whose **weaker** side kind is the given bucket
   * (not identity-strong). Used by weak-surface / cooccur gates.
   */
  sharedDeicticSurfaces: string[];
  sharedGenericSurfaces: string[];
  sharedKinshipSurfaces: string[];
  sharedTitleSurfaces: string[];
  sharedDescSurfaces: string[];
  genderA?: string;
  genderB?: string;
  ageA?: string;
  ageB?: string;
  /** Normalized gender conflict (男 vs 女) */
  genderConflict: boolean;
  windowLoA: number;
  windowHiA: number;
  windowLoB: number;
  windowHiB: number;
  /** Gap between window ranges; 0 if overlap/touch */
  windowGap: number;
  /** Min distance between any two mention globalStarts (chars); null if missing anchors */
  minMentionDistance: number | null;
  /** How many mention-offset pairs fall within `cooccurWindowChars` */
  closeMentionPairCount: number;

  // ── Window co-occurrence graph (stage ③) ─────────────────────────
  /**
   * 专属度 S_excl after sparse gate.
   * Raw: max_X min( count(A,X)/count(A), count(B,X)/count(B) ) over shared companions X.
   * When min(appearCountA, appearCountB) < jaccardSparseMinCount →
   * exclusivity × exclusivitySparseDiscount (default 0.1).
   */
  cooccurExclusivity: number;
  cooccurExclusivityRaw: number;
  topExclusiveCompanion: string | null;
  /** Jaccard of neighbor sets after sparse discount ∈ [0,1] */
  cooccurJaccard: number;
  cooccurJaccardRaw: number;
  /** True when sparse gate applied (excl + jaccard discounted) */
  cooccurSparse: boolean;
  /** Windows both A and B appear in */
  sameWindowCount: number;
  /**
   * True if A and B never appear in the same analysis window.
   * (Often evidence they may be the same person under different names.)
   */
  neverSameWindow: boolean;
  /** Distinct windows A / B appear in */
  appearCountA: number;
  appearCountB: number;
  sharedNeighborCount: number;
}

export interface PairContext {
  a: MergedCharacter;
  b: MergedCharacter;
  features: PairFeatures;
  windows: AnalysisWindow[];
  fullTextLength: number;
  config: Stage3CorefConfig;
}

/** Single rule contribution. */
export interface RuleVerdict {
  /**
   * Signed evidence (any finite real). Typical range about [-1, 1] by convention.
   * Aggregated as: score = clamp(prior + Σ weight_i * delta_i, 0, 1).
   * weight is always positive; sign of contribution comes from delta.
   */
  delta: number;
  /** Absolute override (evaluated after all soft rules; reject wins over merge). */
  hard?: "merge" | "reject";
  reason: string;
}

export interface CorefRule {
  id: string;
  description: string;
  defaultEnabled: boolean;
  /** Default multiplier on delta; must be positive */
  defaultWeight: number;
  evaluate(ctx: PairContext): RuleVerdict | null;
}

export interface RuleRuntimeConfig {
  enabled?: boolean;
  /**
   * Multiplier on rule delta. Must be a **positive** finite number (> 0).
   * Invalid / non-positive values fall back to the rule's defaultWeight.
   * (Not normalized across rules.)
   */
  weight?: number;
}

export interface Stage3CorefConfig {
  /** score ≥ this → auto merge (no agent) */
  autoMergeThreshold: number;
  /** score ≤ this → auto reject (no agent) */
  autoRejectThreshold: number;
  /** Base score before rules */
  prior: number;
  /**
   * Mentions within this char distance count as "close co-occur"
   * for feature closeMentionPairCount.
   */
  cooccurWindowChars: number;
  /**
   * min(count(A),count(B)) below this → sparse gate
   * (single-window pairs would otherwise get S_excl=1 for free).
   */
  jaccardSparseMinCount: number;
  /** Jaccard × this when sparse. Default 0.5. */
  jaccardSparseDiscount: number;
  /** Exclusivity × this when sparse. Default 0.1 (stricter than Jaccard). */
  exclusivitySparseDiscount: number;
  /**
   * Added to exclusivity/jaccard **delta** when neverSameWindow && shared neighbors.
   * Keep small — large boosts + prior 0.5 easily hit auto_merge.
   */
  neverSameWindowBoost: number;
  /** Per-rule enable/weight overrides (keyed by rule id) */
  rules: Record<string, RuleRuntimeConfig>;
  /**
   * Soft advisory only: if grey-zone pair count exceeds this, log a warning.
   * Does **not** cap or skip agent calls (0 = never warn).
   * (Historical name: used to hard-cap at 200 — that cap is removed.)
   */
  agentMaxPairs: number;
  /** Skip agent entirely (rules only) */
  agentEnabled: boolean;
  /** Parallel LLM judgments for grey-zone pairs (default 6). */
  agentConcurrency: number;
  /**
   * After rules + grey agent, force agent on any remaining UF-disjoint pair
   * that still shares ≥1 surface (兜底). Default true.
   */
  sameSurfaceAgentPass: boolean;
  /**
   * When an entity has ≥1 non-deictic surface (name/title), drop deictic
   * pronouns (我/你/他/她/…) from coref surface matching / residual pass.
   * Pure-pronoun entities (e.g. narrator 我 only) keep them. Default true.
   */
  stripDeicticWhenHasName: boolean;
  /**
   * Soft auto_merge (score ≥ threshold, no hard merge) requires ≥1 shared
   * identity-strong surface (kind proper | personal_nick). Blocks pure
   * co-occur / weak-surface auto_merge (g4-style). Hard-rule merge still allowed.
   * Default true.
   */
  requireSharedStrongForAutoMerge: boolean;
  /**
   * When there is no shared identity-strong surface, multiply positive
   * co-occur rule deltas (close_cooccur / exclusivity / jaccard) by this
   * factor ∈ (0,1]. Default 0.25 → co-occur alone cannot hit auto_merge.
   */
  cooccurNoIdentityScale: number;
  /**
   * window_proximity: r = windowGap / (nWindows-1).
   * r < near → soft +; r < mid → light −; r < far → −0.10; else −0.15.
   * Defaults ~2/26, 5/26, 10/26 on a 27-window book.
   */
  proximityNearFrac: number;
  proximityMidFrac: number;
  proximityFarFrac: number;
  /**
   * Grey LLM routing (score ∈ (autoReject, autoMerge)):
   * edgeReject = exp(-u²/(2 σ_reject²)), edgeMerge = exp(-(1-u)²/(2 σ_merge²)).
   * deep if max(edges) ≥ greyEdgeTau; else oneshot.
   * **σ_merge > σ_reject** → wider deep band near auto_merge (asymmetric care).
   */
  /** σ in u-space for reject-edge Gaussian. Default 0.16. */
  greySigmaReject: number;
  /** σ in u-space for merge-edge Gaussian. Default 0.26 (wider than reject). */
  greySigmaMerge: number;
  /** Edge strength threshold for deep mode. Default 0.45. */
  greyEdgeTau: number;
  /**
   * If true, grey pairs near merge side without sharedStrong force deep.
   * Default true.
   */
  greyForceDeepNearMergeNoStrong: boolean;
}

export const STAGE3_DEFAULT_CONFIG: Stage3CorefConfig = {
  autoMergeThreshold: 0.85,
  /** score ≤ this → auto_reject (grey is open above). Raised from 0.15 after
   *  multi-book histogram: low bins rarely agent-merge. */
  autoRejectThreshold: 0.4,
  prior: 0.5,
  cooccurWindowChars: 800,
  jaccardSparseMinCount: 3,
  jaccardSparseDiscount: 0.5,
  exclusivitySparseDiscount: 0.1,
  neverSameWindowBoost: 0.05,
  rules: {},
  agentMaxPairs: 200,
  agentEnabled: true,
  agentConcurrency: 6,
  sameSurfaceAgentPass: true,
  stripDeicticWhenHasName: true,
  requireSharedStrongForAutoMerge: true,
  cooccurNoIdentityScale: 0.25,
  proximityNearFrac: 0.08,
  proximityMidFrac: 0.2,
  proximityFarFrac: 0.4,
  greySigmaReject: 0.16,
  greySigmaMerge: 0.26,
  greyEdgeTau: 0.45,
  greyForceDeepNearMergeNoStrong: true,
};

export type PairDecisionKind = "auto_merge" | "auto_reject" | "agent" | "agent_merge" | "agent_reject" | "agent_skipped";

export interface RuleScoreBreakdown {
  ruleId: string;
  enabled: boolean;
  weight: number;
  delta: number;
  weighted: number;
  hard?: "merge" | "reject";
  reason: string;
}

export interface PairScoreResult {
  idA: string;
  idB: string;
  score: number;
  hard: "merge" | "reject" | null;
  breakdown: RuleScoreBreakdown[];
  decision: PairDecisionKind;
  agentAnswer?: boolean;
  agentReason?: string;
  /** Grey LLM path: oneshot pairwise vs deep multi-turn agent. */
  llmMode?: "oneshot" | "deep";
  llmModeReason?: string;
}

export interface Stage3ResolveResult {
  config: Stage3CorefConfig;
  inputCount: number;
  characters: MergedCharacter[];
  pairCount: number;
  scored: PairScoreResult[];
  stats: {
    autoMerge: number;
    autoReject: number;
    agent: number;
    agentMerge: number;
    agentReject: number;
    agentSkipped: number;
    /** Grey pairs routed to single-shot LLM */
    agentOneshot: number;
    /** Grey pairs routed to deep multi-turn agent */
    agentDeep: number;
    /** Same-surface residual pass: pairs sent to agent */
    sameSurfacePass: number;
    sameSurfaceMerge: number;
    sameSurfaceReject: number;
  };
}
