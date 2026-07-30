/**
 * Entity-level counting AFTER LLM coreference (pipeline A).
 * Roster keep/drop is decided by LLM gate (see character-roster-gate.ts),
 * not by hard frequency / kinship rules.
 */

import type { NameAggregate } from "./character-name-aggregate";
import type { SurfaceCatalog } from "./character-surface-catalog";
import type { ResolvedEntity } from "./character-entity-types";

function norm(s: string): string {
  return (s || "").replace(/\s+/g, "").trim();
}

/**
 * Attach unitHits / mentions to each entity using the surface catalog.
 * Stats are features for the model gate, not automatic drop criteria.
 */
export function countResolvedEntities(
  entities: ResolvedEntity[],
  catalog: SurfaceCatalog,
): NameAggregate[] {
  const statBy = new Map(catalog.stats.map((s) => [norm(s.surface), s]));

  const out: NameAggregate[] = [];
  for (const e of entities) {
    const name = (e.name || "").trim();
    if (!name) continue;
    const surfaces = Array.from(
      new Set(
        [name, ...(e.aliases || []), ...(e.surfaces || [])]
          .map(norm)
          .filter((s) => s.length >= 1),
      ),
    );

    const unitSet = new Set<number>();
    let mentions = 0;
    const aliases = new Set<string>();

    for (const s of surfaces) {
      // Prefer entity-declared aliases; surfaces only for counting
      if (s !== norm(name) && (e.aliases || []).some((a) => norm(a) === s)) {
        aliases.add(s);
      }
      const st = statBy.get(s);
      if (st) {
        mentions += Math.max(st.textHits, st.unitHits);
        for (const u of st.unitIndices) unitSet.add(u);
      }
    }
    for (const a of e.aliases || []) {
      const an = norm(a);
      if (an && an !== norm(name)) aliases.add(an);
    }

    if (mentions === 0) mentions = 1;
    const unitIndices = Array.from(unitSet).sort((a, b) => a - b);
    const unitHits = unitIndices.length || 1;
    const firstUnit = unitIndices[0] ?? 0;
    const lastUnit = unitIndices[unitIndices.length - 1] ?? firstUnit;

    out.push({
      name,
      aliases: Array.from(aliases),
      mentions,
      unitHits,
      firstUnit,
      lastUnit,
      unitIndices,
    });
  }

  out.sort((a, b) => b.mentions - a.mentions || b.unitHits - a.unitHits);
  return out;
}
