/**
 * Shared types for character entity resolve (agent + frequency).
 */

export interface ResolvedEntity {
  /** Real personal name or stable third-person referent */
  name: string;
  /** Third-person titles / nicknames only (no 我爸/你妈) */
  aliases: string[];
  role?: string;
  briefDescription?: string;
  /** All surfaces attributed for counting (may include dialogue forms in catalog) */
  surfaces?: string[];
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

export function normalizeResolvedEntities(
  raw: ResolvedEntity[] | undefined | null,
): ResolvedEntity[] {
  if (!raw?.length) return [];
  const out: ResolvedEntity[] = [];
  const seen = new Set<string>();
  for (const e of raw) {
    const name = (e.name || "").trim();
    // Allow 「周屿的母亲」; skip empty / 1st-2nd person as name
    if (!name || name.length > 24) continue;
    if (isFirstOrSecondPersonDeictic(name)) continue;
    const key = nameKeyEntity(name);
    if (seen.has(key)) continue;
    seen.add(key);
    // Aliases: only keep third-person (drop 我/你… if any slipped past reject)
    const aliases = Array.from(
      new Set(
        (e.aliases || [])
          .map((a) => String(a).trim())
          .filter(
            (a) =>
              a &&
              nameKeyEntity(a) !== key &&
              !isFirstOrSecondPersonDeictic(a),
          ),
      ),
    );
    // surfaces: prefer non-deictic for stable labels
    const surfaces = Array.from(
      new Set(
        [name, ...aliases, ...(e.surfaces || [])]
          .map((s) => String(s).trim())
          .filter((s) => s && !isFirstOrSecondPersonDeictic(s)),
      ),
    );
    out.push({
      name,
      aliases,
      role: e.role || "supporting",
      briefDescription: (e.briefDescription || "").trim() || undefined,
      surfaces,
    });
  }
  return out;
}

/**
 * Merge batch entities into existing roster by name key.
 * Same person: union aliases/surfaces; prefer non-empty role/brief from either side
 * (incoming wins if richer).
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
    const aliases = Array.from(
      new Set([...(old.aliases || []), ...(e.aliases || [])].filter(Boolean)),
    );
    const surfaces = Array.from(
      new Set([...(old.surfaces || []), ...(e.surfaces || [])].filter(Boolean)),
    );
    const briefIncoming = (e.briefDescription || "").trim();
    const briefOld = (old.briefDescription || "").trim();
    byKey.set(k, {
      name: old.name || e.name,
      aliases,
      surfaces,
      role:
        e.role && e.role !== "supporting"
          ? e.role
          : old.role || e.role || "supporting",
      briefDescription:
        briefIncoming.length >= briefOld.length ? briefIncoming || undefined : briefOld || undefined,
    });
  }
  return Array.from(byKey.values());
}

export const SUBMIT_ENTITIES_OK = "角色实体已存";
