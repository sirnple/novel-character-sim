/**
 * Program-first chapter catalog extraction from plain text.
 * LLM only validates the list later (cheap).
 */
import type { ChapterCatalogEntry, ChapterTitleStyle } from "@/types";

const RE_ARABIC = /^[ 　\t]*第\s*(\d{1,5})\s*章([ 　\t\-—–·:：]*)(.*)$/;
const RE_CHINESE = /^[ 　\t]*第\s*([一二三四五六七八九十百千零〇两\d]{1,12})\s*章([ 　\t\-—–·:：]*)(.*)$/;
const RE_VOLUME = /^[ 　\t]*第\s*(\d{1,4}|[一二三四五六七八九十百千]+)\s*卷/;

const CN_MAP: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 百: 100, 千: 1000,
};

export function parseChineseNumeral(s: string): number | undefined {
  const t = (s || "").trim();
  if (!t) return undefined;
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  let total = 0;
  let current = 0;
  for (const ch of t) {
    const v = CN_MAP[ch];
    if (v === undefined) return undefined;
    if (v === 10 || v === 100 || v === 1000) {
      if (current === 0) current = 1;
      total += current * v;
      current = 0;
    } else {
      current = v;
    }
  }
  return total + current;
}

function lineLooksLikeTitle(line: string, maxLen = 40): boolean {
  const t = line.trim();
  if (!t || t.length > maxLen) return false;
  // Avoid pure dialogue or long narrative
  if (/^[「『"']/.test(t)) return false;
  if ((t.match(/[。！？]/g) || []).length >= 2) return false;
  return true;
}

/**
 * Scan full text for chapter headings. Returns catalog sorted by offset.
 */
export function extractChapterCatalog(
  text: string,
  style?: Partial<ChapterTitleStyle> | null,
): ChapterCatalogEntry[] {
  if (!text) return [];
  const preferChinese = style?.numbering === "chinese_di_n_zhang";
  const lines = text.split(/\n/);
  let offset = 0;
  const found: ChapterCatalogEntry[] = [];
  const seenOffsets = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const lineStart = offset;
    offset += line.length + (i < lines.length - 1 ? 1 : 0);

    if (!trimmed || !lineLooksLikeTitle(trimmed, 48)) continue;

    let number: number | undefined;
    let title = "";
    let matched = false;

    const tryArabic = RE_ARABIC.exec(trimmed);
    const tryCn = RE_CHINESE.exec(trimmed);

    if (preferChinese && tryCn) {
      number = parseChineseNumeral(tryCn[1]);
      title = (tryCn[3] || "").trim() || `第${tryCn[1]}章`;
      matched = true;
    } else if (tryArabic) {
      number = parseInt(tryArabic[1], 10);
      title = (tryArabic[3] || "").trim() || `第${tryArabic[1]}章`;
      matched = true;
    } else if (tryCn) {
      number = parseChineseNumeral(tryCn[1]);
      title = (tryCn[3] || "").trim() || `第${tryCn[1]}章`;
      matched = true;
    }

    if (!matched) continue;
    if (seenOffsets.has(lineStart)) continue;
    seenOffsets.add(lineStart);

    found.push({
      id: `ch_${found.length + 1}_${lineStart}`,
      number: Number.isFinite(number as number) ? number : undefined,
      title: title || trimmed,
      startOffset: lineStart,
      source: "regex",
    });
  }

  // Fill endOffset from next start
  for (let i = 0; i < found.length; i++) {
    found[i].endOffset =
      i + 1 < found.length ? found[i + 1].startOffset : text.length;
  }

  return found;
}

/** Infer rough chaptering style from catalog + samples in text. */
export function inferChapteringFromCatalog(
  text: string,
  catalog: ChapterCatalogEntry[],
): ChapterTitleStyle {
  const samples = catalog.slice(0, 8).map((c) => {
    const slice = text.slice(c.startOffset, Math.min(text.length, c.startOffset + 80));
    const first = slice.split("\n")[0]?.trim() || c.title;
    return first;
  });

  let arabic = 0;
  let chinese = 0;
  for (const s of samples) {
    if (/第\s*\d+\s*章/.test(s)) arabic++;
    else if (/第\s*[一二三四五六七八九十百千]/.test(s)) chinese++;
  }

  const enabled = catalog.length >= 2;
  const confidence =
    catalog.length === 0 ? 0.2
    : catalog.length === 1 ? 0.45
    : catalog.length < 5 ? 0.65
    : 0.85;

  // Conservative: low confidence → disabled for agents
  const effectiveEnabled = enabled && confidence >= 0.55;

  let avg = 0;
  if (catalog.length >= 2) {
    const lens = catalog.map((c) => (c.endOffset ?? c.startOffset) - c.startOffset);
    avg = Math.round(lens.reduce((a, b) => a + b, 0) / lens.length);
  }

  return {
    enabled: effectiveEnabled,
    confidence,
    numbering:
      chinese > arabic ? "chinese_di_n_zhang"
      : arabic > 0 ? "arabic_di_n_zhang"
      : "none",
    titlePattern: effectiveEnabled ? "第N章 + 标题" : "无明显分章",
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
    hints.push("长文未检出章节标题，可能不分章或标题格式特殊");
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
