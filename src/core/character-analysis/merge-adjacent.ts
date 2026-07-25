/**
 * Stage ②: pairwise hierarchical merge of window character lists.
 *
 * Example (4 windows): (1⊕2)→a, (3⊕4)→b, then a⊕b.
 * Two characters merge only if they share ≥1 **identical mention** in the
 * junction overlap: same surface **and** same offsetAnchor (globalStart/End).
 * (Not "same surface somewhere in overlap" — two different 我@不同offset 不能并.)
 */

import type {
  AnalysisWindow,
  Character,
  Mention,
  OffsetAnchor,
  WindowExtractResult,
} from "./types";
import {
  locateCharactersInWindow,
  offsetInRange,
  type LocatedCharacter,
  type LocatedMention,
} from "./locate-mentions";
import { overlapRange } from "./windows";

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
  const seen = new Set<string>();
  const out: LocatedMention[] = [];
  for (const m of [...a, ...b]) {
    const surface = normalizeMentionSurface(m.surface);
    if (!surface || !m.offsetAnchor) continue;
    const key = `${surface}\0${m.offsetAnchor.globalStart}\0${m.offsetAnchor.globalEnd}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      surface,
      textAnchor: (m.textAnchor || surface).trim(),
      offsetAnchor: { ...m.offsetAnchor },
    });
  }
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

/**
 * Mentions that are **identical** (surface + offsetAnchor) on both characters
 * and whose globalStart falls inside the junction `overlap`.
 *
 * Returns the shared surface strings (for traces); one entry per distinct identity key.
 */
export function sharedIdenticalMentionsInOverlap(
  a: MergedCharacter | LocatedCharacter,
  b: MergedCharacter | LocatedCharacter,
  overlap: { start: number; end: number },
): string[] {
  const keysInOverlap = (c: { mentions: LocatedMention[] }) => {
    const map = new Map<string, string>(); // identityKey → surface
    for (const m of c.mentions || []) {
      if (!m.offsetAnchor) continue;
      if (!offsetInRange(m.offsetAnchor.globalStart, overlap)) continue;
      const key = mentionIdentityKey(m);
      if (!key) continue;
      map.set(key, normalizeMentionSurface(m.surface));
    }
    return map;
  };
  const ma = keysInOverlap(a);
  const mb = keysInOverlap(b);
  const shared: string[] = [];
  const seenSurface = new Set<string>();
  for (const [key, surface] of ma) {
    if (!mb.has(key)) continue;
    // trace: report surface (and offset via key if needed)
    if (!seenSurface.has(key)) {
      seenSurface.add(key);
      shared.push(`${surface}@${key.split("\0")[1]}`);
    }
  }
  return shared;
}

/** @deprecated name kept for callers; now requires surface+offset identity */
export function sharedSurfacesInOverlap(
  a: MergedCharacter | LocatedCharacter,
  b: MergedCharacter | LocatedCharacter,
  overlap: { start: number; end: number },
): string[] {
  return sharedIdenticalMentionsInOverlap(a, b, overlap);
}

export function canMergeInOverlap(
  a: MergedCharacter,
  b: MergedCharacter,
  overlap: { start: number; end: number } | null,
): { ok: boolean; shared: string[] } {
  if (!overlap || overlap.end <= overlap.start) {
    return { ok: false, shared: [] };
  }
  const shared = sharedIdenticalMentionsInOverlap(a, b, overlap);
  return { ok: shared.length >= 1, shared };
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
