/**
 * Post-process character list: merge split surfaces and orient name vs aliases.
 *
 * Policy for `name` among one person's surfaces (no hard-coded title lexicon):
 * - If a clearly more name-like form exists (soft structural score) → use it
 * - Otherwise pick the best-scoring form; other labels stay aliases
 *
 * Safety: only merge on name↔name string relatedness. Cross-character alias
 * pollution is stripped by sanitizeAliasesAgainstRoster.
 */

import { isInvalidUnitPrimaryName } from "./character-entity-types";

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

/**
 * Soft structural score only — no title/role/kinship vocabulary lists.
 * Lower = more like a compact personal name; higher = more like a long label.
 * Policy: if a clearly more name-like surface exists, pick it; else lowest score wins.
 */
export function titleLikenessScore(s: string): number {
  const x = norm(s);
  if (!x) return 99;
  let score = 0;
  // Compact 2–3 forms often personal names; longer often titles/phrases
  if (x.length <= 1) score += 4;
  else if (x.length === 2 || x.length === 3) score -= 3;
  else if (x.length === 4) score -= 1;
  else score += Math.min(6, x.length - 4);
  // Relational compound shape "A的B" (structure only, no kinship lexicon)
  if (x.includes("的")) score += 5;
  if (/[\s·•]/.test(String(s || ""))) score += 2;
  return score;
}

function isSuspendedPrimaryLabel(s: string): boolean {
  return isInvalidUnitPrimaryName(s);
}

/**
 * Prefer the more name-like surface among two labels of the same person.
 * - Never promote suspended deictics (女朋友/弟弟/他爸) over a solid label
 * - Else soft structural score / containment
 */
export function preferRealName(a: string, b: string): string {
  const x = a.trim();
  const y = b.trim();
  const nx = norm(x);
  const ny = norm(y);
  if (!nx) return y;
  if (!ny) return x;

  // Hard rule: solid entity label always beats suspended relation/deictic
  const xSus = isSuspendedPrimaryLabel(x);
  const ySus = isSuspendedPrimaryLabel(y);
  if (xSus && !ySus) return y;
  if (ySus && !xSus) return x;

  const sx = titleLikenessScore(nx);
  const sy = titleLikenessScore(ny);
  if (sx !== sy) return sx < sy ? x : y;

  if (nx.length !== ny.length) {
    const longer = nx.length > ny.length ? x : y;
    const shorter = nx.length > ny.length ? y : x;
    const L = norm(longer);
    const S = norm(shorter);
    if (L.endsWith(S) || L.startsWith(S)) {
      if (titleLikenessScore(L) > titleLikenessScore(S) + 2) return shorter;
      return longer;
    }
  }

  if (nx.length !== ny.length && Math.abs(nx.length - ny.length) <= 2) {
    const mid = (n: string) =>
      n.length >= 2 && n.length <= 4 ? Math.abs(3 - n.length) : 9;
    if (mid(nx) !== mid(ny)) return mid(nx) < mid(ny) ? x : y;
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
 * Within one character: pick `name` among surfaces.
 * Suspended deictics never win when any solid surface exists
 * (fixes both submit normalize and post-gate consolidate).
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

  // Prefer any solid label over suspended deictic first
  const solid = surfaces.filter((s) => s && !isSuspendedPrimaryLabel(s));
  if (solid.length) {
    canonical = solid[0];
    for (const s of solid) {
      if (norm(s) === norm(canonical)) continue;
      canonical = preferRealName(canonical, s);
    }
  } else {
    // Only suspended labels — soft pick among them (still bad; caller may drop)
    for (const s of surfaces) {
      if (!s || norm(s) === norm(canonical)) continue;
      canonical = preferRealName(canonical, s);
    }
  }

  // Frequency tie-break only among solid surfaces (never promote suspended via freq)
  if (counts && solid.length) {
    let best = canonical;
    let bestCount = countOf(canonical, counts);
    const baseTitle = titleLikenessScore(canonical);
    for (const s of solid) {
      if (norm(s) === norm(best)) continue;
      if (titleLikenessScore(s) > baseTitle) continue;
      const n = countOf(s, counts);
      if (
        titleLikenessScore(s) <= baseTitle &&
        (n > bestCount * 1.2 || n >= bestCount + 3)
      ) {
        best = preferRealName(best, s);
        bestCount = Math.max(bestCount, n);
      }
    }
    if (!isSuspendedPrimaryLabel(best)) canonical = preferRealName(canonical, best);
  }

  // Final guard
  if (isSuspendedPrimaryLabel(canonical)) {
    const alt = surfaces.find((s) => s && !isSuspendedPrimaryLabel(s));
    if (alt) canonical = alt;
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
