/**
 * In-memory workspace for character extract agents (per novel extract run).
 * Tools read/write here so the resolve agent can look up surfaces and submit entities.
 */

import type { SurfaceCatalog } from "./character-surface-catalog";
import type { ResolvedEntity } from "./character-entity-types";

export interface CharacterExtractWorkspace {
  fullText: string;
  catalog: SurfaceCatalog;
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
  },
): void {
  store().set(key(userId, novelId, branchId), {
    fullText: data.fullText,
    catalog: data.catalog,
    entities: null,
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

export function saveResolvedEntities(
  userId: string,
  novelId: string,
  branchId: string,
  entities: ResolvedEntity[],
): { ok: boolean; message: string } {
  const ws = getCharacterExtractWorkspace(userId, novelId, branchId);
  if (!ws) {
    return {
      ok: false,
      message: "无角色抽取工作区（请先完成分段扫名）。",
    };
  }
  ws.entities = entities;
  ws.updatedAt = new Date().toISOString();
  return {
    ok: true,
    message: `已存 ${entities.length} 个角色实体。`,
  };
}

export function clearCharacterExtractWorkspace(
  userId: string,
  novelId: string,
  branchId = "main",
): void {
  store().delete(key(userId, novelId, branchId));
}
