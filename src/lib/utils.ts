import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

/** Create a content-based fingerprint for a novel.
 *  Same novel → same fingerprint → cache hit. */
export function novelFingerprint(text: string): string {
  // Sample: first 5000 + last 1000 + total length
  const head = text.substring(0, 5000);
  const tail = text.substring(Math.max(0, text.length - 1000));
  const sample = head + "|" + text.length + "|" + tail;
  // Simple hash
  let hash = 0;
  for (let i = 0; i < sample.length; i++) {
    const ch = sample.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return "novel_" + Math.abs(hash).toString(36);
}

/** Detect if text is primarily Chinese */
export function isChinese(text: string): boolean {
  const sample = text.substring(0, 1000);
  const cjkCount = (sample.match(/[一-鿿㐀-䶿]/g) || []).length;
  return cjkCount > sample.length * 0.15; // >15% CJK characters = Chinese text
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN");
}

/** Chunk text by paragraphs, respecting max chunk size with overlap */
export function chunkText(
  text: string,
  maxChunkSize: number = 4000,
  overlap: number = 500
): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length > maxChunkSize && current.length > 0) {
      chunks.push(current.trim());
      // Keep overlap: last `overlap` chars of previous chunk
      current = current.slice(-overlap) + "\n\n" + para;
    } else {
      current += (current ? "\n\n" : "") + para;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

/**
 * Robust JSON extraction from LLM responses.
 * Handles: markdown fences, extra text before/after JSON, trailing commas.
 */
export function extractJSON<T>(rawText: string): T {
  let text = rawText.trim();

  // Step 1: Remove markdown code fences if present
  text = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();

  // Step 2: Find the outermost JSON object or array
  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");

  let startIdx: number;
  let endChar: string;

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIdx = firstBrace;
    endChar = "}";
  } else if (firstBracket !== -1) {
    startIdx = firstBracket;
    endChar = "]";
  } else {
    throw new Error(
      `No JSON object/array found in response. First 200 chars: "${text.substring(0, 200)}"`
    );
  }

  // Find matching closing brace/bracket by counting nesting depth for both {} and []
  let braceDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let endIdx = startIdx;

  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    const prev = i > startIdx ? text[i - 1] : "";
    if (ch === '"' && prev !== '\\') inString = !inString;
    if (inString) continue;
    if (ch === '{') braceDepth++;
    else if (ch === '}') { braceDepth--; if (braceDepth === 0 && bracketDepth === 0) { endIdx = i; break; } }
    else if (ch === '[') bracketDepth++;
    else if (ch === ']') { bracketDepth--; if (braceDepth === 0 && bracketDepth === 0) { endIdx = i; break; } }
  }

  const totalUnclosed = braceDepth + bracketDepth;
  if (totalUnclosed > 0) {
    // JSON is truncated — try to salvage by auto-closing
    console.warn(`[extractJSON] Truncated JSON (braceDepth=${braceDepth}, bracketDepth=${bracketDepth}), attempting auto-close...`);
    let salvage = text.substring(startIdx);

    // Close any unclosed string first
    const lastQuote = salvage.lastIndexOf('"');
    if (lastQuote >= 0) {
      // Count quotes after this position — odd means we're inside a string
      const after = salvage.substring(lastQuote + 1);
      const quoteCount = (after.match(/"/g) || []).length;
      if (quoteCount % 2 === 0 && !after.includes('"') && lastQuote > salvage.length - 50) {
        salvage = salvage + '"';
      }
    }

    // Close brackets first, then braces
    for (let d = 0; d < bracketDepth; d++) salvage += ']';
    for (let d = 0; d < braceDepth; d++) salvage += '}';

    // Try parsing
    try {
      return JSON.parse(salvage) as T;
    } catch {
      // Clean trailing commas
      const cleaned = salvage
        .replace(/,\s*}/g, "}")
        .replace(/,\s*]/g, "]")
        .replace(/,\s*,\s*}/g, "}")
        .replace(/,\s*,\s*]/g, "]");
      try {
        return JSON.parse(cleaned) as T;
      } catch (e2) {
        console.error(`[extractJSON] Auto-close failed: ${(e2 as Error).message.substring(0, 100)}`);
      }
    }
    throw new Error(`Unbalanced JSON (braceDepth=${braceDepth}, bracketDepth=${bracketDepth}). First 300 chars: "${text.substring(0, 300)}"`);
  }

  const jsonStr = text.substring(startIdx, endIdx + 1);

  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    // Last resort: fix common LLM JSON issues
    const cleaned = jsonStr
      .replace(/,\s*}/g, "}")       // trailing comma in object
      .replace(/,\s*]/g, "]")       // trailing comma in array
      .replace(/"\s*\n\s*"/g, '",\n"') // missing comma between string values
      .replace(/]\s*\n\s*"/g, '],\n"') // missing comma after array
      .replace(/}\s*\n\s*"/g, '},\n"') // missing comma after nested object
      .replace(/[\n\r]/g, " ");     // newlines in strings

    try {
      return JSON.parse(cleaned) as T;
    } catch {
      throw new Error(`Failed to parse JSON. First 500 chars: "${rawText.substring(0, 500)}"`);
    }
  }
}

/**
 * Clean a filesystem name into a book-title candidate.
 * Handles site prefixes, author suffixes, chapter ranges, extensions.
 *
 * e.g. `soushu2025.com@《欲孽灼心》1-3作者xxx.txt` → `欲孽灼心`
 */
export function cleanFilenameTitle(fileName: string): string {
  if (!fileName) return "";
  let s = fileName.trim();
  // Drop path segments
  s = s.replace(/^.*[\\/]/, "");
  // Drop extension
  s = s.replace(/\.(txt|zip|md|epub|text)$/i, "");
  // Site / mirror prefixes: soushu…@ 《书》  or  本书下载自…
  s = s.replace(/^[^@]*@/, "");
  s = s.replace(/^本书下载自[^：:]*[：:]/, "");
  s = s.replace(/^www\.[^\s]+/i, "");
  // Prefer 《书名》 if present
  const bookMarks = s.match(/《([^》]{1,40})》/);
  if (bookMarks?.[1]) {
    s = bookMarks[1].trim();
  } else {
    // 【书名】 at start (not chapter body)
    const bracket = s.match(/^【([^】]{1,40})】/);
    if (bracket?.[1] && !/[一二三四五六七八九十\d]+[、．.]/.test(s.slice(bracket[0].length))) {
      s = bracket[1].trim();
    }
  }
  // Strip trailing author / chapter range junk
  s = s
    .replace(/[_\-—–\s]*作者[：:\s]*.*$/, "")
    .replace(/[_\-—–\s]*作者.+$/, "")
    .replace(/[_\-—–\s]*\(?\d+\s*[-~～到至]\s*\d+\)?.*$/, "")
    .replace(/[_\-—–\s]*全本.*$/, "")
    .replace(/[_\-—–\s]*完结.*$/, "")
    .replace(/[\[【\(（][^\]】\)）]{0,30}[\]】\)）]\s*$/, "")
    .replace(/[_\-—–.]{2,}.*$/, "")
    .trim();
  // Strip leftover quotes
  s = s.replace(/^[《「『"']+|[》」』"']+$/g, "").trim();
  // Reject if still looks like a URL or empty
  if (!s || /^https?:/i.test(s) || s.length > 60) return "";
  return s;
}

/** True if string looks like a chapter heading, not a book title */
export function looksLikeChapterHeading(s: string): boolean {
  const t = (s || "").trim();
  if (!t) return false;
  if (/^第\s*[\d一二三四五六七八九十百千零〇两]{1,12}\s*[章节回部卷集]/.test(t)) return true;
  if (/^【[^】]{1,40}】\s*[\d一二三四五六七八九十百千零〇两]{1,12}\s*[、．，,.]/.test(t)) {
    return true;
  }
  if (/^[一二三四五六七八九十百千零〇两\d]{1,8}\s*[、．.]\s*.+/.test(t) && t.length > 12) {
    return true;
  }
  if (/^Chapter\s*\d+/i.test(t)) return true;
  return false;
}

/**
 * Extract a book title candidate from novel body (first lines).
 * Prefers 《书名》 / 【书名】 over raw first line (which may be chapter 1).
 */
export function extractTitle(text: string): string {
  if (!text?.trim()) return "未命名小说";
  const head = text.trim().slice(0, 1500);
  const lines = head.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 12);

  for (const line of lines) {
    const book = line.match(/《([^》]{1,40})》/);
    if (book?.[1] && !looksLikeChapterHeading(book[1])) {
      return book[1].trim();
    }
  }

  for (const line of lines) {
    // 【欲孽灼心】一、… → 欲孽灼心
    const m = line.match(/^【([^】]{1,40})】/);
    if (m?.[1]) {
      const rest = line.slice(m[0].length).trim();
      if (
        !rest ||
        /^[\d一二三四五六七八九十百千零〇两]{1,12}\s*[、．，,.\-—]/.test(rest) ||
        /^第/.test(rest)
      ) {
        return m[1].trim();
      }
    }
  }

  const first = lines[0];
  if (first && first.length < 80 && !looksLikeChapterHeading(first)) {
    return first.replace(/^[《「『"']+|[》」』"']+$/g, "").trim();
  }

  return "未命名小说";
}

/**
 * Merge filename + body (+ optional LLM) into a final display title.
 * Filename is a first-class signal (often more reliable than chapter-1 body lines).
 */
export function resolveNovelTitle(opts: {
  text: string;
  fileName?: string;
  llmTitle?: string | null;
}): string {
  const fromFile = cleanFilenameTitle(opts.fileName || "");
  const fromBody = extractTitle(opts.text || "");
  let fromLlm = (opts.llmTitle || "").trim();
  fromLlm = fromLlm.replace(/^[《「『"']+|[》」』"']+$/g, "").trim();
  if (fromLlm.length > 60 || looksLikeChapterHeading(fromLlm)) {
    fromLlm = "";
  }
  // LLM sometimes returns full first line with book + chapter
  if (fromLlm) {
    const bm = fromLlm.match(/《([^》]{1,40})》/);
    if (bm?.[1]) fromLlm = bm[1].trim();
    else {
      const br = fromLlm.match(/^【([^】]{1,40})】/);
      if (br?.[1] && looksLikeChapterHeading(fromLlm)) fromLlm = br[1].trim();
    }
  }

  // Prefer: clean LLM if it agrees with file/body, else file, else body, else LLM
  if (fromLlm && fromFile && (fromLlm === fromFile || fromFile.includes(fromLlm) || fromLlm.includes(fromFile))) {
    return fromLlm.length <= fromFile.length ? fromLlm : fromFile;
  }
  if (fromLlm && fromBody && fromBody !== "未命名小说" && (fromLlm === fromBody || fromBody.includes(fromLlm) || fromLlm.includes(fromBody))) {
    return fromLlm.length <= fromBody.length ? fromLlm : fromBody;
  }
  if (fromFile && fromFile.length >= 1) {
    // If body also has a clean short title that is part of filename, prefer shorter clean one
    if (
      fromBody &&
      fromBody !== "未命名小说" &&
      !looksLikeChapterHeading(fromBody) &&
      (fromFile.includes(fromBody) || fromBody.includes(fromFile))
    ) {
      return fromBody.length <= fromFile.length ? fromBody : fromFile;
    }
    return fromFile;
  }
  if (fromBody && fromBody !== "未命名小说") return fromBody;
  if (fromLlm) return fromLlm;
  return "未命名小说";
}
