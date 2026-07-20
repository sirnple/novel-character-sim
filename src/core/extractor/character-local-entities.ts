/**
 * Local entities from stage-1 unit scan (name + in-window aliases).
 * Anchors = **scan unit / chapter**, not precise char positions.
 */

import type { TextUnit } from "./character-name-units";
import type { UnitNameHit } from "./character-name-aggregate";
import { mergeAnchors, unitAnchor, type MentionAnchor } from "./mention-anchor";
import type { ResolvedEntity } from "./character-entity-types";
import {
  isUnanchoredRelationLabel,
  nameKeyEntity,
} from "./character-entity-types";

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
 * Max |unitIndex| gap for **programmatic same-name coref**.
 * Same name within this distance → one seed entity (no LLM).
 * Same name farther apart → separate seed rows; global LLM decides merge.
 * Different names always left for the global agent.
 */
export const DEFAULT_SAME_NAME_UNIT_DISTANCE = 5;

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

/** Union-find clusters: same name locals linked when |Δunit| ≤ D (transitive). */
function clusterByUnitDistance(
  group: LocalEntity[],
  maxUnitDistance: number,
): LocalEntity[][] {
  const n = group.length;
  if (n <= 1) return group.length ? [group] : [];
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    let x = i;
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(unitOf(group[i]) - unitOf(group[j])) <= maxUnitDistance) {
        union(i, j);
      }
    }
  }
  const buckets = new Map<number, LocalEntity[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const list = buckets.get(r);
    if (list) list.push(group[i]);
    else buckets.set(r, [group[i]]);
  }
  return Array.from(buckets.values());
}

function minUnit(cluster: LocalEntity[]): number {
  let m = Infinity;
  for (const loc of cluster) {
    const u = unitOf(loc);
    if (u < m) m = u;
  }
  return Number.isFinite(m) ? m : 0;
}

/** Keep name ≤24 chars (normalizeResolvedEntities limit). */
function disambiguatedSameName(base: string, minUnitIndex: number): string {
  const suffix = `@u${minUnitIndex}`;
  const max = 24;
  if (base.length + suffix.length <= max) return base + suffix;
  const keep = Math.max(1, max - suffix.length);
  return base.slice(0, keep) + suffix;
}

function mergeClusterToEntity(
  cluster: LocalEntity[],
  displayName: string,
  /** Bare local name in surfaces — only for the primary (earliest) cluster. */
  claimBareNameSurface: boolean,
): ResolvedEntity {
  const sorted = [...cluster].sort((a, b) => unitOf(a) - unitOf(b));
  const bare = (sorted[0]?.name || displayName).trim();
  const nk = nameKeyEntity(displayName);
  const bareKey = nameKeyEntity(bare);
  const aliasSet = new Set<string>();
  let anchors: MentionAnchor[] | undefined;
  for (const loc of sorted) {
    for (const a of loc.aliases || []) {
      const t = String(a || "").trim();
      if (!t) continue;
      const ak = nameKeyEntity(t);
      if (ak === nk || ak === bareKey) continue;
      aliasSet.add(t);
    }
    anchors = mergeAnchors(anchors, loc.anchors);
  }
  const aliases = Array.from(aliasSet);
  // Far same-name clusters must NOT claim bare surface, or mergeResolvedEntities
  // would collapse them via shared surface keys.
  const surfaces = Array.from(
    new Set(
      [
        displayName,
        ...(claimBareNameSurface ? [bare] : []),
        ...aliases,
      ].filter(Boolean),
    ),
  );
  const uMin = minUnit(sorted);
  const uMax = Math.max(...sorted.map(unitOf));
  const brief =
    claimBareNameSurface || bare === displayName
      ? undefined
      : `同名远距簇 surface「${bare}」u@${uMin}${uMax !== uMin ? `–${uMax}` : ""}；与近距同名是否同一人由全局判定`;
  return {
    name: displayName,
    aliases,
    surfaces,
    anchors: anchors && anchors.length ? anchors : undefined,
    role: "supporting",
    briefDescription: brief,
  };
}

/**
 * Program coref seed for stage-2:
 * - **Same name** + |Δunit| ≤ D → merge (aliases/anchors union). Transitive.
 * - **Same name** + only far clusters (> D apart) → separate rows; later clusters
 *   named `原名@u{minUnit}` so roster keys stay unique for ops.
 * - **Different names** never merged here (e.g. 孙悟空 vs 齐天大圣) → global LLM.
 */
export function seedGlobalEntitiesFromLocal(
  locals: LocalEntity[],
  opts?: { maxUnitDistance?: number },
): ResolvedEntity[] {
  const D =
    opts?.maxUnitDistance ?? DEFAULT_SAME_NAME_UNIT_DISTANCE;
  const groups = new Map<string, LocalEntity[]>();
  for (const loc of locals) {
    const name = (loc.name || "").trim();
    const k = nameKeyEntity(name);
    if (!k) continue;
    const g = groups.get(k);
    if (g) g.push(loc);
    else groups.set(k, [loc]);
  }

  const out: ResolvedEntity[] = [];
  for (const [, group] of groups) {
    const clusters = clusterByUnitDistance(group, D).sort(
      (a, b) => minUnit(a) - minUnit(b),
    );
    for (let ci = 0; ci < clusters.length; ci++) {
      const cluster = clusters[ci];
      const bare = (cluster[0]?.name || "").trim() || "未命名";
      // Prefer spelling from earliest unit in cluster
      const earliest = [...cluster].sort((a, b) => unitOf(a) - unitOf(b))[0];
      const baseName = (earliest?.name || bare).trim();
      const primary = ci === 0;
      const displayName = primary
        ? baseName
        : disambiguatedSameName(baseName, minUnit(cluster));
      out.push(mergeClusterToEntity(cluster, displayName, primary));
    }
  }
  return out;
}

/** Seed / tool-only far-cluster id: `周航@u23`. Must not appear in final UI roster. */
const TECHNICAL_FAR_NAME_RE = /^(.+)@u(\d+)$/i;

export function parseTechnicalFarSameName(
  name: string,
): { bare: string; unitIndex: number } | null {
  const m = String(name || "")
    .trim()
    .match(TECHNICAL_FAR_NAME_RE);
  if (!m) return null;
  const bare = m[1].trim();
  if (!bare) return null;
  return { bare, unitIndex: parseInt(m[2], 10) };
}

function stripTechnicalLabel(s: string): string {
  const p = parseTechnicalFarSameName(s);
  return p ? p.bare : String(s || "").trim();
}

function cleanFarBrief(brief: string | undefined): string | undefined {
  const t = (brief || "").trim();
  if (!t) return undefined;
  if (/同名远距簇/.test(t)) return undefined;
  return t;
}

/**
 * After global coref: fold leftover `Name@uN` seed ids into bare `Name`.
 * These ids exist only so far same-name clusters can be addressed by tools;
 * they must not become final roster rows (e.g. 周航 + 周航@u23 → 周航).
 *
 * If two people truly share a surface, the agent must rename them to distinct
 * human names — keeping `@uN` is never a valid final answer.
 */
export function collapseTechnicalFarSameNameKeys(
  entities: ResolvedEntity[],
): ResolvedEntity[] {
  if (!entities?.length) return [];

  type Row = ResolvedEntity & { _i: number };
  const rows: Row[] = entities.map((e, i) => ({
    ...e,
    aliases: [...(e.aliases || [])],
    surfaces: [...(e.surfaces || [])],
    _i: i,
  }));

  const bareKeyOf = (name: string) => {
    const p = parseTechnicalFarSameName(name);
    return nameKeyEntity(p ? p.bare : name);
  };

  // Group all entities that share the same bare display key
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const k = bareKeyOf(r.name);
    if (!k) continue;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }

  const out: ResolvedEntity[] = [];
  for (const [, group] of groups) {
    const hasTech = group.some((r) => parseTechnicalFarSameName(r.name));
    if (!hasTech && group.length === 1) {
      const only = group[0];
      out.push({
        name: only.name,
        aliases: only.aliases,
        surfaces: only.surfaces,
        anchors: only.anchors,
        role: only.role,
        briefDescription: only.briefDescription,
      });
      continue;
    }
    if (!hasTech) {
      // Multiple non-technical distinct names that somehow share bareKey — keep all
      for (const r of group) {
        out.push({
          name: r.name,
          aliases: r.aliases,
          surfaces: r.surfaces,
          anchors: r.anchors,
          role: r.role,
          briefDescription: r.briefDescription,
        });
      }
      continue;
    }

    // Prefer row already using bare name
    const barePreferred =
      group.find((r) => !parseTechnicalFarSameName(r.name)) || group[0];
    const bareName =
      parseTechnicalFarSameName(barePreferred.name)?.bare ||
      barePreferred.name.trim();
    const bareNk = nameKeyEntity(bareName);

    let anchors = barePreferred.anchors;
    const aliasSet = new Set<string>();
    const surfaceSet = new Set<string>([bareName]);
    let role = barePreferred.role || "supporting";
    let brief = cleanFarBrief(barePreferred.briefDescription);

    for (const r of group) {
      anchors = mergeAnchors(anchors, r.anchors);
      for (const a of r.aliases || []) {
        const t = stripTechnicalLabel(a);
        if (t && nameKeyEntity(t) !== bareNk) aliasSet.add(t);
      }
      for (const s of r.surfaces || []) {
        const t = stripTechnicalLabel(s);
        if (t) surfaceSet.add(t);
      }
      // Drop technical name itself from alias/surface noise
      const tech = parseTechnicalFarSameName(r.name);
      if (!tech && r.name && nameKeyEntity(r.name) !== bareNk) {
        aliasSet.add(r.name.trim());
        surfaceSet.add(r.name.trim());
      }
      if (r.role && r.role !== "supporting") role = r.role;
      const b = cleanFarBrief(r.briefDescription);
      if (b && (!brief || b.length > brief.length)) brief = b;
    }

    surfaceSet.add(bareName);
    for (const a of aliasSet) surfaceSet.add(a);

    out.push({
      name: bareName,
      aliases: Array.from(aliasSet),
      surfaces: Array.from(surfaceSet),
      anchors: anchors?.length ? anchors : undefined,
      role,
      briefDescription: brief,
    });
  }

  return out;
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
    `本页 offset=${offset} limit=${limit}（${slice.length} 条）` +
    `。近距异名候选请用 list_near_alias_candidates。`;
  return head + "\n" + lines.join("\n");
}

/**
 * Near-window **different-name** pairs for the global agent to analyze as
 * possible aliases (not auto-merged). Same-name near pairs are already
 * program-merged; this surfaces the hard case: 周伯彦@u2 vs 周屿的父亲@u3,
 * 孙悟空 vs 齐天大圣 in adjacent units, etc.
 */
export interface NearCrossNameCandidate {
  nameA: string;
  nameB: string;
  unitA: number;
  unitB: number;
  unitLabelA?: string;
  unitLabelB?: string;
  dist: number;
  /** Why this pair is worth looking up */
  reasons: string[];
  aliasesA: string[];
  aliasesB: string[];
}

function surfaceKeySet(e: LocalEntity): Set<string> {
  const s = new Set<string>();
  const nk = nameKeyEntity(e.name);
  if (nk) s.add(nk);
  for (const a of e.aliases || []) {
    const k = nameKeyEntity(a);
    if (k) s.add(k);
  }
  return s;
}

export function listNearCrossNameAliasCandidates(
  locals: LocalEntity[],
  opts?: { maxUnitDistance?: number; limit?: number },
): NearCrossNameCandidate[] {
  const D = opts?.maxUnitDistance ?? DEFAULT_SAME_NAME_UNIT_DISTANCE;
  const limit = Math.max(1, opts?.limit ?? 60);
  if (locals.length < 2) return [];

  // Dedupe key: sorted bare name keys
  type Acc = NearCrossNameCandidate;
  const byPair = new Map<string, Acc>();

  for (let i = 0; i < locals.length; i++) {
    const a = locals[i];
    const ka = nameKeyEntity(a.name);
    if (!ka) continue;
    const ua = unitOf(a);
    const setA = surfaceKeySet(a);
    for (let j = i + 1; j < locals.length; j++) {
      const b = locals[j];
      const kb = nameKeyEntity(b.name);
      if (!kb || ka === kb) continue;
      const ub = unitOf(b);
      const dist = Math.abs(ua - ub);
      if (dist > D) continue;

      const setB = surfaceKeySet(b);
      const reasons: string[] = [];
      if (dist === 0) reasons.push("同窗分列(不同name行)");
      else reasons.push(`近距Δunit=${dist}(≤${D})`);

      // One name appears in the other's local aliases / surfaces
      if (setA.has(kb)) reasons.push(`A侧表面含B名「${b.name}」`);
      if (setB.has(ka)) reasons.push(`B侧表面含A名「${a.name}」`);
      // Shared non-name surface (e.g. both claim 周总)
      for (const s of setA) {
        if (s === ka || s === kb) continue;
        if (setB.has(s)) {
          reasons.push(`共享表面「${s}」`);
          break;
        }
      }
      // Relation label ↔ other form: must lookup anchors and attach to real person
      if (isUnanchoredRelationLabel(a.name) || isUnanchoredRelationLabel(b.name)) {
        reasons.push("关系称谓须查锚点挂回真人");
      }

      const pairKey = ka < kb ? `${ka}||${kb}` : `${kb}||${ka}`;
      const ordered =
        ka <= kb
          ? { nameA: a.name.trim(), nameB: b.name.trim(), unitA: ua, unitB: ub, unitLabelA: a.unitLabel, unitLabelB: b.unitLabel, aliasesA: a.aliases || [], aliasesB: b.aliases || [] }
          : { nameA: b.name.trim(), nameB: a.name.trim(), unitA: ub, unitB: ua, unitLabelA: b.unitLabel, unitLabelB: a.unitLabel, aliasesA: b.aliases || [], aliasesB: a.aliases || [] };

      const prev = byPair.get(pairKey);
      if (!prev) {
        byPair.set(pairKey, {
          ...ordered,
          dist,
          reasons: Array.from(new Set(reasons)),
        });
        continue;
      }
      // Keep closest occurrence; union reasons
      if (dist < prev.dist) {
        byPair.set(pairKey, {
          ...ordered,
          dist,
          reasons: Array.from(new Set([...prev.reasons, ...reasons])),
        });
      } else {
        prev.reasons = Array.from(new Set([...prev.reasons, ...reasons]));
      }
    }
  }

  const scored = Array.from(byPair.values()).map((c) => {
    let score = 0;
    if (c.dist === 0) score += 100;
    else score += Math.max(0, 50 - c.dist * 5);
    if (c.reasons.some((r) => r.includes("表面含"))) score += 40;
    if (c.reasons.some((r) => r.includes("共享表面"))) score += 50;
    if (c.reasons.some((r) => r.includes("关系称谓"))) score += 60;
    return { c, score };
  });
  scored.sort(
    (x, y) =>
      y.score - x.score ||
      x.c.dist - y.c.dist ||
      x.c.nameA.localeCompare(y.c.nameA, "zh"),
  );
  return scored.slice(0, limit).map((x) => x.c);
}

export function formatNearCrossNameCandidatesForPrompt(
  items: NearCrossNameCandidate[],
  opts?: { maxUnitDistance?: number },
): string {
  const D = opts?.maxUnitDistance ?? DEFAULT_SAME_NAME_UNIT_DISTANCE;
  if (!items.length) {
    return (
      `【近距异名候选】unit 间距≤${D} 的不同 name 对：0。` +
      `（同名近距已由程序合并；若仍有异名同一人，请 list_local_entities + lookup 自行发现。）`
    );
  }
  const lines = items.map((c, i) => {
    const alA = c.aliasesA.length ? ` aliases=[${c.aliasesA.join("、")}]` : "";
    const alB = c.aliasesB.length ? ` aliases=[${c.aliasesB.join("、")}]` : "";
    const uA = c.unitLabelA ? `${c.unitLabelA}/u@${c.unitA}` : `u@${c.unitA}`;
    const uB = c.unitLabelB ? `${c.unitLabelB}/u@${c.unitB}` : `u@${c.unitB}`;
    return (
      `${i + 1}. 「${c.nameA}」${alA} @${uA}  ↔  「${c.nameB}」${alB} @${uB}` +
      ` · ${c.reasons.join("；")}` +
      ` → lookup 两窗后：若同一人则 merge keep=真名 absorb=另一称呼（称谓进 aliases）`
    );
  });
  return (
    `【近距异名候选 · 须仔细判定是否 aliases/同一人】unit 间距≤${D}，共 ${items.length} 对。` +
    `关系称谓（女朋友/大儿子等）须 lookup 锚点后 merge 进已有真名，禁止 keep=关系称谓。\n` +
    lines.join("\n")
  );
}
