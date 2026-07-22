/**
 * Character coref hyperparameters (① window / ② overlap / residual co-occur).
 *
 * Sources (priority high → low):
 * 1. Explicit function args (tests / eval)
 * 2. Runtime overrides (`data/runtime-settings.json` via admin UI/API)
 * 3. Env vars (`CHARACTER_COREF_*`)
 * 4. Built-in product defaults below
 *
 * Resolve via {@link resolveCharacterCorefConfig} (pass settings from
 * `getRuntimeSettings()`), or `getCharacterCorefConfig()` in runtime-settings.
 *
 * See docs/superpowers/specs/2026-07-22-cooccur-residual-coref-design.md §10
 * for recall / precision trade-offs.
 */

/** Duck-type slice of RuntimeSettings — avoids circular import. */
export type CorefSettingsSlice = {
  corefWindowChars?: number;
  corefOverlapChars?: number;
  corefAutoMergeThreshold?: number;
  corefGreyLowThreshold?: number;
  corefWeightExclusive?: number;
  corefWeightJaccard?: number;
  corefJaccardSparseMinCount?: number;
  corefJaccardSparseDiscount?: number;
  corefTemporalHighOverlap?: number;
  corefTemporalMidOverlap?: number;
  corefTemporalPenaltyHigh?: number;
  corefTemporalPenaltyMid?: number;
  corefTemporalPenaltyLow?: number;
  corefChunkGapMax?: number;
  corefAliasHardMergeMin?: number;
  corefAliasBucketMax?: number;
  corefGreyContextChars?: number;
  corefHardRejectSameUnit?: boolean;
  corefHardRejectGenderConflict?: boolean;
  corefHardRejectAgeConflict?: boolean;
  corefHardMergeSameFullName?: boolean;
};

// ── Product defaults ────────────────────────────────────────────────

/** Stage ① sliding window body size (chars). */
export const COREF_WINDOW_CHARS_DEFAULT = 6_000;
/** Stage ① adjacent-window overlap (chars). */
export const COREF_OVERLAP_CHARS_DEFAULT = 800;

/** Score ≥ this → program auto-merge. */
export const COREF_AUTO_MERGE_THRESHOLD_DEFAULT = 0.85;
/** Score < this → program auto-reject (unless alias-only force-grey). */
export const COREF_GREY_LOW_THRESHOLD_DEFAULT = 0.45;

export const COREF_WEIGHT_EXCLUSIVE_DEFAULT = 0.5;
export const COREF_WEIGHT_JACCARD_DEFAULT = 0.3;

/** Jaccard discount when min(count(A),count(B)) < sparseMinCount. */
export const COREF_JACCARD_SPARSE_MIN_COUNT_DEFAULT = 3;
export const COREF_JACCARD_SPARSE_DISCOUNT_DEFAULT = 0.5;

/** Temporal overlap rate bands → penalty (only ≤0). */
export const COREF_TEMPORAL_HIGH_OVERLAP_DEFAULT = 0.8;
export const COREF_TEMPORAL_MID_OVERLAP_DEFAULT = 0.2;
export const COREF_TEMPORAL_PENALTY_HIGH_DEFAULT = 0;
export const COREF_TEMPORAL_PENALTY_MID_DEFAULT = -0.05;
export const COREF_TEMPORAL_PENALTY_LOW_DEFAULT = -0.2;

/**
 * Channel B: if span gap (in chunk/units) > this, drop co-occur candidate.
 * Channel C (alias) is never pruned by this.
 */
export const COREF_CHUNK_GAP_MAX_DEFAULT = 10;

/** Hard-merge when |aliases(A) ∩ aliases(B)| ≥ this (name excluded). */
export const COREF_ALIAS_HARD_MERGE_MIN_DEFAULT = 2;

/**
 * Skip alias-index buckets larger than this (generic titles like 「队长」).
 * 0 = no cap.
 */
export const COREF_ALIAS_BUCKET_MAX_DEFAULT = 12;

/** Grey LLM context chars per entity side. */
export const COREF_GREY_CONTEXT_CHARS_DEFAULT = 200;

// ── Resolved config shape ───────────────────────────────────────────

export interface CharacterCorefConfig {
  /** ① window body chars */
  windowChars: number;
  /** ① overlap chars between adjacent windows */
  overlapChars: number;

  /** Level-3 auto-merge threshold (inclusive) */
  autoMergeThreshold: number;
  /** Level-3 grey lower bound (inclusive); below → reject */
  greyLowThreshold: number;

  weightExclusive: number;
  weightJaccard: number;
  jaccardSparseMinCount: number;
  jaccardSparseDiscount: number;

  temporalHighOverlap: number;
  temporalMidOverlap: number;
  temporalPenaltyHigh: number;
  temporalPenaltyMid: number;
  temporalPenaltyLow: number;

  chunkGapMax: number;
  aliasHardMergeMin: number;
  aliasBucketMax: number;
  greyContextChars: number;

  /** Hard rules toggles */
  hardRejectSameUnit: boolean;
  hardRejectGenderConflict: boolean;
  hardRejectAgeConflict: boolean;
  hardMergeSameFullName: boolean;
}

export const CHARACTER_COREF_DEFAULTS: CharacterCorefConfig = {
  windowChars: COREF_WINDOW_CHARS_DEFAULT,
  overlapChars: COREF_OVERLAP_CHARS_DEFAULT,
  autoMergeThreshold: COREF_AUTO_MERGE_THRESHOLD_DEFAULT,
  greyLowThreshold: COREF_GREY_LOW_THRESHOLD_DEFAULT,
  weightExclusive: COREF_WEIGHT_EXCLUSIVE_DEFAULT,
  weightJaccard: COREF_WEIGHT_JACCARD_DEFAULT,
  jaccardSparseMinCount: COREF_JACCARD_SPARSE_MIN_COUNT_DEFAULT,
  jaccardSparseDiscount: COREF_JACCARD_SPARSE_DISCOUNT_DEFAULT,
  temporalHighOverlap: COREF_TEMPORAL_HIGH_OVERLAP_DEFAULT,
  temporalMidOverlap: COREF_TEMPORAL_MID_OVERLAP_DEFAULT,
  temporalPenaltyHigh: COREF_TEMPORAL_PENALTY_HIGH_DEFAULT,
  temporalPenaltyMid: COREF_TEMPORAL_PENALTY_MID_DEFAULT,
  temporalPenaltyLow: COREF_TEMPORAL_PENALTY_LOW_DEFAULT,
  chunkGapMax: COREF_CHUNK_GAP_MAX_DEFAULT,
  aliasHardMergeMin: COREF_ALIAS_HARD_MERGE_MIN_DEFAULT,
  aliasBucketMax: COREF_ALIAS_BUCKET_MAX_DEFAULT,
  greyContextChars: COREF_GREY_CONTEXT_CHARS_DEFAULT,
  hardRejectSameUnit: true,
  hardRejectGenderConflict: true,
  hardRejectAgeConflict: true,
  hardMergeSameFullName: true,
};

/** Env var names ↔ config fields (for docs / admin). */
export const CHARACTER_COREF_ENV_KEYS = {
  windowChars: "CHARACTER_COREF_WINDOW_CHARS",
  overlapChars: "CHARACTER_COREF_OVERLAP_CHARS",
  autoMergeThreshold: "CHARACTER_COREF_AUTO_MERGE_THRESHOLD",
  greyLowThreshold: "CHARACTER_COREF_GREY_LOW_THRESHOLD",
  weightExclusive: "CHARACTER_COREF_WEIGHT_EXCLUSIVE",
  weightJaccard: "CHARACTER_COREF_WEIGHT_JACCARD",
  jaccardSparseMinCount: "CHARACTER_COREF_JACCARD_SPARSE_MIN_COUNT",
  jaccardSparseDiscount: "CHARACTER_COREF_JACCARD_SPARSE_DISCOUNT",
  temporalHighOverlap: "CHARACTER_COREF_TEMPORAL_HIGH_OVERLAP",
  temporalMidOverlap: "CHARACTER_COREF_TEMPORAL_MID_OVERLAP",
  temporalPenaltyHigh: "CHARACTER_COREF_TEMPORAL_PENALTY_HIGH",
  temporalPenaltyMid: "CHARACTER_COREF_TEMPORAL_PENALTY_MID",
  temporalPenaltyLow: "CHARACTER_COREF_TEMPORAL_PENALTY_LOW",
  chunkGapMax: "CHARACTER_COREF_CHUNK_GAP_MAX",
  aliasHardMergeMin: "CHARACTER_COREF_ALIAS_HARD_MERGE_MIN",
  aliasBucketMax: "CHARACTER_COREF_ALIAS_BUCKET_MAX",
  greyContextChars: "CHARACTER_COREF_GREY_CONTEXT_CHARS",
  hardRejectSameUnit: "CHARACTER_COREF_HARD_REJECT_SAME_UNIT",
  hardRejectGenderConflict: "CHARACTER_COREF_HARD_REJECT_GENDER",
  hardRejectAgeConflict: "CHARACTER_COREF_HARD_REJECT_AGE",
  hardMergeSameFullName: "CHARACTER_COREF_HARD_MERGE_SAME_NAME",
} as const;

export type CharacterCorefEnvKey =
  (typeof CHARACTER_COREF_ENV_KEYS)[keyof typeof CHARACTER_COREF_ENV_KEYS];

/**
 * Human docs for admin API / .env.example.
 * impact: R↑/R↓ recall, P↑/P↓ precision, cost↑/cost↓ LLM or compute.
 */
export const CHARACTER_COREF_FIELD_DOCS: Record<
  keyof CharacterCorefConfig,
  { label: string; hint: string; impact: string }
> = {
  windowChars: {
    label: "扫名窗大小（字）",
    hint: `默认 ${COREF_WINDOW_CHARS_DEFAULT}。① 滑动窗正文长度。`,
    impact:
      "↑更大窗：同窗角色更全、共现更密，但单次 LLM 更贵、窗内假合风险↑(P↓)；↓更小窗：召回边界角色↓(R↓)、API 次数↑。",
  },
  overlapChars: {
    label: "相邻窗 overlap（字）",
    hint: `默认 ${COREF_OVERLAP_CHARS_DEFAULT}。② 判据 A 对齐带长度。`,
    impact:
      "↑更长 overlap：跨窗同 mention 更易对齐→合并召回↑(R↑)，假对齐略增(P微↓)、扫名窗数↑(cost↑)；↓过短则 overlap 链断→残差压力↑。",
  },
  autoMergeThreshold: {
    label: "自动合并阈值",
    hint: `默认 ${COREF_AUTO_MERGE_THRESHOLD_DEFAULT}。score≥此值程序合。`,
    impact: "↑更严：少自动合(P↑, R↓)，更多进灰区 LLM(cost↑)；↓更松：多自动合(R↑, P↓)。",
  },
  greyLowThreshold: {
    label: "灰区下界 / 自动拒阈值",
    hint: `默认 ${COREF_GREY_LOW_THRESHOLD_DEFAULT}。[low, auto) 灰区；<low 拒。`,
    impact:
      "↑抬高：更少拒、更多灰(cost↑, R微↑)；↓压低：更多直接拒(P↑倾向, 漏合 R↓)。须保持 greyLow < autoMerge。",
  },
  weightExclusive: {
    label: "专属度权重",
    hint: `默认 ${COREF_WEIGHT_EXCLUSIVE_DEFAULT}。S_专属 系数。`,
    impact: "↑强调「共同绑死的配角」→独特共现对更易过线(R↑ for 真同人, 路人共现 P↓)。",
  },
  weightJaccard: {
    label: "Jaccard 权重",
    hint: `默认 ${COREF_WEIGHT_JACCARD_DEFAULT}。邻域重叠系数。`,
    impact: "↑看重朋友圈整体相似；大场面多角色共现时假高分风险↑(P↓)。",
  },
  jaccardSparseMinCount: {
    label: "Jaccard 稀疏门槛（出现次数）",
    hint: `默认 ${COREF_JACCARD_SPARSE_MIN_COUNT_DEFAULT}。min(count)<此则打折。`,
    impact: "↑更易触发打折→少被「各出现1次」骗合(P↑, 弱证据 R↓)。",
  },
  jaccardSparseDiscount: {
    label: "Jaccard 稀疏折扣",
    hint: `默认 ${COREF_JACCARD_SPARSE_DISCOUNT_DEFAULT}。乘在 S_J0 上。`,
    impact: "↓折扣更狠(P↑)；↑接近1则稀疏保护弱(P↓)。",
  },
  temporalHighOverlap: {
    label: "时序「高重叠」界",
    hint: `默认 ${COREF_TEMPORAL_HIGH_OVERLAP_DEFAULT}。重叠率>此不惩罚。`,
    impact: "↓更严才免罚→更多对吃惩罚→难合(P↑, R↓)。",
  },
  temporalMidOverlap: {
    label: "时序「中重叠」界",
    hint: `默认 ${COREF_TEMPORAL_MID_OVERLAP_DEFAULT}。低于此用重惩罚。`,
    impact: "↑更多对落重惩罚带→跨时代同人更难自动合(R↓, P↑)。",
  },
  temporalPenaltyHigh: {
    label: "时序惩罚·高重叠",
    hint: `默认 ${COREF_TEMPORAL_PENALTY_HIGH_DEFAULT}（应为0）。`,
    impact: "应保持 ≤0；改成负会无故压分。",
  },
  temporalPenaltyMid: {
    label: "时序惩罚·中重叠",
    hint: `默认 ${COREF_TEMPORAL_PENALTY_MID_DEFAULT}。`,
    impact: "更负→中等时间交集更难合(R↓)。",
  },
  temporalPenaltyLow: {
    label: "时序惩罚·低/无重叠",
    hint: `默认 ${COREF_TEMPORAL_PENALTY_LOW_DEFAULT}。`,
    impact: "更负→改名跨卷同人更依赖别名/灰区(R↓ unless channel C)；放宽(接近0)→远距假合↑(P↓)。",
  },
  chunkGapMax: {
    label: "共现候选最大块间距",
    hint: `默认 ${COREF_CHUNK_GAP_MAX_DEFAULT}。通道 B：span gap>此剪掉（不剪别名通道）。`,
    impact: "↑更远也对→候选↑(R↑, cost↑, 远距假共现 P↓)；↓更近→漏远距共现同人(R↓)。",
  },
  aliasHardMergeMin: {
    label: "别名硬合并最少共享数",
    hint: `默认 ${COREF_ALIAS_HARD_MERGE_MIN_DEFAULT}。aliases 交集≥此硬合（不含 name）。`,
    impact: "↓=1：单别名即硬合→召回↑但封号污染假合↑(P↓)；↑=3：更谨慎(P↑, R↓)。",
  },
  aliasBucketMax: {
    label: "别名倒排桶上限",
    hint: `默认 ${COREF_ALIAS_BUCKET_MAX_DEFAULT}。同 alias 实体数超过则跳过该桶；0=不限。`,
    impact: "↓防「队长」类泛称爆炸(P↑, cost↓)，可能漏弱别名(R微↓)；↑或0：召回略↑、灰区对↑(cost↑)。",
  },
  greyContextChars: {
    label: "灰区 LLM 上下文（字/侧）",
    hint: `默认 ${COREF_GREY_CONTEXT_CHARS_DEFAULT}。`,
    impact: "↑判准可能↑(P/R 微升)但 token cost↑；↓省钱但易不确定→默认拒(R↓)。",
  },
  hardRejectSameUnit: {
    label: "硬规则：同块同现拒合",
    hint: "默认 true。同 unit 出现过 → 拒。",
    impact: "关：可能把同场两人误合(P↓)；开：保护准确率，罕见「分身同场」漏合。",
  },
  hardRejectGenderConflict: {
    label: "硬规则：性别冲突拒合",
    hint: "默认 true。缺字段则跳过。",
    impact: "开：P↑；关：靠打分/LLM，误合风险↑。",
  },
  hardRejectAgeConflict: {
    label: "硬规则：年龄描述冲突拒合",
    hint: "默认 true。缺字段则跳过。",
    impact: "同性别规则；年龄噪声多时可关以免误拒(R↑, P↓)。",
  },
  hardMergeSameFullName: {
    label: "硬规则：全名相同合并",
    hint: "默认 true。norm(name) 相同 → 合。",
    impact: "开：同名同人召回↑；重名异人书可能假合(P↓)——远距同名另有 @uN 技术分流。",
  },
};

function clamp01(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

function clampPenalty(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  // penalties must be ≤ 0
  return Math.min(0, n);
}

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "1" || v === "true" || v === "yes") return true;
  if (v === 0 || v === "0" || v === "false" || v === "no") return false;
  return fallback;
}

/**
 * Build resolved coref config from a settings slice (+ optional partial override).
 * Pass `getRuntimeSettings()` as `settings` in app code; tests may pass only `partial`.
 */
export function resolveCharacterCorefConfig(
  partial?: Partial<CharacterCorefConfig>,
  settings?: CorefSettingsSlice | null,
): CharacterCorefConfig {
  const s = settings ?? {};
  const d = CHARACTER_COREF_DEFAULTS;

  const windowChars = Math.max(
    500,
    Math.floor(partial?.windowChars ?? s.corefWindowChars ?? d.windowChars),
  );
  let overlapChars = Math.max(
    0,
    Math.floor(partial?.overlapChars ?? s.corefOverlapChars ?? d.overlapChars),
  );
  overlapChars = Math.min(overlapChars, Math.max(0, windowChars - 100));

  let autoMerge = clamp01(
    partial?.autoMergeThreshold ?? s.corefAutoMergeThreshold ?? d.autoMergeThreshold,
    d.autoMergeThreshold,
  );
  let greyLow = clamp01(
    partial?.greyLowThreshold ?? s.corefGreyLowThreshold ?? d.greyLowThreshold,
    d.greyLowThreshold,
  );
  // Invariant: greyLow < autoMerge (else collapse grey band)
  if (greyLow >= autoMerge) {
    greyLow = Math.max(0, autoMerge - 0.05);
  }

  const wEx = clamp01(
    partial?.weightExclusive ?? s.corefWeightExclusive ?? d.weightExclusive,
    d.weightExclusive,
  );
  const wJ = clamp01(
    partial?.weightJaccard ?? s.corefWeightJaccard ?? d.weightJaccard,
    d.weightJaccard,
  );

  return {
    windowChars,
    overlapChars,
    autoMergeThreshold: autoMerge,
    greyLowThreshold: greyLow,
    weightExclusive: wEx,
    weightJaccard: wJ,
    jaccardSparseMinCount: Math.max(
      1,
      Math.floor(
        partial?.jaccardSparseMinCount ??
          s.corefJaccardSparseMinCount ??
          d.jaccardSparseMinCount,
      ),
    ),
    jaccardSparseDiscount: clamp01(
      partial?.jaccardSparseDiscount ??
        s.corefJaccardSparseDiscount ??
        d.jaccardSparseDiscount,
      d.jaccardSparseDiscount,
    ),
    temporalHighOverlap: clamp01(
      partial?.temporalHighOverlap ??
        s.corefTemporalHighOverlap ??
        d.temporalHighOverlap,
      d.temporalHighOverlap,
    ),
    temporalMidOverlap: clamp01(
      partial?.temporalMidOverlap ??
        s.corefTemporalMidOverlap ??
        d.temporalMidOverlap,
      d.temporalMidOverlap,
    ),
    temporalPenaltyHigh: clampPenalty(
      partial?.temporalPenaltyHigh ??
        s.corefTemporalPenaltyHigh ??
        d.temporalPenaltyHigh,
      d.temporalPenaltyHigh,
    ),
    temporalPenaltyMid: clampPenalty(
      partial?.temporalPenaltyMid ??
        s.corefTemporalPenaltyMid ??
        d.temporalPenaltyMid,
      d.temporalPenaltyMid,
    ),
    temporalPenaltyLow: clampPenalty(
      partial?.temporalPenaltyLow ??
        s.corefTemporalPenaltyLow ??
        d.temporalPenaltyLow,
      d.temporalPenaltyLow,
    ),
    chunkGapMax: Math.max(
      0,
      Math.floor(partial?.chunkGapMax ?? s.corefChunkGapMax ?? d.chunkGapMax),
    ),
    aliasHardMergeMin: Math.max(
      1,
      Math.floor(
        partial?.aliasHardMergeMin ??
          s.corefAliasHardMergeMin ??
          d.aliasHardMergeMin,
      ),
    ),
    aliasBucketMax: Math.max(
      0,
      Math.floor(
        partial?.aliasBucketMax ?? s.corefAliasBucketMax ?? d.aliasBucketMax,
      ),
    ),
    greyContextChars: Math.max(
      50,
      Math.floor(
        partial?.greyContextChars ??
          s.corefGreyContextChars ??
          d.greyContextChars,
      ),
    ),
    hardRejectSameUnit: asBool(
      partial?.hardRejectSameUnit ?? s.corefHardRejectSameUnit,
      d.hardRejectSameUnit,
    ),
    hardRejectGenderConflict: asBool(
      partial?.hardRejectGenderConflict ?? s.corefHardRejectGenderConflict,
      d.hardRejectGenderConflict,
    ),
    hardRejectAgeConflict: asBool(
      partial?.hardRejectAgeConflict ?? s.corefHardRejectAgeConflict,
      d.hardRejectAgeConflict,
    ),
    hardMergeSameFullName: asBool(
      partial?.hardMergeSameFullName ?? s.corefHardMergeSameFullName,
      d.hardMergeSameFullName,
    ),
  };
}
