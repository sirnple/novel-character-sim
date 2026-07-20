/**
 * Local entities from stage-1 unit scan (name + in-window aliases).
 * Global coref merges/splits these; local name may be title-only.
 */

import type { TextUnit } from "./character-name-units";
import type { UnitNameHit } from "./character-name-aggregate";
import type { MentionAnchor } from "./mention-anchor";

export interface LocalEntity {
  name: string;
  aliases: string[];
  unitIndex: number;
  unitLabel?: string;
  /** Sampled occurrence anchors when fullText provided */
  anchors?: MentionAnchor[];
}

function norm(s: string): string {
  return String(s || "").replace(/\s+/g, "").trim();
}

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

/**
 * Build local entities from per-unit hits (already locally coref'd by the unit LLM).
 * Optionally attach anchors from fullText for surfaces that appear in the unit span.
 */
export function buildLocalEntitiesFromUnitHits(
  units: TextUnit[],
  unitHits: UnitNameHit[][],
  fullText?: string,
  opts?: { anchorsPerSurface?: number },
): LocalEntity[] {
  const cap = Math.max(1, opts?.anchorsPerSurface ?? 4);
  const out: LocalEntity[] = [];

  for (let ui = 0; ui < units.length; ui++) {
    const unit = units[ui];
    const hits = unitHits[ui] || [];
    for (const h of hits) {
      const name = (h.name || "").trim();
      if (!name || name.length > 24) continue;
      const aliases = Array.from(
        new Set(
          (h.aliases || [])
            .map((a) => String(a).trim())
            .filter((a) => a && norm(a) !== norm(name)),
        ),
      );
      const surfaces = [name, ...aliases];
      let anchors: MentionAnchor[] | undefined;
      if (fullText && unit) {
        const collected: MentionAnchor[] = [];
        const seen = new Set<number>();
        for (const surf of surfaces) {
          // Prefer hits inside this unit's span
          const start = unit.start ?? 0;
          const end = unit.end ?? fullText.length;
          const slice = fullText.slice(start, end);
          const locals = findOffsets(slice, surf, cap);
          for (const loc of locals) {
            const offset = start + loc;
            if (seen.has(offset)) continue;
            seen.add(offset);
            collected.push({
              offset,
              unitIndex: ui,
              unitLabel: unit.label,
              surface: surf,
            });
          }
        }
        if (collected.length) {
          collected.sort((a, b) => a.offset - b.offset);
          anchors = collected.slice(0, cap * 2);
        }
      }
      out.push({
        name,
        aliases,
        unitIndex: ui,
        unitLabel: unit?.label,
        anchors,
      });
    }
  }
  return out;
}

/** Flatten local entities to unique surface strings (for catalog building). */
export function surfacesFromLocalEntities(locals: LocalEntity[]): string[] {
  const set = new Set<string>();
  for (const e of locals) {
    set.add(e.name);
    for (const a of e.aliases || []) set.add(a);
  }
  return Array.from(set).filter((s) => norm(s).length >= 1);
}

/** Compact listing for the global agent. */
export function formatLocalEntitiesForPrompt(
  locals: LocalEntity[],
  opts?: { offset?: number; limit?: number },
): string {
  if (!locals.length) return "（无局部实体）";
  const offset = Math.max(0, opts?.offset ?? 0);
  const limit = Math.max(1, opts?.limit ?? 80);
  const slice = locals.slice(offset, offset + limit);
  const lines = slice.map((e, i) => {
    const al =
      e.aliases?.length > 0 ? ` aliases=[${e.aliases.join("、")}]` : "";
    const where = e.unitLabel ? ` @${e.unitLabel}` : ` @u${e.unitIndex}`;
    const ancs = e.anchors || [];
    const anc =
      ancs.length > 0
        ? ` 锚点=${ancs
            .slice(0, 3)
            .map((a) => `a@${a.offset}`)
            .join(",")}`
        : "";
    return `${offset + i + 1}. ${e.name}${al}${where}${anc}`;
  });
  const head = `局部实体 ${locals.length} 条；本页 offset=${offset} limit=${limit}（${slice.length} 条）`;
  return head + "\n" + lines.join("\n");
}
