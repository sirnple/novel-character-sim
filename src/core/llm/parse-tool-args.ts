/**
 * Parse streaming tool-call argument JSON robustly.
 * Models often emit unescaped newlines/tabs inside string values, which
 * makes JSON.parse throw — previously we silently dropped the whole tool_use.
 *
 * Also detects **truncated** tool JSON (max_tokens cut mid-content) so save_prose
 * can reject incomplete bodies instead of accepting a short salvage loop.
 */
import { extractJSON } from "@/lib/utils";

/** True when braces/strings are unbalanced (stream cut mid-tool-args). */
export function looksLikeTruncatedJson(s: string): boolean {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === "\\") {
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
  }
  return inStr || depth !== 0;
}

function escapeControlCharsInsideStrings(s: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (esc) {
      out += ch;
      esc = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      out += ch;
      continue;
    }
    if (inStr) {
      if (ch === "\n") {
        out += "\\n";
        continue;
      }
      if (ch === "\r") {
        out += "\\r";
        continue;
      }
      if (ch === "\t") {
        out += "\\t";
        continue;
      }
    }
    out += ch;
  }
  return out;
}

/** Salvage { content: "..." } when outer JSON is broken / truncated. */
function salvageContentObject(s: string): Record<string, unknown> | null {
  const keyMatch = s.match(/"content"\s*:\s*"/);
  if (!keyMatch || keyMatch.index == null) return null;
  const start = keyMatch.index + keyMatch[0].length;
  // Truncated: no closing quote — take rest of stream as content body
  const truncated = looksLikeTruncatedJson(s);
  if (truncated) {
    // From start to end: strip trailing incomplete escapes
    let body = s.slice(start);
    // If there's a last complete \" sequence… usually just raw tail
    if (body.endsWith("\\")) body = body.slice(0, -1);
    const content = body
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
    if (content.trim().length < 20) return null;
    return { content, __truncatedArgs: true };
  }
  const endBrace = s.lastIndexOf("}");
  const searchEnd = endBrace > start ? endBrace : s.length;
  const lastQuote = s.lastIndexOf('"', searchEnd);
  if (lastQuote <= start) return null;
  const body = s.slice(start, lastQuote);
  const content = body
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
  if (content.trim().length < 20) return null;
  return { content };
}

/**
 * Parse tool argument JSON string → object.
 * Sets `__truncatedArgs: true` when JSON was incomplete (caller should reject save).
 * Returns null only when completely unusable.
 */
export function parseToolCallArguments(
  raw: string,
  toolName = "",
): Record<string, unknown> | null {
  const s = String(raw || "").trim();
  if (!s) return null;

  const truncated = looksLikeTruncatedJson(s);

  const tryParse = (text: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(text);
      if (v && typeof v === "object" && !Array.isArray(v)) {
        return v as Record<string, unknown>;
      }
      if (
        typeof v === "string" &&
        (toolName.includes("save_outline") || toolName.includes("save_prose"))
      ) {
        return { content: v };
      }
      return null;
    } catch {
      return null;
    }
  };

  let parsed =
    tryParse(s) ||
    tryParse(escapeControlCharsInsideStrings(s)) ||
    tryParse(s.replace(/,\s*([}\]])/g, "$1"));

  let usedExtractJson = false;
  if (!parsed) {
    try {
      const v = extractJSON<unknown>(s);
      if (v && typeof v === "object" && !Array.isArray(v)) {
        parsed = v as Record<string, unknown>;
        usedExtractJson = true;
      }
    } catch {
      /* ignore */
    }
  }

  if (!parsed) {
    parsed = salvageContentObject(s);
  }

  // plan field for foreshadowing
  if (!parsed && /save_foreshadowing_plan|plan/i.test(toolName + s.slice(0, 40))) {
    try {
      const v = extractJSON<unknown>(s);
      if (v && typeof v === "object") {
        if ("plan" in (v as object)) parsed = v as Record<string, unknown>;
        else parsed = { plan: JSON.stringify(v) };
      }
    } catch {
      /* ignore */
    }
  }

  if (!parsed) {
    console.warn(
      `[parseToolArgs] FAILED tool=${toolName || "?"} len=${s.length} truncated=${truncated} head=${JSON.stringify(s.slice(0, 160))}`,
    );
    return null;
  }

  // Mark truncated so save_prose can reject incomplete novels
  if (truncated || usedExtractJson && looksLikeTruncatedJson(s)) {
    parsed = { ...parsed, __truncatedArgs: true };
    console.warn(
      `[parseToolArgs] TRUNCATED tool=${toolName || "?"} argsLen=${s.length} contentLen=${String(parsed.content || "").length}`,
    );
  }

  return parsed;
}
