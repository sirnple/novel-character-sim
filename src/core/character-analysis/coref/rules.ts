/**
 * Coref pruning rules — each returns soft delta and/or hard merge/reject.
 * Toggle via Stage3CorefConfig.rules[id].{enabled, weight}.
 *
 * Mention **kind** drives identity vs weak evidence:
 * - proper | personal_nick → shared_strong / exclusive_proper
 * - deictic | generic | kinship | title | desc → weak only; co-occur scaled down
 */

import type { CorefRule, PairContext, RuleVerdict } from "./types";

function v(
  delta: number,
  reason: string,
  hard?: "merge" | "reject",
): RuleVerdict {
  return { delta, reason, ...(hard ? { hard } : {}) };
}

function hasSharedIdentity(ctx: PairContext): boolean {
  return ctx.features.sharedStrongSurfaces.length > 0;
}

/** Scale positive co-occur deltas when pair lacks identity-strong share. */
function scaleCooccurDelta(ctx: PairContext, delta: number): number {
  if (delta <= 0 || hasSharedIdentity(ctx)) return delta;
  const scale = ctx.config.cooccurNoIdentityScale;
  const s =
    Number.isFinite(scale) && scale > 0 && scale <= 1 ? scale : 0.25;
  return delta * s;
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
    "Shared identity-strong surfaces (proper|personal_nick): n∈[1,3] soft +Δ; n>3 hard merge if neverSameWindow",
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

/**
 * Shared non-identity surfaces, scored by **kind** (weaker side):
 * - deictic: tiny / negative when far
 * - generic / desc: small (这小子 cannot glue people)
 * - kinship / title: mild near windows
 * Skipped when there is already shared strong identity.
 */
export const ruleSharedWeakSurface: CorefRule = {
  id: "shared_weak_surface",
  description:
    "Shared weak surfaces by kind (deictic/generic/kinship/title/desc); no strong share",
  defaultEnabled: true,
  defaultWeight: 1,
  evaluate(ctx) {
    if (hasSharedIdentity(ctx)) return null;
    const f = ctx.features;
    const gap = f.windowGap;
    const parts: string[] = [];
    let delta = 0;

    if (f.sharedDeicticSurfaces.length) {
      // Pure pronouns: almost no merge evidence
      const d = gap === 0 ? 0.04 : gap === 1 ? 0 : -0.08;
      delta += d;
      parts.push(`deictic「${f.sharedDeicticSurfaces.join("、")}」Δ=${d}`);
    }
    if (f.sharedGenericSurfaces.length) {
      const d = gap === 0 ? 0.05 : gap === 1 ? 0.02 : -0.05;
      delta += d;
      parts.push(`generic「${f.sharedGenericSurfaces.join("、")}」Δ=${d}`);
    }
    if (f.sharedDescSurfaces.length) {
      const d = gap === 0 ? 0.06 : gap === 1 ? 0.02 : -0.04;
      delta += d;
      parts.push(`desc「${f.sharedDescSurfaces.join("、")}」Δ=${d}`);
    }
    if (f.sharedKinshipSurfaces.length) {
      const d = gap === 0 ? 0.08 : gap === 1 ? 0.04 : -0.03;
      delta += d;
      parts.push(`kinship「${f.sharedKinshipSurfaces.join("、")}」Δ=${d}`);
    }
    if (f.sharedTitleSurfaces.length) {
      const d = gap === 0 ? 0.08 : gap === 1 ? 0.04 : -0.03;
      delta += d;
      parts.push(`title「${f.sharedTitleSurfaces.join("、")}」Δ=${d}`);
    }

    if (!parts.length) return null;
    // Cap: weak kinds alone must stay well below auto_merge with prior 0.5
    delta = Math.max(-0.2, Math.min(0.12, delta));
    return v(delta, `shared weak by kind gap=${gap} ${parts.join("; ")}`);
  },
};

/**
 * Both have exclusive **proper** names the other lacks, and they share **no**
 * identity-strong surface (proper | personal_nick).
 *
 * Soft evidence only — never hard reject (aliases / incomplete windows still go
 * to agent). Generic shared surfaces (这小子) do NOT suppress this rule.
 *
 * Title-only exclusives (将军 vs 空军少将) are not propers → rule does not fire.
 */
export const ruleExclusiveProperNames: CorefRule = {
  id: "exclusive_proper_names",
  description:
    "No shared identity-strong surface + exclusive proper each side → soft negative",
  defaultEnabled: true,
  defaultWeight: 1,
  evaluate(ctx) {
    const a = ctx.features.exclusiveProperA;
    const b = ctx.features.exclusiveProperB;
    if (!a.length || !b.length) return null;
    // Shared proper/personal_nick → positive path handles it; extra propers are aliases
    if (ctx.features.sharedStrongSurfaces.length) {
      return null;
    }
    // Stronger soft penalty: distinct person names with only weak/generic share
    return v(
      -0.4,
      `distinct exclusive propers「${a.join("、")}」vs「${b.join("、")}」(soft; no hard reject)`,
    );
  },
};

/**
 * Window-range proximity, scaled by novel length (window count).
 *
 * r = windowGap / max(1, nWindows - 1)  — fraction of the book's window span.
 * No short/long book branch: long books make the same absolute gap a smaller r.
 *
 * Thresholds (config): proximityNearFrac / Mid / Far.
 * Fallback when nWindows < 2: legacy absolute gap ladder.
 */
export const ruleWindowProximity: CorefRule = {
  id: "window_proximity",
  description:
    "Window range gap relative to novel window count (r=gap/(nWin-1))",
  defaultEnabled: true,
  defaultWeight: 1,
  evaluate(ctx) {
    const g = ctx.features.windowGap;
    if (g === 0) return v(0.1, "window ranges touch/overlap");

    const nWin = ctx.windows?.length ?? 0;
    if (nWin < 2) {
      // Tests / missing span — absolute gap (legacy)
      if (g === 1) return v(0.05, "window ranges gap=1 (no span)");
      if (g >= 3) return v(-0.15, `window ranges gap=${g} (no span)`);
      return v(-0.05, `window ranges gap=${g} (no span)`);
    }

    const denom = Math.max(1, nWin - 1);
    const r = g / denom;
    const near = ctx.config.proximityNearFrac;
    const mid = ctx.config.proximityMidFrac;
    const far = ctx.config.proximityFarFrac;
    const tag = `r=${r.toFixed(3)} gap=${g} nWin=${nWin}`;

    if (r < near) return v(0.05, `window gap near ${tag}`);
    if (r < mid) return v(-0.05, `window gap mid ${tag}`);
    if (r < far) return v(-0.1, `window gap far ${tag}`);
    return v(-0.15, `window gap very far ${tag}`);
  },
};

/**
 * Close mention offsets (positive only). Far-apart penalty is left to
 * `window_proximity` — do not double-count distance here.
 * Positive delta scaled by cooccurNoIdentityScale without identity share.
 */
export const ruleCloseCooccur: CorefRule = {
  id: "close_cooccur",
  description:
    "Mention offsets within cooccurWindowChars (positive only); ×cooccurNoIdentityScale if no shared strong",
  defaultEnabled: true,
  defaultWeight: 1,
  evaluate(ctx) {
    const n = ctx.features.closeMentionPairCount;
    if (n <= 0) return null;
    const raw = Math.min(0.25, 0.08 * Math.log2(1 + n));
    const delta = scaleCooccurDelta(ctx, raw);
    const tag = hasSharedIdentity(ctx) ? "" : " noIdentity×scale";
    return v(delta, `close co-occur pairs=${n}${tag}`);
  },
};

/** Only shared deictic kinds + far windows → lean reject */
export const ruleNarratorFar: CorefRule = {
  id: "narrator_far_weak",
  description: "Only shared deictic kinds and far windows → negative",
  defaultEnabled: true,
  defaultWeight: 1,
  evaluate(ctx) {
    const shared = ctx.features.sharedSurfaces;
    if (!shared.length) return null;
    if (hasSharedIdentity(ctx)) return null;
    const onlyDeictic =
      ctx.features.sharedDeicticSurfaces.length > 0 &&
      ctx.features.sharedDeicticSurfaces.length === shared.length;
    if (!onlyDeictic) return null;
    if (ctx.features.windowGap >= 2) {
      return v(
        -0.2,
        `only deictic share「${ctx.features.sharedDeicticSurfaces.join("、")}」 windowGap≥2`,
      );
    }
    return null;
  },
};

/**
 * 共现专属度 S_excl = max_X min(count(A,X)/count(A), count(B,X)/count(B)).
 * Sparse (min window count < jaccardSparseMinCount): features already have
 * S × exclusivitySparseDiscount (default 0.1) — soft credit, not full S=1.
 *
 * Contribution = weight × delta, with delta = S_excl ∈ [0,1].
 * defaultWeight 0.25 → max soft contrib +0.25.
 * neverSameWindow: small boost on S before multiply (skipped when sparse,
 * so single-window pairs cannot recover to ~1 via boost).
 */
export const ruleCooccurExclusivity: CorefRule = {
  id: "cooccur_exclusivity",
  description:
    "Shared-companion exclusivity (sparse×discount); slight boost if never same window",
  defaultEnabled: true,
  defaultWeight: 0.25,
  evaluate(ctx) {
    let s = ctx.features.cooccurExclusivity;
    if (s <= 0 && !(ctx.features.neverSameWindow && ctx.features.sharedNeighborCount > 0)) {
      return null;
    }
    // Sparse pairs keep discounted S only — no neverSameWindow boost on top.
    if (
      !ctx.features.cooccurSparse &&
      ctx.features.neverSameWindow &&
      ctx.features.sharedNeighborCount > 0
    ) {
      s = Math.min(1, s + ctx.config.neverSameWindowBoost);
    }
    if (s <= 0) return null;
    const delta = scaleCooccurDelta(ctx, s);
    const x = ctx.features.topExclusiveCompanion;
    const sparseTag = ctx.features.cooccurSparse
      ? ` sparse×${ctx.config.exclusivitySparseDiscount}`
      : "";
    return v(
      delta,
      `cooccur exclusivity=${s.toFixed(3)}` +
        (ctx.features.cooccurSparse
          ? ` (raw=${ctx.features.cooccurExclusivityRaw.toFixed(3)}${sparseTag})`
          : "") +
        (x ? ` topX=${x}` : "") +
        (ctx.features.neverSameWindow ? " neverSameWindow" : "") +
        (hasSharedIdentity(ctx) ? "" : " noIdentity×scale"),
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
    const delta = scaleCooccurDelta(ctx, s);
    return v(
      delta,
      `cooccur jaccard=${s.toFixed(3)} (raw=${ctx.features.cooccurJaccardRaw.toFixed(3)}` +
        (ctx.features.cooccurSparse
          ? `, sparse×${ctx.config.jaccardSparseDiscount}`
          : "") +
        `, sharedN=${ctx.features.sharedNeighborCount}` +
        (ctx.features.neverSameWindow ? ", neverSameWindow" : "") +
        (hasSharedIdentity(ctx) ? "" : ", noIdentity×scale") +
        `)`,
    );
  },
};

/**
 * Two entity records co-occur in the same analysis window(s).
 * Mild soft signal only — co-presence ≠ automatically different people
 * (agent must still weigh mention similarity / aliases).
 */
export const ruleSameWindowCooccur: CorefRule = {
  id: "same_window_cooccur",
  description:
    "sameWindowCount≥1 → mild soft negative (co-presence hint; not decisive)",
  defaultEnabled: true,
  defaultWeight: 1,
  evaluate(ctx) {
    const n = ctx.features.sameWindowCount;
    if (n <= 0) return null;
    if (hasSharedIdentity(ctx)) {
      return v(-0.04, `sameWindowCount=${n} (shared strong — very mild)`);
    }
    const delta = n >= 2 ? -0.12 : -0.08;
    return v(delta, `sameWindowCount=${n} co-presence hint (check surfaces)`);
  },
};

/**
 * Mentions of A and B sit close in the novel with no shared strong surface.
 * Mild soft signal only — nearby offsets may be two people or name+alias.
 */
export const ruleCloseMentionDifferent: CorefRule = {
  id: "close_mention_diff",
  description:
    "Close mention offsets without shared strong → mild soft negative (hint)",
  defaultEnabled: true,
  defaultWeight: 1,
  evaluate(ctx) {
    if (hasSharedIdentity(ctx)) return null;
    const d = ctx.features.minMentionDistance;
    if (d == null) return null;
    if (d <= 400) {
      return v(-0.08, `minMentionDistance=${d}≤400 nearby (no shared strong)`);
    }
    if (d <= 1200) {
      return v(-0.04, `minMentionDistance=${d}≤1200 nearby (no shared strong)`);
    }
    return null;
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
  ruleCloseMentionDifferent,
  ruleSameWindowCooccur,
  ruleNarratorFar,
  ruleCooccurExclusivity,
  ruleCooccurJaccard,
];

export function getCorefRule(id: string): CorefRule | undefined {
  return ALL_COREF_RULES.find((r) => r.id === id);
}
