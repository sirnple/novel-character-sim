/**
 * Program-first chapter catalog.
 * Patterns live in chapter-rules.json (e-reader style); this file only scans + filters.
 */
import type { ChapterCatalogEntry, ChapterTitleStyle } from "@/types";
import { parseChineseNumeral } from "./chapter-numerals";
import {
  getChapterRulesConfig,
  loadChapterRules,
  matchChapterLine,
} from "./chapter-rules";

export { parseChineseNumeral };
export { getChapterRulesConfig, loadChapterRules, matchChapterLine };

/**
 * Scan full text for chapter headings. Returns catalog sorted by offset.
 */
export function extractChapterCatalog(
  text: string,
  _style?: Partial<ChapterTitleStyle> | null,
): ChapterCatalogEntry[] {
  if (!text) return [];
  const { config } = loadChapterRules();
  const lines = text.split(/\n/);
  let offset = 0;
  const raw: (ChapterCatalogEntry & { strength: number; kind: string })[] = [];
  const seenOffsets = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const lineStart = offset;
    offset += line.length + (i < lines.length - 1 ? 1 : 0);

    if (!trimmed) continue;
    const m = matchChapterLine(trimmed);
    if (!m) continue;
    if (seenOffsets.has(lineStart)) continue;

    const prevBlank = i === 0 || !lines[i - 1]?.trim();
    const nextBlank = i >= lines.length - 1 || !lines[i + 1]?.trim();
    let strength = m.strength;
    if (prevBlank) strength += config.blankLineBoostPrev ?? 0;
    if (nextBlank) strength += config.blankLineBoostNext ?? 0;

    seenOffsets.add(lineStart);
    raw.push({
      id: `ch_${raw.length + 1}_${lineStart}`,
      number: m.number,
      title: m.title || trimmed,
      startOffset: lineStart,
      source: "regex",
      strength,
      kind: m.kind,
    });
  }

  let filtered = filterWeakHits(raw, config.strongThreshold, config.keepWeakWithStrongMin);

  for (let i = 0; i < filtered.length; i++) {
    filtered[i].endOffset =
      i + 1 < filtered.length ? filtered[i + 1].startOffset : text.length;
  }

  return filtered.map(({ strength: _s, kind: _k, ...rest }) => rest);
}

function filterWeakHits(
  raw: (ChapterCatalogEntry & { strength: number; kind: string })[],
  strongThreshold: number,
  keepWeakMin: number,
): (ChapterCatalogEntry & { strength: number; kind: string })[] {
  if (raw.length <= 1) return raw;

  const strong = raw.filter((r) => r.strength >= strongThreshold);
  if (strong.length >= 3) {
    return raw.filter(
      (r) => r.strength >= keepWeakMin || isSequentialFriendly(r, strong),
    );
  }

  const weak = raw.filter(
    (r) => r.kind === "cn_enum" || r.kind === "ar_enum",
  );
  if (weak.length === raw.length && weak.length >= 3) {
    const nums = weak.map((w) => w.number).filter((n): n is number => n != null);
    let increasing = 0;
    for (let i = 1; i < nums.length; i++) {
      if (nums[i] > nums[i - 1]) increasing++;
    }
    if (increasing >= nums.length * 0.6) return raw;
    return [];
  }

  const weakMin = getChapterRulesConfig().weakMinStrength ?? 55;
  return raw.filter((r) => r.strength >= weakMin);
}

function isSequentialFriendly(
  r: ChapterCatalogEntry & { strength: number },
  strong: ChapterCatalogEntry[],
): boolean {
  if (r.number == null) return r.strength >= 75;
  const nums = strong.map((s) => s.number).filter((n): n is number => n != null);
  if (!nums.length) return true;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return r.number >= min - 1 && r.number <= max + 5;
}

/** Infer rough chaptering style from catalog + samples in text. */
export function inferChapteringFromCatalog(
  text: string,
  catalog: ChapterCatalogEntry[],
): ChapterTitleStyle {
  const samples = catalog.slice(0, 8).map((c) => {
    const slice = text.slice(
      c.startOffset,
      Math.min(text.length, c.startOffset + 100),
    );
    const first = slice.split("\n")[0]?.trim() || c.title;
    return first;
  });

  let arabic = 0;
  let chinese = 0;
  let bracket = 0;
  for (const s of samples) {
    if (/第\s*\d+\s*章/.test(s)) arabic++;
    else if (/第\s*[一二三四五六七八九十百千]/.test(s)) chinese++;
    if (/^【/.test(s)) bracket++;
  }

  const enabled = catalog.length >= 2;
  let confidence =
    catalog.length === 0 ? 0.15
    : catalog.length === 1 ? 0.42
    : catalog.length < 4 ? 0.62
    : catalog.length < 10 ? 0.8
    : 0.9;

  const nums = catalog.map((c) => c.number).filter((n): n is number => n != null);
  if (nums.length >= 3) {
    let inc = 0;
    for (let i = 1; i < nums.length; i++) {
      if (nums[i] === nums[i - 1] + 1) inc++;
    }
    if (inc >= nums.length * 0.5) confidence = Math.min(0.95, confidence + 0.1);
  }

  const effectiveEnabled = enabled && confidence >= 0.55;

  let avg = 0;
  if (catalog.length >= 2) {
    const lens = catalog.map(
      (c) => (c.endOffset ?? c.startOffset) - c.startOffset,
    );
    avg = Math.round(lens.reduce((a, b) => a + b, 0) / lens.length);
  }

  let titlePattern = "无明显分章";
  if (effectiveEnabled) {
    if (bracket > 0) titlePattern = "【书名】序号、标题";
    else titlePattern = "第N章 + 标题";
  }

  return {
    enabled: effectiveEnabled,
    confidence,
    numbering:
      chinese > arabic ? "chinese_di_n_zhang"
      : arabic > 0 ? "arabic_di_n_zhang"
      : bracket > 0 ? "other"
      : "none",
    titlePattern,
    separator: " ",
    samples,
    avgChapterLengthChars: avg || undefined,
    chapterEndTendency: "unknown",
  };
}

/** Heuristic quality issues for LLM or UI. */
export function catalogQualityHints(
  catalog: ChapterCatalogEntry[],
  textLen: number,
): string[] {
  const hints: string[] = [];
  if (catalog.length === 0 && textLen > 50_000) {
    hints.push(
      "长文未检出章节标题：可在 src/core/form/chapter-rules.json 增加规则",
    );
  }
  const nums = catalog.map((c) => c.number).filter((n): n is number => n != null);
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] < nums[i - 1]) {
      hints.push("章号出现回退，可能有误检");
      break;
    }
    if (nums[i] > nums[i - 1] + 3) {
      hints.push("章号跳跃较大，可能漏检");
      break;
    }
  }
  if (catalog.length > 0 && textLen > 0) {
    const density = catalog.length / (textLen / 10000);
    if (density > 30) hints.push("章节过密，可能把正文行误识别为标题");
  }
  return hints;
}
