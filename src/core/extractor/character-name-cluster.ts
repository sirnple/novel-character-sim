/**
 * Soft-cluster name surfaces before cluster-level frequency gate (spec scheme C).
 * Conservative: prefer missing a merge over merging two people.
 */

import type { NameAggregate } from "./character-name-aggregate";

export interface NameCluster {
  /** Longest surface as provisional canonical */
  canonical: string;
  surfaces: string[];
  aliases: string[];
  /** Sum of surface mentions (presence counts) */
  mentions: number;
  /** Union of unit indices where any surface appeared */
  unitHits: number;
  firstUnit: number;
  lastUnit: number;
}

function normalize(s: string): string {
  return (s || "").replace(/\s+/g, "").trim();
}

/** Common Chinese surnames (1-char) — enough for soft merge heuristics */
const SURNAME_1 = new Set(
  "赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛范彭郎鲁韦昌马苗凤花方俞任袁柳唐罗毕郝安常乐于时傅皮齐康伍余元卜顾孟平黄和穆萧尹姚邵汪祁毛禹狄米贝明戴谈宋茅庞熊纪舒项祝董梁杜阮蓝闵席季贾路江童颜郭梅盛林钟徐邱骆高夏蔡田樊胡凌霍虞万柯管卢莫房丁邓郁单洪包诸左石崔龚程邢陆荣翁荀羊甄封储井段巫乌焦车侯班秋仲伊宫宁仇甘祖武符刘景詹龙叶司韶黎薄白蒲从鄂索咸籍赖卓蔺屠蒙池乔阴翟谭贡劳逄姬申冉桑桂牛寿通边燕浦尚农温庄晏柴阎连习宦鱼容向古易戈廖庾居衡步都耿满弘匡国文寇欧利蔚越隆聂晁勾融冷辛简饶空曾沙鞠丰巢关蒯查荆红游权盖晋楚闫岳帅缑有琴商牟佘伯赏墨哈年爱阳佟洛叶甘武".split(
    "",
  ),
);

function hasSurname(name: string): boolean {
  return name.length >= 2 && SURNAME_1.has(name[0]);
}

function relatedSurfaces(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 2 || b.length < 2) return false;
  // One is suffix of the other (雪棠 ⊂ 洛雪棠)
  if (a.length !== b.length) {
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;
    if (longer.endsWith(shorter) && shorter.length >= 2) {
      // Prefer when longer has surname or shorter is 2–3 given-name-ish
      if (hasSurname(longer) || shorter.length <= 3) return true;
    }
    if (longer.startsWith(shorter) && hasSurname(shorter) && longer.length <= shorter.length + 2) {
      return true;
    }
  }
  return false;
}

/**
 * Cluster surface aggregates using alias edges + conservative string relatedness.
 * unitIndexSets optional: map surface → set of unit indices for union unitHits.
 */
export function softClusterAggregates(
  surfaces: NameAggregate[],
  unitIndexBySurface?: Map<string, Set<number>>,
): NameCluster[] {
  if (!surfaces.length) return [];

  const byName = new Map(surfaces.map((s) => [s.name, s]));
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let p = parent.get(x) || x;
    while ((parent.get(p) || p) !== p) p = parent.get(p)!;
    parent.set(x, p);
    return p;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    // Prefer longer name as root
    if (ra.length >= rb.length) parent.set(rb, ra);
    else parent.set(ra, rb);
  };

  for (const s of surfaces) {
    parent.set(s.name, s.name);
  }

  // Alias edges from unit extract
  for (const s of surfaces) {
    for (const al of s.aliases) {
      const a = normalize(al);
      if (!a || a === s.name) continue;
      if (byName.has(a)) union(s.name, a);
      // even if alias not its own aggregate, attach later as alias string
    }
  }

  // Pairwise relatedness among top surfaces (cap O(n²) work)
  const names = surfaces.map((s) => s.name);
  const n = names.length;
  const limit = Math.min(n, 400);
  for (let i = 0; i < limit; i++) {
    for (let j = i + 1; j < limit; j++) {
      if (relatedSurfaces(names[i], names[j])) {
        union(names[i], names[j]);
      }
    }
  }

  const groups = new Map<string, string[]>();
  for (const name of names) {
    const r = find(name);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(name);
  }

  const clusters: NameCluster[] = [];
  for (const [, members] of Array.from(groups.entries())) {
    members.sort((a, b) => b.length - a.length || a.localeCompare(b));
    const canonical = members[0];
    let mentions = 0;
    let firstUnit = Number.MAX_SAFE_INTEGER;
    let lastUnit = 0;
    const aliases = new Set<string>();
    const units = new Set<number>();

    for (const m of members) {
      const agg = byName.get(m)!;
      mentions += agg.mentions;
      firstUnit = Math.min(firstUnit, agg.firstUnit);
      lastUnit = Math.max(lastUnit, agg.lastUnit);
      for (const al of agg.aliases) aliases.add(al);
      for (const o of members) if (o !== canonical) aliases.add(o);

      const uiset = unitIndexBySurface?.get(m);
      if (uiset) {
        for (const u of Array.from(uiset)) units.add(u);
      } else {
        // fallback: approximate from unitHits by treating as dense — use span only
        for (let u = agg.firstUnit; u <= agg.lastUnit && u < agg.firstUnit + agg.unitHits; u++) {
          units.add(u);
        }
      }
    }

    // Better unitHits: if we tracked per-surface unit sets use union size; else max unitHits
    let unitHits = units.size;
    if (!unitIndexBySurface || unitHits === 0) {
      unitHits = Math.max(...members.map((m) => byName.get(m)!.unitHits));
      // if multiple members, estimate union ≥ max, ≤ sum
      if (members.length > 1) {
        const sum = members.reduce((s, m) => s + byName.get(m)!.unitHits, 0);
        unitHits = Math.min(sum, Math.max(unitHits, Math.ceil(sum * 0.7)));
      }
    }

    clusters.push({
      canonical,
      surfaces: members,
      aliases: Array.from(aliases).filter((a) => a !== canonical),
      mentions,
      unitHits,
      firstUnit: firstUnit === Number.MAX_SAFE_INTEGER ? 0 : firstUnit,
      lastUnit,
    });
  }

  clusters.sort((a, b) => b.mentions - a.mentions || b.unitHits - a.unitHits);
  return clusters;
}

export function clusterToAggregateShape(c: NameCluster): NameAggregate {
  return {
    name: c.canonical,
    mentions: c.mentions,
    unitHits: c.unitHits,
    aliases: c.aliases,
    firstUnit: c.firstUnit,
    lastUnit: c.lastUnit,
  };
}
