/**
 * Stage ②: merge per-window local entities via overlap criterion A.
 *
 * Adjacent windows Wi, Wi+1 with overlap text O:
 *   e ∈ Wi, f ∈ Wi+1 are the same person iff
 *   S(e) ∩ S(f) ≠ ∅ and some common mention u appears as substring of O.
 *
 * Then union-find across the chain → one ResolvedEntity per person.
 *
 * Mentions = canonical name + aliases (product term; not legacy "surface").
 */

import type { TextUnit } from "./character-name-units";
import { overlapTextBetweenUnits } from "./character-name-units";
import type { UnitNameHit } from "./character-name-aggregate";
import type { ResolvedEntity } from "./character-entity-types";
import { nameKeyEntity } from "./character-entity-types";
import { preferRealName } from "./character-name-consolidate";
import { mergeAnchors, unitAnchor, type MentionAnchor } from "./mention-anchor";

function norm(s: string): string {
  return nameKeyEntity(s);
}

/** Mention set S(e) = {canonical} ∪ aliases */
export function mentionSetOf(
  name: string,
  aliases?: string[] | null,
): Set<string> {
  const s = new Set<string>();
  const n = norm(name);
  if (n) s.add(n);
  for (const a of aliases || []) {
    const k = norm(a);
    if (k) s.add(k);
  }
  return s;
}

/**
 * Criterion A: shared mention string appears in overlap text.
 */
export function criterionASharedMentionInOverlap(
  nameA: string,
  aliasesA: string[] | undefined,
  nameB: string,
  aliasesB: string[] | undefined,
  overlapText: string,
): { ok: boolean; shared?: string } {
  if (!overlapText) return { ok: false };
  const sa = mentionSetOf(nameA, aliasesA);
  const sb = mentionSetOf(nameB, aliasesB);
  const o = overlapText; // raw; substring check uses norm-free literal
  // Prefer longer shared mentions first (avoid 的 matching noise)
  const shared: string[] = [];
  for (const u of sa) {
    if (sb.has(u)) shared.push(u);
  }
  shared.sort((a, b) => b.length - a.length || a.localeCompare(b, "zh"));
  for (const u of shared) {
    if (u.length < 2) continue;
    if (o.includes(u)) return { ok: true, shared: u };
  }
  return { ok: false };
}

interface LocalNode {
  id: number;
  unitIndex: number;
  name: string;
  aliases: string[];
  anchors?: MentionAnchor[];
}

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

/**
 * Build local nodes from unit hits (one node per in-window person row).
 */
export function localNodesFromUnitHits(
  units: TextUnit[],
  unitHits: UnitNameHit[][],
): LocalNode[] {
  const nodes: LocalNode[] = [];
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
      const id = nodes.length;
      nodes.push({
        id,
        unitIndex: ui,
        name,
        aliases,
        anchors: unit ? [unitAnchor(unit, ui, name)] : undefined,
      });
    }
  }
  return nodes;
}

/**
 * Stage ② main entry: overlap criterion A + union-find → ResolvedEntity[].
 */
export function mergeLocalEntitiesByOverlap(
  units: TextUnit[],
  unitHits: UnitNameHit[][],
  fullText: string,
): ResolvedEntity[] {
  const nodes = localNodesFromUnitHits(units, unitHits);
  if (!nodes.length) return [];

  const uf = new UnionFind(nodes.length);
  // Index nodes by unit
  const byUnit = new Map<number, LocalNode[]>();
  for (const n of nodes) {
    const list = byUnit.get(n.unitIndex) || [];
    list.push(n);
    byUnit.set(n.unitIndex, list);
  }

  for (let i = 0; i < units.length - 1; i++) {
    const left = byUnit.get(i) || [];
    const right = byUnit.get(i + 1) || [];
    if (!left.length || !right.length) continue;
    const O = overlapTextBetweenUnits(fullText, units[i], units[i + 1]);
    if (!O) continue;
    for (const e of left) {
      for (const f of right) {
        const { ok } = criterionASharedMentionInOverlap(
          e.name,
          e.aliases,
          f.name,
          f.aliases,
          O,
        );
        if (ok) uf.union(e.id, f.id);
      }
    }
  }

  // Also union same-window duplicates with identical mention sets (safety)
  for (const list of byUnit.values()) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const sa = mentionSetOf(list[a].name, list[a].aliases);
        const sb = mentionSetOf(list[b].name, list[b].aliases);
        let same = sa.size === sb.size;
        if (same) {
          for (const x of sa) {
            if (!sb.has(x)) {
              same = false;
              break;
            }
          }
        }
        if (same) uf.union(list[a].id, list[b].id);
      }
    }
  }

  const groups = new Map<number, LocalNode[]>();
  for (const n of nodes) {
    const r = uf.find(n.id);
    const g = groups.get(r) || [];
    g.push(n);
    groups.set(r, g);
  }

  const out: ResolvedEntity[] = [];
  for (const group of groups.values()) {
    out.push(mergeNodeGroup(group));
  }
  // Stable order: first appearance unit, then name
  out.sort((a, b) => {
    const ua = a.anchors?.[0]?.unitIndex ?? 0;
    const ub = b.anchors?.[0]?.unitIndex ?? 0;
    return ua - ub || (a.name || "").localeCompare(b.name || "", "zh");
  });
  return out;
}

function mergeNodeGroup(group: LocalNode[]): ResolvedEntity {
  const surfaces = new Set<string>();
  let anchors: MentionAnchor[] | undefined;
  let name = group[0].name;
  for (const n of group) {
    surfaces.add(n.name);
    for (const a of n.aliases) surfaces.add(a);
    anchors = mergeAnchors(anchors, n.anchors);
    name = preferRealName(name, n.name);
  }
  for (const s of surfaces) {
    name = preferRealName(name, s);
  }
  const nk = norm(name);
  const aliases = Array.from(surfaces).filter((s) => norm(s) !== nk);
  return {
    name: name.trim(),
    aliases,
    surfaces: Array.from(new Set([name, ...aliases])),
    anchors: anchors?.length ? anchors : undefined,
    role: "supporting",
  };
}
