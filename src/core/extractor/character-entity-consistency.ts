/**
 * Roster consistency for global coref submit:
 * - primary name of A must not remain a separate row while also claimed
 *   as alias/surface of B (unless agent has not linked them at all)
 * - multi-claim pollution (many rows claim the same primary) is an error
 * - unambiguous primary→alias links may be folded programmatically
 * - string short/long name pairs (雪棠⊂洛雪棠) folded via isNameSurfaceOf
 */

import {
  isNameSurfaceOf,
  preferRealName,
} from "./character-name-consolidate";
import {
  nameKeyEntity,
  unionResolvedEntity,
  type ResolvedEntity,
} from "./character-entity-types";

export interface PrimaryAliasCollision {
  /** Primary name that also appears on other rows as alias/surface */
  primaryName: string;
  /** Other entity primary names that claim it */
  claimedBy: string[];
}

function norm(s: string): string {
  return nameKeyEntity(s);
}

function claimedNonNameKeys(e: ResolvedEntity): Set<string> {
  const nameK = norm(e.name);
  const s = new Set<string>();
  for (const x of [...(e.aliases || []), ...(e.surfaces || [])]) {
    const k = norm(x);
    if (k && k !== nameK) s.add(k);
  }
  return s;
}

/**
 * Rows whose primary name is also claimed as alias/surface by another row.
 * Multi-claim (claimedBy.length > 1) = alias pollution; agent must clean.
 */
export function listPrimaryAliasCollisions(
  entities: ResolvedEntity[] | null | undefined,
): PrimaryAliasCollision[] {
  if (!entities?.length) return [];
  const byName = new Map<string, ResolvedEntity>();
  for (const e of entities) {
    const k = norm(e.name);
    if (k) byName.set(k, e);
  }
  const out: PrimaryAliasCollision[] = [];
  for (const [pk, pe] of Array.from(byName.entries())) {
    const claimedBy: string[] = [];
    for (const other of entities) {
      const ok = norm(other.name);
      if (!ok || ok === pk) continue;
      // Alias or surface (not primary name) of other equals this primary
      if (claimedNonNameKeys(other).has(pk)) {
        claimedBy.push(other.name.trim());
      }
    }
    const uniq = Array.from(new Set(claimedBy));
    if (uniq.length > 0) {
      out.push({ primaryName: pe.name.trim(), claimedBy: uniq });
    }
  }
  out.sort((a, b) => a.primaryName.localeCompare(b.primaryName, "zh"));
  return out;
}

/**
 * One line per dual hang: names + concrete fix.
 * Example: `双挂「屿哥」↔「周屿」→ merge keep="周屿" absorb=["屿哥"]`
 */
export function formatPrimaryAliasCollisionIssues(
  collisions: PrimaryAliasCollision[],
  limit = 24,
): string[] {
  const issues: string[] = [];
  for (const c of collisions.slice(0, limit)) {
    const abs = c.primaryName;
    if (c.claimedBy.length === 1) {
      const keep = c.claimedBy[0];
      issues.push(
        `双挂「${abs}」↔「${keep}」→ merge keep="${keep}" absorb=["${abs}"]` +
          `（或从「${keep}」的 aliases 删掉误挂的「${abs}」）`,
      );
    } else {
      const claimers = c.claimedBy.slice(0, 6).join("、");
      const more =
        c.claimedBy.length > 6 ? `等${c.claimedBy.length}人` : "";
      issues.push(
        `双挂「${abs}」被多人挂为 alias：${claimers}${more}` +
          ` → 先从错误行删 alias「${abs}」，再 merge keep=正确真名 absorb=["${abs}"]`,
      );
    }
  }
  if (collisions.length > limit) {
    issues.push(`…另有 ${collisions.length - limit} 处双挂未列出`);
  }
  return issues;
}

export function listPrimaryAliasCollisionIssues(
  entities: ResolvedEntity[] | null | undefined,
): string[] {
  return formatPrimaryAliasCollisionIssues(listPrimaryAliasCollisions(entities));
}

/**
 * Full dual-hang block for submit tool (numbered list, which pairs).
 */
export function formatDualHangBlockForSubmit(
  entities: ResolvedEntity[] | null | undefined,
  opts?: { limit?: number },
): string {
  const collisions = listPrimaryAliasCollisions(entities);
  if (!collisions.length) return "";
  const limit = opts?.limit ?? 30;
  const lines = formatPrimaryAliasCollisionIssues(collisions, limit);
  const numbered = lines.map((line, i) => `${i + 1}. ${line}`);
  return (
    `【双挂清单 · 共 ${collisions.length} 处】须逐项处理后再 submit（禁止重扫）：\n` +
    numbered.join("\n")
  );
}

/**
 * Both primaries related by short/long name surface (雪棠 ↔ 洛雪棠).
 * Program can fold these; also listed for diagnostics.
 */
export function listNameSurfaceDualPrimaries(
  entities: ResolvedEntity[] | null | undefined,
): { a: string; b: string }[] {
  if (!entities?.length) return [];
  const names = entities.map((e) => (e.name || "").trim()).filter(Boolean);
  const pairs: { a: string; b: string }[] = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      if (isNameSurfaceOf(names[i], names[j])) {
        pairs.push({ a: names[i], b: names[j] });
      }
    }
  }
  return pairs;
}

/**
 * Fold only **string-safe** dual primaries (雪棠⊂洛雪棠).
 *
 * Do **not** auto-merge “A.name ∈ B.aliases” — polluted aliases (洛清莹.aliases
 * 含姜璎玑) would wrongly absorb real people. Those require agent merge/ops
 * and are blocked by `listBlockingConsistencyIssues`.
 */
export function foldSafeEntityRedundancies(
  entities: ResolvedEntity[] | null | undefined,
): { entities: ResolvedEntity[]; log: string[] } {
  if (!entities?.length) return { entities: [], log: [] };
  let list = entities.map((e) => ({
    ...e,
    aliases: [...(e.aliases || [])],
    surfaces: e.surfaces ? [...e.surfaces] : undefined,
  }));
  const log: string[] = [];

  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (!isNameSurfaceOf(list[i].name, list[j].name)) continue;
        const merged = unionResolvedEntity(list[i], list[j]);
        const orientedName = preferRealName(list[i].name, list[j].name);
        const oriented =
          norm(merged.name) === norm(orientedName)
            ? merged
            : {
                ...merged,
                name: orientedName,
                aliases: Array.from(
                  new Set(
                    [merged.name, ...(merged.aliases || [])].filter(
                      (x) => norm(x) !== norm(orientedName),
                    ),
                  ),
                ),
              };
        log.push(
          `fold 短名「${list[i].name}」↔「${list[j].name}」→「${oriented.name}」`,
        );
        list = list.filter((_, idx) => idx !== i && idx !== j);
        list.push(oriented);
        changed = true;
        break outer;
      }
    }
  }

  return { entities: list, log };
}

/**
 * Issues that must block submit success / agent completion.
 * Any residual primary-as-alias dual hang (after short-name fold).
 */
export function listBlockingConsistencyIssues(
  entities: ResolvedEntity[] | null | undefined,
): string[] {
  return formatPrimaryAliasCollisionIssues(listPrimaryAliasCollisions(entities));
}

/** True if roster still has primary/alias dual hangs. */
export function hasPrimaryAliasCollisions(
  entities: ResolvedEntity[] | null | undefined,
): boolean {
  return listPrimaryAliasCollisions(entities).length > 0;
}
