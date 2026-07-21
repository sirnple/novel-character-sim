/**
 * Split novel text into extraction units (chapters or fixed windows).
 * Spec: chapter-first; pack when chapters > 150 or bodies tiny; else ~6k windows.
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

export interface TextUnit {
  index: number;
  label: string;
  start: number;
  end: number;
  text: string;
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
  /** Window size when no/unusable catalog (default 6000) */
  windowChars?: number;
  /** Pack chapters when count exceeds this (default 150) */
  packWhenChaptersExceed?: number;
  /** Min chapter body to keep alone when not force-packing */
  minChapterChars?: number;
  /** Target size when packing (default 8000) */
  packTargetChars?: number;
}

/**
 * Build units for per-unit name scan (spec-frozen defaults).
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

  const windowChars = options.windowChars ?? 6_000;
  const packWhenExceed = options.packWhenChaptersExceed ?? 150;
  const minChapterChars = options.minChapterChars ?? 400;
  const packTarget = options.packTargetChars ?? 8_000;

  const catalog = extractChapterCatalog(text);
  if (catalog.length >= 4) {
    // Always chapter-based when catalog exists; pack if many/tiny chapters
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

  return windowUnits(text, windowChars);
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

function windowUnits(text: string, windowChars: number): TextUnit[] {
  const units: TextUnit[] = [];
  const step = Math.max(2_000, Math.floor(windowChars * 0.92));
  let start = 0;
  let index = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + windowChars);
    // Prefer break near newline
    if (end < text.length) {
      const slice = text.slice(start, end);
      const nl = slice.lastIndexOf("\n");
      if (nl > windowChars * 0.5) end = start + nl + 1;
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
  }
  return units;
}
