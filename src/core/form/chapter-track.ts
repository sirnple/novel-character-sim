/**
 * Mainline vs 番外 / front-back matter for chapter catalog.
 * Program seed classification; LLM list audit may override track.
 */
import type { ChapterCatalogEntry, ChapterTrack } from "@/types";

const TRACKS: ChapterTrack[] = [
  "main",
  "extra",
  "front_matter",
  "back_matter",
  "volume",
];

export function isChapterTrack(v: unknown): v is ChapterTrack {
  return typeof v === "string" && (TRACKS as string[]).includes(v);
}

/** Normalize missing track → main (legacy rows). */
export function effectiveTrack(
  c: Pick<ChapterCatalogEntry, "track"> | null | undefined,
): ChapterTrack {
  return c?.track && isChapterTrack(c.track) ? c.track : "main";
}

export function isMainTrack(
  c: Pick<ChapterCatalogEntry, "track"> | null | undefined,
): boolean {
  return effectiveTrack(c) === "main";
}

/**
 * Program seed from rule kind + title/line text.
 * LLM may re-label; this is default when extracting.
 */
export function classifyChapterTrack(input: {
  kind?: string;
  title?: string;
  rawLine?: string;
}): ChapterTrack {
  const kind = (input.kind || "").toLowerCase();
  const t = `${input.title || ""} ${input.rawLine || ""}`.trim();

  if (kind === "volume" || /^第\s*[\d一二三四五六七八九十百千零〇两]+\s*卷/.test(t)) {
    return "volume";
  }

  // 番外 / side stories (prefer over other specials when co-mentioned)
  if (
    /番外|外传|特别篇|加更|番外篇|番外章|番外辑|番外卷|外篇|支线篇/.test(t) ||
    kind.includes("extra")
  ) {
    return "extra";
  }

  if (
    /尾声|后记|终章|终幕|完结感言|作者的话|写在后面|结语/.test(t) ||
    kind.includes("back")
  ) {
    return "back_matter";
  }

  if (
    /序章|楔子|引子|前言|序言|开篇|引子章|prologue/i.test(t) ||
    kind.includes("front")
  ) {
    return "front_matter";
  }

  // special_front_back rule without clear token → front_matter (序章等 prefix)
  if (kind === "special_front_back") {
    return "front_matter";
  }

  return "main";
}

export function mainlineChapters(
  catalog: ChapterCatalogEntry[] | null | undefined,
): ChapterCatalogEntry[] {
  return (catalog || []).filter(isMainTrack);
}

export function catalogTrackStats(catalog: ChapterCatalogEntry[]): {
  main: number;
  extra: number;
  front_matter: number;
  back_matter: number;
  volume: number;
  total: number;
} {
  const stats = {
    main: 0,
    extra: 0,
    front_matter: 0,
    back_matter: 0,
    volume: 0,
    total: catalog.length,
  };
  for (const c of catalog) {
    const t = effectiveTrack(c);
    stats[t]++;
  }
  return stats;
}

export function lastMainChapter(
  catalog: ChapterCatalogEntry[],
): ChapterCatalogEntry | undefined {
  const main = mainlineChapters(catalog);
  return main.length ? main[main.length - 1] : undefined;
}

export function lastPhysicalChapter(
  catalog: ChapterCatalogEntry[],
): ChapterCatalogEntry | undefined {
  return catalog.length ? catalog[catalog.length - 1] : undefined;
}

/**
 * When chaptering is on and the physical end of the book is not main track,
 * master must ask before default “continue writing”.
 */
export function needsContinuationTrackChoice(
  chapteringEnabled: boolean,
  catalog: ChapterCatalogEntry[],
): boolean {
  if (!chapteringEnabled || !catalog.length) return false;
  const last = lastPhysicalChapter(catalog);
  if (!last) return false;
  return effectiveTrack(last) !== "main";
}

export const CONTINUATION_TRACK_OPTIONS = [
  "续写番外（接在当前位置，番外轨，不占主线章号）",
  "回主线开新章（主线章号+1，用主线章名格式）",
] as const;

export function trackLabelZh(track: ChapterTrack): string {
  switch (track) {
    case "extra":
      return "番外";
    case "front_matter":
      return "序";
    case "back_matter":
      return "尾";
    case "volume":
      return "卷";
    default:
      return "主线";
  }
}

/** Apply LLM trackLabels by catalog index; invalid tracks ignored. */
export function applyTrackLabels(
  catalog: ChapterCatalogEntry[],
  labels: Array<{ index?: number; track?: string } | null> | undefined,
): ChapterCatalogEntry[] {
  if (!labels?.length) return catalog;
  const out = catalog.map((c) => ({ ...c }));
  for (const lab of labels) {
    if (!lab || typeof lab !== "object") continue;
    const i = Number(lab.index);
    if (!Number.isFinite(i) || i < 0 || i >= out.length) continue;
    if (!isChapterTrack(lab.track)) continue;
    out[i] = { ...out[i], track: lab.track };
  }
  return out;
}
