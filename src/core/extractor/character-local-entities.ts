/**
 * Local entities from stage-1 unit scan (name + in-window aliases).
 * Anchors = **scan unit / chapter**, not precise char positions.
 */

import type { TextUnit } from "./character-name-units";
import type { UnitNameHit } from "./character-name-aggregate";
import { mergeAnchors, unitAnchor, type MentionAnchor } from "./mention-anchor";
import type { ResolvedEntity } from "./character-entity-types";
import { nameKeyEntity } from "./character-entity-types";

export interface LocalEntity {
  name: string;
  aliases: string[];
  unitIndex: number;
  unitLabel?: string;
  /** Unit/chapter anchors (offset = unit.start for lookup) */
  anchors?: MentionAnchor[];
}

function norm(s: string): string {
  return String(s || "").replace(/\s+/g, "").trim();
}

/**
 * Build local entities from per-unit hits (locally coref'd by the unit LLM).
 * One anchor per entity = the scan unit where it was found.
 */
export function buildLocalEntitiesFromUnitHits(
  units: TextUnit[],
  unitHits: UnitNameHit[][],
  _fullText?: string,
): LocalEntity[] {
  void _fullText;
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
      const anchors = unit
        ? [unitAnchor(unit, ui, name)]
        : undefined;
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

/**
 * Seed book-wide roster from local entities by **exact name key** only
 * (union aliases + unit anchors). Cross-title merge (孙悟空↔齐天大圣 as
 * separate local names) remains for the global agent.
 */
export function seedGlobalEntitiesFromLocal(
  locals: LocalEntity[],
): ResolvedEntity[] {
  const byKey = new Map<string, ResolvedEntity>();
  for (const loc of locals) {
    const name = (loc.name || "").trim();
    const k = nameKeyEntity(name);
    if (!k) continue;
    const aliases = (loc.aliases || []).filter(
      (a) => a && nameKeyEntity(a) !== k,
    );
    const surfaces = Array.from(new Set([name, ...aliases].filter(Boolean)));
    const anchors = loc.anchors || [];
    const prev = byKey.get(k);
    if (!prev) {
      byKey.set(k, {
        name,
        aliases,
        surfaces,
        anchors: anchors.length ? anchors : undefined,
        role: "supporting",
      });
      continue;
    }
    const nextAliases = Array.from(
      new Set([...(prev.aliases || []), ...aliases].filter(Boolean)),
    );
    const nextSurfaces = Array.from(
      new Set([...(prev.surfaces || []), ...surfaces].filter(Boolean)),
    );
    byKey.set(k, {
      name: prev.name || name,
      aliases: nextAliases.filter((a) => nameKeyEntity(a) !== k),
      surfaces: nextSurfaces,
      anchors: mergeAnchors(prev.anchors, anchors),
      role: prev.role || "supporting",
      briefDescription: prev.briefDescription,
    });
  }
  return Array.from(byKey.values());
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
    const where = e.unitLabel
      ? ` · 窗 ${e.unitLabel} (u@${e.unitIndex})`
      : ` · u@${e.unitIndex}`;
    return `${offset + i + 1}. ${e.name}${al}${where}`;
  });
  const head =
    `局部实体 ${locals.length} 条（锚点=扫名 unit/章节，可 lookup 该窗正文）；` +
    `本页 offset=${offset} limit=${limit}（${slice.length} 条）`;
  return head + "\n" + lines.join("\n");
}
