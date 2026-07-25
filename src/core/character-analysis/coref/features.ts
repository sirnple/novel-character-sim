import type { MergedCharacter } from "../merge-adjacent";
import { normalizeMentionSurface } from "../merge-adjacent";
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

/** Generic pronouns / deictics — noisy for coref when a real name also exists. */
const DEICTIC_PRONOUNS = new Set([
  "我",
  "你",
  "您",
  "他",
  "她",
  "它",
  "咱",
  "俺",
  "本人",
  "自己",
  "大家",
  "别人",
  "人家",
  "咱们",
  "我们",
  "你们",
  "他们",
  "她们",
  "它们",
]);

export function isDeicticPronounSurface(surface: string): boolean {
  const s = normalizeMentionSurface(surface);
  if (!s) return false;
  if (DEICTIC_PRONOUNS.has(s)) return true;
  // bare 们 suffix forms already covered; single-char only beyond set
  return false;
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

function isStrongSurface(s: string): boolean {
  // multi-char or Latin word — weak singles like 我/他/她 handled separately
  if (s.length >= 2) return true;
  return /^[A-Za-z]{2,}$/.test(s);
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
  const sharedStrongSurfaces = sharedSurfaces.filter(isStrongSurface);
  const setShared = new Set(sharedSurfaces);
  const exclusiveStrongA = surfacesA.filter(
    (s) => isStrongSurface(s) && !setShared.has(s),
  );
  const exclusiveStrongB = surfacesB.filter(
    (s) => isStrongSurface(s) && !setShared.has(s),
  );

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
      })
    : null;

  return {
    idA: a.id,
    idB: b.id,
    surfacesA,
    surfacesB,
    sharedSurfaces,
    sharedStrongSurfaces,
    exclusiveStrongA,
    exclusiveStrongB,
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
