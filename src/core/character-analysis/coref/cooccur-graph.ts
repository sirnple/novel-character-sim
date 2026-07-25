/**
 * Build window-level co-occurrence graph over stage-② MergedCharacters.
 *
 * Unit = analysis window index (a mention belongs to every window covering its globalStart;
 * we assign the **lowest** window index that contains the offset).
 */

import type { MergedCharacter } from "../merge-adjacent";
import type { AnalysisWindow } from "../types";

export interface EntityCooccurStats {
  id: string;
  /** Windows this entity appears in */
  units: Set<number>;
  /** |units| */
  count: number;
  /** neighborId → number of shared windows */
  coWith: Map<string, number>;
}

export interface CooccurGraph {
  byId: Map<string, EntityCooccurStats>;
}

/** Assign mention global offset → window index (first covering window). */
export function windowIndexForOffset(
  globalStart: number,
  windows: AnalysisWindow[],
): number | null {
  let best: number | null = null;
  for (const w of windows) {
    if (globalStart >= w.start && globalStart < w.end) {
      if (best == null || w.index < best) best = w.index;
    }
  }
  return best;
}

export function buildCooccurGraph(
  characters: MergedCharacter[],
  windows: AnalysisWindow[],
): CooccurGraph {
  const byId = new Map<string, EntityCooccurStats>();
  for (const c of characters) {
    const units = new Set<number>();
    for (const m of c.mentions || []) {
      const g = m.offsetAnchor?.globalStart;
      if (typeof g !== "number") continue;
      const u = windowIndexForOffset(g, windows);
      if (u != null) units.add(u);
    }
    // Fallback: use windowLo..windowHi if no anchors resolved
    if (!units.size && c.windowLo != null && c.windowHi != null) {
      for (let u = c.windowLo; u <= c.windowHi; u++) units.add(u);
    }
    byId.set(c.id, {
      id: c.id,
      units,
      count: units.size,
      coWith: new Map(),
    });
  }

  // Invert: unit → entity ids
  const byUnit = new Map<number, string[]>();
  for (const [id, st] of byId) {
    for (const u of st.units) {
      const list = byUnit.get(u) || [];
      list.push(id);
      byUnit.set(u, list);
    }
  }

  for (const [, ids] of byUnit) {
    const uniq = Array.from(new Set(ids));
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        const a = uniq[i]!;
        const b = uniq[j]!;
        const sa = byId.get(a)!;
        const sb = byId.get(b)!;
        sa.coWith.set(b, (sa.coWith.get(b) || 0) + 1);
        sb.coWith.set(a, (sb.coWith.get(a) || 0) + 1);
      }
    }
  }

  return { byId };
}

export interface PairCooccurMetrics {
  /**
   * S_专属 after sparse gate ∈ [0,1].
   * Raw exclusivity is `exclusivityRaw`; when min(countA,countB) < sparseMin,
   * exclusivity is **zeroed** (single-window pairs otherwise get S=1 for free).
   * Jaccard still uses sparseDiscount under the same gate.
   */
  exclusivity: number;
  /** Raw exclusivity before sparse gate */
  exclusivityRaw: number;
  /** Companion id achieving max exclusivity */
  topExclusiveCompanion: string | null;
  /** Raw Jaccard of neighbor sets */
  jaccardRaw: number;
  /** Jaccard after sparse discount */
  jaccard: number;
  /** Windows both appear in */
  sameWindowCount: number;
  /** True if A and B never share a window */
  neverSameWindow: boolean;
  /** True when min(countA,countB) < sparseMin (discount applied) */
  sparse: boolean;
  countA: number;
  countB: number;
  neighborCountA: number;
  neighborCountB: number;
  sharedNeighborCount: number;
}

const EMPTY_METRICS: PairCooccurMetrics = {
  exclusivity: 0,
  exclusivityRaw: 0,
  topExclusiveCompanion: null,
  jaccardRaw: 0,
  jaccard: 0,
  sameWindowCount: 0,
  neverSameWindow: true,
  sparse: false,
  countA: 0,
  countB: 0,
  neighborCountA: 0,
  neighborCountB: 0,
  sharedNeighborCount: 0,
};

/**
 * Co-occurrence exclusivity / Jaccard for pair (A,B).
 *
 * 专属度(X) = min( count(A,X)/count(A), count(B,X)/count(B) )
 * S_专属 = max_{X ∈ N(A)∩N(B)} 专属度(X)
 *
 * Jaccard = |N(A)∩N(B)| / |N(A)∪N(B)|
 * (neighbors exclude A and B themselves)
 */
export function pairCooccurMetrics(
  idA: string,
  idB: string,
  graph: CooccurGraph,
  opts?: { jaccardSparseMinCount?: number; jaccardSparseDiscount?: number },
): PairCooccurMetrics {
  const sa = graph.byId.get(idA);
  const sb = graph.byId.get(idB);
  if (!sa || !sb) return { ...EMPTY_METRICS };

  const sparseMin = opts?.jaccardSparseMinCount ?? 3;
  const sparseDisc = opts?.jaccardSparseDiscount ?? 0.5;

  const sameWindowCount = (() => {
    let n = 0;
    for (const u of sa.units) {
      if (sb.units.has(u)) n++;
    }
    return n;
  })();

  // Neighbors = co-occur entities excluding the other of the pair
  const neighA = new Set<string>();
  for (const [x] of sa.coWith) {
    if (x !== idB) neighA.add(x);
  }
  const neighB = new Set<string>();
  for (const [x] of sb.coWith) {
    if (x !== idA) neighB.add(x);
  }

  const shared: string[] = [];
  for (const x of neighA) {
    if (neighB.has(x)) shared.push(x);
  }

  let exclusivityRaw = 0;
  let topExclusiveCompanion: string | null = null;
  const countA = Math.max(1, sa.count);
  const countB = Math.max(1, sb.count);
  for (const x of shared) {
    const cax = sa.coWith.get(x) || 0;
    const cbx = sb.coWith.get(x) || 0;
    const ex = Math.min(cax / countA, cbx / countB);
    if (ex > exclusivityRaw) {
      exclusivityRaw = ex;
      topExclusiveCompanion = x;
    }
  }

  const inter = shared.length;
  const union = neighA.size + neighB.size - inter;
  const jaccardRaw = union > 0 ? inter / union : 0;
  // Single-window entities trivially get S_excl=1 with any shared companion.
  // Sparse gate: zero exclusivity (do not count); still discount Jaccard.
  const sparse = Math.min(sa.count, sb.count) < sparseMin;
  const jaccard = sparse ? jaccardRaw * sparseDisc : jaccardRaw;
  const exclusivity = sparse ? 0 : exclusivityRaw;

  return {
    exclusivity,
    exclusivityRaw,
    topExclusiveCompanion,
    jaccardRaw,
    jaccard,
    sameWindowCount,
    neverSameWindow: sameWindowCount === 0,
    sparse,
    countA: sa.count,
    countB: sb.count,
    neighborCountA: neighA.size,
    neighborCountB: neighB.size,
    sharedNeighborCount: inter,
  };
}
