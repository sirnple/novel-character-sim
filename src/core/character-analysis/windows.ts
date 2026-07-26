import {
  STAGE1_DEFAULT_CONFIG,
  type AnalysisWindow,
  type Stage1ScanConfig,
} from "./types";

/**
 * Split full text into sliding windows with adjacent overlap.
 * step = windowChars - overlapChars.
 */
export function buildAnalysisWindows(
  fullText: string,
  config: Partial<Stage1ScanConfig> = {},
): AnalysisWindow[] {
  const windowChars = Math.max(
    500,
    config.windowChars ?? STAGE1_DEFAULT_CONFIG.windowChars,
  );
  let overlapChars = Math.max(
    0,
    config.overlapChars ?? STAGE1_DEFAULT_CONFIG.overlapChars,
  );
  overlapChars = Math.min(overlapChars, Math.max(0, windowChars - 100));

  const text = fullText || "";
  if (!text.length) return [];

  const step = Math.max(1, windowChars - overlapChars);
  const windows: AnalysisWindow[] = [];
  let start = 0;
  let index = 0;

  while (start < text.length) {
    let end = Math.min(text.length, start + windowChars);
    // Prefer break at newline near the end (last 120 chars) when not last chunk
    if (end < text.length) {
      const slice = text.slice(Math.max(start, end - 120), end);
      const nl = slice.lastIndexOf("\n");
      if (nl >= 40) {
        end = Math.max(start, end - 120) + nl + 1;
      }
    }
    if (end <= start) end = Math.min(text.length, start + windowChars);

    windows.push({
      index,
      label: `窗${index}`,
      start,
      end,
      text: text.slice(start, end),
    });

    if (end >= text.length) break;
    start += step;
    // Ensure progress if step logic + newline adjust stalls
    if (windows.length > 0 && start <= windows[windows.length - 1]!.start) {
      start = windows[windows.length - 1]!.end;
    }
    index++;
    if (index > 100_000) break; // safety
  }

  return windows;
}

/** Global [start, end) overlap between two windows, if any. */
export function overlapRange(
  a: AnalysisWindow,
  b: AnalysisWindow,
): { start: number; end: number } | null {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  if (end <= start) return null;
  return { start, end };
}

export type OverlapStrip = {
  globalStart: number;
  globalEnd: number;
  localStart: number;
  localEnd: number;
  text: string;
};

/**
 * Overlap strips of `window` with previous / next neighbors (for pronoun policy).
 * Local offsets are relative to `window.text`.
 */
export function windowOverlapZones(
  window: AnalysisWindow,
  prev: AnalysisWindow | null | undefined,
  next: AnalysisWindow | null | undefined,
): {
  withPrev: OverlapStrip | null;
  withNext: OverlapStrip | null;
} {
  let withPrev: OverlapStrip | null = null;
  let withNext: OverlapStrip | null = null;

  if (prev) {
    const r = overlapRange(window, prev);
    if (r) {
      withPrev = {
        globalStart: r.start,
        globalEnd: r.end,
        localStart: r.start - window.start,
        localEnd: r.end - window.start,
        text: window.text.slice(r.start - window.start, r.end - window.start),
      };
    }
  }
  if (next) {
    const r = overlapRange(window, next);
    if (r) {
      withNext = {
        globalStart: r.start,
        globalEnd: r.end,
        localStart: r.start - window.start,
        localEnd: r.end - window.start,
        text: window.text.slice(r.start - window.start, r.end - window.start),
      };
    }
  }
  return { withPrev, withNext };
}

/**
 * Split window text into [prefixOverlap | middle | suffixOverlap] for prompts.
 * Middle may be empty if the whole window is overlap (short texts).
 */
export function splitWindowByOverlap(
  window: AnalysisWindow,
  prev: AnalysisWindow | null | undefined,
  next: AnalysisWindow | null | undefined,
): {
  prefixOverlap: string;
  middle: string;
  suffixOverlap: string;
  hasAnyOverlap: boolean;
} {
  const { withPrev, withNext } = windowOverlapZones(window, prev, next);
  const n = window.text.length;
  const prefixEnd = withPrev ? Math.min(n, Math.max(0, withPrev.localEnd)) : 0;
  const suffixStart = withNext
    ? Math.min(n, Math.max(prefixEnd, withNext.localStart))
    : n;

  const prefixOverlap = window.text.slice(0, prefixEnd);
  const middle = window.text.slice(prefixEnd, suffixStart);
  const suffixOverlap = window.text.slice(suffixStart);
  return {
    prefixOverlap,
    middle,
    suffixOverlap,
    hasAnyOverlap: Boolean(prefixOverlap || suffixOverlap),
  };
}
