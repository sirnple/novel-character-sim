/**
 * Surface catalog for pipeline A:
 *   unit scan → collect surface strings → (later) LLM coref → entity counts
 *
 * Programmatic lookup of occurrence contexts — used as a document-query tool
 * for the coreference LLM (not string soft-clustering).
 */

import type { TextUnit } from "./character-name-units";
import type { UnitNameHit } from "./character-name-aggregate";

export interface SurfaceHit {
  unitIndex: number;
  unitLabel: string;
  /** Offset in fullText where this occurrence starts */
  offset: number;
  /** ±contextChars around the hit */
  context: string;
}

export interface SurfaceStat {
  surface: string;
  /** Distinct units where unit-scan reported this surface */
  unitHits: number;
  unitIndices: number[];
  /** Occurrences found by scanning fullText (may be 0 if OCR/spacing mismatch) */
  textHits: number;
}

export interface SurfaceCatalog {
  stats: SurfaceStat[];
  /** Lookup occurrence contexts for a surface (document query) */
  lookup: (surface: string, maxHits?: number) => SurfaceHit[];
  /** All known surface strings */
  surfaces: string[];
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
    const textHits = findOffsets(fullText, surface, maxText).length;
    // Candidate prune: single-unit single-scan on long books
    if (
      fullText.length >= 150_000 &&
      unitIndices.length === 1 &&
      textHits <= 1
    ) {
      // still keep if unit scan saw it — one-offs may be important once;
      // only drop if extremely weak: keep all for recall, gate later on entities
    }
    stats.push({
      surface,
      unitHits: unitIndices.length,
      unitIndices,
      textHits: Math.max(textHits, unitIndices.length),
    });
  }

  stats.sort(
    (a, b) =>
      b.unitHits - a.unitHits ||
      b.textHits - a.textHits ||
      a.surface.localeCompare(b.surface, "zh"),
  );

  const unitIndexBySurface = bySurface;

  const lookup = (surface: string, maxHits = 4): SurfaceHit[] => {
    const s = norm(surface);
    if (!s) return [];
    const offsets = findOffsets(fullText, s, maxHits);
    if (offsets.length) {
      return offsets.map((offset) => {
        const u = unitForOffset(units, offset);
        return {
          unitIndex: u?.index ?? -1,
          unitLabel: u?.label ?? "?",
          offset,
          context: sliceContext(fullText, offset, s.length, radius),
        };
      });
    }
    // Fallback: no literal hit — use unit texts where scan reported it
    const unitsIdx = unitIndexBySurface.get(s);
    if (!unitsIdx?.size) return [];
    const hits: SurfaceHit[] = [];
    for (const ui of Array.from(unitsIdx).slice(0, maxHits)) {
      const u = units[ui];
      if (!u) continue;
      const local = u.text.indexOf(s);
      const offset = local >= 0 ? u.start + local : u.start;
      hits.push({
        unitIndex: ui,
        unitLabel: u.label,
        offset,
        context: sliceContext(
          fullText,
          offset,
          s.length,
          radius,
        ),
      });
    }
    return hits;
  };

  return {
    stats,
    lookup,
    surfaces: stats.map((x) => x.surface),
  };
}

/** Format candidate list for resolve prompt (no entity counts yet). */
export function formatSurfaceCandidatesForPrompt(
  stats: SurfaceStat[],
  limit?: number,
): string {
  const list = limit && limit > 0 ? stats.slice(0, limit) : stats;
  if (!list.length) return "（无候选称呼）";
  return list
    .map(
      (s, i) =>
        `${i + 1}. 「${s.surface}」（扫名命中 ${s.unitHits} 段` +
        (s.textHits ? `，正文约 ${s.textHits}+ 处` : "") +
        `）`,
    )
    .join("\n");
}

/** Format lookup tool result for the model. */
export function formatLookupResult(
  surface: string,
  hits: SurfaceHit[],
): string {
  if (!hits.length) {
    return `未找到「${surface}」的上下文。可能是扫名误检，或写法与正文不完全一致。`;
  }
  return (
    `「${surface}」共返回 ${hits.length} 处上下文：\n` +
    hits
      .map(
        (h, i) =>
          `--- #${i + 1} ${h.unitLabel} (offset ${h.offset}) ---\n${h.context}`,
      )
      .join("\n\n")
  );
}
