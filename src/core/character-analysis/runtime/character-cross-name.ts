/**
 * P3: cross-name (异名) hypothesis candidates + pair resolution ledger.
 *
 * Program lists suspects (same-window / near / co-occur / local-alias).
 * Agent must process each still-open pair: merge | distinct | uncertain.
 * Unprocessed open pairs block submit / agent completion.
 *
 * Co-occur volume knobs (tune if lists are too large):
 * - {@link DEFAULT_MIN_COOCCUR_UNITS}
 * - {@link DEFAULT_CROSS_NAME_CANDIDATE_LIMIT}
 */

import {
  DEFAULT_SAME_NAME_UNIT_DISTANCE,
  type LocalEntity,
} from "./character-local-entities";
import {
  isUnanchoredRelationLabel,
  nameKeyEntity,
  type ResolvedEntity,
} from "./character-entity-types";
import type { SurfaceCatalog } from "./character-surface-catalog";

/** Min shared units to add a pure co-occur edge. Raise to 2–3 if lists explode. */
export const DEFAULT_MIN_COOCCUR_UNITS = 1;

/** Max candidates kept after scoring (submit gate uses this list). */
export const DEFAULT_CROSS_NAME_CANDIDATE_LIMIT = 120;

export type CrossNameVerdict = "merge" | "distinct" | "uncertain";

export type CrossNameSource =
  | "same_window"
  | "near"
  | "cooccur"
  | "local_alias"
  | "shared_surface"
  | "relation";

export interface CrossNameCandidate {
  /** Stable id: sorted name keys joined by || */
  pairKey: string;
  nameA: string;
  nameB: string;
  sources: CrossNameSource[];
  reasons: string[];
  /** Higher = process first */
  score: number;
  /** Min |Δunit| among local evidence; Infinity if only catalog cooccur */
  minDist: number;
  cooccurUnits: number;
  unitA?: number;
  unitB?: number;
  unitLabelA?: string;
  unitLabelB?: string;
}

export interface CrossNamePairResolution {
  pairKey: string;
  nameA: string;
  nameB: string;
  verdict: CrossNameVerdict;
  note?: string;
  at: string;
}

function norm(s: string): string {
  return nameKeyEntity(s);
}

export function crossNamePairKey(a: string, b: string): string {
  const ka = norm(a);
  const kb = norm(b);
  if (!ka || !kb) return "";
  return ka <= kb ? `${ka}||${kb}` : `${kb}||${ka}`;
}

function unitOf(loc: LocalEntity): number {
  if (typeof loc.unitIndex === "number" && Number.isFinite(loc.unitIndex)) {
    return loc.unitIndex;
  }
  const fromAnchor = loc.anchors?.[0]?.unitIndex;
  if (typeof fromAnchor === "number" && Number.isFinite(fromAnchor)) {
    return fromAnchor;
  }
  return 0;
}

interface NameAgg {
  display: string;
  units: Set<number>;
  /** name keys that appeared as local aliases of this primary */
  aliasOfKeys: Set<string>;
  /** other primaries that listed this name as alias */
  claimedAsAliasBy: Set<string>;
  labels: Map<number, string | undefined>;
}

function buildNameAggs(locals: LocalEntity[]): Map<string, NameAgg> {
  const map = new Map<string, NameAgg>();
  const ensure = (name: string): NameAgg | null => {
    const k = norm(name);
    if (!k) return null;
    let a = map.get(k);
    if (!a) {
      a = {
        display: name.trim(),
        units: new Set(),
        aliasOfKeys: new Set(),
        claimedAsAliasBy: new Set(),
        labels: new Map(),
      };
      map.set(k, a);
    }
    return a;
  };

  for (const loc of locals) {
    const name = (loc.name || "").trim();
    const agg = ensure(name);
    if (!agg) continue;
    const u = unitOf(loc);
    agg.units.add(u);
    if (loc.unitLabel) agg.labels.set(u, loc.unitLabel);
    // Prefer earlier / longer display as display name
    if (name.length >= agg.display.length) agg.display = name;

    for (const al of loc.aliases || []) {
      const ak = norm(al);
      if (!ak || ak === norm(name)) continue;
      agg.aliasOfKeys.add(ak);
      // Reverse: alias surface may also be a primary elsewhere
      const other = ensure(al);
      if (other) {
        other.claimedAsAliasBy.add(norm(name));
        other.units.add(u);
      }
    }
  }
  return map;
}

function enrichFromCatalog(
  aggs: Map<string, NameAgg>,
  catalog: SurfaceCatalog | null | undefined,
): void {
  if (!catalog?.stats?.length) return;
  for (const st of catalog.stats) {
    const k = norm(st.surface);
    if (!k) continue;
    const agg = aggs.get(k);
    if (!agg) continue; // only enrich known primary-ish names from locals
    for (const u of st.unitIndices || []) {
      if (Number.isFinite(u)) agg.units.add(u);
    }
  }
}

function setIntersectSize(a: Set<number>, b: Set<number>): number {
  let n = 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  for (const x of smaller) {
    if (larger.has(x)) n++;
  }
  return n;
}

function minUnitDist(a: Set<number>, b: Set<number>): number {
  if (!a.size || !b.size) return Infinity;
  let best = Infinity;
  for (const ua of a) {
    for (const ub of b) {
      const d = Math.abs(ua - ub);
      if (d < best) best = d;
    }
  }
  return best;
}

function pickUnitLabel(agg: NameAgg, unit: number | undefined): string | undefined {
  if (unit == null || !Number.isFinite(unit)) return undefined;
  return agg.labels.get(unit);
}

/**
 * Build full cross-name hypothesis list (P3).
 * Does not auto-merge. minCooccurUnits defaults to 1 (any shared unit).
 */
export function listCrossNameCandidates(
  locals: LocalEntity[],
  opts?: {
    maxUnitDistance?: number;
    limit?: number;
    catalog?: SurfaceCatalog | null;
    /**
     * Min shared units for co-occur edge.
     * Default {@link DEFAULT_MIN_COOCCUR_UNITS} (1). Raise to 2–3 to cut noise.
     */
    minCooccurUnits?: number;
  },
): CrossNameCandidate[] {
  const D = opts?.maxUnitDistance ?? DEFAULT_SAME_NAME_UNIT_DISTANCE;
  const limit = Math.max(
    1,
    opts?.limit ?? DEFAULT_CROSS_NAME_CANDIDATE_LIMIT,
  );
  const minCo = Math.max(
    1,
    opts?.minCooccurUnits ?? DEFAULT_MIN_COOCCUR_UNITS,
  );
  if (!locals?.length) return [];

  const aggs = buildNameAggs(locals);
  enrichFromCatalog(aggs, opts?.catalog);
  const keys = Array.from(aggs.keys()).sort((a, b) => a.localeCompare(b, "zh"));
  if (keys.length < 2) return [];

  type Acc = {
    nameA: string;
    nameB: string;
    pairKey: string;
    sources: Set<CrossNameSource>;
    reasons: Set<string>;
    minDist: number;
    cooccurUnits: number;
    unitA?: number;
    unitB?: number;
    unitLabelA?: string;
    unitLabelB?: string;
  };
  const byPair = new Map<string, Acc>();

  const touch = (
    ka: string,
    kb: string,
    patch: {
      sources?: CrossNameSource[];
      reasons?: string[];
      minDist?: number;
      cooccurUnits?: number;
      unitA?: number;
      unitB?: number;
    },
  ) => {
    if (!ka || !kb || ka === kb) return;
    const pairKey = ka <= kb ? `${ka}||${kb}` : `${kb}||${ka}`;
    const a = aggs.get(ka)!;
    const b = aggs.get(kb)!;
    const nameA = ka <= kb ? a.display : b.display;
    const nameB = ka <= kb ? b.display : a.display;
    let acc = byPair.get(pairKey);
    if (!acc) {
      acc = {
        nameA,
        nameB,
        pairKey,
        sources: new Set(),
        reasons: new Set(),
        minDist: Infinity,
        cooccurUnits: 0,
      };
      byPair.set(pairKey, acc);
    }
    for (const s of patch.sources || []) acc.sources.add(s);
    for (const r of patch.reasons || []) acc.reasons.add(r);
    if (patch.minDist != null && patch.minDist < acc.minDist) {
      acc.minDist = patch.minDist;
      if (patch.unitA != null) acc.unitA = patch.unitA;
      if (patch.unitB != null) acc.unitB = patch.unitB;
    }
    if (patch.cooccurUnits != null && patch.cooccurUnits > acc.cooccurUnits) {
      acc.cooccurUnits = patch.cooccurUnits;
    }
  };

  // Local pair walk: same_window / near / local_alias / shared surfaces
  for (let i = 0; i < locals.length; i++) {
    const a = locals[i];
    const ka = norm(a.name);
    if (!ka) continue;
    const ua = unitOf(a);
    const setA = new Set<string>([ka, ...(a.aliases || []).map(norm).filter(Boolean)]);
    for (let j = i + 1; j < locals.length; j++) {
      const b = locals[j];
      const kb = norm(b.name);
      if (!kb || ka === kb) continue;
      const ub = unitOf(b);
      const dist = Math.abs(ua - ub);
      const setB = new Set<string>([kb, ...(b.aliases || []).map(norm).filter(Boolean)]);

      const sources: CrossNameSource[] = [];
      const reasons: string[] = [];

      if (dist === 0) {
        sources.push("same_window");
        reasons.push("同窗分列(不同name行)");
      } else if (dist <= D) {
        sources.push("near");
        reasons.push(`近距Δunit=${dist}(≤${D})`);
      }

      if (setA.has(kb)) {
        sources.push("local_alias");
        reasons.push(`A侧表面含B名「${b.name}」`);
      }
      if (setB.has(ka)) {
        sources.push("local_alias");
        reasons.push(`B侧表面含A名「${a.name}」`);
      }
      for (const s of setA) {
        if (s === ka || s === kb) continue;
        if (setB.has(s)) {
          sources.push("shared_surface");
          reasons.push(`共享表面「${s}」`);
          break;
        }
      }
      if (
        isUnanchoredRelationLabel(a.name) ||
        isUnanchoredRelationLabel(b.name)
      ) {
        sources.push("relation");
        reasons.push("关系称谓须查锚点挂回真人");
      }

      // Far pairs only kept if local_alias / shared / relation (cooccur added later)
      if (!sources.length && dist > D) continue;
      if (!sources.length && dist <= D) {
        // near already added
      }
      if (!sources.length) continue;

      touch(ka, kb, {
        sources,
        reasons,
        minDist: dist,
        unitA: ua,
        unitB: ub,
      });
    }
  }

  // Catalog / agg co-occurrence for all primary pairs
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const ka = keys[i];
      const kb = keys[j];
      const a = aggs.get(ka)!;
      const b = aggs.get(kb)!;
      const co = setIntersectSize(a.units, b.units);
      const dist = minUnitDist(a.units, b.units);

      if (co >= minCo) {
        touch(ka, kb, {
          sources: ["cooccur"],
          reasons: [`共现${co}窗`],
          cooccurUnits: co,
          minDist: dist,
        });
      }

      // local alias graph from aggs
      if (a.aliasOfKeys.has(kb) || b.aliasOfKeys.has(ka)) {
        touch(ka, kb, {
          sources: ["local_alias"],
          reasons: ["局部 aliases 互挂/含对方名"],
          minDist: dist,
        });
      }
      if (a.claimedAsAliasBy.has(kb) || b.claimedAsAliasBy.has(ka)) {
        touch(ka, kb, {
          sources: ["local_alias"],
          reasons: ["一方主名曾作另一方 alias"],
          minDist: dist,
        });
      }
    }
  }

  // Fill unit labels for display
  for (const acc of byPair.values()) {
    const ka = norm(acc.nameA);
    const kb = norm(acc.nameB);
    const a = aggs.get(ka);
    const b = aggs.get(kb);
    if (a && acc.unitA != null) {
      acc.unitLabelA = pickUnitLabel(a, acc.unitA);
    }
    if (b && acc.unitB != null) {
      acc.unitLabelB = pickUnitLabel(b, acc.unitB);
    }
  }

  const scored: CrossNameCandidate[] = [];
  for (const acc of byPair.values()) {
    if (!acc.sources.size) continue;
    let score = 0;
    if (acc.sources.has("same_window")) score += 100;
    if (acc.sources.has("local_alias")) score += 80;
    if (acc.sources.has("shared_surface")) score += 50;
    if (acc.sources.has("relation")) score += 60;
    if (acc.sources.has("near")) {
      score += Math.max(0, 50 - (Number.isFinite(acc.minDist) ? acc.minDist * 5 : 50));
    }
    if (acc.sources.has("cooccur")) {
      score += Math.min(40, 10 + acc.cooccurUnits * 5);
    }
    scored.push({
      pairKey: acc.pairKey,
      nameA: acc.nameA,
      nameB: acc.nameB,
      sources: Array.from(acc.sources),
      reasons: Array.from(acc.reasons),
      score,
      minDist: acc.minDist,
      cooccurUnits: acc.cooccurUnits,
      unitA: acc.unitA,
      unitB: acc.unitB,
      unitLabelA: acc.unitLabelA,
      unitLabelB: acc.unitLabelB,
    });
  }

  scored.sort(
    (x, y) =>
      y.score - x.score ||
      x.minDist - y.minDist ||
      x.nameA.localeCompare(y.nameA, "zh"),
  );
  return scored.slice(0, limit);
}

/** Primary name keys currently on the roster */
export function primaryNameKeySet(
  entities: ResolvedEntity[] | null | undefined,
): Set<string> {
  const s = new Set<string>();
  for (const e of entities || []) {
    const k = norm(e.name);
    if (k) s.add(k);
  }
  return s;
}

/** Pair still has two distinct primary rows */
export function isCrossNamePairOpen(
  entities: ResolvedEntity[] | null | undefined,
  nameA: string,
  nameB: string,
): boolean {
  const prim = primaryNameKeySet(entities);
  const ka = norm(nameA);
  const kb = norm(nameB);
  if (!ka || !kb || ka === kb) return false;
  return prim.has(ka) && prim.has(kb);
}

export function recordCrossNameResolution(
  ledger: Record<string, CrossNamePairResolution> | null | undefined,
  input: {
    nameA: string;
    nameB: string;
    verdict: CrossNameVerdict;
    note?: string;
  },
): Record<string, CrossNamePairResolution> {
  const next = { ...(ledger || {}) };
  const pairKey = crossNamePairKey(input.nameA, input.nameB);
  if (!pairKey) return next;
  const [k1, k2] = pairKey.split("||");
  // Preserve display order by verdict names when possible
  next[pairKey] = {
    pairKey,
    nameA: input.nameA.trim() || k1,
    nameB: input.nameB.trim() || k2,
    verdict: input.verdict,
    note: input.note?.trim() || undefined,
    at: new Date().toISOString(),
  };
  return next;
}

/** When merge absorb X into keep Y, mark pair resolved as merge */
export function recordMergesFromOps(
  ledger: Record<string, CrossNamePairResolution> | null | undefined,
  ops: Array<{ op?: string; keep?: string; absorb?: string[] }>,
): Record<string, CrossNamePairResolution> {
  let next = { ...(ledger || {}) };
  for (const op of ops || []) {
    if (op.op !== "merge" || !op.keep) continue;
    for (const ab of op.absorb || []) {
      next = recordCrossNameResolution(next, {
        nameA: op.keep,
        nameB: ab,
        verdict: "merge",
        note: `ops merge keep=${op.keep}`,
      });
    }
  }
  return next;
}

export interface UnresolvedCrossName {
  candidate: CrossNameCandidate;
  /** Why still blocking */
  status: "unprocessed";
}

/**
 * Candidates that still have two primaries and no explicit resolution
 * (merge via ops counts; structural merge that removed a primary also clears).
 */
export function listUnresolvedCrossNamePairs(
  candidates: CrossNameCandidate[],
  entities: ResolvedEntity[] | null | undefined,
  ledger: Record<string, CrossNamePairResolution> | null | undefined,
): UnresolvedCrossName[] {
  const out: UnresolvedCrossName[] = [];
  for (const c of candidates) {
    if (!isCrossNamePairOpen(entities, c.nameA, c.nameB)) continue;
    if (ledger?.[c.pairKey]) continue;
    out.push({ candidate: c, status: "unprocessed" });
  }
  return out;
}

export function formatCrossNameCandidatesForPrompt(
  items: CrossNameCandidate[],
  opts?: {
    ledger?: Record<string, CrossNamePairResolution> | null;
    entities?: ResolvedEntity[] | null;
  },
): string {
  if (!items.length) {
    return (
      `【异名怀疑 P3】0 对。` +
      `（来源：同窗分列 / 近距 / 共现 / 局部 alias。无候选则可 submit。）`
    );
  }
  const ledger = opts?.ledger || {};
  const lines = items.map((c, i) => {
    const open =
      opts?.entities != null
        ? isCrossNamePairOpen(opts.entities, c.nameA, c.nameB)
        : true;
    const res = ledger[c.pairKey];
    const status = res
      ? `已处理=${res.verdict}`
      : open
        ? "未处理"
        : "已合并不再分列";
    const uA =
      c.unitLabelA != null
        ? `${c.unitLabelA}/u@${c.unitA}`
        : c.unitA != null
          ? `u@${c.unitA}`
          : "";
    const uB =
      c.unitLabelB != null
        ? `${c.unitLabelB}/u@${c.unitB}`
        : c.unitB != null
          ? `u@${c.unitB}`
          : "";
    const where =
      uA || uB ? ` @${uA || "?"}${uB ? " ↔ " + uB : ""}` : "";
    return (
      `${i + 1}. 「${c.nameA}」↔「${c.nameB}」${where}` +
      ` · 分=${c.score} · ${c.sources.join("+")}` +
      ` · ${c.reasons.join("；")}` +
      ` · 【${status}】` +
      (res?.note ? `(${res.note})` : "") +
      (status === "未处理"
        ? ` → lookup 后：merge / resolve_cross_name_pair(verdict=distinct|uncertain)`
        : "")
    );
  });
  const openN = items.filter((c) => {
    if (ledger[c.pairKey]) return false;
    if (opts?.entities == null) return true;
    return isCrossNamePairOpen(opts.entities, c.nameA, c.nameB);
  }).length;
  return (
    `【异名怀疑 P3 · 共 ${items.length} 对 · 未处理且仍分列 ${openN}】` +
    `来源含同窗/近距/共现/局部alias。` +
    `每对必须处理：merge 或 resolve_cross_name_pair(distinct|uncertain 存疑)。` +
    `未处理不得 submit 完成。\n` +
    lines.join("\n")
  );
}

export function formatUnresolvedCrossNameBlock(
  unresolved: UnresolvedCrossName[],
  limit = 30,
): string {
  if (!unresolved.length) return "";
  const slice = unresolved.slice(0, limit);
  const lines = slice.map((u, i) => {
    const c = u.candidate;
    return (
      `${i + 1}. 未处理「${c.nameA}」↔「${c.nameB}」` +
      `（${c.sources.join("+")}；${c.reasons.slice(0, 3).join("；")}）` +
      ` → merge keep=… absorb=[…] 或 resolve_cross_name_pair(nameA,nameB,verdict=distinct|uncertain)`
    );
  });
  const more =
    unresolved.length > limit
      ? `\n…另有 ${unresolved.length - limit} 对未处理`
      : "";
  return (
    `【异名未处理 · 共 ${unresolved.length} 对】禁止重扫；须逐对处理后再 submit：\n` +
    lines.join("\n") +
    more
  );
}
