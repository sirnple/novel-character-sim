/**
 * Surface catalog for pipeline A:
 *   unit scan → collect surface strings → (later) LLM coref → entity counts
 *
 * Programmatic lookup of occurrence contexts — used as a document-query tool
 * for the coreference LLM (not string soft-clustering).
 * Each surface carries position **anchors** (offset + unit) for same-name split.
 */

import type { TextUnit } from "./character-name-units";
import type { UnitNameHit } from "./character-name-aggregate";
import {
  ANCHOR_PER_SURFACE_MAX,
  formatAnchorId,
  formatAnchorShort,
  sampleAnchors,
  type MentionAnchor,
} from "./mention-anchor";

export type { MentionAnchor };

export interface SurfaceHit {
  unitIndex: number;
  unitLabel: string;
  /** Offset in fullText where this occurrence starts */
  offset: number;
  /** ±contextChars around the hit */
  context: string;
  /** Stable anchor id a@{offset} */
  anchorId: string;
}

export interface SurfaceStat {
  surface: string;
  /** Distinct units where unit-scan reported this surface */
  unitHits: number;
  unitIndices: number[];
  /** Occurrences found by scanning fullText (may be 0 if OCR/spacing mismatch) */
  textHits: number;
  /**
   * Sampled occurrence anchors (first/mid/last-ish).
   * Coref & detail should query by these, not name alone.
   */
  anchors: MentionAnchor[];
}

export interface SurfaceCatalog {
  stats: SurfaceStat[];
  /** Lookup occurrence contexts for a surface (document query) */
  lookup: (surface: string, maxHits?: number) => SurfaceHit[];
  /** Lookup by absolute offset anchors (any surface) */
  lookupAnchors: (
    offsets: number[],
    opts?: { length?: number },
  ) => Array<{ offset: number; unitLabel: string; context: string; anchorId: string }>;
  /** All known surface strings */
  surfaces: string[];
  /** Find catalog row by surface */
  getStat: (surface: string) => SurfaceStat | undefined;
}

function norm(s: string): string {
  return (s || "").replace(/\s+/g, "").trim();
}

function collectSurfacesFromUnitHits(unitHits: UnitNameHit[][]): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  for (let ui = 0; ui < unitHits.length; ui++) {
    for (const h of unitHits[ui] || []) {
      const names = [h.name, ...(h.aliases || [])]
        .map(norm)
        .filter((s) => s.length >= 1 && s.length <= 24);
      for (const s of names) {
        if (!map.has(s)) map.set(s, new Set());
        map.get(s)!.add(ui);
      }
    }
  }
  return map;
}

/** Find non-overlapping occurrences of needle in haystack (literal). */
function findOffsets(haystack: string, needle: string, max: number): number[] {
  if (!needle || !haystack) return [];
  const out: number[] = [];
  let from = 0;
  while (out.length < max && from < haystack.length) {
    const i = haystack.indexOf(needle, from);
    if (i < 0) break;
    out.push(i);
    from = i + Math.max(1, needle.length);
  }
  return out;
}

function unitForOffset(units: TextUnit[], offset: number): TextUnit | undefined {
  for (const u of units) {
    if (offset >= u.start && offset < u.end) return u;
  }
  // fallback: nearest unit by start
  let best: TextUnit | undefined;
  let bestDist = Infinity;
  for (const u of units) {
    const d = Math.abs(u.start - offset);
    if (d < bestDist) {
      bestDist = d;
      best = u;
    }
  }
  return best;
}

function sliceContext(fullText: string, offset: number, needleLen: number, radius: number): string {
  const start = Math.max(0, offset - radius);
  const end = Math.min(fullText.length, offset + needleLen + radius);
  let ctx = fullText.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) ctx = "…" + ctx;
  if (end < fullText.length) ctx = ctx + "…";
  return ctx;
}

/**
 * Build catalog from unit-scan hits + fullText string search.
 * Light noise filter: drop pure one-off on medium+ books (candidate prune only).
 */
export function buildSurfaceCatalog(
  unitHits: UnitNameHit[][],
  units: TextUnit[],
  fullText: string,
  opts?: { contextRadius?: number; maxTextHitsPerSurface?: number },
): SurfaceCatalog {
  const radius = opts?.contextRadius ?? 120;
  const maxText = opts?.maxTextHitsPerSurface ?? 8;
  const bySurface = collectSurfacesFromUnitHits(unitHits);

  const stats: SurfaceStat[] = [];
  for (const [surface, unitSet] of Array.from(bySurface.entries())) {
    const unitIndices = Array.from(unitSet).sort((a, b) => a - b);
    // Collect more offsets for anchors than for display count
    const allOffsets = findOffsets(fullText, surface, Math.max(maxText, 24));
    const textHits = allOffsets.length;
    const rawAnchors: MentionAnchor[] = allOffsets.map((offset) => {
      const u = unitForOffset(units, offset);
      return {
        offset,
        unitIndex: u?.index ?? -1,
        unitLabel: u?.label ?? "?",
        surface,
      };
    });
    // If string search weak, seed anchors from unit windows where scan saw it
    if (!rawAnchors.length && unitIndices.length) {
      for (const ui of unitIndices.slice(0, ANCHOR_PER_SURFACE_MAX)) {
        const u = units[ui];
        if (!u) continue;
        const local = u.text.indexOf(surface);
        const offset = local >= 0 ? u.start + local : u.start;
        rawAnchors.push({
          offset,
          unitIndex: ui,
          unitLabel: u.label,
          surface,
        });
      }
    }
    const anchors = sampleAnchors(rawAnchors, ANCHOR_PER_SURFACE_MAX);
    stats.push({
      surface,
      unitHits: unitIndices.length,
      unitIndices,
      textHits: Math.max(textHits, unitIndices.length),
      anchors,
    });
  }

  stats.sort(
    (a, b) =>
      b.unitHits - a.unitHits ||
      b.textHits - a.textHits ||
      a.surface.localeCompare(b.surface, "zh"),
  );

  const unitIndexBySurface = bySurface;
  const statBySurface = new Map(stats.map((s) => [s.surface, s] as const));

  const toHit = (offset: number, surface: string, needleLen: number): SurfaceHit => {
    const u = unitForOffset(units, offset);
    return {
      unitIndex: u?.index ?? -1,
      unitLabel: u?.label ?? "?",
      offset,
      context: sliceContext(fullText, offset, needleLen, radius),
      anchorId: formatAnchorId({ offset }),
    };
  };

  const lookup = (surface: string, maxHits = 4): SurfaceHit[] => {
    const s = norm(surface);
    if (!s) return [];
    // Prefer catalog anchors (sampled positions) then raw string search
    const st = statBySurface.get(s);
    if (st?.anchors?.length) {
      return st.anchors.slice(0, maxHits).map((a) => toHit(a.offset, s, s.length));
    }
    const offsets = findOffsets(fullText, s, maxHits);
    if (offsets.length) {
      return offsets.map((offset) => toHit(offset, s, s.length));
    }
    const unitsIdx = unitIndexBySurface.get(s);
    if (!unitsIdx?.size) return [];
    const hits: SurfaceHit[] = [];
    for (const ui of Array.from(unitsIdx).slice(0, maxHits)) {
      const u = units[ui];
      if (!u) continue;
      const local = u.text.indexOf(s);
      const offset = local >= 0 ? u.start + local : u.start;
      hits.push(toHit(offset, s, s.length));
    }
    return hits;
  };

  const lookupAnchors = (
    offsets: number[],
    opts?: { length?: number },
  ): Array<{ offset: number; unitLabel: string; context: string; anchorId: string }> => {
    const len = Math.min(2000, Math.max(80, opts?.length ?? 400));
    const out: Array<{
      offset: number;
      unitLabel: string;
      context: string;
      anchorId: string;
    }> = [];
    const seen = new Set<number>();
    for (const raw of offsets) {
      const offset = Math.max(0, Math.floor(Number(raw) || 0));
      if (seen.has(offset)) continue;
      seen.add(offset);
      const u = unitForOffset(units, offset);
      const end = Math.min(fullText.length, offset + len);
      const start = Math.max(0, offset - Math.floor(len * 0.25));
      let ctx = fullText.slice(start, end).replace(/\s+/g, " ").trim();
      if (start > 0) ctx = "…" + ctx;
      if (end < fullText.length) ctx = ctx + "…";
      out.push({
        offset,
        unitLabel: u?.label ?? "?",
        context: ctx,
        anchorId: formatAnchorId({ offset }),
      });
    }
    return out;
  };

  return {
    stats,
    lookup,
    lookupAnchors,
    surfaces: stats.map((x) => x.surface),
    getStat: (surface: string) => statBySurface.get(norm(surface)),
  };
}

/** Format candidate list for resolve prompt (includes position anchors). */
export function formatSurfaceCandidatesForPrompt(
  stats: SurfaceStat[],
  limit?: number,
): string {
  const list = limit && limit > 0 ? stats.slice(0, limit) : stats;
  if (!list.length) return "（无候选称呼）";
  return list
    .map((s, i) => {
      const anchorPart =
        s.anchors?.length > 0
          ? ` · 锚点 ${s.anchors
              .slice(0, 4)
              .map((a) => formatAnchorShort(a))
              .join("；")}` + (s.anchors.length > 4 ? "…" : "")
          : "";
      return (
        `${i + 1}. 「${s.surface}」（扫名 ${s.unitHits} 段` +
        (s.textHits ? `，正文约 ${s.textHits}+ 处` : "") +
        `${anchorPart}）`
      );
    })
    .join("\n");
}

/** Format lookup tool result for the model (always show anchor ids). */
export function formatLookupResult(
  surface: string,
  hits: SurfaceHit[],
): string {
  if (!hits.length) {
    return `未找到「${surface}」的上下文。可能是扫名误检，或写法与正文不完全一致。`;
  }
  return (
    `「${surface}」共返回 ${hits.length} 处（带锚点；同名异人请按锚点拆实体）：\n` +
    hits
      .map(
        (h, i) =>
          `--- #${i + 1} ${h.anchorId} ${h.unitLabel} (offset ${h.offset}) ---\n${h.context}`,
      )
      .join("\n\n")
  );
}

/** Collect catalog anchors for a set of surfaces (entity submit enrichment). */
export function anchorsForSurfaces(
  catalog: SurfaceCatalog | null | undefined,
  surfaces: string[],
  cap = 12,
): MentionAnchor[] {
  if (!catalog) return [];
  const out: MentionAnchor[] = [];
  const seen = new Set<number>();
  for (const surf of surfaces) {
    const st = catalog.getStat(surf);
    for (const a of st?.anchors || []) {
      if (seen.has(a.offset)) continue;
      seen.add(a.offset);
      out.push({ ...a, surface: a.surface || surf });
      if (out.length >= cap) return out;
    }
  }
  return out;
}
