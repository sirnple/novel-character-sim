/**
 * Post-process character list: merge split surfaces and orient name vs aliases.
 *
 * name    = 真实姓名 (e.g. 孙悟空, 猪八戒)
 * aliases = 封号/外号/法号/绰号 (e.g. 齐天大圣, 美猴王, 天蓬元帅) — never another person
 *         · 仅第三人称稳定指称；剔除 我爸/你妈 等第一二人称指示语
 *
 * Safety: only merge on name↔name string relatedness. Cross-character alias
 * pollution is stripped by sanitizeAliasesAgainstRoster.
 */



export interface ConsolidatableCharacter {
  name: string;
  aliases?: string[];
  role?: string;
  briefDescription?: string;
}

export interface ConsolidateOptions {
  /**
   * Surface mention counts. Used as a weak tie-break among real-name-like
   * surfaces only — never to promote a pure title over a true name.
   */
  surfaceCounts?: Map<string, number> | Record<string, number>;
}

function norm(s: string): string {
  return (s || "").replace(/\s+/g, "").trim();
}

function countOf(
  surface: string,
  counts?: Map<string, number> | Record<string, number>,
): number {
  if (!counts) return 0;
  const k = norm(surface);
  if (counts instanceof Map) return counts.get(k) ?? 0;
  return counts[k] ?? 0;
}

/** Common title / epithet markers — high score = more like 封号 not 真名 */
const TITLE_MARKERS =
  /女王|女帝|女皇|魔王|魔帝|魔尊|魔神|圣女|圣子|圣主|宗主|掌门|城主|盟主|教主|岛主|剑圣|剑神|战神|战圣|杀神|死神|帝君|天尊|至尊|殿下|陛下|阁下|公子|小姐|夫人|大侠|少侠|魔头|妖王|妖帝|龙王|虎王|狼王|巨熊|血魔|修罗|阎罗|判官|阁主|帮主|舵主|元帅|将军|元君|真人|上人|仙尊|仙帝/;

const SURNAME_1 = new Set(
  "赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛范彭郎鲁韦昌马苗凤花方俞任袁柳唐罗毕郝安常乐于时傅皮齐康伍余元卜顾孟平黄和穆萧尹姚邵汪祁毛禹狄米贝明戴谈宋茅庞熊纪舒项祝董梁杜阮蓝闵席季贾路江童颜郭梅盛林钟徐邱骆高夏蔡田樊胡凌霍虞万柯管卢莫房丁邓郁单洪包诸左石崔龚程邢陆荣翁荀羊甄封储井段巫乌焦车侯班秋仲伊宫宁仇甘祖武符刘景詹龙叶司韶黎薄白蒲从鄂索咸籍赖卓蔺屠蒙池乔阴翟谭贡劳逄姬申冉桑桂牛寿通边燕浦尚农温庄晏柴阎连习宦鱼容向古易戈廖庾居衡步都耿满弘匡国文寇欧利蔚越隆聂晁勾融冷辛简饶空曾沙鞠丰巢关蒯查荆红游权盖晋楚闫岳帅缑有琴商牟佘伯赏墨哈年爱阳佟洛叶甘武".split(
    "",
  ),
);

/** One surface is a short form of the other (prefix/suffix containment). */
export function isNameSurfaceOf(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y || x === y) return false;
  if (x.length < 2 || y.length < 2) return false;
  const longer = x.length >= y.length ? x : y;
  const shorter = x.length >= y.length ? y : x;
  if (shorter.length < 2) return false;
  // 悟空 ⊂ 孙悟空；八戒 ⊂ 猪八戒
  if (longer.endsWith(shorter)) return true;
  if (longer.startsWith(shorter) && longer.length - shorter.length <= 3) {
    return true;
  }
  if (longer.includes(shorter) && shorter.length >= 3) {
    return (
      longer.startsWith(shorter) ||
      longer.endsWith(shorter) ||
      shorter.length >= 3
    );
  }
  return false;
}

/** Higher = more likely a title/epithet, lower = more likely a real personal name. */
export function titleLikenessScore(s: string): number {
  const x = norm(s);
  if (!x) return 99;
  let score = 0;
  if (TITLE_MARKERS.test(x)) score += 8;
  // Pure title-ish length with marker already heavy; bare 2-char with 王/帝 etc.
  if (/^[一-鿿]{2,6}(王|帝|尊|圣|主|后)$/.test(x)) score += 4;
  // Has CJK surname + 1–2 given → real name pattern
  if (x.length >= 2 && x.length <= 4 && SURNAME_1.has(x[0])) score -= 5;
  // Short personal-looking 2–4 CJK without title markers
  if (/^[一-鿿]{2,4}$/.test(x) && !TITLE_MARKERS.test(x)) {
    score -= 2;
  }
  // Long epithet-like form without surname
  if (x.length >= 4 && !SURNAME_1.has(x[0]) && TITLE_MARKERS.test(x)) {
    score += 3;
  }
  return score;
}

/**
 * Prefer real personal name over title/epithet.
 * - 孙悟空 beats 齐天大圣 / 美猴王
 * - 孙悟空 beats 悟空 when longer is surname+name
 * - 猪八戒 beats 天蓬元帅
 */
export function preferRealName(a: string, b: string): string {
  const x = a.trim();
  const y = b.trim();
  const nx = norm(x);
  const ny = norm(y);
  if (!nx) return y;
  if (!ny) return x;

  const sx = titleLikenessScore(nx);
  const sy = titleLikenessScore(ny);
  if (sx !== sy) return sx < sy ? x : y;

  // Containment: longer ends with shorter
  if (nx.length !== ny.length) {
    const longer = nx.length > ny.length ? x : y;
    const shorter = nx.length > ny.length ? y : x;
    const L = norm(longer);
    const S = norm(shorter);
    if (L.endsWith(S)) {
      // Surname+given (孙悟空) vs given (悟空) → full real name
      if (SURNAME_1.has(L[0]) && L.length <= S.length + 2) return longer;
      // Title-like longer form → prefer shorter personal name if shorter is cleaner
      if (titleLikenessScore(L) > titleLikenessScore(S)) return shorter;
      return longer;
    }
  }

  // Tie: prefer form with surname and 2–4 chars
  const cjkName = (s: string) => {
    const n = norm(s);
    return n.length >= 2 && n.length <= 4 && SURNAME_1.has(n[0]) ? 1 : 0;
  };
  if (cjkName(x) !== cjkName(y)) return cjkName(x) > cjkName(y) ? x : y;

  // Prefer slightly longer among equally personal (孙悟空 vs 悟空 already handled)
  if (nx.length !== ny.length && Math.abs(nx.length - ny.length) <= 2) {
    return nx.length > ny.length ? x : y;
  }
  return nx.localeCompare(ny, "zh") <= 0 ? x : y;
}

/** @deprecated alias of preferRealName */
export function preferCanonicalName(a: string, b: string): string {
  return preferRealName(a, b);
}

/** @deprecated alias of preferRealName */
export function preferEpithetForm(a: string, b: string): string {
  return preferRealName(a, b);
}

/**
 * Within one character: real name in `name`, titles/nicknames in aliases.
 */
export function orientNameAndAliases<T extends ConsolidatableCharacter>(
  c: T,
  counts?: Map<string, number> | Record<string, number>,
): T {
  const name = (c.name || "").trim();
  const aliases = Array.from(
    new Set((c.aliases || []).map((a) => a.trim()).filter(Boolean)),
  );
  if (!name) return c;

  const surfaces = [name, ...aliases];
  let canonical = name;

  for (const s of surfaces) {
    if (norm(s) === norm(canonical)) continue;
    // Always prefer more real-name-like surface
    if (
      titleLikenessScore(s) < titleLikenessScore(canonical) ||
      isNameSurfaceOf(canonical, s) ||
      isNameSurfaceOf(s, canonical)
    ) {
      canonical = preferRealName(canonical, s);
    }
  }

  // Weak frequency tie-break only among equally real-name-like surfaces
  if (counts) {
    let best = canonical;
    let bestCount = countOf(canonical, counts);
    const baseTitle = titleLikenessScore(canonical);
    for (const s of surfaces) {
      if (norm(s) === norm(best)) continue;
      // Never promote a much more title-like form via frequency
      if (titleLikenessScore(s) > baseTitle + 1) continue;
      const n = countOf(s, counts);
      if (
        titleLikenessScore(s) <= baseTitle &&
        (n > bestCount * 1.2 || n >= bestCount + 3)
      ) {
        best = preferRealName(best, s);
        bestCount = Math.max(bestCount, n);
      }
    }
    canonical = preferRealName(canonical, best);
  }

  const rest = surfaces
    .filter((s) => norm(s) !== norm(canonical))
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    ...c,
    name: canonical.trim(),
    aliases: Array.from(new Set(rest)),
  };
}

function roleRank(role?: string): number {
  const r = (role || "").toLowerCase();
  if (r === "protagonist" || r.includes("主角")) return 0;
  if (r === "antagonist" || r.includes("反")) return 1;
  if (r === "supporting" || r.includes("配")) return 2;
  return 3;
}

/** Names alone are the same person (safe merge signal). */
function namesSamePerson(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return isNameSurfaceOf(x, y);
}

/**
 * Merge characters that are clearly the same surface family
 * (short name vs elongated name). Does NOT merge 孙悟空 / 齐天大圣
 * unless the LLM already put them on one row — string merge can't know.
 */
export function consolidateRawCharacters<T extends ConsolidatableCharacter>(
  chars: T[],
  opts?: ConsolidateOptions,
): T[] {
  if (!chars?.length) return [];

  const counts = opts?.surfaceCounts;

  const items = chars
    .map((c) =>
      orientNameAndAliases(
        {
          ...c,
          name: (c.name || "").trim(),
          aliases: Array.from(
            new Set((c.aliases || []).map((a) => a.trim()).filter(Boolean)),
          ),
        } as T,
        counts,
      ),
    )
    .filter((c) => c.name.length >= 1);

  const parent = new Map<number, number>();
  const find = (i: number): number => {
    let p = parent.get(i) ?? i;
    while ((parent.get(p) ?? p) !== p) p = parent.get(p)!;
    parent.set(i, p);
    return p;
  };
  const union = (i: number, j: number) => {
    const ri = find(i);
    const rj = find(j);
    if (ri === rj) return;
    parent.set(rj, ri);
  };

  for (let i = 0; i < items.length; i++) parent.set(i, i);

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (namesSamePerson(items[i].name, items[j].name)) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < items.length; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(i);
  }

  const out: T[] = [];
  for (const idxs of Array.from(groups.values())) {
    const members = idxs.map((i) => items[i]);
    members.sort(
      (a, b) =>
        roleRank(a.role) - roleRank(b.role) ||
        (b.briefDescription?.length || 0) - (a.briefDescription?.length || 0),
    );
    const primary = members[0];
    const allSurfaces = new Set<string>();
    for (const m of members) {
      allSurfaces.add(m.name);
      for (const al of m.aliases || []) allSurfaces.add(al);
    }

    const synthetic = orientNameAndAliases(
      {
        ...primary,
        name: primary.name,
        aliases: Array.from(allSurfaces).filter(
          (s) => norm(s) !== norm(primary.name),
        ),
      } as T,
      counts,
    );

    let canonical = synthetic.name;
    for (const s of Array.from(allSurfaces)) {
      canonical = preferRealName(canonical, s);
    }
    // Final orient pass for frequency among real-name candidates
    const final = orientNameAndAliases(
      {
        ...synthetic,
        name: canonical,
        aliases: Array.from(allSurfaces).filter(
          (s) => norm(s) !== norm(canonical),
        ),
      } as T,
      counts,
    );

    out.push({
      ...primary,
      name: final.name.trim(),
      aliases: final.aliases || [],
      briefDescription:
        members.map((m) => m.briefDescription || "").find((d) => d.length > 0) ||
        primary.briefDescription ||
        "",
    } as T);
  }

  return sanitizeAliasesAgainstRoster(out);
}

/**
 * Remove aliases that clearly belong to another listed character.
 */
export function sanitizeAliasesAgainstRoster<T extends ConsolidatableCharacter>(
  chars: T[],
): T[] {
  if (!chars?.length) return [];

  const names = chars.map((c) => ({
    name: c.name,
    n: norm(c.name),
  }));

  return chars.map((c) => {
    const self = norm(c.name);
    const cleaned = (c.aliases || []).filter((al) => {
      const a = norm(al);
      if (!a || a === self) return false;
      for (const other of names) {
        if (other.n === self) continue;
        if (a === other.n) return false;
        if (isNameSurfaceOf(a, other.n)) return false;
      }
      return true;
    });
    return { ...c, aliases: Array.from(new Set(cleaned)) };
  });
}

/** Build surface count map from frequency aggregates/clusters */
export function surfaceCountsFromRoster(
  rows: { name: string; aliases?: string[]; mentions?: number }[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const n = Math.max(1, r.mentions ?? 1);
    const key = norm(r.name);
    if (key) m.set(key, Math.max(m.get(key) ?? 0, n));
    for (const al of r.aliases || []) {
      const ak = norm(al);
      if (ak) m.set(ak, Math.max(m.get(ak) ?? 0, Math.ceil(n * 0.5)));
    }
  }
  return m;
}
