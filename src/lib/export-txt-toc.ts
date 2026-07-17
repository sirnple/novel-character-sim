/**
 * Prepend a plain-text TOC from chapter catalog when exporting branch TXT.
 */
import type { ChapterCatalogEntry } from "@/types";

export function formatChapterTocLine(c: ChapterCatalogEntry): string {
  if (c.number != null) {
    const title = (c.title || "").replace(/^第\s*[\d一二三四五六七八九十百千零〇两]+\s*章\s*/, "");
    return title ? `第${c.number}章 ${title}` : `第${c.number}章`;
  }
  return c.title || "（无标题）";
}

/**
 * If chapters non-empty, return body with a leading 目录 block; else body unchanged.
 */
export function prependTocToTxt(
  body: string,
  chapters: ChapterCatalogEntry[] | null | undefined,
): string {
  const list = (chapters || []).filter((c) => c && (c.title || c.number != null));
  if (!list.length) return body ?? "";

  const tocLines = list.map((c, i) => `${i + 1}. ${formatChapterTocLine(c)}`);
  const header = ["【目录】", ...tocLines, "", "────────", ""].join("\n");
  return header + (body || "");
}
