/**
 * Display window helpers for long novel bodies (Phase-1 perf).
 * Default: show tail so 续写/写作 stays responsive without mounting 1M glyphs.
 */

/** Max chars rendered in write/read pane by default. */
export const BODY_WINDOW_CHARS = 80_000;

/** Cap search highlight DOM nodes to avoid mark explosion. */
export const FIND_MATCH_CAP = 200;

export interface TextWindow {
  /** Slice currently shown */
  text: string;
  /** Absolute offset of text[0] in the full branch body */
  baseOffset: number;
  /** Full branch length */
  totalLength: number;
  /** True when more content exists before the window */
  hasEarlier: boolean;
}

/**
 * Take a tail window of `full` (or whole text if short).
 */
export function takeTailWindow(
  full: string,
  maxChars: number = BODY_WINDOW_CHARS,
): TextWindow {
  const totalLength = full?.length || 0;
  if (totalLength <= maxChars) {
    return {
      text: full || "",
      baseOffset: 0,
      totalLength,
      hasEarlier: false,
    };
  }
  const baseOffset = totalLength - maxChars;
  return {
    text: full.slice(baseOffset),
    baseOffset,
    totalLength,
    hasEarlier: true,
  };
}

/**
 * Expand window toward the start by `extra` chars (or load full if remaining small).
 */
export function expandEarlier(
  full: string,
  current: TextWindow,
  extra: number = BODY_WINDOW_CHARS,
): TextWindow {
  if (!current.hasEarlier || current.baseOffset <= 0) {
    return takeTailWindow(full, full.length);
  }
  const newBase = Math.max(0, current.baseOffset - extra);
  return {
    text: full.slice(newBase),
    baseOffset: newBase,
    totalLength: full.length,
    hasEarlier: newBase > 0,
  };
}

export function loadFullWindow(full: string): TextWindow {
  return {
    text: full || "",
    baseOffset: 0,
    totalLength: full?.length || 0,
    hasEarlier: false,
  };
}

/** Map a local index in the window to absolute branch offset. */
export function toAbsoluteOffset(window: TextWindow, localOffset: number): number {
  return window.baseOffset + Math.max(0, Math.min(localOffset, window.text.length));
}
