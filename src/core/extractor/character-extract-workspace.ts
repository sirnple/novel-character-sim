/**
 * In-memory workspace for character extract agents (per novel extract run).
 * Tools read/write here so the resolve agent can look up surfaces and submit entities.
 */

import type { SurfaceCatalog } from "./character-surface-catalog";
import {
  mergeResolvedEntities,
  type ResolvedEntity,
} from "./character-entity-types";
import { foldSafeEntityRedundancies } from "./character-entity-consistency";
import {
  seedGlobalEntitiesFromLocal,
  type LocalEntity,
} from "./character-local-entities";
import { applyEntityOps, type EntityOp } from "./character-entity-ops";
import type { TextUnit } from "./character-name-units";
import {
  listCrossNameCandidates,
  recordMergesFromOps,
  type CrossNameCandidate,
  type CrossNamePairResolution,
} from "./character-cross-name";
import type { UnitNameHit } from "./character-name-aggregate";
import { mergeLocalEntitiesByOverlap } from "./character-overlap-merge";

export interface CharacterExtractWorkspace {
  fullText: string;
  catalog: SurfaceCatalog;
  /** Scan units (chapter/windows) — anchors point here */
  units?: TextUnit[];
  /** Stage-1 local coref entities (per unit/window) */
  localEntities?: LocalEntity[];
  /** Set by submit_character_entities */
  entities: ResolvedEntity[] | null;
  unitCount: number;
  surfaceCount: number;
  updatedAt: string;
  /**
   * P3: explicit pair processing ledger (merge | distinct | uncertain).
   * Unprocessed open pairs block submit completion.
   */
  pairResolutions?: Record<string, CrossNamePairResolution>;
  /** Cached P3 candidates (rebuilt on scan / demand) */
  crossNameCandidates?: CrossNameCandidate[];
}

type Store = Map<string, CharacterExtractWorkspace>;

function store(): Store {
  const g = globalThis as typeof globalThis & {
    __ncsCharExtractWs?: Store;
  };
  if (!g.__ncsCharExtractWs) g.__ncsCharExtractWs = new Map();
  return g.__ncsCharExtractWs;
}

function key(userId: string, novelId: string, branchId = "main"): string {
  return `${userId || "guest"}::${novelId}::${branchId || "main"}`;
}

export function beginCharacterExtractWorkspace(
  userId: string,
  novelId: string,
  branchId: string,
  data: {
    fullText: string;
    catalog: SurfaceCatalog;
    unitCount: number;
    localEntities?: LocalEntity[];
    units?: TextUnit[];
    /** Per-unit hits for stage-② overlap merge (preferred seed) */
    unitHits?: UnitNameHit[][];
  },
): void {
  const locals = data.localEntities || [];
  const units = data.units || [];
  // Stage ②: overlap criterion A merge when we have units + hits.
  // Fallback: near same-name seed only (legacy).
  let seeded: ResolvedEntity[] | null = null;
  if (units.length && data.unitHits?.length) {
    seeded = mergeLocalEntitiesByOverlap(
      units,
      data.unitHits,
      data.fullText,
    );
  } else if (locals.length > 0) {
    seeded = seedGlobalEntitiesFromLocal(locals);
  }
  const crossNameCandidates = listCrossNameCandidates(locals, {
    catalog: data.catalog,
  });
  store().set(key(userId, novelId, branchId), {
    fullText: data.fullText,
    catalog: data.catalog,
    units,
    localEntities: locals,
    entities: seeded,
    unitCount: data.unitCount,
    surfaceCount: data.catalog.stats.length,
    pairResolutions: {},
    crossNameCandidates,
    updatedAt: new Date().toISOString(),
  });
}

export function getCharacterExtractWorkspace(
  userId: string,
  novelId: string,
  branchId = "main",
): CharacterExtractWorkspace | null {
  return store().get(key(userId, novelId, branchId)) || null;
}

/**
 * Persist entities into extract workspace.
 * Default **merge** by name so multi-batch submit_character_entities is safe.
 * Pass replace:true only when intentionally wiping the roster.
 */
export function saveResolvedEntities(
  userId: string,
  novelId: string,
  branchId: string,
  entities: ResolvedEntity[],
  opts?: { replace?: boolean; ops?: EntityOp[] },
): {
  ok: boolean;
  message: string;
  batchCount: number;
  totalCount: number;
  entities: ResolvedEntity[];
  opLog: string[];
} {
  const ws = getCharacterExtractWorkspace(userId, novelId, branchId);
  if (!ws) {
    return {
      ok: false,
      message: "无角色抽取工作区（请先 scan_character_mentions）。",
      batchCount: 0,
      totalCount: 0,
      entities: [],
      opLog: [],
    };
  }
  const batchCount = entities.length;
  // Spec: apply ops first (merge/split), then upsert entities into roster
  let base = ws.entities || [];
  let opLog: string[] = [];
  if (opts?.ops?.length) {
    const applied = applyEntityOps(base, opts.ops);
    base = applied.entities;
    opLog = applied.log;
    // P3: merge ops auto-mark pairs as processed
    ws.pairResolutions = recordMergesFromOps(ws.pairResolutions, opts.ops);
  }
  let next = opts?.replace
    ? entities
    : mergeResolvedEntities(base, entities);
  // If only ops and empty entities batch, still persist ops result
  if (!opts?.replace && !entities.length && opts?.ops?.length) {
    next = base;
  }
  // Safe short-name / unambiguous alias-primary folds (not multi-claim pollution)
  const folded = foldSafeEntityRedundancies(next);
  if (folded.log.length) {
    opLog = [...opLog, ...folded.log];
  }
  const final = folded.entities;
  ws.entities = final;
  ws.updatedAt = new Date().toISOString();
  return {
    ok: true,
    message: `本批 ${batchCount} 人，累计 ${final.length} 人。`,
    batchCount,
    totalCount: final.length,
    entities: final,
    opLog,
  };
}

/** Ensure cross-name candidates cached on workspace (rebuild if missing). */
export function ensureCrossNameCandidates(
  userId: string,
  novelId: string,
  branchId = "main",
): CrossNameCandidate[] {
  const ws = getCharacterExtractWorkspace(userId, novelId, branchId);
  if (!ws) return [];
  if (ws.crossNameCandidates?.length) return ws.crossNameCandidates;
  const items = listCrossNameCandidates(ws.localEntities || [], {
    catalog: ws.catalog,
  });
  ws.crossNameCandidates = items;
  ws.updatedAt = new Date().toISOString();
  return items;
}

export function clearCharacterExtractWorkspace(
  userId: string,
  novelId: string,
  branchId = "main",
): void {
  store().delete(key(userId, novelId, branchId));
}
