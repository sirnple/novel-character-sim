/**
 * merge / split ops for global coref
 */
import assert from "node:assert/strict";
import { applyEntityOps } from "../../src/core/extractor/character-entity-ops";
import type { ResolvedEntity } from "../../src/core/extractor/character-entity-types";
import { buildLocalEntitiesFromUnitHits } from "../../src/core/extractor/character-local-entities";
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

console.log("character-entity-ops.test.ts OK");
