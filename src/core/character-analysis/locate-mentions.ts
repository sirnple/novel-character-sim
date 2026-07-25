/**
 * Resolve Mention.textAnchor / surface → OffsetAnchor in a window (and global).
 */

import type { AnalysisWindow, Character, Mention, OffsetAnchor } from "./types";

export interface LocatedMention extends Mention {
  offsetAnchor: OffsetAnchor;
}

export interface LocatedCharacter extends Omit<Character, "mentions"> {
  mentions: LocatedMention[];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Find `needle` in `haystack` at or after `from`, preferring exact match.
 * Returns local start or -1.
 */
export function indexOfFrom(
  haystack: string,
  needle: string,
  from = 0,
): number {
  if (!needle) return -1;
  const i = haystack.indexOf(needle, from);
  return i;
}

/**
 * Prefer locating textAnchor; fall back to surface.
 * Search is sequential within the window so repeated surfaces get increasing offsets.
 */
export function locateMentionInWindow(
  mention: Mention,
  window: AnalysisWindow,
  searchFromLocal = 0,
): LocatedMention | null {
  const surface = (mention.surface || "").trim();
  if (!surface) return null;
  const text = window.text || "";
  const anchor = (mention.textAnchor || "").trim();

  let localStart = -1;
  let matched = surface;

  if (anchor) {
    localStart = indexOfFrom(text, anchor, searchFromLocal);
    if (localStart >= 0) {
      // Prefer surface start inside the anchor hit
      const inner = text.indexOf(surface, localStart);
      if (inner >= localStart && inner < localStart + anchor.length) {
        localStart = inner;
        matched = surface;
      } else {
        matched = anchor;
      }
    }
  }
  if (localStart < 0) {
    localStart = indexOfFrom(text, surface, searchFromLocal);
    matched = surface;
  }
  if (localStart < 0) {
    // Retry from 0 if sequential miss (LLM order ≠ text order)
    if (searchFromLocal > 0) {
      return locateMentionInWindow(mention, window, 0);
    }
    return null;
  }

  const localEnd = clamp(localStart + matched.length, 0, text.length);
  const offsetAnchor: OffsetAnchor = {
    localStart,
    localEnd,
    globalStart: window.start + localStart,
    globalEnd: window.start + localEnd,
  };
  return {
    surface,
    textAnchor: anchor || surface,
    offsetAnchor,
  };
}

/**
 * Locate all mentions of characters extracted from one window.
 * Mentions that cannot be placed are dropped (with optional keep unlocated flag later).
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
        // try unrestricted
        const again = locateMentionInWindow(m, window, 0);
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
