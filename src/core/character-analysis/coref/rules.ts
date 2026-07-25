/**
 * Coref pruning rules — each returns soft delta and/or hard merge/reject.
 * Toggle via Stage3CorefConfig.rules[id].{enabled, weight}.
 */

import type { CorefRule, RuleVerdict } from "./types";

function v(
  delta: number,
  reason: string,
  hard?: "merge" | "reject",
): RuleVerdict {
  return { delta, reason, ...(hard ? { hard } : {}) };
}

/** 男 vs 女 → hard reject */
export const ruleGenderConflict: CorefRule = {
  id: "gender_conflict",
  description: "Gender 男/女 conflict → hard reject",
  defaultEnabled: true,
  defaultWeight: 1,
  evaluate(ctx) {
    if (!ctx.features.genderConflict) return null;
    return v(-1, "gender conflict (男 vs 女)", "reject");
  },
};

/**
 * Shared multi-char surfaces (exact string match in both entities).
 *
 * - count **> 3** and **never same analysis window** → hard merge
 *   (same-window pairs were already split by stage-① in-window coref;
 *   do not force-merge them just because surfaces overlap.)
 * - count **1..3**, or n>3 but same-window → soft **positive** only
 *   (n higher → higher Δ; same-window soft is capped lower)
 * - Not about character-length of a single surface.
 */
export const ruleSharedStrongSurface: CorefRule = {
  id: "shared_strong_surface",
  description:
    "Shared multi-char surfaces: n∈[1,3] soft +Δ; n>3 hard merge only if neverSameWindow",
  defaultEnabled: true,
  defaultWeight: 1,
  evaluate(ctx) {
    const s = ctx.features.sharedStrongSurfaces;
    if (!s.length) return null;
    const n = s.length;
    const sameWin = !ctx.features.neverSameWindow; // co-occurred in ≥1 window
    // Hard merge: more than 3 shared strong surfaces AND never same window
    if (n > 3 && !sameWin) {
      return v(
        0.45,
        `shared strong surfaces n=${n}>3 neverSameWindow「${s.join("、")}」`,
        "merge",
      );
    }
    // Soft positive for n = 1, 2, 3 — more shared surfaces → higher delta
    // n=1 → 0.15, n=2 → 0.28, n=3 → 0.40
    // n>3 but same-window: use n=3 soft level (no hard)
    const softByCount: Record<number, number> = {
      1: 0.15,
      2: 0.28,
      3: 0.4,
    };
    let delta = softByCount[Math.min(n, 3)] ?? 0.15 * Math.min(n, 3);
    // Same window: stage1 kept them separate → dampen soft evidence
    if (sameWin) {
      delta = Math.min(delta, 0.12);
    }
    return v(
      delta,
      `shared strong surfaces n=${n}` +
        (n > 3 && sameWin ? ">3 but sameWindow→no hard" : "≤3") +
        ` Δ=+${delta.toFixed(2)}` +
        (sameWin ? " sameWindow" : "") +
        `「${s.join("、")}」`,
    );
  },
};

/** Share only weak surfaces like 我/他 — mild positive if windows near */
export const ruleSharedWeakSurface: CorefRule = {
  id: "shared_weak_surface",
  description: "Shared weak surface (我/他/…) without strong share",
  defaultEnabled: true,
  defaultWeight: 1,
  evaluate(ctx) {
    const weak = ctx.features.sharedSurfaces.filter(
      (s) => !ctx.features.sharedStrongSurfaces.includes(s),
    );
    if (!weak.length) return null;
    if (ctx.features.sharedStrongSurfaces.length) return null;
    // 我 shared across distant windows is weak evidence alone
    const gap = ctx.features.windowGap;
    const delta = gap === 0 ? 0.12 : gap === 1 ? 0.05 : -0.05;
    return v(delta, `shared weak surface「${weak.join("、")}」 gap=${gap}`);
  },
};

/**
 * Both have multi-char surfaces the other lacks, and they share **no** strong surface.
 *
 * Soft evidence only — never hard reject. Aliases often diverge over the story
 * (将军/空军少将、一个老者/老者); string inequality must not veto merge.
 *
 * If they **do** share a strong surface, this rule does **not** fire: that is
 * positive evidence handled by `shared_strong_surface` (extra exclusive names
 * on one side are just additional aliases, not a conflict).
 */
export const ruleExclusiveProperNames: CorefRule = {
  id: "exclusive_proper_names",
  description:
    "No shared strong name + exclusive multi-char names each side → soft negative only",
  defaultEnabled: true,
  defaultWeight: 1,
  evaluate(ctx) {
    const a = ctx.features.exclusiveStrongA;
    const b = ctx.features.exclusiveStrongB;
    if (!a.length || !b.length) return null;
    // Shared strong surface → same-person signal lives in shared_strong_surface;
    // exclusive extras (黎星 on one side only, etc.) are aliases, not a penalty.
    if (ctx.features.sharedStrongSurfaces.length) {
      return null;
    }
    // No shared strong name: soft doubt only — agent decides alias vs distinct
    return v(
      -0.2,
      `distinct exclusive names「${a.join("、")}」vs「${b.join("、")}」(soft; no hard reject)`,
    );
  },
};

/** Window ranges overlap or adjacent → slight positive */
export const ruleWindowProximity: CorefRule = {
  id: "window_proximity",
  description: "Window range gap (0 touch/overlap, larger = farther)",
  defaultEnabled: true,
  defaultWeight: 1,
  evaluate(ctx) {
    const g = ctx.features.windowGap;
    if (g === 0) return v(0.1, "window ranges touch/overlap");
    if (g === 1) return v(0.05, "window ranges gap=1");
    if (g >= 3) return v(-0.15, `window ranges gap=${g}`);
    return v(-0.05, `window ranges gap=${g}`);
  },
};

/** Close mention offsets (co-occurrence in text) */
export const ruleCloseCooccur: CorefRule = {
  id: "close_cooccur",
  description: "Mention offsets within cooccurWindowChars",
  defaultEnabled: true,
  defaultWeight: 1,
  evaluate(ctx) {
    const n = ctx.features.closeMentionPairCount;
    if (n <= 0) {
      const d = ctx.features.minMentionDistance;
      if (d != null && d > ctx.config.cooccurWindowChars * 3) {
        return v(-0.1, `min mention distance=${d}`);
      }
      return null;
    }
    return v(Math.min(0.25, 0.08 * Math.log2(1 + n)), `close co-occur pairs=${n}`);
  },
};

/** Same single-char 我 only + far windows → lean reject (agent or auto) */
export const ruleNarratorFar: CorefRule = {
  id: "narrator_far_weak",
  description: "Only shared 我/你/他 and far windows → negative",
  defaultEnabled: true,
  defaultWeight: 1,
  evaluate(ctx) {
    const shared = ctx.features.sharedSurfaces;
    if (!shared.length) return null;
    const onlyPronoun = shared.every((s) =>
      ["我", "你", "他", "她", "它"].includes(s),
    );
    if (!onlyPronoun) return null;
    if (ctx.features.windowGap >= 2) {
      return v(-0.2, "only pronoun share and windowGap≥2");
    }
    return null;
  },
};

/**
 * 共现专属度 S_excl = max_X min(count(A,X)/count(A), count(B,X)/count(B)).
 * Sparse: when min(countA,countB) < jaccardSparseMinCount, S is **zeroed**
 * in features (do not count) so single-window pairs do not get S=1 for free.
 *
 * Contribution = weight × delta, with delta = S_excl ∈ [0,1].
 * defaultWeight 0.25 → max soft contrib +0.25.
 * neverSameWindow: small boost on S before multiply (only when not sparse-zeroed).
 */
export const ruleCooccurExclusivity: CorefRule = {
  id: "cooccur_exclusivity",
  description:
    "Shared-companion exclusivity (zeroed when sparse); slight boost if never same window",
  defaultEnabled: true,
  defaultWeight: 0.25,
  evaluate(ctx) {
    // Sparse gate already zeroed features.cooccurExclusivity — do not re-boost.
    if (ctx.features.cooccurSparse) {
      const raw = ctx.features.cooccurExclusivityRaw;
      if (raw <= 0) return null;
      return v(
        0,
        `cooccur exclusivity=0 (raw=${raw.toFixed(3)}, sparse→zero)` +
          (ctx.features.topExclusiveCompanion
            ? ` topX=${ctx.features.topExclusiveCompanion}`
            : ""),
      );
    }
    let s = ctx.features.cooccurExclusivity;
    if (s <= 0 && !(ctx.features.neverSameWindow && ctx.features.sharedNeighborCount > 0)) {
      return null;
    }
    if (
      ctx.features.neverSameWindow &&
      ctx.features.sharedNeighborCount > 0
    ) {
      s = Math.min(1, s + ctx.config.neverSameWindowBoost);
    }
    if (s <= 0) return null;
    const x = ctx.features.topExclusiveCompanion;
    return v(
      s,
      `cooccur exclusivity=${s.toFixed(3)}` +
        (x ? ` topX=${x}` : "") +
        (ctx.features.neverSameWindow ? " neverSameWindow" : ""),
    );
  },
};

/**
 * 共现 Jaccard = |N(A)∩N(B)| / |N(A)∪N(B)|（稀疏打折后）.
 * defaultWeight 0.15 → max soft contrib +0.15 (was 0.3).
 */
export const ruleCooccurJaccard: CorefRule = {
  id: "cooccur_jaccard",
  description:
    "Neighbor-set Jaccard; sparse discount; slight boost if never same window",
  defaultEnabled: true,
  defaultWeight: 0.15,
  evaluate(ctx) {
    let s = ctx.features.cooccurJaccard;
    if (s <= 0 && !(ctx.features.neverSameWindow && ctx.features.sharedNeighborCount > 0)) {
      return null;
    }
    if (
      ctx.features.neverSameWindow &&
      ctx.features.sharedNeighborCount > 0
    ) {
      s = Math.min(1, s + ctx.config.neverSameWindowBoost);
    }
    if (s <= 0) return null;
    return v(
      s,
      `cooccur jaccard=${s.toFixed(3)} (raw=${ctx.features.cooccurJaccardRaw.toFixed(3)}` +
        (ctx.features.cooccurSparse
          ? `, sparse×${ctx.config.jaccardSparseDiscount}`
          : "") +
        `, sharedN=${ctx.features.sharedNeighborCount}` +
        (ctx.features.neverSameWindow ? ", neverSameWindow" : "") +
        `)`,
    );
  },
};

/** Registry — add new rules here */
export const ALL_COREF_RULES: CorefRule[] = [
  ruleGenderConflict,
  ruleSharedStrongSurface,
  ruleSharedWeakSurface,
  ruleExclusiveProperNames,
  ruleWindowProximity,
  ruleCloseCooccur,
  ruleNarratorFar,
  ruleCooccurExclusivity,
  ruleCooccurJaccard,
];

export function getCorefRule(id: string): CorefRule | undefined {
  return ALL_COREF_RULES.find((r) => r.id === id);
}
