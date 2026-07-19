/**
 * Helpers for staging / merging character profiles in analysis workspace.
 */
import type { CharacterProfile } from "@/types";

export function nameKey(name: string): string {
  return String(name || "").replace(/\s+/g, "").trim();
}

function filledStr(s: unknown, min = 4): boolean {
  return typeof s === "string" && s.trim().length >= min;
}

function filledArr(a: unknown, minItems = 1): boolean {
  return Array.isArray(a) && a.filter((x) => String(x || "").trim()).length >= minItems;
}

/**
 * Count filled profile dimensions (0–7).
 * Roster stubs usually score 0–1 (brief only). Full detail should be ≥3.
 */
export function profileDetailScore(c: CharacterProfile | null | undefined): number {
  if (!c) return 0;
  let n = 0;
  if (filledStr(c.appearance?.summary, 6)) n++;
  if (
    filledStr(c.personality?.description, 6) ||
    filledArr(c.personality?.traits, 2) ||
    filledStr(c.personality?.decisionStyle, 2)
  ) {
    n++;
  }
  if (
    filledStr(c.drive?.goal, 2) ||
    filledStr(c.drive?.motivation, 2) ||
    filledStr(c.drive?.fear, 2)
  ) {
    n++;
  }
  if (
    filledArr(c.behavior?.patterns, 1) ||
    filledArr(c.behavior?.habits, 1) ||
    filledStr(c.behavior?.attitudeToAuthority, 2)
  ) {
    n++;
  }
  if (filledStr(c.worldview, 4) || filledArr(c.values, 1)) n++;
  if (
    filledStr(c.speakingStyle?.description, 4) ||
    filledArr(c.speakingStyle?.catchphrases, 1) ||
    filledStr(c.speakingStyle?.sentenceStyle, 2)
  ) {
    n++;
  }
  if (
    filledStr(c.background?.origin, 2) ||
    filledStr(c.background?.description, 4) ||
    filledArr(c.background?.keyEvents, 1)
  ) {
    n++;
  }
  return n;
}

/** Multi-dimension detail (not a bare roster brief in one field). */
export function profileHasDetail(c: CharacterProfile | null | undefined): boolean {
  return profileDetailScore(c) >= 3;
}

export function profileHasRelationships(c: CharacterProfile | null | undefined): boolean {
  return Array.isArray(c?.relationships) && c!.relationships!.length > 0;
}

/**
 * Roster set authority = `roster` names only.
 * Overlay matching enrichment from `prev` (detail/rels) so re-list does not
 * re-inflate membership from leftover draft names.
 */
export function rebuildDraftFromRoster(
  roster: CharacterProfile[],
  prev: CharacterProfile[] | null | undefined,
): CharacterProfile[] {
  const prevBy = new Map<string, CharacterProfile>();
  for (const c of prev || []) {
    const k = nameKey(c.name);
    if (k) prevBy.set(k, c);
  }
  return roster.map((stub) => {
    const k = nameKey(stub.name);
    const old = k ? prevBy.get(k) : undefined;
    if (!old) return stub;
    // Membership from roster; keep richer detail/aliases/rels from prev
    return mergeCharacterProfiles(stub, old);
  });
}

/** Prefer non-empty nested fields from `richer` over `base`. */
export function mergeCharacterProfiles(
  base: CharacterProfile,
  richer: Partial<CharacterProfile>,
): CharacterProfile {
  const pickObj = <T extends Record<string, any>>(a: T | undefined, b: T | undefined): T => {
    const out = { ...(a || {}), ...(b || {}) } as T;
    for (const k of Object.keys(out)) {
      const bv = b?.[k];
      const av = a?.[k];
      if (typeof bv === "string" && !bv.trim() && typeof av === "string" && av.trim()) {
        (out as any)[k] = av;
      }
      if (Array.isArray(bv) && bv.length === 0 && Array.isArray(av) && av.length > 0) {
        (out as any)[k] = av;
      }
    }
    return out;
  };

  const aliases = Array.from(
    new Set([...(base.aliases || []), ...((richer.aliases as string[]) || [])].filter(Boolean)),
  );

  let relationships = base.relationships || [];
  if (Array.isArray(richer.relationships) && richer.relationships.length > 0) {
    // Prefer richer if it has more edges
    relationships =
      richer.relationships.length >= relationships.length
        ? richer.relationships
        : relationships;
  }

  const baseAnchors = Array.isArray(base.mentionAnchors) ? base.mentionAnchors : [];
  const richAnchors = Array.isArray((richer as any).mentionAnchors)
    ? ((richer as any).mentionAnchors as CharacterProfile["mentionAnchors"])
    : [];
  const anchorBy = new Map<number, NonNullable<CharacterProfile["mentionAnchors"]>[number]>();
  for (const a of [...baseAnchors, ...(richAnchors || [])]) {
    if (!a || !Number.isFinite(Number(a.offset))) continue;
    const off = Math.floor(Number(a.offset));
    const prev = anchorBy.get(off);
    if (!prev) anchorBy.set(off, { ...a, offset: off });
    else {
      anchorBy.set(off, {
        offset: off,
        unitIndex: prev.unitIndex ?? a.unitIndex,
        unitLabel: prev.unitLabel || a.unitLabel,
        surface: prev.surface || a.surface,
      });
    }
  }
  const mentionAnchors = Array.from(anchorBy.values())
    .sort((x, y) => x.offset - y.offset)
    .slice(0, 12);

  return {
    ...base,
    ...richer,
    id: base.id || (richer as any).id,
    name: base.name || String((richer as any).name || ""),
    aliases,
    appearance: pickObj(base.appearance as any, richer.appearance as any),
    personality: pickObj(base.personality as any, richer.personality as any),
    drive: pickObj(base.drive as any, richer.drive as any),
    behavior: pickObj(base.behavior as any, richer.behavior as any),
    speakingStyle: pickObj(base.speakingStyle as any, richer.speakingStyle as any),
    voice: pickObj(base.voice as any, richer.voice as any),
    background: pickObj(base.background as any, richer.background as any),
    worldview:
      (typeof richer.worldview === "string" && richer.worldview.trim()
        ? richer.worldview
        : base.worldview) || "",
    values:
      Array.isArray(richer.values) && richer.values.length
        ? richer.values
        : base.values || [],
    relationships,
    mentionAnchors: mentionAnchors.length
      ? mentionAnchors
      : base.mentionAnchors || (richer as any).mentionAnchors,
  } as CharacterProfile;
}

export function applyRelationshipEdges(
  chars: CharacterProfile[],
  edges: Array<Record<string, unknown>>,
): { chars: CharacterProfile[]; applied: number } {
  const byName = new Map(chars.map((c) => [nameKey(c.name), c]));
  let applied = 0;
  for (const e of edges || []) {
    const from = nameKey(String(e.from || e.source || ""));
    const to = nameKey(String(e.to || e.target || ""));
    if (!from || !to) continue;
    const owner = byName.get(from);
    const target = byName.get(to);
    if (!owner) continue;
    if (!owner.relationships) owner.relationships = [];
    const tName = target?.name || String(e.to || e.target || "").trim();
    // de-dupe by target+type
    const typ = String(e.type || "other");
    const exists = owner.relationships.some(
      (r) => nameKey(r.characterName || "") === nameKey(tName) && r.type === typ,
    );
    if (exists) continue;
    owner.relationships.push({
      characterId: target?.id || "",
      characterName: tName,
      type: typ,
      symmetry: e.symmetry as any,
      reverseType: e.reverseType as any,
      valence: e.valence as any,
      visibility: e.visibility as any,
      description: String(e.description || ""),
      history: String(e.history || ""),
      dynamics: String(e.dynamics || ""),
    });
    applied++;
  }
  return { chars: Array.from(byName.values()), applied };
}

/**
 * detail_json must cover multiple dimensions — reject single-field "性格简介".
 * Required: appearance + personality, plus ≥2 of drive/behavior/worldview|values/
 * speakingStyle/background.
 */
export function detailPayloadIsRich(detail: Record<string, unknown>): boolean {
  if (!detail || typeof detail !== "object") return false;
  const d = detail as any;
  const hasAppearance = filledStr(d.appearance?.summary, 6);
  const hasPersonality =
    filledStr(d.personality?.description, 6) ||
    filledArr(d.personality?.traits, 2) ||
    filledStr(d.personality?.decisionStyle, 2);
  let extras = 0;
  if (
    filledStr(d.drive?.goal, 2) ||
    filledStr(d.drive?.motivation, 2) ||
    filledStr(d.drive?.fear, 2) ||
    filledStr(d.drive?.weakness, 2)
  ) {
    extras++;
  }
  if (
    filledArr(d.behavior?.patterns, 1) ||
    filledArr(d.behavior?.habits, 1) ||
    filledStr(d.behavior?.attitudeToAuthority, 2)
  ) {
    extras++;
  }
  if (filledStr(d.worldview, 4) || filledArr(d.values, 1)) extras++;
  if (
    filledStr(d.speakingStyle?.description, 4) ||
    filledArr(d.speakingStyle?.catchphrases, 1) ||
    filledStr(d.speakingStyle?.sentenceStyle, 2)
  ) {
    extras++;
  }
  if (
    filledStr(d.background?.origin, 2) ||
    filledStr(d.background?.description, 4) ||
    filledArr(d.background?.keyEvents, 1)
  ) {
    extras++;
  }
  return hasAppearance && hasPersonality && extras >= 2;
}

/** Human-readable reject reason for incomplete detail_json. */
export function detailPayloadRejectReason(detail: Record<string, unknown>): string {
  if (detailPayloadIsRich(detail)) return "";
  const d = detail as any;
  const miss: string[] = [];
  if (!filledStr(d.appearance?.summary, 6)) miss.push("appearance.summary");
  if (
    !filledStr(d.personality?.description, 6) &&
    !filledArr(d.personality?.traits, 2)
  ) {
    miss.push("personality(traits/description)");
  }
  miss.push("另需 drive/behavior/worldview|values/speakingStyle/background 中至少 2 项");
  return `详情维度不足（缺 ${miss.join("、")}）。须含外貌+性格，并至少两项：drive/behavior/世界观或价值观/说话风格/背景。`;
}
