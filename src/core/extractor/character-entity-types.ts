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
    const anchors = normalizeAnchors((e as any).anchors);
    out.push({
      name,
      aliases,
      role: e.role || "supporting",
      briefDescription: (e.briefDescription || "").trim() || undefined,
      surfaces,
      anchors: anchors.length ? anchors : undefined,
    });
  }
  return out;
}

function claimedKeysOf(e: ResolvedEntity): Set<string> {
  const s = new Set<string>();
  for (const x of [e.name, ...(e.aliases || []), ...(e.surfaces || [])]) {
    const k = nameKeyEntity(x);
    if (k) s.add(k);
  }
  return s;
}

function unionEntity(a: ResolvedEntity, b: ResolvedEntity): ResolvedEntity {
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
    else if ((b.role === "protagonist" || b.role === "antagonist") && a.role === "supporting")
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
 * Merge batch into roster by **name key**, then collapse entities that share
 * any claimed surface (name/alias/surface). Shared surface means the agent
 * already treated them as the same label set — not string kinship heuristics.
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
    byKey.set(k, unionEntity(old, e));
  }

  // Collapse when two different name-keys share a surface claim
  let list = Array.from(byKey.values());
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < list.length; i++) {
      const ki = claimedKeysOf(list[i]);
      for (let j = i + 1; j < list.length; j++) {
        const kj = claimedKeysOf(list[j]);
        let hit = false;
        for (const x of Array.from(ki)) {
          if (kj.has(x)) {
            hit = true;
            break;
          }
        }
        if (!hit) continue;
        const merged = unionEntity(list[i], list[j]);
        list = list.filter((_, idx) => idx !== i && idx !== j);
        list.push(merged);
        changed = true;
        break outer;
      }
    }
  }
  return list;
}

export const SUBMIT_ENTITIES_OK = "角色实体已存";
