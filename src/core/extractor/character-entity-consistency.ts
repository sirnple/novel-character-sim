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
  isInvalidUnitPrimaryName,
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

/** Mutual hang: each primary lists the other in aliases/surfaces. */
export interface MutualAliasHang {
  nameA: string;
  nameB: string;
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

/** A↔B: each has the other's primary in aliases/surfaces. */
export function listMutualAliasHangs(
  entities: ResolvedEntity[] | null | undefined,
): MutualAliasHang[] {
  if (!entities?.length) return [];
  const out: MutualAliasHang[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < entities.length; i++) {
    const a = entities[i];
    const ka = norm(a.name);
    if (!ka) continue;
    const setA = claimedNonNameKeys(a);
    for (let j = i + 1; j < entities.length; j++) {
      const b = entities[j];
      const kb = norm(b.name);
      if (!kb || ka === kb) continue;
      if (!setA.has(kb)) continue;
      if (!claimedNonNameKeys(b).has(ka)) continue;
      const pairKey = ka <= kb ? `${ka}||${kb}` : `${kb}||${ka}`;
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      out.push({
        nameA: ka <= kb ? a.name.trim() : b.name.trim(),
        nameB: ka <= kb ? b.name.trim() : a.name.trim(),
      });
    }
  }
  return out;
}

function isDeicticOrSuspendedLabel(s: string): boolean {
  return isInvalidUnitPrimaryName(s);
}

/** Prefer keep when one side is solid name-like and the other is deictic/suspended. */
function mutualHangHint(nameA: string, nameB: string): string {
  const aSus = isDeicticOrSuspendedLabel(nameA);
  const bSus = isDeicticOrSuspendedLabel(nameB);
  if (aSus && !bSus) {
    return (
      `互挂「${nameA}」↔「${nameB}」：一侧像代词/悬空称谓，一侧更像真名/稳定名` +
      ` → merge keep="${nameB}" absorb=["${nameA}"]（消解到真名）`
    );
  }
  if (bSus && !aSus) {
    return (
      `互挂「${nameA}」↔「${nameB}」：一侧像代词/悬空称谓，一侧更像真名/稳定名` +
      ` → merge keep="${nameA}" absorb=["${nameB}"]（消解到真名）`
    );
  }
  if (aSus && bSus) {
    return (
      `互挂「${nameA}」↔「${nameB}」：双方都不是真名，可能共同指向第三者` +
      ` → lookup 后 merge keep=真名 absorb=["${nameA}","${nameB}"]，禁止 keep=悬空词`
    );
  }
  // both look non-suspended: still may both be epithets pointing to a third
  return (
    `互挂「${nameA}」↔「${nameB}」：若双方都不是真名/都像外号封号，可能共同指向第三者` +
    ` → lookup 后 merge keep=真名 absorb=[二者]；若一方是真名则 keep=真名 absorb=[另一方]`
  );
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
 * When entities provided, mutual hangs (A↔B) get 互挂-specific guidance.
 * Example: `双挂「屿哥」↔「周屿」→ merge keep="周屿" absorb=["屿哥"]`
 */
export function formatPrimaryAliasCollisionIssues(
  collisions: PrimaryAliasCollision[],
  limit = 24,
  entities?: ResolvedEntity[] | null,
): string[] {
  const mutualKeys = new Set(
    listMutualAliasHangs(entities).map((m) =>
      norm(m.nameA) <= norm(m.nameB)
        ? `${norm(m.nameA)}||${norm(m.nameB)}`
        : `${norm(m.nameB)}||${norm(m.nameA)}`,
    ),
  );
  const issues: string[] = [];
  const emittedMutual = new Set<string>();

  for (const c of collisions.slice(0, limit)) {
    const abs = c.primaryName;
    if (c.claimedBy.length === 1) {
      const other = c.claimedBy[0];
      const pk =
        norm(abs) <= norm(other)
          ? `${norm(abs)}||${norm(other)}`
          : `${norm(other)}||${norm(abs)}`;
      if (mutualKeys.has(pk)) {
        if (emittedMutual.has(pk)) continue;
        emittedMutual.add(pk);
        issues.push(mutualHangHint(abs, other));
        continue;
      }
      issues.push(
        `双挂（单向）「${abs}」被「${other}」挂为 alias` +
          ` → 同一人则 merge keep=真名 absorb=["${abs}"]；` +
          `误挂则从「${other}」的 aliases 删掉「${abs}」`,
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
  return formatPrimaryAliasCollisionIssues(
    listPrimaryAliasCollisions(entities),
    24,
    entities,
  );
}

/**
 * Full dual-hang + mutual-hang block for submit tool.
 */
export function formatDualHangBlockForSubmit(
  entities: ResolvedEntity[] | null | undefined,
  opts?: { limit?: number },
): string {
  const collisions = listPrimaryAliasCollisions(entities);
  if (!collisions.length) return "";
  const limit = opts?.limit ?? 30;
  const mutual = listMutualAliasHangs(entities);
  const lines = formatPrimaryAliasCollisionIssues(collisions, limit, entities);
  const numbered = lines.map((line, i) => `${i + 1}. ${line}`);
  const guide =
    `【消解指引】\n` +
    `- 双挂：主名 X 同时出现在别人 aliases（可单向）。\n` +
    `- 互挂：A、B 都是主名且互相写在对方 aliases 里（≠双挂的统称）。\n` +
    `- 互挂且双方都不是真名/都像外号 → 可能共同指向第三者：lookup 后 keep=真名 absorb=[A,B]。\n` +
    `- 互挂且一方真名、一方代词/悬空称谓 → keep=真名 absorb=[代词侧]。\n` +
    `- 单向双挂：merge 到真名，或删误挂 alias。\n`;
  const mutualNote = mutual.length
    ? `其中互挂对 ${mutual.length}：${mutual.map((m) => `「${m.nameA}」↔「${m.nameB}」`).join("、")}\n`
    : "";
  return (
    `【双挂/互挂清单 · 双挂 ${collisions.length} 条】须逐项处理后再 submit（禁止重扫）：\n` +
    mutualNote +
    guide +
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
  return formatPrimaryAliasCollisionIssues(
    listPrimaryAliasCollisions(entities),
    24,
    entities,
  );
}

/** True if roster still has primary/alias dual hangs. */
export function hasPrimaryAliasCollisions(
  entities: ResolvedEntity[] | null | undefined,
): boolean {
  return listPrimaryAliasCollisions(entities).length > 0;
}
