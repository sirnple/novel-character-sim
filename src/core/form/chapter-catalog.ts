/**
 * Program-first chapter catalog — multi-pattern scanner inspired by
 * Chinese e-reader rules (Legado / 静读天下 style): 第N章、第N回、
 * Chapter N、【书名】一、…、纯数字标题等。
 */
import type { ChapterCatalogEntry, ChapterTitleStyle } from "@/types";

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

/** Match result from a single line */
interface LineMatch {
  number?: number;
  title: string;
  strength: number; // higher = more reliable pattern
  kind: string;
}

const CN_NUM = "[一二三四五六七八九十百千零〇两\\d]{1,12}";
const AR_NUM = "\\d{1,5}";

/**
 * Ordered patterns (strength descending). Mirrors common reader rule sets.
 * Each pattern is anchored to a full line (already trimmed).
 */
const PATTERNS: {
  re: RegExp;
  strength: number;
  kind: string;
  num: (m: RegExpExecArray) => number | undefined;
  title: (m: RegExpExecArray) => string;
}[] = [
  // 第01章 / 第1章 标题 / 第十二章 雨夜
  {
    re: new RegExp(
      `^第\\s*(${AR_NUM})\\s*章([ 　\\t\\-—–·:：]*)(.*)$`,
    ),
    strength: 100,
    kind: "di_n_zhang_ar",
    num: (m) => parseInt(m[1], 10),
    title: (m) => (m[3] || "").trim() || `第${m[1]}章`,
  },
  {
    re: new RegExp(
      `^第\\s*(${CN_NUM})\\s*章([ 　\\t\\-—–·:：]*)(.*)$`,
    ),
    strength: 100,
    kind: "di_n_zhang_cn",
    num: (m) => parseChineseNumeral(m[1]),
    title: (m) => (m[3] || "").trim() || `第${m[1]}章`,
  },
  // 第N节 / 第N回 / 第N话
  {
    re: new RegExp(
      `^第\\s*(${AR_NUM}|${CN_NUM})\\s*(节|回|话)([ 　\\t\\-—–·:：]*)(.*)$`,
    ),
    strength: 92,
    kind: "di_n_unit",
    num: (m) => parseChineseNumeral(m[1]) ?? parseInt(m[1], 10),
    title: (m) => (m[4] || "").trim() || `第${m[1]}${m[2]}`,
  },
  // Chapter 1 / CHAPTER 12 Title
  {
    re: /^Chapter\s*(\d{1,5})([:.\-—–\s]*)(.*)$/i,
    strength: 95,
    kind: "chapter_en",
    num: (m) => parseInt(m[1], 10),
    title: (m) => (m[3] || "").trim() || `Chapter ${m[1]}`,
  },
  // 【书名】一、标题  /  【xxx】1.标题  （常见网文分卷标题行）
  {
    re: new RegExp(
      `^【[^】]{1,40}】\\s*(${AR_NUM}|${CN_NUM})\\s*[、．，,.．:：\\-—]\\s*(.*)$`,
    ),
    strength: 88,
    kind: "bracket_book_num",
    num: (m) => parseChineseNumeral(m[1]) ?? parseInt(m[1], 10),
    title: (m) => (m[2] || "").trim() || m[0],
  },
  // 纯：一、标题 / 十二、标题（需后续序号启发式加权）
  {
    re: new RegExp(`^(${CN_NUM})\\s*[、．.]\\s*(.+)$`),
    strength: 55,
    kind: "cn_enum",
    num: (m) => parseChineseNumeral(m[1]),
    title: (m) => (m[2] || "").trim(),
  },
  // 1. 标题 / 01、标题（弱）
  {
    re: /^(0*\d{1,4})\s*[、．.]\s*(.+)$/,
    strength: 50,
    kind: "ar_enum",
    num: (m) => parseInt(m[1], 10),
    title: (m) => (m[2] || "").trim(),
  },
  // 序章 / 楔子 / 引子 / 尾声 / 番外 / 后记
  {
    re: /^(序章|楔子|引子|前言|序言|尾声|后记|番外|终章|终幕)([ 　\t\-—–·:：]*)(.*)$/,
    strength: 80,
    kind: "special",
    num: () => undefined,
    title: (m) => {
      const rest = (m[3] || "").trim();
      return rest ? `${m[1]} ${rest}` : m[1];
    },
  },
  // 第N卷（卷级，弱于章，仍记入目录）
  {
    re: new RegExp(
      `^第\\s*(${AR_NUM}|${CN_NUM})\\s*卷([ 　\\t\\-—–·:：]*)(.*)$`,
    ),
    strength: 70,
    kind: "volume",
    num: (m) => parseChineseNumeral(m[1]) ?? parseInt(m[1], 10),
    title: (m) => (m[3] || "").trim() || `第${m[1]}卷`,
  },
];

const MAX_TITLE_LEN = 80;

function isNarrativeNoise(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (t.length > MAX_TITLE_LEN) return true;
  // dialogue openers
  if (/^[「『"'“]/.test(t)) return true;
  // too many sentence endings → prose
  if ((t.match(/[。！？!?；;]/g) || []).length >= 2) return true;
  // ends with period and long → likely sentence
  if (t.length > 24 && /[。！？]$/.test(t)) return true;
  // URL / site watermark
  if (/https?:\/\/|www\.|\.com|搜书|下载自/i.test(t)) return true;
  // author notes often long and chatty
  if (/本章完|求推荐|求月票|字数|更新/.test(t) && t.length > 20) return true;
  return false;
}

function matchLine(line: string): LineMatch | null {
  if (isNarrativeNoise(line)) return null;
  for (const p of PATTERNS) {
    const m = p.re.exec(line);
    if (!m) continue;
    const number = p.num(m);
    let title = p.title(m);
    if (!title) title = line;
    // weak patterns need a non-empty descriptive title
    if (p.strength < 60 && title.length < 2) continue;
    return {
      number: Number.isFinite(number as number) ? number : undefined,
      title,
      strength: p.strength,
      kind: p.kind,
    };
  }
  return null;
}

/**
 * Scan full text for chapter headings. Returns catalog sorted by offset.
 */
export function extractChapterCatalog(
  text: string,
  _style?: Partial<ChapterTitleStyle> | null,
): ChapterCatalogEntry[] {
  if (!text) return [];
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
    const m = matchLine(trimmed);
    if (!m) continue;
    if (seenOffsets.has(lineStart)) continue;

    // Prefer lines that sit near blank lines (title isolation) — small boost later
    const prevBlank = i === 0 || !lines[i - 1]?.trim();
    const nextBlank = i >= lines.length - 1 || !lines[i + 1]?.trim();
    let strength = m.strength;
    if (prevBlank) strength += 5;
    if (nextBlank) strength += 3;

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

  // Drop weak hits that break number sequence badly when stronger hits exist
  let filtered = filterWeakHits(raw);

  // Fill endOffset
  for (let i = 0; i < filtered.length; i++) {
    filtered[i].endOffset =
      i + 1 < filtered.length ? filtered[i + 1].startOffset : text.length;
  }

  // Strip internal fields
  return filtered.map(({ strength: _s, kind: _k, ...rest }) => rest);
}

function filterWeakHits(
  raw: (ChapterCatalogEntry & { strength: number; kind: string })[],
): (ChapterCatalogEntry & { strength: number; kind: string })[] {
  if (raw.length <= 1) return raw;

  const strong = raw.filter((r) => r.strength >= 80);
  // If we have enough strong headings, drop pure enum noise (1. 2. in body)
  if (strong.length >= 3) {
    return raw.filter((r) => r.strength >= 70 || isSequentialFriendly(r, strong));
  }

  // Only weak cn_enum / ar_enum: keep if numbers mostly increase
  const weak = raw.filter((r) => r.kind === "cn_enum" || r.kind === "ar_enum");
  if (weak.length === raw.length && weak.length >= 3) {
    const nums = weak.map((w) => w.number).filter((n): n is number => n != null);
    let increasing = 0;
    for (let i = 1; i < nums.length; i++) {
      if (nums[i] > nums[i - 1]) increasing++;
    }
    if (increasing >= nums.length * 0.6) return raw;
    // not sequential → discard weak-only false positives
    return [];
  }

  return raw.filter((r) => r.strength >= 55);
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
    const slice = text.slice(c.startOffset, Math.min(text.length, c.startOffset + 100));
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
  // More chapters / clearer patterns → higher confidence
  let confidence =
    catalog.length === 0 ? 0.15
    : catalog.length === 1 ? 0.42
    : catalog.length < 4 ? 0.62
    : catalog.length < 10 ? 0.8
    : 0.9;

  // Sequential numbers boost
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
    const lens = catalog.map((c) => (c.endOffset ?? c.startOffset) - c.startOffset);
    avg = Math.round(lens.reduce((a, b) => a + b, 0) / lens.length);
  }

  let titlePattern = "无明显分章";
  if (effectiveEnabled) {
    if (bracket > 0) titlePattern = "【书名】序号、标题";
    else if (chinese >= arabic) titlePattern = "第N章 + 标题";
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
    hints.push("长文未检出章节标题，可能使用【书名】序号或其它非常规格式");
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
