/**
 * merge / split ops for global coref
 */
import assert from "node:assert/strict";
import { applyEntityOps } from "../../src/core/extractor/character-entity-ops";
import type { ResolvedEntity } from "../../src/core/extractor/character-entity-types";
import {
  buildLocalEntitiesFromUnitHits,
  collapseTechnicalFarSameNameKeys,
  listNearCrossNameAliasCandidates,
  seedGlobalEntitiesFromLocal,
} from "../../src/core/extractor/character-local-entities";
import {
  formatRelationPrimariesForPrompt,
  listRelationPrimaryNames,
} from "../../src/core/extractor/character-entity-coverage";
import type { TextUnit } from "../../src/core/extractor/character-name-units";
import type { UnitNameHit } from "../../src/core/extractor/character-name-aggregate";

function ent(
  name: string,
  aliases: string[] = [],
  anchors: { offset: number; surface?: string }[] = [],
): ResolvedEntity {
  return {
    name,
    aliases,
    surfaces: [name, ...aliases],
    anchors: anchors.map((a) => ({
      offset: a.offset,
      surface: a.surface || name,
    })),
  };
}

// --- merge ---
{
  const roster = [
    ent("孙悟空", [], [{ offset: 100, surface: "孙悟空" }]),
    ent("齐天大圣", [], [{ offset: 200, surface: "齐天大圣" }]),
  ];
  const { entities, log } = applyEntityOps(roster, [
    { op: "merge", keep: "孙悟空", absorb: ["齐天大圣"] },
  ]);
  assert.equal(entities.length, 1);
  assert.equal(entities[0].name, "孙悟空");
  assert.ok(
    entities[0].aliases.includes("齐天大圣") ||
      entities[0].surfaces?.includes("齐天大圣"),
  );
  assert.ok(log.some((l) => l.includes("merge")));
}

// --- split by surface ---
{
  const roster = [
    ent(
      "孙悟空",
      ["齐天大圣", "某路人外号"],
      [
        { offset: 1, surface: "孙悟空" },
        { offset: 2, surface: "齐天大圣" },
        { offset: 9, surface: "某路人外号" },
      ],
    ),
  ];
  const { entities } = applyEntityOps(roster, [
    {
      op: "split",
      from: "孙悟空",
      move_surfaces: ["某路人外号"],
      new_name: "某路人",
    },
  ]);
  assert.equal(entities.length, 2);
  const main = entities.find(
    (e) => e.name === "孙悟空" || e.aliases.includes("齐天大圣"),
  );
  const other = entities.find(
    (e) =>
      e.name === "某路人" ||
      e.aliases.includes("某路人外号") ||
      e.name === "某路人外号",
  );
  assert.ok(main);
  assert.ok(other);
  assert.ok(!(main!.aliases || []).includes("某路人外号"));
}

// --- local entities: unit-level anchor ---
{
  const units: TextUnit[] = [
    {
      index: 0,
      label: "第1回",
      start: 100,
      end: 140,
      text: "孙悟空即齐天大圣也",
    },
  ];
  const hits: UnitNameHit[][] = [
    [{ name: "孙悟空", aliases: ["齐天大圣"], count: 1 }],
  ];
  const locals = buildLocalEntitiesFromUnitHits(units, hits);
  assert.equal(locals.length, 1);
  assert.equal(locals[0].name, "孙悟空");
  assert.deepEqual(locals[0].aliases, ["齐天大圣"]);
  assert.equal(locals[0].anchors?.[0]?.unitIndex, 0);
  assert.equal(locals[0].anchors?.[0]?.unitLabel, "第1回");
  assert.equal(locals[0].anchors?.[0]?.offset, 100);
}

// --- seed: near same-name (Δunit ≤ D=5) program-merged; different name stays ---
{
  const locals = [
    {
      name: "孙悟空",
      aliases: ["齐天大圣"],
      unitIndex: 0,
      unitLabel: "第1回",
      anchors: [{ offset: 0, unitIndex: 0, unitLabel: "第1回" }],
    },
    {
      name: "孙悟空",
      aliases: ["美猴王"],
      unitIndex: 2,
      unitLabel: "第3回",
      anchors: [{ offset: 500, unitIndex: 2, unitLabel: "第3回" }],
    },
    {
      name: "齐天大圣",
      aliases: [],
      unitIndex: 5,
      unitLabel: "第6回",
      anchors: [{ offset: 900, unitIndex: 5, unitLabel: "第6回" }],
    },
  ];
  const seeded = seedGlobalEntitiesFromLocal(locals);
  // near same name merged; 齐天大圣 as separate local name stays until global merge
  assert.equal(seeded.length, 2);
  const wukong = seeded.find((e) => e.name === "孙悟空");
  assert.ok(wukong);
  assert.ok(wukong!.aliases.includes("齐天大圣"));
  assert.ok(wukong!.aliases.includes("美猴王"));
  assert.equal(wukong!.anchors?.length, 2);
}

// --- seed: far same-name (Δunit > 5) stay separate for global LLM ---
{
  const locals = [
    {
      name: "李叔",
      aliases: [],
      unitIndex: 0,
      anchors: [{ offset: 0, unitIndex: 0 }],
    },
    {
      name: "李叔",
      aliases: ["李叔叔"],
      unitIndex: 3,
      anchors: [{ offset: 300, unitIndex: 3 }],
    },
    {
      name: "李叔",
      aliases: [],
      unitIndex: 10,
      anchors: [{ offset: 1000, unitIndex: 10 }],
    },
  ];
  const seeded = seedGlobalEntitiesFromLocal(locals);
  // 0–3 linked (Δ=3≤5); 10 is Δ=7 from 3 → second cluster
  assert.equal(seeded.length, 2);
  const near = seeded.find((e) => e.name === "李叔");
  const far = seeded.find((e) => e.name === "李叔@u10");
  assert.ok(near);
  assert.ok(far);
  assert.equal(near!.anchors?.length, 2);
  assert.ok(near!.aliases.includes("李叔叔") || near!.surfaces?.includes("李叔叔"));
  assert.equal(far!.anchors?.length, 1);
  // far cluster must not claim bare surface (avoids mergeResolvedEntities collapse)
  assert.ok(!(far!.surfaces || []).includes("李叔"));
  assert.ok((far!.surfaces || []).includes("李叔@u10"));
}

// --- seed: transitive chain 0–5–10 with D=5 → one entity ---
{
  const locals = [0, 5, 10].map((u) => ({
    name: "孙悟空",
    aliases: [] as string[],
    unitIndex: u,
    anchors: [{ offset: u * 100, unitIndex: u }],
  }));
  const seeded = seedGlobalEntitiesFromLocal(locals);
  assert.equal(seeded.length, 1);
  assert.equal(seeded[0].name, "孙悟空");
  assert.equal(seeded[0].anchors?.length, 3);
}

// --- seed: gap 6 > D=5 → two entities ---
{
  const locals = [
    {
      name: "王大爷",
      aliases: [],
      unitIndex: 0,
      anchors: [{ offset: 0, unitIndex: 0 }],
    },
    {
      name: "王大爷",
      aliases: [],
      unitIndex: 6,
      anchors: [{ offset: 600, unitIndex: 6 }],
    },
  ];
  const seeded = seedGlobalEntitiesFromLocal(locals);
  assert.equal(seeded.length, 2);
  assert.ok(seeded.some((e) => e.name === "王大爷"));
  assert.ok(seeded.some((e) => e.name === "王大爷@u6"));
}

// --- post-coref: leftover 周航@u23 must collapse into 周航 (no UI leak) ---
{
  const roster: ResolvedEntity[] = [
    ent("周航", ["航仔"], [{ offset: 0 }, { offset: 100 }]),
    {
      name: "周航@u23",
      aliases: [],
      surfaces: ["周航@u23"],
      anchors: [{ offset: 2300, unitIndex: 23 }],
      role: "supporting",
      briefDescription: "同名远距簇 surface「周航」u@23；与近距同名是否同一人由全局判定",
    },
    ent("王铎@u23", [], [{ offset: 2400 }]),
  ];
  const collapsed = collapseTechnicalFarSameNameKeys(roster);
  assert.equal(collapsed.length, 2);
  const zhou = collapsed.find((e) => e.name === "周航");
  const wang = collapsed.find((e) => e.name === "王铎");
  assert.ok(zhou);
  assert.ok(wang);
  assert.ok(!collapsed.some((e) => e.name.includes("@u")));
  assert.ok((zhou!.aliases || []).includes("航仔"));
  assert.ok((zhou!.anchors?.length || 0) >= 2);
  assert.ok(!/同名远距簇/.test(zhou!.briefDescription || ""));
}

// --- near cross-name pairs: candidates for alias analysis (not auto-merge) ---
{
  const locals = [
    {
      name: "周伯彦",
      aliases: ["周总"],
      unitIndex: 2,
      unitLabel: "第3章",
      anchors: [{ offset: 200, unitIndex: 2 }],
    },
    {
      name: "周屿的父亲",
      aliases: ["父亲"],
      unitIndex: 3,
      unitLabel: "第4章",
      anchors: [{ offset: 300, unitIndex: 3 }],
    },
    {
      name: "孙悟空",
      aliases: [],
      unitIndex: 0,
      anchors: [{ offset: 0, unitIndex: 0 }],
    },
    {
      name: "齐天大圣",
      aliases: ["孙悟空"],
      unitIndex: 1,
      anchors: [{ offset: 100, unitIndex: 1 }],
    },
    // far: should not pair with D=5 if gap > 5
    {
      name: "路人甲",
      aliases: [],
      unitIndex: 20,
      anchors: [{ offset: 2000, unitIndex: 20 }],
    },
  ];
  const pairs = listNearCrossNameAliasCandidates(locals, {
    maxUnitDistance: 5,
    limit: 20,
  });
  assert.ok(pairs.some((p) => p.nameA.includes("周") && p.nameB.includes("周")));
  const fatherPair = pairs.find(
    (p) =>
      (p.nameA === "周伯彦" && p.nameB === "周屿的父亲") ||
      (p.nameB === "周伯彦" && p.nameA === "周屿的父亲"),
  );
  assert.ok(fatherPair, "near 周伯彦↔周屿的父亲 should be listed");
  assert.equal(fatherPair!.dist, 1);
  const wukongPair = pairs.find(
    (p) =>
      (p.nameA === "孙悟空" && p.nameB === "齐天大圣") ||
      (p.nameB === "孙悟空" && p.nameA === "齐天大圣"),
  );
  assert.ok(wukongPair);
  assert.ok(
    wukongPair!.reasons.some((r) => r.includes("表面含") || r.includes("共享")),
  );
  assert.ok(!pairs.some((p) => p.nameA === "路人甲" || p.nameB === "路人甲"));
}

// --- relation primary names flagged for global agent ---
{
  const roster: ResolvedEntity[] = [
    ent("周屿", ["屿哥"], [{ offset: 0 }]),
    ent("女朋友", ["女友"], [{ offset: 100 }]),
    ent("大儿子", [], [{ offset: 200 }]),
  ];
  const bad = listRelationPrimaryNames(roster);
  assert.equal(bad.length, 2);
  assert.ok(bad.some((e) => e.name === "女朋友"));
  assert.ok(bad.some((e) => e.name === "大儿子"));
  const msg = formatRelationPrimariesForPrompt(roster);
  assert.ok(msg.includes("lookup"));
  assert.ok(msg.includes("女朋友"));
  assert.ok(!formatRelationPrimariesForPrompt([ent("周屿", [])]));
}

// --- normalize does not re-pick names; validate catches bad primaries ---
{
  const {
    normalizeResolvedEntities,
    validateSubmitEntities,
  } = require("../../src/core/extractor/character-entity-types") as typeof import("../../src/core/extractor/character-entity-types");
  const kept = normalizeResolvedEntities([
    { name: "女朋友", aliases: ["裴冉"] },
    { name: "周航", aliases: ["弟弟"] },
  ]);
  // Agent name preserved (no silent orient)
  assert.equal(kept.find((e) => e.aliases?.includes("裴冉"))?.name, "女朋友");
  assert.equal(kept.find((e) => e.name === "周航")?.name, "周航");
  const issues = validateSubmitEntities(kept);
  assert.ok(issues.some((x) => x.includes("女朋友") || x.includes("悬空")));
  assert.ok(
    !validateSubmitEntities([
      { name: "裴冉", aliases: ["女朋友"] },
      { name: "周航", aliases: ["弟弟"] },
    ]).length,
  );
  assert.ok(
    validateSubmitEntities([
      { name: "周屿", aliases: [] },
      { name: "周屿", aliases: ["屿哥"] },
    ]).some((x) => x.includes("重复")),
  );
  assert.ok(
    validateSubmitEntities([{ name: "", aliases: [] }]).some((x) =>
      x.includes("空主名"),
    ),
  );
}

// --- near candidates boost 女朋友↔许栀 ---
{
  const locals = [
    {
      name: "女朋友",
      aliases: [] as string[],
      unitIndex: 2,
      anchors: [{ offset: 200, unitIndex: 2 }],
    },
    {
      name: "许栀",
      aliases: ["许老师"],
      unitIndex: 3,
      anchors: [{ offset: 300, unitIndex: 3 }],
    },
  ];
  const pairs = listNearCrossNameAliasCandidates(locals, { maxUnitDistance: 5 });
  assert.ok(pairs.length >= 1);
  assert.ok(pairs[0].reasons.some((r) => r.includes("关系称谓")));
}

// --- primary/alias consistency: short-name fold + dual-hang block ---
{
  const {
    foldSafeEntityRedundancies,
    listPrimaryAliasCollisions,
    listBlockingConsistencyIssues,
  } = require("../../src/core/extractor/character-entity-consistency") as typeof import("../../src/core/extractor/character-entity-consistency");

  // 雪棠 ⊂ 洛雪棠 as dual primaries → program fold
  {
    const { entities, log } = foldSafeEntityRedundancies([
      ent("雪棠", ["洛大小姐"]),
      ent("洛雪棠", ["未婚妻"]),
      ent("李动", []),
    ]);
    assert.equal(entities.length, 2, log.join(";"));
    const x = entities.find((e) => e.name === "洛雪棠" || e.name === "雪棠");
    assert.ok(x);
    assert.equal(x!.name, "洛雪棠");
    assert.ok(
      (x!.aliases || []).includes("雪棠") ||
        (x!.surfaces || []).includes("雪棠"),
    );
    assert.equal(listBlockingConsistencyIssues(entities).length, 0);
  }

  // Epithet dual-hang: do NOT silent-merge (pollution risk); block for agent merge
  {
    const {
      formatDualHangBlockForSubmit,
    } = require("../../src/core/extractor/character-entity-consistency") as typeof import("../../src/core/extractor/character-entity-consistency");
    const roster = [
      ent("战女王", []),
      ent("唐兰嫣", ["战女王", "队长"]),
      ent("李动", []),
    ];
    const { entities } = foldSafeEntityRedundancies(roster);
    assert.equal(entities.length, 3, "epithet not auto-merged");
    const issues = listBlockingConsistencyIssues(entities);
    assert.ok(issues.some((x) => x.includes("战女王")), issues.join(";"));
    assert.ok(
      issues.some((x) => x.includes("唐兰嫣") && x.includes("merge keep")),
      "must name both sides + merge: " + issues.join(";"),
    );
    const block = formatDualHangBlockForSubmit(entities);
    assert.ok(block.includes("双挂") || block.includes("互挂"));
    assert.ok(block.includes("战女王"));
    assert.ok(block.includes("唐兰嫣"));
    assert.ok(
      block.includes("merge keep") || block.includes("absorb"),
      block,
    );
  }

  // Mutual hang A↔B: both list each other
  {
    const {
      listMutualAliasHangs,
      formatDualHangBlockForSubmit: fmtBlock,
    } = require("../../src/core/extractor/character-entity-consistency") as typeof import("../../src/core/extractor/character-entity-consistency");
    const mutualRoster = [
      ent("女朋友", ["许栀"]),
      ent("许栀", ["女朋友", "许老师"]),
    ];
    const mutual = listMutualAliasHangs(mutualRoster);
    assert.equal(mutual.length, 1);
    const block = fmtBlock(mutualRoster);
    assert.ok(block.includes("互挂"), block);
    assert.ok(block.includes("真名") || block.includes("消解到真名"), block);
    assert.ok(block.includes("许栀"), block);
  }

  // Mutual hang both non-real: guide to third person
  {
    const {
      listMutualAliasHangs,
      formatDualHangBlockForSubmit: fmtBlock,
    } = require("../../src/core/extractor/character-entity-consistency") as typeof import("../../src/core/extractor/character-entity-consistency");
    const both = [ent("女朋友", ["校花女友"]), ent("校花女友", ["女朋友"])];
    assert.ok(listMutualAliasHangs(both).length >= 1);
    const block = fmtBlock(both);
    assert.ok(block.includes("第三者") || block.includes("都不是真名"), block);
  }

  // Pollution: 姜璎玑 primary + false claim on 洛清莹 → block, never absorb into 洛清莹
  {
    const roster = [
      ent("姜璎玑", ["魔都女王"]),
      ent("洛清莹", ["姜璎玑", "雪棠"]),
      ent("雪棠", []),
      ent("洛雪棠", ["雪棠"]),
    ];
    const folded = foldSafeEntityRedundancies(roster).entities;
    // 雪棠⊂洛雪棠 folds; 姜 must remain separate primary
    assert.ok(folded.some((e) => e.name === "姜璎玑"));
    assert.ok(!folded.some((e) => e.name === "雪棠"));
    const issues = listBlockingConsistencyIssues(folded);
    assert.ok(
      issues.some((x) => x.includes("姜璎玑")),
      "must block polluted claim on 姜璎玑: " + issues.join(";"),
    );
    const col = listPrimaryAliasCollisions(folded);
    const jiang = col.find((c) => c.primaryName === "姜璎玑");
    assert.ok(jiang);
    assert.deepEqual(jiang!.claimedBy, ["洛清莹"]);
  }
}

// --- P3 cross-name candidates + resolve ledger ---
{
  const {
    listCrossNameCandidates,
    listUnresolvedCrossNamePairs,
    recordCrossNameResolution,
    recordMergesFromOps,
    formatUnresolvedCrossNameBlock,
    crossNamePairKey,
  } = require("../../src/core/extractor/character-cross-name") as typeof import("../../src/core/extractor/character-cross-name");

  const locals = [
    {
      name: "战女王",
      aliases: [] as string[],
      unitIndex: 2,
      unitLabel: "第3章",
    },
    {
      name: "唐兰嫣",
      aliases: ["战女王"] as string[],
      unitIndex: 2,
      unitLabel: "第3章",
    },
    {
      name: "周屿",
      aliases: ["屿哥"],
      unitIndex: 0,
    },
    {
      name: "许栀",
      aliases: [],
      unitIndex: 10,
    },
    {
      name: "秦予嫣",
      aliases: [],
      unitIndex: 10,
    },
  ];
  const items = listCrossNameCandidates(locals, { limit: 40 });
  assert.ok(
    items.some(
      (c) =>
        (c.nameA === "战女王" || c.nameB === "战女王") &&
        (c.nameA === "唐兰嫣" || c.nameB === "唐兰嫣"),
    ),
    "same-window / local_alias 战女王↔唐兰嫣: " +
      items.map((c) => c.nameA + "/" + c.nameB).join(","),
  );
  const pair = items.find(
    (c) =>
      crossNamePairKey(c.nameA, c.nameB) ===
      crossNamePairKey("战女王", "唐兰嫣"),
  );
  assert.ok(pair);
  assert.ok(
    pair!.sources.includes("same_window") ||
      pair!.sources.includes("local_alias"),
  );

  // cooccur: same unitIndex 10
  assert.ok(
    items.some(
      (c) =>
        (c.nameA === "许栀" || c.nameB === "许栀") &&
        (c.nameA === "秦予嫣" || c.nameB === "秦予嫣") &&
        c.sources.includes("cooccur"),
    ),
    "cooccur 许栀↔秦予嫣",
  );

  const roster = [
    ent("战女王", []),
    ent("唐兰嫣", ["队长"]),
    ent("周屿", ["屿哥"]),
  ];
  let unresolved = listUnresolvedCrossNamePairs(items, roster, {});
  assert.ok(
    unresolved.some(
      (u) =>
        crossNamePairKey(u.candidate.nameA, u.candidate.nameB) ===
        crossNamePairKey("战女王", "唐兰嫣"),
    ),
  );

  // uncertain marks processed
  let ledger = recordCrossNameResolution(
    {},
    { nameA: "战女王", nameB: "唐兰嫣", verdict: "uncertain" },
  );
  unresolved = listUnresolvedCrossNamePairs(items, roster, ledger);
  assert.ok(
    !unresolved.some(
      (u) =>
        crossNamePairKey(u.candidate.nameA, u.candidate.nameB) ===
        crossNamePairKey("战女王", "唐兰嫣"),
    ),
    "uncertain clears unprocessed",
  );

  // merge ops clear
  ledger = recordMergesFromOps(
    {},
    [{ op: "merge", keep: "唐兰嫣", absorb: ["战女王"] }],
  );
  const afterMerge = [
    ent("唐兰嫣", ["战女王", "队长"]),
    ent("周屿", ["屿哥"]),
  ];
  unresolved = listUnresolvedCrossNamePairs(items, afterMerge, ledger);
  assert.ok(
    !unresolved.some(
      (u) =>
        crossNamePairKey(u.candidate.nameA, u.candidate.nameB) ===
        crossNamePairKey("战女王", "唐兰嫣"),
    ),
    "merge removes open pair",
  );

  const block = formatUnresolvedCrossNameBlock(
    listUnresolvedCrossNamePairs(
      items,
      [ent("战女王", []), ent("唐兰嫣", [])],
      {},
    ),
  );
  assert.ok(block.includes("战女王"));
  assert.ok(block.includes("唐兰嫣"));
  assert.ok(block.includes("未处理"));
}

console.log("character-entity-ops.test.ts OK");
