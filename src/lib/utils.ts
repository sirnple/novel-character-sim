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

  // Find matching closing brace/bracket by counting nesting depth
  const openChar = text[startIdx];
  const closeChar = endChar;
  let depth = 0;
  let endIdx = startIdx;

  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }

  if (depth !== 0) {
    // JSON is truncated — try to salvage by auto-closing
    console.warn(`[extractJSON] Truncated JSON detected (depth=${depth}), attempting auto-close...`);
    // Append closing brackets to balance the JSON
    let salvage = text.substring(startIdx);
    for (let d = 0; d < depth; d++) {
      salvage += endChar;
    }
    // Close any unclosed string
    const lastQuote = salvage.lastIndexOf('"');
    const afterLastQuote = salvage.substring(lastQuote + 1);
    if (!afterLastQuote.includes('"') && lastQuote > salvage.length - 20) {
      salvage = salvage + '"';
    }

    try {
      return JSON.parse(salvage) as T;
    } catch {
      // Try cleaning as well
      const cleaned = salvage
        .replace(/,\s*}/g, "}")
        .replace(/,\s*]/g, "]")
        .replace(/"\s*\n\s*"/g, '",\n"');
      try {
        return JSON.parse(cleaned) as T;
      } catch {
        console.error(`[extractJSON] Auto-close failed.`);
      }
    }
    throw new Error(`Unbalanced JSON (depth=${depth}). First 300 chars: "${text.substring(0, 300)}"`);
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

/** Extract a potential title from the first lines of the text */
export function extractTitle(text: string): string {
  const firstLine = text.trim().split("\n")[0];
  if (firstLine && firstLine.length < 100) {
    return firstLine.replace(/^[《「『]|[》」』]$/g, "").trim();
  }
  return "未命名小说";
}
