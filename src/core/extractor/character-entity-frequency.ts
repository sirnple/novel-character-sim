/**
 * Entity-level frequency AFTER LLM coreference (pipeline A).
 * Counts are summed across all surfaces of each resolved person.
 */

import type { NameAggregate } from "./character-name-aggregate";
import type { SurfaceCatalog } from "./character-surface-catalog";
import type { ResolvedEntity } from "./character-entity-types";

function norm(s: string): string {
  return (s || "").replace(/\s+/g, "").trim();
}

/**
 * Attach unitHits / mentions to each entity using the surface catalog.
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
      if (s !== norm(name)) aliases.add(s);
      const st = statBy.get(s);
      if (st) {
        mentions += Math.max(st.textHits, st.unitHits);
        for (const u of st.unitIndices) unitSet.add(u);
      } else {
        // surface not in catalog — still keep as alias, no count
      }
    }

    // If nothing matched catalog, give minimal presence so entity isn't zeroed
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
