/**
 * Aggregate per-unit name mentions and keep by frequency threshold
 * (not a fixed top-N).
 */

export interface UnitNameHit {
  /** Canonical display name as returned by the unit LLM */
  name: string;
  /** Optional aliases seen in this unit */
  aliases?: string[];
  /** Mentions inside the unit (default 1 if only presence) */
  count?: number;
}

export interface NameAggregate {
  name: string;
  /** Sum of per-unit mention counts */
  mentions: number;
  /** Number of units (chapters/windows) this name appeared in */
  unitHits: number;
  aliases: string[];
  /** First unit index (0-based) */
  firstUnit: number;
  lastUnit: number;
  /** Exact unit indices when known (from scan anchors); used for detail/rel context */
  unitIndices?: number[];
}

export interface MentionThreshold {
  /** Minimum total mentions across the book */
  minMentions: number;
  /** Minimum distinct units the name must appear in */
  minUnits: number;
}

export interface FilterByFrequencyResult {
  kept: NameAggregate[];
  dropped: NameAggregate[];
  threshold: MentionThreshold;
  /** True if threshold was raised because too many names passed the base bar */
  thresholdRaised: boolean;
}

/**
 * Default absolute frequency bar from book scale.
 * Longer books → higher bar so one-off extras don't flood the roster.
 */
export function defaultMentionThreshold(
  textLength: number,
  unitCount: number,
): MentionThreshold {
  let minMentions: number;
  let minUnits: number;

  if (textLength >= 1_500_000) {
    minMentions = 5;
    minUnits = 3;
  } else if (textLength >= 500_000) {
    minMentions = 4;
    minUnits = 2;
  } else if (textLength >= 150_000) {
    minMentions = 3;
    minUnits = 2;
  } else if (textLength >= 50_000) {
    minMentions = 2;
    minUnits = 1;
  } else {
    minMentions = 2;
    minUnits = 1;
  }

  // Very few units (short text / coarse windows): don't demand multi-unit
  if (unitCount <= 3) {
    minUnits = 1;
    minMentions = Math.min(minMentions, 2);
  } else if (unitCount <= 8) {
    minUnits = Math.min(minUnits, 2);
  }

  return { minMentions, minUnits };
}

function normalizeKey(name: string): string {
  return (name || "").replace(/\s+/g, "").trim();
}

/**
 * Merge unit-level hits into per-name aggregates.
 * Names are keyed by exact normalized string; aliases are attached, not merged across people
 * (alias merge is left to the final LLM pass).
 */
export function aggregateUnitHits(
  unitHits: UnitNameHit[][],
): NameAggregate[] {
  const map = new Map<string, NameAggregate>();

  for (let ui = 0; ui < unitHits.length; ui++) {
    const hits = unitHits[ui] || [];
    const seenInUnit = new Set<string>();

    for (const h of hits) {
      const name = normalizeKey(h.name);
      if (!name || name.length < 1) continue;
      const key = name;
      const add = Math.max(1, Math.floor(h.count || 1));

      let a = map.get(key);
      if (!a) {
        a = {
          name,
          mentions: 0,
          unitHits: 0,
          aliases: [],
          firstUnit: ui,
          lastUnit: ui,
        };
        map.set(key, a);
      }
      a.mentions += add;
      a.lastUnit = ui;
      if (!seenInUnit.has(key)) {
        a.unitHits += 1;
        seenInUnit.add(key);
      }
      for (const al of h.aliases || []) {
        const aNorm = normalizeKey(al);
        if (aNorm && aNorm !== name && !a.aliases.includes(aNorm)) {
          a.aliases.push(aNorm);
        }
      }
    }
  }

  return Array.from(map.values()).sort(
    (x, y) => y.mentions - x.mentions || y.unitHits - x.unitHits,
  );
}

export function passesThreshold(
  a: NameAggregate,
  t: MentionThreshold,
): boolean {
  return a.mentions >= t.minMentions && a.unitHits >= t.minUnits;
}

/**
 * Keep all names above the frequency bar. No fixed top-N.
 *
 * If the base bar still yields an unmanageable roster (prompt safety),
 * raise minMentions step by step — still frequency-based, not "top 80".
 */
export function filterByMentionFrequency(
  aggregates: NameAggregate[],
  opts: {
    textLength: number;
    unitCount: number;
    /** Override base threshold */
    threshold?: Partial<MentionThreshold>;
    /**
     * Soft ceiling for downstream LLM merge prompt only.
     * If exceeded, minMentions is raised until under this or max raise.
     * Default 200; set Infinity to never raise.
     */
    softMaxNames?: number;
  },
): FilterByFrequencyResult {
  const base = defaultMentionThreshold(opts.textLength, opts.unitCount);
  let minMentions = opts.threshold?.minMentions ?? base.minMentions;
  let minUnits = opts.threshold?.minUnits ?? base.minUnits;
  const softMax = opts.softMaxNames ?? 200;

  const apply = (t: MentionThreshold) => {
    const kept = aggregates.filter((a) => passesThreshold(a, t));
    const dropped = aggregates.filter((a) => !passesThreshold(a, t));
    return { kept, dropped };
  };

  let t: MentionThreshold = { minMentions, minUnits };
  let { kept, dropped } = apply(t);
  let raised = false;

  // Raise mention bar only — still "everyone above N", not top-K
  while (
    Number.isFinite(softMax) &&
    kept.length > softMax &&
    minMentions < 30
  ) {
    minMentions += 1;
    t = { minMentions, minUnits };
    ({ kept, dropped } = apply(t));
    raised = true;
  }

  kept.sort((a, b) => b.mentions - a.mentions || b.unitHits - a.unitHits);
  return {
    kept,
    dropped,
    threshold: t,
    thresholdRaised: raised,
  };
}

/** Format frequency-qualified names for the final Pass1 merge prompt */
export function formatFrequencyRosterForPrompt(
  names: NameAggregate[],
  limit?: number,
): string {
  const list = limit && limit > 0 ? names.slice(0, limit) : names;
  if (!list.length) return "（无达到频次阈值的人名）";
  return list
    .map((n, i) => {
      const al = n.aliases.length ? `，别名线索：${n.aliases.slice(0, 4).join("、")}` : "";
      return `${i + 1}. ${n.name}（出现约${n.mentions}次，跨${n.unitHits}段${al}）`;
    })
    .join("\n");
}
