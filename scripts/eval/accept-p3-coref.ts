/**
 * Deterministic P3 acceptance (no live LLM).
 * Checks candidates, unresolved gate, resolve/merge ledger, dual vs mutual hang.
 *
 *   npx tsx scripts/eval/accept-p3-coref.ts
 */
import assert from "node:assert/strict";
import {
  listCrossNameCandidates,
  listUnresolvedCrossNamePairs,
  recordCrossNameResolution,
  recordMergesFromOps,
  crossNamePairKey,
  formatUnresolvedCrossNameBlock,
} from "../../src/core/extractor/character-cross-name";
import {
  listPrimaryAliasCollisions,
  listMutualAliasHangs,
  formatDualHangBlockForSubmit,
  foldSafeEntityRedundancies,
} from "../../src/core/extractor/character-entity-consistency";
import type { ResolvedEntity } from "../../src/core/extractor/character-entity-types";
import type { LocalEntity } from "../../src/core/extractor/character-local-entities";

function ent(name: string, aliases: string[] = []): ResolvedEntity {
  return { name, aliases, surfaces: [name, ...aliases] };
}

function loc(
  name: string,
  unitIndex: number,
  aliases: string[] = [],
  unitLabel?: string,
): LocalEntity {
  return { name, aliases, unitIndex, unitLabel };
}

let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}: ${(e as Error).message}`);
  }
}

console.log("P3 acceptance (deterministic)\n");

// --- A. same-window + local_alias → candidate ---
check("same-window / local_alias produces 战女王↔唐兰嫣", () => {
  const locals = [
    loc("战女王", 2, [], "第3章"),
    loc("唐兰嫣", 2, ["战女王"], "第3章"),
    loc("李动", 0),
  ];
  const items = listCrossNameCandidates(locals, { limit: 40 });
  const hit = items.find(
    (c) =>
      crossNamePairKey(c.nameA, c.nameB) ===
      crossNamePairKey("战女王", "唐兰嫣"),
  );
  assert.ok(hit, `missing pair, got ${items.map((c) => c.nameA + "/" + c.nameB)}`);
  assert.ok(
    hit!.sources.includes("same_window") ||
      hit!.sources.includes("local_alias"),
  );
});

// --- B. cooccur ---
check("cooccur surfaces 许栀↔秦予嫣", () => {
  const locals = [
    loc("许栀", 10),
    loc("秦予嫣", 10),
    loc("周屿", 0),
  ];
  const items = listCrossNameCandidates(locals, { limit: 40 });
  const hit = items.find(
    (c) =>
      crossNamePairKey(c.nameA, c.nameB) ===
      crossNamePairKey("许栀", "秦予嫣"),
  );
  assert.ok(hit);
  assert.ok(hit!.sources.includes("cooccur") || hit!.sources.includes("same_window"));
});

// --- C. unresolved blocks until processed ---
check("unresolved until merge/uncertain", () => {
  const locals = [
    loc("战女王", 1, ["唐兰嫣"]),
    loc("唐兰嫣", 1, ["战女王"]),
  ];
  const items = listCrossNameCandidates(locals);
  const roster = [ent("战女王"), ent("唐兰嫣", ["队长"])];
  let u = listUnresolvedCrossNamePairs(items, roster, {});
  assert.ok(u.length >= 1);

  const ledgerU = recordCrossNameResolution(
    {},
    { nameA: "战女王", nameB: "唐兰嫣", verdict: "uncertain" },
  );
  u = listUnresolvedCrossNamePairs(items, roster, ledgerU);
  assert.ok(
    !u.some(
      (x) =>
        crossNamePairKey(x.candidate.nameA, x.candidate.nameB) ===
        crossNamePairKey("战女王", "唐兰嫣"),
    ),
  );

  const ledgerM = recordMergesFromOps(
    {},
    [{ op: "merge", keep: "唐兰嫣", absorb: ["战女王"] }],
  );
  const after = [ent("唐兰嫣", ["战女王", "队长"])];
  u = listUnresolvedCrossNamePairs(items, after, ledgerM);
  assert.ok(
    !u.some(
      (x) =>
        crossNamePairKey(x.candidate.nameA, x.candidate.nameB) ===
        crossNamePairKey("战女王", "唐兰嫣"),
    ),
  );
});

// --- D. dual hang one-way ---
check("one-way dual hang detected", () => {
  const roster = [ent("战女王"), ent("唐兰嫣", ["战女王", "队长"])];
  const col = listPrimaryAliasCollisions(roster);
  assert.ok(col.some((c) => c.primaryName === "战女王"));
  const block = formatDualHangBlockForSubmit(roster);
  assert.ok(block.includes("双挂"));
  assert.ok(block.includes("战女王"));
});

// --- E. mutual hang guidance ---
check("mutual hang 女朋友↔许栀 → keep real name", () => {
  const roster = [ent("女朋友", ["许栀"]), ent("许栀", ["女朋友", "许老师"])];
  const mutual = listMutualAliasHangs(roster);
  assert.equal(mutual.length, 1);
  const block = formatDualHangBlockForSubmit(roster);
  assert.ok(block.includes("互挂"), block);
  assert.ok(block.includes("许栀"), block);
  assert.ok(/真名|消解到真名/.test(block), block);
});

check("mutual hang both non-real → third person hint", () => {
  const roster = [ent("女朋友", ["校花女友"]), ent("校花女友", ["女朋友"])];
  assert.ok(listMutualAliasHangs(roster).length >= 1);
  const block = formatDualHangBlockForSubmit(roster);
  assert.ok(/第三者|都不是真名/.test(block), block);
});

// --- F. short-name fold still works ---
check("short-name fold 雪棠⊂洛雪棠", () => {
  const { entities } = foldSafeEntityRedundancies([
    ent("雪棠", ["洛大小姐"]),
    ent("洛雪棠", ["未婚妻"]),
    ent("李动"),
  ]);
  assert.equal(entities.length, 2);
  assert.ok(entities.some((e) => e.name === "洛雪棠"));
  assert.ok(!entities.some((e) => e.name === "雪棠"));
});

// --- G. unresolved block names pairs ---
check("unresolved block lists names", () => {
  const locals = [loc("魔都女王", 5), loc("姜璎玑", 5, ["魔都女王"])];
  const items = listCrossNameCandidates(locals);
  const u = listUnresolvedCrossNamePairs(
    items,
    [ent("魔都女王"), ent("姜璎玑")],
    {},
  );
  const block = formatUnresolvedCrossNameBlock(u);
  assert.ok(block.includes("未处理"));
  assert.ok(block.includes("魔都女王") || block.includes("姜璎玑"));
});

console.log(
  failed
    ? `\nP3 acceptance FAILED (${failed} checks)`
    : "\nP3 acceptance PASSED (deterministic)",
);
process.exitCode = failed ? 1 : 0;
