/**
 * Shared types for character entity resolve (agent + frequency).
 */

import {
  mergeAnchors,
  normalizeAnchors,
  type MentionAnchor,
} from "./mention-anchor";

export type { MentionAnchor };

export interface ResolvedEntity {
  /** Real personal name or stable third-person referent */
  name: string;
  /** Third-person titles / nicknames only (no 我爸/你妈) */
  aliases: string[];
  role?: string;
  briefDescription?: string;
  /** All surfaces attributed for counting (may include dialogue forms in catalog) */
  surfaces?: string[];
  /**
   * Occurrence anchors (offset + unit) owned by **this** person.
   * Same surface string at distant anchors may be different people — split entities.
   */
  anchors?: MentionAnchor[];
}

/**
 * Detect 1st/2nd-person speaker-relative labels (我爸/你妈/我哥…).
 * Used only to reject submit so the list agent rewrites to third person — not silent rewrite.
 */
export function isFirstOrSecondPersonDeictic(s: string): boolean {
  const t = (s || "").replace(/\s+/g, "").trim();
  if (!t || t.length < 2) return false;
  if (/^(我们|你们|咱们)(的)?/.test(t)) return true;
  if (/^(我|你|您|俺|咱)的?/.test(t)) return true;
  return false;
}

/** Bare pronouns / generics — never a character name. */
export function isBarePronounOrGeneric(s: string): boolean {
  const t = (s || "").replace(/\s+/g, "").trim();
  if (!t) return true;
  return /^(他|她|它|他们|她们|它们|我|你|您|咱|俺|有人|众人|那人|这人|谁|某人)$/.test(
    t,
  );
}

/**
 * Unanchored relation / role label used as a sole `name`.
 * These need a proper name or stable epithet in the same row (aliases), or must be dropped.
 * Intentionally only matches **whole-string** pure roles (许老师 / 周屿的父亲 are NOT pure).
 */
export function isUnanchoredRelationLabel(s: string): boolean {
  const t = (s || "").replace(/\s+/g, "").trim();
  if (!t) return true;
  // Speaker-relative kinship already covered elsewhere; bare 他爸-style
  if (/^(他|她|我|你|您|俺|咱)(的)?(爸|妈|爹|父|母|哥|姐|弟|妹|儿子|女儿|老公|老婆)/.test(t)) {
    return true;
  }
  // Pure relation role with no name stem (whole string)
  if (
    /^(小|大|老)?(儿子|女儿|孩子|孙子|孙女|侄子|侄女)$/.test(t) ||
    /^(男|女)?朋友$/.test(t) ||
    /^(老公|老婆|丈夫|妻子|男友|女友)$/.test(t) ||
    /^(弟弟|哥哥|姐姐|妹妹|父亲|母亲|爸爸|妈妈|爸|妈|爹|娘|后妈|继母|小妈)$/.test(
      t,
    ) ||
    /^(老师|同学|总|经理|主任)$/.test(t)
  ) {
    return true;
  }
  return false;
}

/** True if this string must not be a stage-1 primary `name` alone. */
export function isInvalidUnitPrimaryName(s: string): boolean {
  return (
    isBarePronounOrGeneric(s) ||
    isFirstOrSecondPersonDeictic(s) ||
    isUnanchoredRelationLabel(s)
  );
}

/** Issues like `周伯彦.alias=我爸` for tool error messages */
export function findFirstSecondPersonAliasIssues(
  raw: ResolvedEntity[] | undefined | null,
): string[] {
  if (!raw?.length) return [];
  const issues: string[] = [];
  for (const e of raw) {
    const name = String(e?.name || "").trim();
    if (name && isFirstOrSecondPersonDeictic(name)) {
      issues.push(`name「${name}」`);
    }
    for (const a of e?.aliases || []) {
      const al = String(a || "").trim();
      if (al && isFirstOrSecondPersonDeictic(al)) {
        issues.push(`${name || "?"}alias「${al}」`);
      }
    }
  }
  return issues;
}

export function nameKeyEntity(name: string): string {
  return String(name || "").replace(/\s+/g, "").trim();
}

/**
 * Light clean only — **does not** re-pick primary names or merge people.
 * Name choice / coref is the global agent's job; submit validates structure.
 */
export function normalizeResolvedEntities(
  raw: ResolvedEntity[] | undefined | null,
): ResolvedEntity[] {
  if (!raw?.length) return [];
  const cleaned: ResolvedEntity[] = [];
  for (const e of raw) {
    const name = (e.name || "").trim();
    // Keep empty/bad names so validateSubmitEntities can report them
    const aliases = Array.from(
      new Set(
        (e.aliases || [])
          .map((a) => String(a || "").trim())
          .filter((a) => a && nameKeyEntity(a) !== nameKeyEntity(name)),
      ),
    );
    const surfaces = Array.from(
      new Set(
        [name, ...aliases, ...(e.surfaces || [])]
          .map((s) => String(s || "").trim())
          .filter(Boolean),
      ),
    );
    const anchors = normalizeAnchors((e as any).anchors);
    cleaned.push({
      name,
      aliases,
      role: e.role || "supporting",
      briefDescription: (e.briefDescription || "").trim() || undefined,
      surfaces: surfaces.length ? surfaces : undefined,
      anchors: anchors.length ? anchors : undefined,
    });
  }
  return cleaned;
}

/**
 * Program checks only — agent must fix; no silent rewrite.
 * - empty primary name
 * - duplicate primary names (within the list)
 * - suspended deictic / relation as primary name
 * - 1st/2nd-person deictics in name or aliases
 */
export function validateSubmitEntities(
  entities: ResolvedEntity[] | undefined | null,
): string[] {
  const issues: string[] = [];
  if (!entities?.length) return issues;
  const seen = new Map<string, number>();
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    const name = (e?.name || "").trim();
    if (!name) {
      issues.push(`第${i + 1}行空主名`);
      continue;
    }
    if (name.length > 24) {
      issues.push(`主名过长「${name.slice(0, 12)}…」`);
    }
    const key = nameKeyEntity(name);
    if (seen.has(key)) {
      issues.push(`主名重复「${name}」`);
    } else {
      seen.set(key, i);
    }
    if (isInvalidUnitPrimaryName(name)) {
      issues.push(
        `主名是悬空指代「${name}」（须 merge 到真实实体，不能单独作 name）`,
      );
    }
    if (isFirstOrSecondPersonDeictic(name)) {
      issues.push(`主名含第一/二人称「${name}」`);
    }
    for (const a of e.aliases || []) {
      const al = String(a || "").trim();
      if (al && isFirstOrSecondPersonDeictic(al)) {
        issues.push(`${name} 的 alias「${al}」含第一/二人称`);
      }
    }
  }
  return issues;
}

/** Exported for consistency fold / ops that union two person rows. */
export function unionResolvedEntity(
  a: ResolvedEntity,
  b: ResolvedEntity,
): ResolvedEntity {
  const aliases = Array.from(
    new Set([...(a.aliases || []), ...(b.aliases || [])].filter(Boolean)),
  );
  const surfaces = Array.from(
    new Set(
      [
        a.name,
        b.name,
        ...(a.surfaces || []),
        ...(b.surfaces || []),
        ...aliases,
      ].filter(Boolean),
    ),
  );
  const briefA = (a.briefDescription || "").trim();
  const briefB = (b.briefDescription || "").trim();
  const anchors = mergeAnchors(a.anchors, b.anchors);
  // Prefer longer real-name-ish form already chosen as name by agent;
  // if one name is substring of the other, keep longer.
  let name = a.name || b.name;
  const ka = nameKeyEntity(a.name);
  const kb = nameKeyEntity(b.name);
  if (ka && kb && ka !== kb) {
    if (kb.includes(ka) && kb.length > ka.length) name = b.name;
    else if (ka.includes(kb) && ka.length > kb.length) name = a.name;
    else if (
      (b.role === "protagonist" || b.role === "antagonist") &&
      a.role === "supporting"
    )
      name = b.name;
  }
  const nameKey = nameKeyEntity(name);
  return {
    name,
    aliases: aliases.filter((x) => nameKeyEntity(x) !== nameKey),
    surfaces: surfaces.filter(Boolean),
    role:
      b.role && b.role !== "supporting"
        ? b.role
        : a.role && a.role !== "supporting"
          ? a.role
          : b.role || a.role || "supporting",
    briefDescription:
      briefB.length >= briefA.length ? briefB || undefined : briefA || undefined,
    anchors: anchors.length ? anchors : undefined,
  };
}

/**
 * Merge batch into roster by **name key** only.
 * Cross-name alias / short-name folds live in `foldSafeEntityRedundancies`
 * (character-entity-consistency) so polluted shared aliases cannot mega-merge.
 */
export function mergeResolvedEntities(
  prev: ResolvedEntity[] | null | undefined,
  batch: ResolvedEntity[],
): ResolvedEntity[] {
  const byKey = new Map<string, ResolvedEntity>();
  for (const e of prev || []) {
    const k = nameKeyEntity(e.name);
    if (k) byKey.set(k, e);
  }
  for (const e of batch) {
    const k = nameKeyEntity(e.name);
    if (!k) continue;
    const old = byKey.get(k);
    if (!old) {
      byKey.set(k, e);
      continue;
    }
    byKey.set(k, unionResolvedEntity(old, e));
  }
  return Array.from(byKey.values());
}

export const SUBMIT_ENTITIES_OK = "角色实体已存";
