/**
 * Split novel text into extraction units for mention scan + overlap merge.
 *
 * Primary path (2026-07-22): **character windows with overlap** so stage-②
 * can align entities when a shared mention appears in O_i,i+1.
 *
 * Legacy chapter-first packing remains available via preferChapters.
 *
 * LLM mention-scan may further pack several units into one model call
 * (see packUnitsForMentionScan) under a char/unit budget for speed.
 */

import { extractChapterCatalog } from "@/core/form/chapter-catalog";
import { getRuntimeSettings } from "@/lib/runtime-settings";

export {
  MENTION_SCAN_BATCH_CHARS_DEFAULT,
  MENTION_SCAN_BATCH_UNITS_DEFAULT,
} from "@/lib/runtime-settings";

/** Default window body size (chars) for overlap scan */
export const DEFAULT_OVERLAP_WINDOW_CHARS = 6_000;
/** Default overlap between adjacent windows (chars); tune later */
export const DEFAULT_OVERLAP_CHARS = 800;

export interface TextUnit {
  index: number;
  label: string;
  start: number;
  end: number;
  text: string;
}

/**
 * Overlap text between unit i and i+1 in fullText coordinates.
 * When units are built with step = window - overlap, this is
 * [units[i+1].start, units[i].end).
 */
export function overlapRangeBetweenUnits(
  a: TextUnit,
  b: TextUnit,
): { start: number; end: number } | null {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  if (end <= start) return null;
  return { start, end };
}

export function overlapTextBetweenUnits(
  fullText: string,
  a: TextUnit,
  b: TextUnit,
): string {
  const r = overlapRangeBetweenUnits(a, b);
  if (!r) return "";
  return fullText.slice(r.start, r.end);
}

/**
 * Group consecutive units into LLM call batches under char + unit caps.
 * Single unit longer than maxChars is still one batch (caller truncates text).
 * Defaults from {@link getRuntimeSettings} (env + runtime overrides).
 */
export function packUnitsForMentionScan(
  units: TextUnit[],
  options?: { maxChars?: number; maxUnits?: number },
): TextUnit[][] {
  const settings = getRuntimeSettings();
  const maxChars = options?.maxChars ?? settings.mentionScanBatchChars;
  const maxUnits = options?.maxUnits ?? settings.mentionScanBatchUnits;

  if (!units.length) return [];
  const batches: TextUnit[][] = [];
  let cur: TextUnit[] = [];
  let curChars = 0;

  for (const u of units) {
    const len = (u.text || "").length;
    const wouldChars = curChars + len + (cur.length ? 80 : 0); // section header slack
    const wouldUnits = cur.length + 1;
    const overflow =
      cur.length > 0 &&
      (wouldUnits > maxUnits || (wouldChars > maxChars && curChars > 0));
    if (overflow) {
      batches.push(cur);
      cur = [];
      curChars = 0;
    }
    cur.push(u);
    curChars += len + (cur.length > 1 ? 80 : 0);
    // Lone unit already over budget: flush alone next iteration if more come
    if (cur.length === 1 && len >= maxChars) {
      batches.push(cur);
      cur = [];
      curChars = 0;
    }
  }
  if (cur.length) batches.push(cur);
  return batches;
}

export interface BuildUnitsOptions {
  /** Window size (default {@link DEFAULT_OVERLAP_WINDOW_CHARS}) */
  windowChars?: number;
  /**
   * Overlap chars between adjacent windows (default {@link DEFAULT_OVERLAP_CHARS}).
   * Set 0 only for legacy non-overlap experiments.
   */
  overlapChars?: number;
  /**
   * Prefer chapter packing when catalog is rich (legacy).
   * Default **false** — character extract uses overlap windows.
   */
  preferChapters?: boolean;
  /** Pack chapters when count exceeds this (default 150) */
  packWhenChaptersExceed?: number;
  /** Min chapter body to keep alone when not force-packing */
  minChapterChars?: number;
  /** Target size when packing (default 8000) */
  packTargetChars?: number;
}

/**
 * Sliding windows with explicit character overlap (stage ① for overlap-merge coref).
 */
export function buildOverlapScanUnits(
  fullText: string,
  options?: { windowChars?: number; overlapChars?: number },
): TextUnit[] {
  const text = fullText || "";
  if (!text.trim()) return [];
  if (text.length < 50) {
    return [{ index: 0, label: "全文", start: 0, end: text.length, text }];
  }

  const windowChars = Math.max(
    500,
    options?.windowChars ?? DEFAULT_OVERLAP_WINDOW_CHARS,
  );
  let overlapChars =
    options?.overlapChars ?? DEFAULT_OVERLAP_CHARS;
  overlapChars = Math.max(0, Math.min(overlapChars, windowChars - 100));
  const step = Math.max(1, windowChars - overlapChars);

  const units: TextUnit[] = [];
  let start = 0;
  let index = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + windowChars);
    // Prefer break near newline in the non-overlap tail
    if (end < text.length) {
      const slice = text.slice(start, end);
      const searchFrom = Math.floor(slice.length * 0.55);
      const nl = slice.lastIndexOf("\n");
      if (nl >= searchFrom) end = start + nl + 1;
    }
    units.push({
      index,
      label: `窗${index + 1}`,
      start,
      end,
      text: text.slice(start, end),
    });
    index++;
    if (end >= text.length) break;
    start += step;
    // Guard: always advance
    if (units.length > 1 && start <= units[units.length - 1].start) {
      start = units[units.length - 1].start + step;
    }
  }
  return units;
}

/**
 * Build units for per-unit mention scan.
 * Default: **overlap character windows** (stage ①).
 * Pass preferChapters:true for legacy chapter-first packing (no guaranteed overlap).
 */
export function buildNameScanUnits(
  fullText: string,
  options: BuildUnitsOptions = {},
): TextUnit[] {
  const text = fullText || "";
  if (text.length < 50) {
    return text.trim()
      ? [{ index: 0, label: "全文", start: 0, end: text.length, text }]
      : [];
  }

  if (options.preferChapters) {
    const windowChars = options.windowChars ?? DEFAULT_OVERLAP_WINDOW_CHARS;
    const packWhenExceed = options.packWhenChaptersExceed ?? 150;
    const minChapterChars = options.minChapterChars ?? 400;
    const packTarget = options.packTargetChars ?? 8_000;

    const catalog = extractChapterCatalog(text);
    if (catalog.length >= 4) {
      const forcePack = catalog.length > packWhenExceed;
      const packed = packChapterRanges(
        text,
        catalog,
        forcePack ? Math.min(packTarget, 12_000) : packTarget,
        forcePack ? 800 : minChapterChars,
        forcePack,
      );
      if (packed.length >= 2) return packed;
    }
    return buildOverlapScanUnits(text, {
      windowChars,
      overlapChars: options.overlapChars ?? 0,
    });
  }

  return buildOverlapScanUnits(text, {
    windowChars: options.windowChars,
    overlapChars: options.overlapChars,
  });
}

function packChapterRanges(
  text: string,
  catalog: {
    number?: number;
    title: string;
    startOffset: number;
    endOffset?: number;
  }[],
  packTarget: number,
  minChapterChars: number,
  forcePack: boolean,
): TextUnit[] {
  type Range = { start: number; end: number; labels: string[] };
  const ranges: Range[] = [];

  for (let i = 0; i < catalog.length; i++) {
    const start = catalog[i].startOffset;
    const end =
      catalog[i].endOffset ??
      (i + 1 < catalog.length ? catalog[i + 1].startOffset : text.length);
    if (end <= start) continue;
    const num = catalog[i].number ?? i + 1;
    const label = `第${num}章 ${catalog[i].title || ""}`.trim();
    const last = ranges[ranges.length - 1];
    const len = end - start;
    const shouldPack =
      last &&
      last.end - last.start + len <= packTarget * 1.4 &&
      (forcePack ||
        last.end - last.start < packTarget ||
        len < minChapterChars);
    if (shouldPack && last) {
      last.end = end;
      last.labels.push(label);
    } else {
      ranges.push({ start, end, labels: [label] });
    }
  }

  // Leading text before first chapter
  if (ranges.length && ranges[0].start > 200) {
    ranges.unshift({
      start: 0,
      end: ranges[0].start,
      labels: ["文首"],
    });
  }

  return ranges.map((r, index) => ({
    index,
    label:
      r.labels.length === 1
        ? r.labels[0]
        : `${r.labels[0]}…等${r.labels.length}章`,
    start: r.start,
    end: r.end,
    text: text.slice(r.start, r.end),
  }));
}


