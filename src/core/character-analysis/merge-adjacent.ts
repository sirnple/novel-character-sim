/**
 * Stage ②: pairwise hierarchical merge of window character lists.
 *
 * Example (4 windows): (1⊕2)→a, (3⊕4)→b, then a⊕b.
 *
 * Merge if **either**:
 * 1. Shared **proper | personal_nick** surface string on both sides
 *    (any offsets; need **not** lie in junction overlap), or
 * 2. Junction overlap has enough **identical** mentions
 *    (same surface + same offsetAnchor), with kind-tier thresholds:
 *
 * | tier   | kinds                         | min shared identical |
 * |--------|-------------------------------|----------------------|
 * | strong | proper, personal_nick         | 1                    |
 * | mid    | title, kinship, desc          | 2                    |
 * | weak   | deictic, generic              | 3                    |
 *
 * Tiers are counted separately (not summed across tiers).
 */

import type {
  AnalysisWindow,
  Character,
  Mention,
  OffsetAnchor,
  WindowExtractResult,
} from "./types";
import {
  isIdentityStrongKind,
  preferMentionKind,
  resolveMentionKind,
  type MentionKind,
} from "./mention-kind";
import {
  locateCharactersInWindow,
  offsetInRange,
  type LocatedCharacter,
  type LocatedMention,
} from "./locate-mentions";
import { overlapRange } from "./windows";

/** Stage② merge evidence tiers (identical surface+offset in overlap). */
export type MergeEvidenceTier = {
  strong: number;
  mid: number;
  weak: number;
};

export const MERGE_EVIDENCE_MIN: Readonly<MergeEvidenceTier> = {
  strong: 1,
  mid: 2,
  weak: 3,
};

export type MergeEvidenceTierKind = keyof MergeEvidenceTier;

export function mergeEvidenceTierOfKind(k: MentionKind): MergeEvidenceTierKind {
  if (k === "proper" || k === "personal_nick") return "strong";
  if (k === "title" || k === "kinship" || k === "desc") return "mid";
  return "weak"; // deictic | generic
}

export function normalizeMentionSurface(surface: string): string {
  return (surface || "").trim().replace(/\s+/g, " ");
}

export interface MergedCharacter {
  id: string;
  mentions: LocatedMention[];
  gender?: string;
  age?: string;
  /**
   * Stage ④: display / roster primary name chosen from surfaces.
   * Submit path maps this to ResolvedEntity.name.
   */
  canonicalName?: string;
  /** Inclusive window index range that contributed */
  windowLo: number;
  windowHi: number;
}

export interface Segment {
  /** Characters covering a contiguous window range */
  characters: MergedCharacter[];
  windowLo: number;
  windowHi: number;
}

export interface PairMergeTrace {
  leftWindows: [number, number];
  rightWindows: [number, number];
  overlap: { start: number; end: number } | null;
  merges: Array<{
    leftId: string;
    rightId: string;
    sharedSurfacesInOverlap: string[];
  }>;
  leftOnly: string[];
  rightOnly: string[];
}

function preferField(a?: string, b?: string): string | undefined {
  const x = (a || "").trim();
  const y = (b || "").trim();
  if (x && y) {
    if (x === "未知" && y !== "未知") return y;
    if (y === "未知" && x !== "未知") return x;
    return x.length >= y.length ? x : y;
  }
  return x || y || undefined;
}

function mergeMentionLists(
  a: LocatedMention[],
  b: LocatedMention[],
): LocatedMention[] {
  const byKey = new Map<string, LocatedMention>();
  for (const m of [...a, ...b]) {
    const surface = normalizeMentionSurface(m.surface);
    if (!surface || !m.offsetAnchor) continue;
    const key = `${surface}\0${m.offsetAnchor.globalStart}\0${m.offsetAnchor.globalEnd}`;
    const kind = m.kind ?? resolveMentionKind(surface);
    const prev = byKey.get(key);
    if (prev) {
      byKey.set(key, {
        ...prev,
        kind: preferMentionKind(prev.kind ?? kind, kind),
      });
      continue;
    }
    byKey.set(key, {
      surface,
      textAnchor: (m.textAnchor || surface).trim(),
      kind,
      offsetAnchor: { ...m.offsetAnchor },
    });
  }
  const out = Array.from(byKey.values());
  out.sort((x, y) => x.offsetAnchor.globalStart - y.offsetAnchor.globalStart);
  return out;
}

export function mergeTwoMergedCharacters(
  a: MergedCharacter,
  b: MergedCharacter,
  id: string,
): MergedCharacter {
  const gender = preferField(a.gender, b.gender);
  const age = preferField(a.age, b.age);
  return {
    id,
    mentions: mergeMentionLists(a.mentions, b.mentions),
    ...(gender ? { gender } : {}),
    ...(age ? { age } : {}),
    windowLo: Math.min(a.windowLo, b.windowLo),
    windowHi: Math.max(a.windowHi, b.windowHi),
  };
}

/**
 * Identity of a mention for cross-window match:
 * same surface + same offsetAnchor (global range).
 */
export function mentionIdentityKey(m: LocatedMention): string | null {
  if (!m.offsetAnchor) return null;
  const s = normalizeMentionSurface(m.surface);
  if (!s) return null;
  const { globalStart, globalEnd } = m.offsetAnchor;
  return `${s}\0${globalStart}\0${globalEnd}`;
}

function kindOfLocatedMention(m: LocatedMention): MentionKind {
  return m.kind ?? resolveMentionKind(m.surface, m.kind);
}

/**
 * Any located mention with offset may contribute to Stage② tier counts
 * (thresholds decide whether they are enough to merge).
 */
export function isMergeEvidenceMention(m: LocatedMention): boolean {
  return Boolean(m.offsetAnchor && normalizeMentionSurface(m.surface));
}

/**
 * Shared **identical** mentions (surface + offset) in `overlap`, all kinds.
 * Returns trace strings `surface@globalStart` (and optional kind for debug).
 */
export function sharedIdenticalMentionsInOverlap(
  a: MergedCharacter | LocatedCharacter,
  b: MergedCharacter | LocatedCharacter,
  overlap: { start: number; end: number },
): string[] {
  return classifySharedIdenticalInOverlap(a, b, overlap).shared;
}

/**
 * Count shared identical mentions by evidence tier.
 * Each distinct identity key counts once; tier from A's kind (prefer stronger if both tagged).
 */
export function classifySharedIdenticalInOverlap(
  a: MergedCharacter | LocatedCharacter,
  b: MergedCharacter | LocatedCharacter,
  overlap: { start: number; end: number },
): { shared: string[]; tiers: MergeEvidenceTier; byKey: Array<{ label: string; tier: MergeEvidenceTierKind; kind: MentionKind }> } {
  const keysInOverlap = (c: { mentions: LocatedMention[] }) => {
    // identityKey → { surface, kind }
    const map = new Map<string, { surface: string; kind: MentionKind }>();
    for (const m of c.mentions || []) {
      if (!m.offsetAnchor) continue;
      if (!offsetInRange(m.offsetAnchor.globalStart, overlap)) continue;
      if (!isMergeEvidenceMention(m)) continue;
      const key = mentionIdentityKey(m);
      if (!key) continue;
      const kind = kindOfLocatedMention(m);
      const prev = map.get(key);
      if (!prev) {
        map.set(key, {
          surface: normalizeMentionSurface(m.surface),
          kind,
        });
      } else {
        map.set(key, {
          surface: prev.surface,
          kind: preferMentionKind(prev.kind, kind),
        });
      }
    }
    return map;
  };
  const ma = keysInOverlap(a);
  const mb = keysInOverlap(b);
  const tiers: MergeEvidenceTier = { strong: 0, mid: 0, weak: 0 };
  const shared: string[] = [];
  const byKey: Array<{
    label: string;
    tier: MergeEvidenceTierKind;
    kind: MentionKind;
  }> = [];
  for (const [key, va] of ma) {
    const vb = mb.get(key);
    if (!vb) continue;
    const kind = preferMentionKind(va.kind, vb.kind);
    const tier = mergeEvidenceTierOfKind(kind);
    tiers[tier]++;
    const label = `${va.surface}@${key.split("\0")[1]}`;
    shared.push(label);
    byKey.push({ label, tier, kind });
  }
  return { shared, tiers, byKey };
}

/** @deprecated name kept for callers; lists all identical shared mentions in overlap */
export function sharedSurfacesInOverlap(
  a: MergedCharacter | LocatedCharacter,
  b: MergedCharacter | LocatedCharacter,
  overlap: { start: number; end: number },
): string[] {
  return sharedIdenticalMentionsInOverlap(a, b, overlap);
}

export function meetsMergeEvidenceThresholds(
  tiers: MergeEvidenceTier,
  min: MergeEvidenceTier = MERGE_EVIDENCE_MIN,
): boolean {
  return (
    tiers.strong >= min.strong ||
    tiers.mid >= min.mid ||
    tiers.weak >= min.weak
  );
}

/**
 * Strong surfaces (proper|personal_nick) present on a character, keyed by surface.
 * Kind is the best (highest identity) label seen for that surface.
 */
export function strongSurfacesOf(
  c: MergedCharacter | LocatedCharacter,
): Map<string, MentionKind> {
  const map = new Map<string, MentionKind>();
  for (const m of c.mentions || []) {
    const s = normalizeMentionSurface(m.surface);
    if (!s) continue;
    const k = kindOfLocatedMention(m);
    if (!isIdentityStrongKind(k)) continue;
    const prev = map.get(s);
    map.set(s, prev ? preferMentionKind(prev, k) : k);
  }
  return map;
}

/**
 * Shared proper|personal_nick surface **strings** (any offset; not limited to overlap).
 * Returns surfaces sorted for stable traces.
 */
export function sharedStrongSurfacesAnywhere(
  a: MergedCharacter | LocatedCharacter,
  b: MergedCharacter | LocatedCharacter,
): string[] {
  const ma = strongSurfacesOf(a);
  const mb = strongSurfacesOf(b);
  const out: string[] = [];
  for (const s of ma.keys()) {
    if (mb.has(s)) out.push(s);
  }
  return out.sort((x, y) => x.localeCompare(y, "zh"));
}

/**
 * Merge if:
 * - ≥1 shared proper|personal_nick surface string (anywhere), or
 * - shared identical mentions in overlap meet kind-tier thresholds
 *   (strong≥1 | mid≥2 | weak≥3 by default).
 *
 * Overlap may be null: strong-surface share alone can still merge.
 */
export function canMergeInOverlap(
  a: MergedCharacter,
  b: MergedCharacter,
  overlap: { start: number; end: number } | null,
): {
  ok: boolean;
  shared: string[];
  tiers: MergeEvidenceTier;
  /** Shared proper|nick surfaces (any offset) that triggered merge */
  sharedStrongAnywhere: string[];
} {
  const sharedStrongAnywhere = sharedStrongSurfacesAnywhere(a, b);
  if (sharedStrongAnywhere.length >= 1) {
    return {
      ok: true,
      shared: sharedStrongAnywhere.map((s) => `${s}@any`),
      tiers: { strong: sharedStrongAnywhere.length, mid: 0, weak: 0 },
      sharedStrongAnywhere,
    };
  }

  if (!overlap || overlap.end <= overlap.start) {
    return {
      ok: false,
      shared: [],
      tiers: { strong: 0, mid: 0, weak: 0 },
      sharedStrongAnywhere: [],
    };
  }
  const { shared, tiers } = classifySharedIdenticalInOverlap(a, b, overlap);
  return {
    ok: meetsMergeEvidenceThresholds(tiers),
    shared,
    tiers,
    sharedStrongAnywhere: [],
  };
}

/**
 * Junction overlap between left window range [loL, hiL] and right [loR, hiR]:
 * overlap of window hiL and window loR (must be adjacent groups).
 */
export function junctionOverlap(
  windows: AnalysisWindow[],
  windowLoL: number,
  windowHiL: number,
  windowLoR: number,
  windowHiR: number,
): { start: number; end: number } | null {
  void windowLoL;
  void windowHiR;
  const leftEdge = windows[windowHiL];
  const rightEdge = windows[windowLoR];
  if (!leftEdge || !rightEdge) return null;
  return overlapRange(leftEdge, rightEdge);
}

/**
 * Merge two segments (pairwise). Matching is bipartite greedy by #shared surfaces.
 */
export function mergeSegmentPair(
  left: Segment,
  right: Segment,
  windows: AnalysisWindow[],
  idCounter: { n: number },
): { segment: Segment; trace: PairMergeTrace } {
  const overlap = junctionOverlap(
    windows,
    left.windowLo,
    left.windowHi,
    right.windowLo,
    right.windowHi,
  );

  type Cand = { li: number; ri: number; shared: string[]; score: number };
  const cands: Cand[] = [];
  for (let li = 0; li < left.characters.length; li++) {
    for (let ri = 0; ri < right.characters.length; ri++) {
      const { ok, shared } = canMergeInOverlap(
        left.characters[li]!,
        right.characters[ri]!,
        overlap,
      );
      if (!ok) continue;
      cands.push({ li, ri, shared, score: shared.length });
    }
  }
  cands.sort((a, b) => b.score - a.score || a.li - b.li || a.ri - b.ri);

  const usedL = new Set<number>();
  const usedR = new Set<number>();
  const out: MergedCharacter[] = [];
  const merges: PairMergeTrace["merges"] = [];

  for (const c of cands) {
    if (usedL.has(c.li) || usedR.has(c.ri)) continue;
    usedL.add(c.li);
    usedR.add(c.ri);
    const id = `c${idCounter.n++}`;
    const merged = mergeTwoMergedCharacters(
      left.characters[c.li]!,
      right.characters[c.ri]!,
      id,
    );
    out.push(merged);
    merges.push({
      leftId: left.characters[c.li]!.id,
      rightId: right.characters[c.ri]!.id,
      sharedSurfacesInOverlap: c.shared,
    });
  }

  const leftOnly: string[] = [];
  const rightOnly: string[] = [];
  left.characters.forEach((ch, i) => {
    if (usedL.has(i)) return;
    out.push({
      ...ch,
      id: `c${idCounter.n++}`,
      mentions: mergeMentionLists(ch.mentions, []),
    });
    leftOnly.push(ch.id);
  });
  right.characters.forEach((ch, i) => {
    if (usedR.has(i)) return;
    out.push({
      ...ch,
      id: `c${idCounter.n++}`,
      mentions: mergeMentionLists(ch.mentions, []),
    });
    rightOnly.push(ch.id);
  });

  return {
    segment: {
      characters: out,
      windowLo: left.windowLo,
      windowHi: right.windowHi,
    },
    trace: {
      leftWindows: [left.windowLo, left.windowHi],
      rightWindows: [right.windowLo, right.windowHi],
      overlap,
      merges,
      leftOnly,
      rightOnly,
    },
  };
}

function windowToSegment(
  located: LocatedCharacter[],
  windowIndex: number,
  idCounter: { n: number },
): Segment {
  return {
    windowLo: windowIndex,
    windowHi: windowIndex,
    characters: located.map((ch) => ({
      id: `c${idCounter.n++}`,
      mentions: ch.mentions,
      ...(ch.gender ? { gender: ch.gender } : {}),
      ...(ch.age ? { age: ch.age } : {}),
      windowLo: windowIndex,
      windowHi: windowIndex,
    })),
  };
}

/**
 * Hierarchical pairwise merge until one segment remains.
 * Odd last segment carries forward unpaired.
 */
export function hierarchicalPairMerge(
  segments: Segment[],
  windows: AnalysisWindow[],
  idCounter: { n: number },
): { segment: Segment; traces: PairMergeTrace[] } {
  const traces: PairMergeTrace[] = [];
  let level = segments;
  if (!level.length) {
    return {
      segment: { characters: [], windowLo: 0, windowHi: 0 },
      traces,
    };
  }

  while (level.length > 1) {
    const next: Segment[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i]!;
      const b = level[i + 1];
      if (!b) {
        next.push(a);
        continue;
      }
      const { segment, trace } = mergeSegmentPair(a, b, windows, idCounter);
      traces.push(trace);
      next.push(segment);
    }
    level = next;
  }

  return { segment: level[0]!, traces };
}

/**
 * Stage ② entry: locate mentions → hierarchical pairwise merge.
 */
export function mergeAdjacentWindowCharacters(
  byWindow: WindowExtractResult[],
  windows: AnalysisWindow[],
): {
  characters: MergedCharacter[];
  traces: PairMergeTrace[];
  locatedByWindow: Array<{
    windowIndex: number;
    characters: LocatedCharacter[];
  }>;
} {
  const byIndex = new Map(windows.map((w) => [w.index, w]));
  const ordered = [...byWindow].sort(
    (a, b) => a.window.index - b.window.index,
  );
  const idCounter = { n: 0 };
  const locatedByWindow: Array<{
    windowIndex: number;
    characters: LocatedCharacter[];
  }> = [];
  const segments: Segment[] = [];

  for (const w of ordered) {
    const full = byIndex.get(w.window.index);
    if (!full) {
      locatedByWindow.push({ windowIndex: w.window.index, characters: [] });
      continue;
    }
    const located = locateCharactersInWindow(w.characters || [], full);
    locatedByWindow.push({ windowIndex: w.window.index, characters: located });
    segments.push(windowToSegment(located, w.window.index, idCounter));
  }

  const { segment, traces } = hierarchicalPairMerge(
    segments,
    windows,
    idCounter,
  );

  return {
    characters: segment.characters,
    traces,
    locatedByWindow,
  };
}

// ── Compat helpers used by older tests (surface-only share) ─────────

export function characterSurfaces(c: Character): Set<string> {
  const s = new Set<string>();
  for (const m of c.mentions || []) {
    const n = normalizeMentionSurface(m.surface);
    if (n) s.add(n);
  }
  return s;
}

export function charactersShareMention(a: Character, b: Character): boolean {
  const sa = characterSurfaces(a);
  for (const s of characterSurfaces(b)) {
    if (sa.has(s)) return true;
  }
  return false;
}

export function sharedMentionSurfaces(a: Character, b: Character): string[] {
  const sa = characterSurfaces(a);
  const out: string[] = [];
  for (const s of characterSurfaces(b)) {
    if (sa.has(s)) out.push(s);
  }
  return out;
}

export function mergeTwoCharacters(a: Character, b: Character): Character {
  const gender = preferField(a.gender, b.gender);
  const age = preferField(a.age, b.age);
  const mentions: Mention[] = [];
  const seen = new Set<string>();
  for (const m of [...(a.mentions || []), ...(b.mentions || [])]) {
    const surface = normalizeMentionSurface(m.surface);
    if (!surface) continue;
    const key = `${surface}\0${(m.textAnchor || "").trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mentions.push({
      surface,
      textAnchor: (m.textAnchor || surface).trim(),
      kind: m.kind ?? resolveMentionKind(surface),
      ...(m.offsetAnchor
        ? { offsetAnchor: { ...m.offsetAnchor } as OffsetAnchor }
        : {}),
    });
  }
  return {
    mentions,
    ...(gender ? { gender } : {}),
    ...(age ? { age } : {}),
  };
}
