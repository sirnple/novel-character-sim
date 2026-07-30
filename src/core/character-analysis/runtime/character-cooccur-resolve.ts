/**
 * Residual global coref after stage ①② (overlap merge):
 * hard rules → co-occur score → threshold → grey LLM.
 *
 * Candidate channels:
 *   A: shared companion inverted index
 *   B: chunk gap prune (A only)
 *   C: global alias index (force into P; no gap prune)
 *
 * Config: getCharacterCorefConfig() / CHARACTER_COREF_* (design §10).
 */

import type { LLMProvider } from "@/types";
import { extractJSON } from "@/lib/utils";
import {
  type CharacterCorefConfig,
  resolveCharacterCorefConfig,
} from "@/lib/character-coref-config";
import { getCharacterCorefConfig } from "@/lib/runtime-settings";
import {
  isFirstOrSecondPersonDeictic,
  isUnanchoredRelationLabel,
  nameKeyEntity,
  unionResolvedEntity,
  type ResolvedEntity,
} from "./character-entity-types";

// ── Types ───────────────────────────────────────────────────────────

export type CandidateSource = "cooccur" | "alias" | "both";

export interface CorefCandidatePair {
  i: number;
  j: number;
  source: CandidateSource;
  sharedAliases: string[];
  sharedCompanions: number;
}

export type HardDecision = "merge" | "reject" | "undecided";

export interface PairScoreBreakdown {
  sExclusive: number;
  sJ: number;
  sJ0: number;
  pTemporal: number;
  temporalOverlapRate: number;
  score: number;
  topCompanion?: string;
}

export type PairRoute =
  | "hard_merge"
  | "hard_reject"
  | "auto_merge"
  | "auto_reject"
  | "grey"
  | "grey_alias_force"
  | "llm_merge"
  | "llm_reject";

export interface PairDecision {
  i: number;
  j: number;
  route: PairRoute;
  reason: string;
  source: CandidateSource;
  score?: PairScoreBreakdown;
  sharedAliases: string[];
}

export interface ResidualResolveLog {
  beforeCount: number;
  afterCount: number;
  candidateCount: number;
  decisions: PairDecision[];
  merges: Array<{ keep: string; absorb: string; route: PairRoute }>;
  greyAsked: number;
  config: CharacterCorefConfig;
}

export interface EntityUnitStats {
  units: Set<number>;
  first: number;
  last: number;
  count: number;
  neighbors: Set<number>;
  coWith: Map<number, number>;
}

// ── Helpers ─────────────────────────────────────────────────────────

function norm(s: string): string {
  return nameKeyEntity(s);
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function ordered(a: number, b: number): [number, number] {
  return a < b ? [a, b] : [b, a];
}

export function buildEntityUnitStats(
  entities: ResolvedEntity[],
): EntityUnitStats[] {
  const n = entities.length;
  const stats: EntityUnitStats[] = Array.from({ length: n }, () => ({
    units: new Set<number>(),
    first: Infinity,
    last: -Infinity,
    count: 0,
    neighbors: new Set(),
    coWith: new Map(),
  }));

  const byUnit = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    for (const a of entities[i].anchors || []) {
      const u =
        a.unitIndex != null && Number.isFinite(a.unitIndex)
          ? Math.floor(a.unitIndex)
          : null;
      if (u == null || u < 0) continue;
      stats[i].units.add(u);
      const list = byUnit.get(u) || [];
      list.push(i);
      byUnit.set(u, list);
    }
    if (stats[i].units.size) {
      let first = Infinity;
      let last = -Infinity;
      for (const u of stats[i].units) {
        if (u < first) first = u;
        if (u > last) last = u;
      }
      stats[i].first = first;
      stats[i].last = last;
      stats[i].count = stats[i].units.size;
    } else {
      stats[i].first = 0;
      stats[i].last = 0;
      stats[i].count = 0;
    }
  }

  for (const [, idxs] of byUnit) {
    const uniq = Array.from(new Set(idxs));
    for (let a = 0; a < uniq.length; a++) {
      for (let b = a + 1; b < uniq.length; b++) {
        const i = uniq[a];
        const j = uniq[b];
        stats[i].neighbors.add(j);
        stats[j].neighbors.add(i);
        stats[i].coWith.set(j, (stats[i].coWith.get(j) || 0) + 1);
        stats[j].coWith.set(i, (stats[j].coWith.get(i) || 0) + 1);
      }
    }
  }
  return stats;
}

function spanGap(a: EntityUnitStats, b: EntityUnitStats): number {
  if (!a.units.size || !b.units.size) return 0;
  if (a.last >= b.first && b.last >= a.first) return 0;
  if (a.last < b.first) return b.first - a.last;
  return a.first - b.last;
}

// ── Candidates ──────────────────────────────────────────────────────

export function generateCorefCandidates(
  entities: ResolvedEntity[],
  stats: EntityUnitStats[],
  cfg: CharacterCorefConfig,
): CorefCandidatePair[] {
  const n = entities.length;
  const map = new Map<string, CorefCandidatePair>();

  const upsert = (
    i: number,
    j: number,
    source: "cooccur" | "alias",
    sharedAliases: string[] = [],
  ) => {
    if (i === j) return;
    const [a, b] = ordered(i, j);
    const k = pairKey(a, b);
    const prev = map.get(k);
    if (!prev) {
      map.set(k, {
        i: a,
        j: b,
        source,
        sharedAliases: [...sharedAliases],
        sharedCompanions: 0,
      });
      return;
    }
    if (prev.source !== source) prev.source = "both";
    if (sharedAliases.length) {
      prev.sharedAliases = Array.from(
        new Set([...prev.sharedAliases, ...sharedAliases]),
      );
    }
  };

  // Channel A: pairs that share a companion X
  for (let x = 0; x < n; x++) {
    const neigh = Array.from(stats[x].neighbors);
    for (let a = 0; a < neigh.length; a++) {
      for (let b = a + 1; b < neigh.length; b++) {
        upsert(neigh[a], neigh[b], "cooccur");
      }
    }
  }
  for (const p of map.values()) {
    let shared = 0;
    for (const x of stats[p.i].neighbors) {
      if (x !== p.j && stats[p.j].neighbors.has(x)) shared++;
    }
    p.sharedCompanions = shared;
  }

  // Channel B: gap prune cooccur edges
  const gapMax = cfg.chunkGapMax;
  for (const [k, p] of Array.from(map.entries())) {
    if (p.source === "alias") continue;
    const gap = spanGap(stats[p.i], stats[p.j]);
    if (gap > gapMax) {
      if (p.source === "both") p.source = "alias";
      else map.delete(k);
    }
  }

  // Channel C: alias index
  const aliasBuckets = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    for (const al of entities[i].aliases || []) {
      const k = norm(al);
      if (!k || k.length < 2) continue;
      if (isFirstOrSecondPersonDeictic(al) || isUnanchoredRelationLabel(al))
        continue;
      const list = aliasBuckets.get(k) || [];
      list.push(i);
      aliasBuckets.set(k, list);
    }
  }
  const bucketMax = cfg.aliasBucketMax;
  for (const [aliasKey, idxs] of aliasBuckets) {
    const uniq = Array.from(new Set(idxs));
    if (bucketMax > 0 && uniq.length > bucketMax) continue;
    if (uniq.length < 2) continue;
    const surfaces: string[] = [];
    const seen = new Set<string>();
    for (const i of uniq) {
      for (const al of entities[i].aliases || []) {
        if (norm(al) === aliasKey && !seen.has(aliasKey)) {
          seen.add(aliasKey);
          surfaces.push(al.trim());
        }
      }
    }
    for (let a = 0; a < uniq.length; a++) {
      for (let b = a + 1; b < uniq.length; b++) {
        upsert(uniq[a], uniq[b], "alias", surfaces);
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => a.i - b.i || a.j - b.j);
}

// ── Hard rules ──────────────────────────────────────────────────────

function genderOf(e: ResolvedEntity): string | null {
  const g = (e as { gender?: string }).gender;
  if (g == null || !String(g).trim()) return null;
  const t = String(g).trim().toLowerCase();
  if (/男|male|^m$|雄/.test(t)) return "m";
  if (/女|female|^f$|雌/.test(t)) return "f";
  return t;
}

function ageBucket(e: ResolvedEntity): string | null {
  const a = (e as { age?: string }).age;
  if (a == null || !String(a).trim()) return null;
  const t = String(a).replace(/\s+/g, "");
  if (/幼|婴儿|孩|童|少年|少女|未成年/.test(t)) return "young";
  if (/老|暮|高龄|古稀|花甲|白发/.test(t)) return "old";
  if (/青|壮|中年|成年/.test(t)) return "adult";
  return t;
}

export function sharedAliasList(
  a: ResolvedEntity,
  b: ResolvedEntity,
): string[] {
  const sa = new Set(
    (a.aliases || []).map(norm).filter((k) => k && k.length >= 2),
  );
  const out: string[] = [];
  const seen = new Set<string>();
  for (const al of b.aliases || []) {
    const k = norm(al);
    if (k && sa.has(k) && !seen.has(k)) {
      seen.add(k);
      out.push(al.trim());
    }
  }
  return out;
}

export function applyHardRules(
  a: ResolvedEntity,
  b: ResolvedEntity,
  statsA: EntityUnitStats,
  statsB: EntityUnitStats,
  cfg: CharacterCorefConfig,
): { decision: HardDecision; reason: string; sharedAliases: string[] } {
  const sharedAliases = sharedAliasList(a, b);

  if (cfg.hardRejectSameUnit) {
    for (const u of statsA.units) {
      if (statsB.units.has(u)) {
        return {
          decision: "reject",
          reason: `同块同现 unit=${u}`,
          sharedAliases,
        };
      }
    }
  }

  if (cfg.hardRejectGenderConflict) {
    const ga = genderOf(a);
    const gb = genderOf(b);
    if (ga && gb && ga !== gb) {
      return {
        decision: "reject",
        reason: `性别冲突 ${ga} vs ${gb}`,
        sharedAliases,
      };
    }
  }

  if (cfg.hardRejectAgeConflict) {
    const aa = ageBucket(a);
    const ab = ageBucket(b);
    if (
      aa &&
      ab &&
      ((aa === "young" && ab === "old") || (aa === "old" && ab === "young"))
    ) {
      return {
        decision: "reject",
        reason: `年龄描述冲突 ${aa} vs ${ab}`,
        sharedAliases,
      };
    }
  }

  if (sharedAliases.length >= cfg.aliasHardMergeMin) {
    return {
      decision: "merge",
      reason: `共享别名≥${cfg.aliasHardMergeMin}: ${sharedAliases.slice(0, 6).join("、")}`,
      sharedAliases,
    };
  }

  if (cfg.hardMergeSameFullName) {
    const na = norm(a.name);
    const nb = norm(b.name);
    if (na && nb && na === nb) {
      return {
        decision: "merge",
        reason: `全名相同「${a.name}」`,
        sharedAliases,
      };
    }
  }

  return { decision: "undecided", reason: "", sharedAliases };
}

// ── Scoring ─────────────────────────────────────────────────────────

/** Residual co-occur pair score (legacy residual path; not coref/scorePair). */
export function scoreCooccurPair(
  entities: ResolvedEntity[],
  stats: EntityUnitStats[],
  i: number,
  j: number,
  cfg: CharacterCorefConfig,
): PairScoreBreakdown {
  const si = stats[i];
  const sj = stats[j];
  const common: number[] = [];
  for (const x of si.neighbors) {
    if (x !== j && sj.neighbors.has(x)) common.push(x);
  }

  let sExclusive = 0;
  let topCompanion: string | undefined;
  const ci = Math.max(1, si.count);
  const cj = Math.max(1, sj.count);
  for (const x of common) {
    const cix = si.coWith.get(x) || 0;
    const cjx = sj.coWith.get(x) || 0;
    const ex = Math.min(cix / ci, cjx / cj);
    if (ex > sExclusive) {
      sExclusive = ex;
      topCompanion = entities[x]?.name;
    }
  }

  const nInter = common.length;
  const union = new Set<number>();
  for (const x of si.neighbors) if (x !== j) union.add(x);
  for (const x of sj.neighbors) if (x !== i) union.add(x);
  const nUnion = union.size || 1;
  const sJ0 = nInter / nUnion;
  const sparse = Math.min(si.count, sj.count) < cfg.jaccardSparseMinCount;
  const sJ = sparse ? sJ0 * cfg.jaccardSparseDiscount : sJ0;

  let temporalOverlapRate = 0;
  let pTemporal = cfg.temporalPenaltyLow;
  if (si.units.size && sj.units.size) {
    const spanI = Math.max(1, si.last - si.first + 1);
    const spanJ = Math.max(1, sj.last - sj.first + 1);
    const ov = Math.max(
      0,
      Math.min(si.last, sj.last) - Math.max(si.first, sj.first) + 1,
    );
    temporalOverlapRate = ov / Math.min(spanI, spanJ);
    if (temporalOverlapRate > cfg.temporalHighOverlap) {
      pTemporal = cfg.temporalPenaltyHigh;
    } else if (temporalOverlapRate >= cfg.temporalMidOverlap) {
      pTemporal = cfg.temporalPenaltyMid;
    } else {
      pTemporal = cfg.temporalPenaltyLow;
    }
  }

  const raw =
    cfg.weightExclusive * sExclusive + cfg.weightJaccard * sJ + pTemporal;
  const score = Math.min(1, Math.max(0, raw));

  return {
    sExclusive,
    sJ,
    sJ0,
    pTemporal,
    temporalOverlapRate,
    score,
    topCompanion,
  };
}

function hasCommonNeighbor(
  stats: EntityUnitStats[],
  i: number,
  j: number,
): boolean {
  for (const x of stats[i].neighbors) {
    if (x !== j && stats[j].neighbors.has(x)) return true;
  }
  return false;
}

// ── UF ──────────────────────────────────────────────────────────────

class UnionFind {
  parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    let x = i;
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

// ── Grey LLM ────────────────────────────────────────────────────────

function entityContext(
  fullText: string,
  e: ResolvedEntity,
  chars: number,
): string {
  const anchors = e.anchors || [];
  const offset =
    anchors[0]?.offset != null && Number.isFinite(anchors[0].offset)
      ? Math.max(0, Math.floor(anchors[0].offset))
      : 0;
  const half = Math.floor(chars / 2);
  const start = Math.max(0, offset - half);
  const end = Math.min(fullText.length, offset + half + (chars % 2));
  let slice = fullText.slice(start, end);
  if (start > 0) slice = "…" + slice;
  if (end < fullText.length) slice = slice + "…";
  return slice || (e.briefDescription || "").slice(0, chars) || e.name;
}

export async function judgeGreyPairWithLlm(
  llm: LLMProvider,
  fullText: string,
  a: ResolvedEntity,
  b: ResolvedEntity,
  meta: {
    score?: PairScoreBreakdown;
    sharedAliases: string[];
    source: CandidateSource;
    contextChars: number;
  },
): Promise<"yes" | "no" | "uncertain"> {
  const ctxA = entityContext(fullText, a, meta.contextChars);
  const ctxB = entityContext(fullText, b, meta.contextChars);
  const scoreLine = meta.score
    ? `score=${meta.score.score.toFixed(3)} 专属=${meta.score.sExclusive.toFixed(2)} J=${meta.score.sJ.toFixed(2)} 时序罚=${meta.score.pTemporal} 顶配角=${meta.score.topCompanion || "无"}`
    : "score=n/a";
  const aliasLine = meta.sharedAliases.length
    ? `共享别名: ${meta.sharedAliases.join("、")}`
    : "共享别名: 无";

  const system = `你是小说角色指代消解裁判。判断两个实体是否为同一人。
只输出 JSON：{"decision":"yes"|"no"|"uncertain","reason":"一句话"}
不确定时必须 uncertain（系统将拒绝合并）。不要编造正文没有的情节。`;

  const user = `实体A：主名「${a.name}」别名=[${(a.aliases || []).join("、")}]
上下文A：
${ctxA}

实体B：主名「${b.name}」别名=[${(b.aliases || []).join("、")}]
上下文B：
${ctxB}

证据：来源=${meta.source}；${aliasLine}；${scoreLine}

是否同一人？`;

  try {
    const raw = await llm.chat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { temperature: 0.1, maxTokens: 200 },
    );
    const parsed = extractJSON<{ decision?: string }>(raw);
    const d = String(parsed?.decision || "")
      .trim()
      .toLowerCase();
    if (d === "yes" || d === "是" || d === "merge" || d === "same")
      return "yes";
    if (d === "no" || d === "否" || d === "different" || d === "reject")
      return "no";
    return "uncertain";
  } catch {
    return "uncertain";
  }
}

// ── Main ────────────────────────────────────────────────────────────

export interface ResolveResidualOptions {
  config?: Partial<CharacterCorefConfig>;
  llm?: LLMProvider | null;
  /** When true (or no llm), grey pairs are left unmerged (reject). */
  skipLlm?: boolean;
  fullText?: string;
}

function resolveCfg(
  partial?: Partial<CharacterCorefConfig>,
): CharacterCorefConfig {
  return partial
    ? resolveCharacterCorefConfig(partial)
    : getCharacterCorefConfig();
}

function collapseEntities(
  entities: ResolvedEntity[],
  uf: UnionFind,
  decisions: PairDecision[],
): {
  entities: ResolvedEntity[];
  merges: ResidualResolveLog["merges"];
} {
  const groups = new Map<number, number[]>();
  for (let i = 0; i < entities.length; i++) {
    const r = uf.find(i);
    const g = groups.get(r) || [];
    g.push(i);
    groups.set(r, g);
  }

  const merges: ResidualResolveLog["merges"] = [];
  const out: ResolvedEntity[] = [];
  for (const members of groups.values()) {
    let acc = entities[members[0]];
    for (let k = 1; k < members.length; k++) {
      const other = entities[members[k]];
      const mi = members[0];
      const mj = members[k];
      const route =
        decisions.find(
          (d) =>
            (d.i === mi && d.j === mj) ||
            (d.j === mi && d.i === mj) ||
            (members.includes(d.i) && members.includes(d.j)),
        )?.route || "hard_merge";
      merges.push({ keep: acc.name, absorb: other.name, route });
      acc = unionResolvedEntity(acc, other);
    }
    out.push(acc);
  }

  out.sort((a, b) => {
    const ua = a.anchors?.[0]?.unitIndex ?? 0;
    const ub = b.anchors?.[0]?.unitIndex ?? 0;
    return ua - ub || (a.name || "").localeCompare(b.name || "", "zh");
  });
  return { entities: out, merges };
}

/**
 * Fully synchronous residual resolve (program only).
 * Grey / alias-force-grey → leave unmerged (agent or LLM pass later).
 */
export function resolveResidualCooccurProgram(
  entities: ResolvedEntity[],
  options: Omit<ResolveResidualOptions, "llm" | "skipLlm"> = {},
): { entities: ResolvedEntity[]; log: ResidualResolveLog } {
  const cfg = resolveCfg(options.config);
  const beforeCount = entities.length;
  const decisions: PairDecision[] = [];

  if (entities.length < 2) {
    return {
      entities: entities.slice(),
      log: {
        beforeCount,
        afterCount: entities.length,
        candidateCount: 0,
        decisions,
        merges: [],
        greyAsked: 0,
        config: cfg,
      },
    };
  }

  const stats = buildEntityUnitStats(entities);
  const candidates = generateCorefCandidates(entities, stats, cfg);
  const uf = new UnionFind(entities.length);
  const pending: CorefCandidatePair[] = [];

  for (const c of candidates) {
    if (uf.find(c.i) === uf.find(c.j)) continue;
    const hard = applyHardRules(
      entities[c.i],
      entities[c.j],
      stats[c.i],
      stats[c.j],
      cfg,
    );
    if (hard.decision === "merge") {
      uf.union(c.i, c.j);
      decisions.push({
        i: c.i,
        j: c.j,
        route: "hard_merge",
        reason: hard.reason,
        source: c.source,
        sharedAliases: hard.sharedAliases,
      });
    } else if (hard.decision === "reject") {
      decisions.push({
        i: c.i,
        j: c.j,
        route: "hard_reject",
        reason: hard.reason,
        source: c.source,
        sharedAliases: hard.sharedAliases,
      });
    } else {
      pending.push(c);
    }
  }

  for (const c of pending) {
    if (uf.find(c.i) === uf.find(c.j)) continue;
    const shared = sharedAliasList(entities[c.i], entities[c.j]);
    const noCommon = !hasCommonNeighbor(stats, c.i, c.j);
    const forceAliasGrey =
      (c.source === "alias" || c.source === "both") &&
      noCommon &&
      shared.length >= 1;
    const score = scoreCooccurPair(entities, stats, c.i, c.j, cfg);

    if (forceAliasGrey && c.source === "alias") {
      decisions.push({
        i: c.i,
        j: c.j,
        route: "grey_alias_force",
        reason: "仅别名通道无共现邻居；程序态保留给 LLM/Agent",
        source: c.source,
        score,
        sharedAliases: shared,
      });
      continue;
    }

    if (score.score >= cfg.autoMergeThreshold) {
      uf.union(c.i, c.j);
      decisions.push({
        i: c.i,
        j: c.j,
        route: "auto_merge",
        reason: `score=${score.score.toFixed(3)}≥${cfg.autoMergeThreshold}`,
        source: c.source,
        score,
        sharedAliases: shared,
      });
    } else if (score.score >= cfg.greyLowThreshold || forceAliasGrey) {
      decisions.push({
        i: c.i,
        j: c.j,
        route: forceAliasGrey ? "grey_alias_force" : "grey",
        reason: forceAliasGrey
          ? "别名强制灰区；程序态不合并"
          : `灰区 score=${score.score.toFixed(3)}；程序态不合并`,
        source: c.source,
        score,
        sharedAliases: shared,
      });
    } else {
      decisions.push({
        i: c.i,
        j: c.j,
        route: "auto_reject",
        reason: `score=${score.score.toFixed(3)}<${cfg.greyLowThreshold}`,
        source: c.source,
        score,
        sharedAliases: shared,
      });
    }
  }

  const collapsed = collapseEntities(entities, uf, decisions);
  return {
    entities: collapsed.entities,
    log: {
      beforeCount,
      afterCount: collapsed.entities.length,
      candidateCount: candidates.length,
      decisions,
      merges: collapsed.merges,
      greyAsked: 0,
      config: cfg,
    },
  };
}

/**
 * Full residual resolve with optional grey LLM.
 */
export async function resolveResidualCooccur(
  entities: ResolvedEntity[],
  options: ResolveResidualOptions = {},
): Promise<{ entities: ResolvedEntity[]; log: ResidualResolveLog }> {
  const cfg = resolveCfg(options.config);
  const fullText = options.fullText || "";
  const useLlm =
    !!options.llm && !options.skipLlm && fullText.length > 0;
  const beforeCount = entities.length;
  const decisions: PairDecision[] = [];

  if (entities.length < 2) {
    return {
      entities: entities.slice(),
      log: {
        beforeCount,
        afterCount: entities.length,
        candidateCount: 0,
        decisions,
        merges: [],
        greyAsked: 0,
        config: cfg,
      },
    };
  }

  const stats = buildEntityUnitStats(entities);
  const candidates = generateCorefCandidates(entities, stats, cfg);
  const uf = new UnionFind(entities.length);
  const pending: CorefCandidatePair[] = [];
  let greyAsked = 0;

  for (const c of candidates) {
    if (uf.find(c.i) === uf.find(c.j)) continue;
    const hard = applyHardRules(
      entities[c.i],
      entities[c.j],
      stats[c.i],
      stats[c.j],
      cfg,
    );
    if (hard.decision === "merge") {
      uf.union(c.i, c.j);
      decisions.push({
        i: c.i,
        j: c.j,
        route: "hard_merge",
        reason: hard.reason,
        source: c.source,
        sharedAliases: hard.sharedAliases,
      });
    } else if (hard.decision === "reject") {
      decisions.push({
        i: c.i,
        j: c.j,
        route: "hard_reject",
        reason: hard.reason,
        source: c.source,
        sharedAliases: hard.sharedAliases,
      });
    } else {
      pending.push(c);
    }
  }

  type GreyItem = {
    c: CorefCandidatePair;
    score: PairScoreBreakdown;
    forceAlias: boolean;
    shared: string[];
  };
  const greyQueue: GreyItem[] = [];

  for (const c of pending) {
    if (uf.find(c.i) === uf.find(c.j)) continue;
    const shared = sharedAliasList(entities[c.i], entities[c.j]);
    const noCommon = !hasCommonNeighbor(stats, c.i, c.j);
    const forceAliasGrey =
      (c.source === "alias" || c.source === "both") &&
      noCommon &&
      shared.length >= 1;
    const score = scoreCooccurPair(entities, stats, c.i, c.j, cfg);

    if (forceAliasGrey && c.source === "alias") {
      greyQueue.push({ c, score, forceAlias: true, shared });
      continue;
    }

    if (score.score >= cfg.autoMergeThreshold) {
      uf.union(c.i, c.j);
      decisions.push({
        i: c.i,
        j: c.j,
        route: "auto_merge",
        reason: `score=${score.score.toFixed(3)}≥${cfg.autoMergeThreshold}`,
        source: c.source,
        score,
        sharedAliases: shared,
      });
    } else if (score.score >= cfg.greyLowThreshold || forceAliasGrey) {
      greyQueue.push({
        c,
        score,
        forceAlias: forceAliasGrey,
        shared,
      });
    } else {
      decisions.push({
        i: c.i,
        j: c.j,
        route: "auto_reject",
        reason: `score=${score.score.toFixed(3)}<${cfg.greyLowThreshold}`,
        source: c.source,
        score,
        sharedAliases: shared,
      });
    }
  }

  for (const g of greyQueue) {
    const { c, score, forceAlias, shared } = g;
    if (uf.find(c.i) === uf.find(c.j)) continue;

    if (!useLlm) {
      decisions.push({
        i: c.i,
        j: c.j,
        route: forceAlias ? "grey_alias_force" : "grey",
        reason: forceAlias
          ? "仅别名通道；无 LLM → 不合并"
          : `灰区 score=${score.score.toFixed(3)}；无 LLM → 不合并`,
        source: c.source,
        score,
        sharedAliases: shared,
      });
      continue;
    }

    greyAsked++;
    const verdict = await judgeGreyPairWithLlm(
      options.llm!,
      fullText,
      entities[c.i],
      entities[c.j],
      {
        score,
        sharedAliases: shared,
        source: c.source,
        contextChars: cfg.greyContextChars,
      },
    );
    if (verdict === "yes") {
      uf.union(c.i, c.j);
      decisions.push({
        i: c.i,
        j: c.j,
        route: "llm_merge",
        reason: forceAlias
          ? "灰区LLM(别名强制) 是"
          : `灰区LLM 是 score=${score.score.toFixed(3)}`,
        source: c.source,
        score,
        sharedAliases: shared,
      });
    } else {
      decisions.push({
        i: c.i,
        j: c.j,
        route: "llm_reject",
        reason: `灰区LLM ${verdict === "no" ? "否" : "不确定→拒"}`,
        source: c.source,
        score,
        sharedAliases: shared,
      });
    }
  }

  const collapsed = collapseEntities(entities, uf, decisions);
  return {
    entities: collapsed.entities,
    log: {
      beforeCount,
      afterCount: collapsed.entities.length,
      candidateCount: candidates.length,
      decisions,
      merges: collapsed.merges,
      greyAsked,
      config: cfg,
    },
  };
}
