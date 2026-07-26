import type { MergedCharacter } from "../merge-adjacent";
import { normalizeMentionSurface } from "../merge-adjacent";
import {
  isDeicticKind,
  isIdentityStrongKind,
  isProperKind,
  kindOfSurfaceOnCharacter,
  preferMentionKind,
  resolveMentionKind,
  type MentionKind,
} from "../mention-kind";
import {
  pairCooccurMetrics,
  type CooccurGraph,
} from "./cooccur-graph";
import type { PairFeatures, Stage3CorefConfig } from "./types";

const GENDER_MALE = /^(男|男性|公|雄|先生|男孩|少年|男人|男子)/;
const GENDER_FEMALE = /^(女|女性|母|雌|小姐|女士|女孩|少女|女人|女子)/;

export function normalizeGender(g?: string): "男" | "女" | "未知" {
  const t = (g || "").trim();
  if (!t || t === "未知") return "未知";
  if (GENDER_MALE.test(t)) return "男";
  if (GENDER_FEMALE.test(t)) return "女";
  if (t.includes("男")) return "男";
  if (t.includes("女")) return "女";
  return "未知";
}

export function surfacesOf(c: MergedCharacter): string[] {
  const s = new Set<string>();
  for (const m of c.mentions || []) {
    const n = normalizeMentionSurface(m.surface);
    if (n) s.add(n);
  }
  return Array.from(s);
}

export function isDeicticPronounSurface(surface: string): boolean {
  const s = normalizeMentionSurface(surface);
  if (!s) return false;
  return isDeicticKind(resolveMentionKind(s));
}

/** Best kind for a surface on this character (mention tags + rule fallback). */
export function surfaceKindOn(
  c: MergedCharacter,
  surface: string,
): MentionKind {
  return kindOfSurfaceOnCharacter(c.mentions || [], surface);
}

/** Identity-strong surface: proper | personal_nick (not generic/title/…). */
export function isStrongSurfaceOn(
  c: MergedCharacter,
  surface: string,
): boolean {
  return isIdentityStrongKind(surfaceKindOn(c, surface));
}

export function isProperSurfaceOn(
  c: MergedCharacter,
  surface: string,
): boolean {
  return isProperKind(surfaceKindOn(c, surface));
}

/**
 * Kind of a surface for pair evidence: take the **weaker** identity kind
 * of the two sides (conservative — one side tagging 这小子 as nick does not
 * make it strong).
 */
export function sharedSurfaceKind(
  a: MergedCharacter,
  b: MergedCharacter,
  surface: string,
): MentionKind {
  const ka = surfaceKindOn(a, surface);
  const kb = surfaceKindOn(b, surface);
  // preferMentionKind picks stronger; invert by picking the other when ranks differ
  const strong = preferMentionKind(ka, kb);
  return strong === ka ? kb : ka;
}

/**
 * Surfaces used for coref matching.
 * If `stripDeicticWhenHasName` and the entity has any non-deictic surface,
 * drop 我/你/他/… so quoted speech does not glue names to the narrator.
 */
export function surfacesForCoref(
  c: MergedCharacter,
  stripDeicticWhenHasName: boolean,
): string[] {
  const all = surfacesOf(c);
  if (!stripDeicticWhenHasName) return all;
  const nonDeictic = all.filter((s) => !isDeicticPronounSurface(s));
  if (nonDeictic.length > 0) return nonDeictic;
  return all; // pure-pronoun entity (narrator 我) keeps deictics
}

/** Identity-strong surfaces only (proper | personal_nick). */
export function identityStrongSurfacesForCoref(
  c: MergedCharacter,
  stripDeicticWhenHasName: boolean,
): string[] {
  return surfacesForCoref(c, stripDeicticWhenHasName).filter((s) =>
    isStrongSurfaceOn(c, s),
  );
}

export function buildPairFeatures(
  a: MergedCharacter,
  b: MergedCharacter,
  config: Stage3CorefConfig,
  graph?: CooccurGraph | null,
): PairFeatures {
  const strip = config.stripDeicticWhenHasName !== false;
  const surfacesA = surfacesForCoref(a, strip);
  const surfacesB = surfacesForCoref(b, strip);
  const setB = new Set(surfacesB);
  const sharedSurfaces = surfacesA.filter((s) => setB.has(s));
  // Shared strong only if BOTH sides treat the surface as identity-strong
  const sharedStrongSurfaces = sharedSurfaces.filter(
    (s) => isStrongSurfaceOn(a, s) && isStrongSurfaceOn(b, s),
  );
  const setShared = new Set(sharedSurfaces);
  const exclusiveStrongA = surfacesA.filter(
    (s) => isStrongSurfaceOn(a, s) && !setShared.has(s),
  );
  const exclusiveStrongB = surfacesB.filter(
    (s) => isStrongSurfaceOn(b, s) && !setShared.has(s),
  );
  const exclusiveProperA = surfacesA.filter(
    (s) => isProperSurfaceOn(a, s) && !setShared.has(s),
  );
  const exclusiveProperB = surfacesB.filter(
    (s) => isProperSurfaceOn(b, s) && !setShared.has(s),
  );
  const sharedProperSurfaces = sharedSurfaces.filter(
    (s) => isProperSurfaceOn(a, s) && isProperSurfaceOn(b, s),
  );

  const sharedDeicticSurfaces: string[] = [];
  const sharedGenericSurfaces: string[] = [];
  const sharedKinshipSurfaces: string[] = [];
  const sharedTitleSurfaces: string[] = [];
  const sharedDescSurfaces: string[] = [];
  for (const s of sharedSurfaces) {
    if (sharedStrongSurfaces.includes(s)) continue;
    const k = sharedSurfaceKind(a, b, s);
    if (k === "deictic") sharedDeicticSurfaces.push(s);
    else if (k === "generic") sharedGenericSurfaces.push(s);
    else if (k === "kinship") sharedKinshipSurfaces.push(s);
    else if (k === "title") sharedTitleSurfaces.push(s);
    else if (k === "desc") sharedDescSurfaces.push(s);
    else if (k === "proper" || k === "personal_nick") {
      // one side strong one side weak — treat as weak generic-ish
      sharedGenericSurfaces.push(s);
    }
  }

  const gA = normalizeGender(a.gender);
  const gB = normalizeGender(b.gender);
  const genderConflict =
    (gA === "男" && gB === "女") || (gA === "女" && gB === "男");

  const windowGap = Math.max(
    0,
    Math.max(a.windowLo, b.windowLo) - Math.min(a.windowHi, b.windowHi) - 1,
  );

  const offsA = (a.mentions || [])
    .map((m) => m.offsetAnchor?.globalStart)
    .filter((x): x is number => typeof x === "number");
  const offsB = (b.mentions || [])
    .map((m) => m.offsetAnchor?.globalStart)
    .filter((x): x is number => typeof x === "number");

  let minMentionDistance: number | null = null;
  let closeMentionPairCount = 0;
  const W = config.cooccurWindowChars;
  if (offsA.length && offsB.length) {
    minMentionDistance = Number.POSITIVE_INFINITY;
    for (const x of offsA) {
      for (const y of offsB) {
        const d = Math.abs(x - y);
        if (d < minMentionDistance) minMentionDistance = d;
        if (d <= W) closeMentionPairCount++;
      }
    }
    if (!Number.isFinite(minMentionDistance)) minMentionDistance = null;
  }

  const co = graph
    ? pairCooccurMetrics(a.id, b.id, graph, {
        jaccardSparseMinCount: config.jaccardSparseMinCount,
        jaccardSparseDiscount: config.jaccardSparseDiscount,
        exclusivitySparseDiscount: config.exclusivitySparseDiscount,
      })
    : null;

  return {
    idA: a.id,
    idB: b.id,
    surfacesA,
    surfacesB,
    sharedSurfaces,
    sharedStrongSurfaces,
    sharedProperSurfaces,
    exclusiveStrongA,
    exclusiveStrongB,
    exclusiveProperA,
    exclusiveProperB,
    sharedDeicticSurfaces,
    sharedGenericSurfaces,
    sharedKinshipSurfaces,
    sharedTitleSurfaces,
    sharedDescSurfaces,
    genderA: a.gender,
    genderB: b.gender,
    ageA: a.age,
    ageB: b.age,
    genderConflict,
    windowLoA: a.windowLo,
    windowHiA: a.windowHi,
    windowLoB: b.windowLo,
    windowHiB: b.windowHi,
    windowGap,
    minMentionDistance,
    closeMentionPairCount,
    cooccurExclusivity: co?.exclusivity ?? 0,
    cooccurExclusivityRaw: co?.exclusivityRaw ?? 0,
    topExclusiveCompanion: co?.topExclusiveCompanion ?? null,
    cooccurJaccard: co?.jaccard ?? 0,
    cooccurJaccardRaw: co?.jaccardRaw ?? 0,
    cooccurSparse: co?.sparse ?? false,
    sameWindowCount: co?.sameWindowCount ?? 0,
    neverSameWindow: co?.neverSameWindow ?? true,
    appearCountA: co?.countA ?? 0,
    appearCountB: co?.countB ?? 0,
    sharedNeighborCount: co?.sharedNeighborCount ?? 0,
  };
}
