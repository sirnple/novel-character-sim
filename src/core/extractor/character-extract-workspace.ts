/**
 * In-memory workspace for character extract agents (per novel extract run).
 * Tools read/write here so the resolve agent can look up surfaces and submit entities.
 */

import type { SurfaceCatalog } from "./character-surface-catalog";
import {
  mergeResolvedEntities,
  type ResolvedEntity,
} from "./character-entity-types";
import {
  seedGlobalEntitiesFromLocal,
  type LocalEntity,
} from "./character-local-entities";
import { applyEntityOps, type EntityOp } from "./character-entity-ops";
import type { TextUnit } from "./character-name-units";

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
  },
): void {
  const locals = data.localEntities || [];
  // Program coref: same name within D units → one row; far same-name /
  // different names left for the global agent (see seedGlobalEntitiesFromLocal).
  const seeded =
    locals.length > 0 ? seedGlobalEntitiesFromLocal(locals) : null;
  store().set(key(userId, novelId, branchId), {
    fullText: data.fullText,
    catalog: data.catalog,
    units: data.units || [],
    localEntities: locals,
    entities: seeded,
    unitCount: data.unitCount,
    surfaceCount: data.catalog.stats.length,
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
  }
  const next = opts?.replace
    ? entities
    : mergeResolvedEntities(base, entities);
  // If only ops and empty entities batch, still persist ops result
  const final =
    opts?.replace
      ? entities
      : entities.length
        ? next
        : opts?.ops?.length
          ? base
          : next;
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

export function clearCharacterExtractWorkspace(
  userId: string,
  novelId: string,
  branchId = "main",
): void {
  store().delete(key(userId, novelId, branchId));
}
