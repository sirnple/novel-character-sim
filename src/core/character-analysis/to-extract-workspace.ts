/**
 * Adapt character-analysis pipeline output → character-extract workspace types
 * (catalog, localEntities, ResolvedEntity) for analysis agents.
 */

import type { TextUnit } from "@/core/extractor/character-name-units";
import type { UnitNameHit } from "@/core/extractor/character-name-aggregate";
import type { LocalEntity } from "@/core/extractor/character-local-entities";
import type { ResolvedEntity } from "@/core/extractor/character-entity-types";
import {
  isBarePronounOrGeneric,
  isInvalidUnitPrimaryName,
  nameKeyEntity,
} from "@/core/extractor/character-entity-types";
import { buildSurfaceCatalog } from "@/core/extractor/character-surface-catalog";
import type { SurfaceCatalog } from "@/core/extractor/character-surface-catalog";
import {
  crossNamePairKey,
  listCrossNameCandidates,
  type CrossNamePairResolution,
} from "@/core/extractor/character-cross-name";
import type { CharacterExtractWorkspace } from "@/core/extractor/character-extract-workspace";
import {
  isDeicticPronounSurface,
  surfacesForCoref,
  surfacesOf,
} from "./coref/features";
import { filterDisplayAliases } from "./mention-kind";
import { locateCharactersInWindow } from "./locate-mentions";
import type { MergedCharacter } from "./merge-adjacent";
import type {
  AnalysisWindow,
  WindowExtractResult,
} from "./types";
import type { CharacterAnalysisPipelineResult } from "./pipeline";

export function analysisWindowsToTextUnits(
  windows: AnalysisWindow[],
): TextUnit[] {
  return windows.map((w) => ({
    index: w.index,
    label: w.label,
    start: w.start,
    end: w.end,
    text: w.text,
  }));
}

/** Prefer longest non-deictic surface as primary name. */
export function pickPrimaryAndAliases(
  surfaces: string[],
): { name: string; aliases: string[] } {
  const uniq = Array.from(
    new Set(surfaces.map((s) => (s || "").trim()).filter(Boolean)),
  );
  const nonDeictic = uniq.filter(
    (s) => !isDeicticPronounSurface(s) && !isBarePronounOrGeneric(s),
  );
  let pool = nonDeictic.length ? nonDeictic : uniq.filter((s) => !isBarePronounOrGeneric(s));
  if (!pool.length) pool = uniq;
  // Avoid invalid pure relation labels as primary when alternatives exist
  const validPrimary = pool.filter((s) => !isInvalidUnitPrimaryName(s));
  const ordered = (validPrimary.length ? validPrimary : pool).sort(
    (a, b) => b.length - a.length || a.localeCompare(b, "zh"),
  );
  const name = ordered[0] || "未知";
  const aliases = ordered.filter((s) => s !== name);
  return { name, aliases };
}

export function mergedCharacterToResolvedEntity(
  c: MergedCharacter,
  windows: AnalysisWindow[],
): ResolvedEntity {
  const allSurfaces = surfacesOf(c);
  // Stage ④ canonicalName preferred; fallback to heuristic pick
  let name = (c.canonicalName || "").trim();
  let aliases: string[];
  if (name) {
    // surfaces field keeps full bag for analysis tools; aliases for UI only
    // (drop deictic / desc / generic).
    aliases = filterDisplayAliases(
      allSurfaces.filter((s) => s !== name),
      c.mentions,
    );
  } else {
    const corefSurfaces = surfacesForCoref(c, true);
    const picked = pickPrimaryAndAliases(
      corefSurfaces.length ? corefSurfaces : allSurfaces,
    );
    name = picked.name;
    aliases = filterDisplayAliases(
      picked.aliases.filter((s) => s !== name),
      c.mentions,
    );
  }
  const anchors = (c.mentions || [])
    .filter((m) => m.offsetAnchor && typeof m.offsetAnchor.globalStart === "number")
    .map((m) => {
      const g = m.offsetAnchor!.globalStart;
      const w =
        windows.find((x) => g >= x.start && g < x.end) ||
        windows[c.windowLo] ||
        windows[0];
      return {
        offset: g,
        unitIndex: w?.index ?? c.windowLo,
        unitLabel: w?.label,
        surface: m.surface,
      };
    });
  // Dedup anchors by offset
  const seen = new Set<number>();
  const uniqAnchors = anchors.filter((a) => {
    if (seen.has(a.offset)) return false;
    seen.add(a.offset);
    return true;
  });
  const brief = [c.gender, c.age].filter(Boolean).join(" · ");
  return {
    name,
    canonicalName: name,
    corefId: c.id,
    aliases,
    surfaces: allSurfaces,
    anchors: uniqAnchors.slice(0, 24),
    ...(brief ? { briefDescription: brief } : {}),
  };
}

/** Stage1 per-window → local entities (for list_local_entities / cross-name). */
export function stage1ToLocalEntities(
  byWindow: WindowExtractResult[],
  windows: AnalysisWindow[],
): LocalEntity[] {
  const out: LocalEntity[] = [];
  for (const wr of byWindow) {
    const w =
      windows.find((x) => x.index === wr.window.index) ||
      ({
        ...wr.window,
        text: "",
      } as AnalysisWindow);
    const located = wr.error
      ? []
      : locateCharactersInWindow(wr.characters || [], w);
    for (const c of located) {
      const surs = surfacesOf(c as MergedCharacter);
      const { name, aliases } = pickPrimaryAndAliases(surs);
      if (!name || name === "未知") continue;
      const anchors = (c.mentions || [])
        .filter((m) => m.offsetAnchor)
        .map((m) => ({
          offset: m.offsetAnchor!.globalStart,
          unitIndex: wr.window.index,
          unitLabel: wr.window.label,
          surface: m.surface,
        }));
      out.push({
        name,
        aliases,
        unitIndex: wr.window.index,
        unitLabel: wr.window.label,
        anchors: anchors.length
          ? anchors
          : [
              {
                offset: w.start,
                unitIndex: wr.window.index,
                unitLabel: wr.window.label,
                surface: name,
              },
            ],
      });
    }
  }
  return out;
}

function localToUnitHits(
  locals: LocalEntity[],
  unitCount: number,
): UnitNameHit[][] {
  const hits: UnitNameHit[][] = Array.from({ length: unitCount }, () => []);
  for (const e of locals) {
    const ui = Math.max(0, Math.min(unitCount - 1, e.unitIndex || 0));
    hits[ui]!.push({
      name: e.name,
      aliases: e.aliases || [],
    });
  }
  return hits;
}

/**
 * Build catalog + locals + resolved entities for extract workspace.
 */
export function pipelineResultToExtractSeed(
  result: CharacterAnalysisPipelineResult,
  fullText: string,
): {
  units: TextUnit[];
  catalog: SurfaceCatalog;
  localEntities: LocalEntity[];
  entities: ResolvedEntity[];
  unitHits: UnitNameHit[][];
  /** Stage③ oneshot uncertain pairs — outer agent may resolve with tools */
  uncertainPairs: import("./coref/types").UncertainCorefPair[];
} {
  const units = analysisWindowsToTextUnits(result.windows);
  const localEntities = stage1ToLocalEntities(result.byWindow, result.windows);
  const unitHits = localToUnitHits(localEntities, units.length);
  const catalog = buildSurfaceCatalog(unitHits, units, fullText);
  const entities = result.stage3.characters.map((c) =>
    mergedCharacterToResolvedEntity(c, result.windows),
  );
  // Drop empty/invalid rows
  const cleaned = entities.filter(
    (e) => e.name && e.name !== "未知" && e.name.trim().length > 0,
  );
  return {
    units,
    catalog,
    localEntities,
    entities: cleaned,
    unitHits,
    uncertainPairs: result.stage3.uncertainPairs || [],
  };
}

/**
 * Mark all cross-name candidates resolved from stage3 entity clusters
 * so submit gate does not block on unprocessed pairs.
 */
export function sealCrossNameLedgerFromEntities(
  ws: CharacterExtractWorkspace,
  entities: ResolvedEntity[],
): void {
  const cands = listCrossNameCandidates(ws.localEntities || [], {
    catalog: ws.catalog,
  });
  const ledger: Record<string, CrossNamePairResolution> = {
    ...(ws.pairResolutions || {}),
  };
  const entityBags = entities.map((e) => {
    const bag = new Set<string>();
    for (const s of [e.name, ...(e.aliases || []), ...(e.surfaces || [])]) {
      const k = nameKeyEntity(s);
      if (k) bag.add(k);
    }
    return bag;
  });
  const now = new Date().toISOString();
  for (const c of cands) {
    if (ledger[c.pairKey]) continue;
    const ka = nameKeyEntity(c.nameA);
    const kb = nameKeyEntity(c.nameB);
    const same = entityBags.some((bag) => bag.has(ka) && bag.has(kb));
    const key = c.pairKey || crossNamePairKey(c.nameA, c.nameB);
    if (!key) continue;
    ledger[key] = {
      pairKey: key,
      nameA: c.nameA,
      nameB: c.nameB,
      verdict: same ? "merge" : "distinct",
      note: "character-analysis pipeline (stage1+2+3)",
      at: now,
    };
  }
  ws.pairResolutions = ledger;
  ws.crossNameCandidates = cands;
  ws.updatedAt = now;
}
