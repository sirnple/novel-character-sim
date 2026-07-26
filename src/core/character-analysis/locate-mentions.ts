/**
 * Resolve Mention.textAnchor / surface → OffsetAnchor in a window (and global).
 *
 * Location algorithm:
 *  1. Find `textAnchor` in the window:
 *     exact → newline-tolerant → fuzzy (small edit / extra chars in body)
 *  2. Within that hit span, find `surface` → offset = surface range.
 *  3. Fallbacks:
 *     - textAnchor hit but surface not inside → whole textAnchor span
 *     - textAnchor miss → search all `surface` hits; pick the one whose
 *       local neighborhood best overlaps textAnchor (not merely first hit)
 *
 * Non-exact matches log a warning (`[locate]`).
 */

import type { AnalysisWindow, Character, Mention, OffsetAnchor } from "./types";

export interface LocatedMention extends Mention {
  offsetAnchor: OffsetAnchor;
}

export interface LocatedCharacter extends Omit<Character, "mentions"> {
  mentions: LocatedMention[];
}

export type LocateMatchMode =
  | "exact"
  | "newline"
  | "fuzzy"
  | "surface_overlap"
  | "surface_only";

export interface LocateSpan {
  start: number;
  end: number;
  mode: LocateMatchMode;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Strip CR/LF for comparison; keep all other characters. */
export function stripNewlines(s: string): string {
  return (s || "").replace(/\r\n|\r|\n/g, "");
}

/**
 * Find `needle` in `haystack` at or after `from` (exact).
 * Returns local start or -1.
 */
export function indexOfFrom(
  haystack: string,
  needle: string,
  from = 0,
): number {
  if (!needle) return -1;
  return haystack.indexOf(needle, from);
}

/**
 * Find `needle` in `haystack` starting at `from`, allowing the haystack to
 * contain extra CR/LF that the needle omits (and ignoring newlines in needle).
 */
export function indexOfAllowingNewlines(
  haystack: string,
  needle: string,
  from = 0,
): { start: number; end: number } | null {
  const n = stripNewlines(needle);
  if (!n) return null;
  const startFrom = Math.max(0, from);
  const H = haystack.length;

  for (let i = startFrom; i < H; i++) {
    const c0 = haystack[i]!;
    if (c0 === "\r" || c0 === "\n") continue;

    let hi = i;
    let ni = 0;
    while (ni < n.length && hi < H) {
      const hc = haystack[hi]!;
      if (hc === "\r" || hc === "\n") {
        hi++;
        continue;
      }
      if (hc !== n[ni]) break;
      hi++;
      ni++;
    }
    if (ni === n.length) {
      return { start: i, end: hi };
    }
  }
  return null;
}

/** Classic LCS length (for short Chinese anchors; O(nm) with n,m ≲ 80). */
export function lcsLength(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return 0;
  // rolling two rows
  let prev = new Array<number>(m + 1).fill(0);
  let cur = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) cur[j] = prev[j - 1]! + 1;
      else cur[j] = Math.max(prev[j]!, cur[j - 1]!);
    }
    const tmp = prev;
    prev = cur;
    cur = tmp;
    cur.fill(0);
  }
  return prev[m]!;
}

/**
 * Fuzzy locate: sliding windows over haystack (newlines ignored in scoring).
 * Allows body to have extra/missing a few chars vs LLM textAnchor.
 *
 * Accepts when LCS(needle, window) / needleLen >= minRatio (default 0.78)
 * and absolute unmatched ≤ max(4, ceil(0.28 * needleLen)).
 */
export function indexOfFuzzy(
  haystack: string,
  needle: string,
  from = 0,
  opts?: { minRatio?: number; maxUnmatched?: number },
): { start: number; end: number; score: number } | null {
  const n = stripNewlines(needle);
  if (n.length < 4) return null;

  const minRatio = opts?.minRatio ?? 0.78;
  const maxUnmatched =
    opts?.maxUnmatched ?? Math.max(4, Math.ceil(n.length * 0.28));

  // Precompute non-newline char stream with map back to original indices
  const chars: string[] = [];
  const origAt: number[] = [];
  for (let i = Math.max(0, from); i < haystack.length; i++) {
    const c = haystack[i]!;
    if (c === "\r" || c === "\n") continue;
    chars.push(c);
    origAt.push(i);
  }
  if (chars.length < n.length - maxUnmatched) return null;

  const stream = chars.join("");
  // Window length in non-newline chars: needle ± slack
  const winLo = Math.max(1, n.length - maxUnmatched);
  const winHi = n.length + maxUnmatched;

  let best: { start: number; end: number; score: number } | null = null;

  for (let i = 0; i < stream.length; i++) {
    for (let len = winLo; len <= winHi && i + len <= stream.length; len++) {
      const win = stream.slice(i, i + len);
      const lcs = lcsLength(n, win);
      const unmatched = n.length - lcs;
      if (unmatched > maxUnmatched) continue;
      const ratio = lcs / n.length;
      if (ratio < minRatio) continue;
      // Prefer higher ratio, then shorter window (tighter fit)
      const score = ratio - (len - n.length) * 0.001;
      if (!best || score > best.score) {
        const o0 = origAt[i]!;
        const o1 = origAt[i + len - 1]! + 1; // exclusive end in original
        best = { start: o0, end: o1, score };
      }
    }
  }
  return best;
}

/**
 * Locate needle from `from`: exact → newline-tolerant → fuzzy.
 * Always reports match mode for warnings.
 */
export function findSpan(
  haystack: string,
  needle: string,
  from = 0,
): LocateSpan | null {
  if (!needle) return null;
  const exact = indexOfFrom(haystack, needle, from);
  if (exact >= 0) {
    return { start: exact, end: exact + needle.length, mode: "exact" };
  }
  const nl = indexOfAllowingNewlines(haystack, needle, from);
  if (nl) {
    return { start: nl.start, end: nl.end, mode: "newline" };
  }
  const fuzzy = indexOfFuzzy(haystack, needle, from);
  if (fuzzy) {
    return { start: fuzzy.start, end: fuzzy.end, mode: "fuzzy" };
  }
  return null;
}

function warnNonExact(
  mode: LocateMatchMode,
  surface: string,
  anchor: string,
  window: AnalysisWindow,
  detail?: string,
): void {
  if (mode === "exact") return;
  const a = (anchor || "").slice(0, 40);
  console.warn(
    `[locate] non-exact match mode=${mode} win=${window.index}` +
      ` surface=「${surface}」 anchor=「${a}${anchor.length > 40 ? "…" : ""}」` +
      (detail ? ` ${detail}` : ""),
  );
}

function makeLocated(
  surface: string,
  textAnchor: string,
  kind: Mention["kind"],
  localStart: number,
  localEnd: number,
  window: AnalysisWindow,
): LocatedMention {
  const end = clamp(localEnd, localStart, (window.text || "").length);
  const start = clamp(localStart, 0, end);
  return {
    surface,
    textAnchor,
    kind,
    offsetAnchor: {
      localStart: start,
      localEnd: end,
      globalStart: window.start + start,
      globalEnd: window.start + end,
    },
  };
}

/**
 * Find surface inside [spanStart, spanEnd) of haystack.
 * Exact first; newline-tolerant within span if needed.
 */
function findSurfaceInSpan(
  haystack: string,
  surface: string,
  spanStart: number,
  spanEnd: number,
): { start: number; end: number } | null {
  if (!surface || spanEnd <= spanStart) return null;

  const region = haystack.slice(spanStart, spanEnd);
  const exact = region.indexOf(surface);
  if (exact >= 0) {
    return {
      start: spanStart + exact,
      end: spanStart + exact + surface.length,
    };
  }

  const hit = indexOfAllowingNewlines(haystack, surface, spanStart);
  if (!hit) return null;
  if (hit.start < spanStart || hit.end > spanEnd) return null;
  if (
    stripNewlines(haystack.slice(hit.start, hit.end)) !==
    stripNewlines(surface)
  ) {
    return null;
  }
  return hit;
}

/** All exact surface occurrences at or after `from`. */
export function findAllSurfaceHits(
  haystack: string,
  surface: string,
  from = 0,
): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  if (!surface) return out;
  let i = Math.max(0, from);
  while (i < haystack.length) {
    const j = haystack.indexOf(surface, i);
    if (j < 0) break;
    out.push({ start: j, end: j + surface.length });
    i = j + Math.max(1, surface.length);
  }
  return out;
}

/**
 * Among surface hits, pick the one whose neighborhood best matches textAnchor
 * (LCS ratio). Used when textAnchor itself cannot be located.
 */
export function pickSurfaceByAnchorOverlap(
  haystack: string,
  surface: string,
  textAnchor: string,
  from = 0,
): { start: number; end: number; score: number } | null {
  const hits = findAllSurfaceHits(haystack, surface, from);
  if (!hits.length) {
    // also try from 0 if from > 0
    if (from > 0) return pickSurfaceByAnchorOverlap(haystack, surface, textAnchor, 0);
    return null;
  }
  const anchor = stripNewlines(textAnchor);
  if (!anchor) {
    return { ...hits[0]!, score: 0 };
  }
  const radius = Math.max(anchor.length + 8, surface.length + 20);
  let best: { start: number; end: number; score: number } | null = null;
  for (const h of hits) {
    const lo = Math.max(0, h.start - radius);
    const hi = Math.min(haystack.length, h.end + radius);
    const neigh = stripNewlines(haystack.slice(lo, hi));
    const lcs = lcsLength(anchor, neigh);
    const score = lcs / anchor.length;
    if (!best || score > best.score) {
      best = { start: h.start, end: h.end, score };
    }
  }
  return best;
}

/**
 * Prefer locating textAnchor; fall back to surface with anchor-overlap ranking.
 */
export function locateMentionInWindow(
  mention: Mention,
  window: AnalysisWindow,
  searchFromLocal = 0,
): LocatedMention | null {
  const surface = (mention.surface || "").trim();
  if (!surface) return null;
  const text = window.text || "";
  if (!text) return null;
  const anchor = (mention.textAnchor || "").trim();
  const from = Math.max(0, searchFromLocal);

  if (anchor) {
    let span = findSpan(text, anchor, from);
    if (!span && from > 0) {
      span = findSpan(text, anchor, 0);
    }
    if (span) {
      warnNonExact(span.mode, surface, anchor, window);
      const surfaceHit = findSurfaceInSpan(
        text,
        surface,
        span.start,
        span.end,
      );
      if (surfaceHit) {
        return makeLocated(
          surface,
          anchor,
          mention.kind,
          surfaceHit.start,
          surfaceHit.end,
          window,
        );
      }
      // textAnchor hit but surface not inside → whole anchor span
      return makeLocated(
        surface,
        anchor,
        mention.kind,
        span.start,
        span.end,
        window,
      );
    }

    // textAnchor miss → surface hits ranked by overlap with anchor
    const picked = pickSurfaceByAnchorOverlap(text, surface, anchor, from);
    if (picked) {
      warnNonExact(
        "surface_overlap",
        surface,
        anchor,
        window,
        `overlapScore=${picked.score.toFixed(2)} global=${window.start + picked.start}`,
      );
      return makeLocated(
        surface,
        anchor,
        mention.kind,
        picked.start,
        picked.end,
        window,
      );
    }
    return null;
  }

  // No textAnchor — surface only
  let span = findSpan(text, surface, from);
  if (!span && from > 0) {
    span = findSpan(text, surface, 0);
  }
  if (!span) return null;
  if (span.mode !== "exact") {
    warnNonExact(span.mode, surface, surface, window);
  }
  return makeLocated(
    surface,
    surface,
    mention.kind,
    span.start,
    span.end,
    window,
  );
}

/**
 * Locate all mentions of characters extracted from one window.
 * Mentions that cannot be placed are dropped.
 */
export function locateCharactersInWindow(
  characters: Character[],
  window: AnalysisWindow,
): LocatedCharacter[] {
  const out: LocatedCharacter[] = [];
  for (const ch of characters) {
    let cursor = 0;
    const located: LocatedMention[] = [];
    for (const m of ch.mentions || []) {
      const lm = locateMentionInWindow(m, window, cursor);
      if (!lm) {
        const again =
          cursor > 0 ? locateMentionInWindow(m, window, 0) : null;
        if (again) {
          located.push(again);
          cursor = again.offsetAnchor.localEnd;
        }
        continue;
      }
      located.push(lm);
      cursor = lm.offsetAnchor.localEnd;
    }
    if (!located.length) continue;
    out.push({
      mentions: located,
      ...(ch.gender ? { gender: ch.gender } : {}),
      ...(ch.age ? { age: ch.age } : {}),
    });
  }
  return out;
}

export function offsetInRange(
  globalStart: number,
  range: { start: number; end: number },
): boolean {
  return globalStart >= range.start && globalStart < range.end;
}
