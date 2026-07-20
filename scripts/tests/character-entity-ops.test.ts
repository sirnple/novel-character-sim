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
    ent("洛雪棠", [], [{ offset: 100, surface: "洛雪棠" }]),
    ent("洛大小姐", [], [{ offset: 200, surface: "洛大小姐" }]),
  ];
  const { entities, log } = applyEntityOps(roster, [
    { op: "merge", keep: "洛雪棠", absorb: ["洛大小姐"] },
  ]);
  assert.equal(entities.length, 1);
  assert.equal(entities[0].name, "洛雪棠");
  assert.ok(entities[0].aliases.includes("洛大小姐") || entities[0].surfaces?.includes("洛大小姐"));
  assert.ok(log.some((l) => l.includes("merge")));
}

// --- split by surface ---
{
  const roster = [
    ent(
      "洛雪棠",
      ["洛大小姐", "那位小姐"],
      [
        { offset: 1, surface: "洛雪棠" },
        { offset: 2, surface: "洛大小姐" },
        { offset: 9, surface: "那位小姐" },
      ],
    ),
  ];
  const { entities } = applyEntityOps(roster, [
    {
      op: "split",
      from: "洛雪棠",
      move_surfaces: ["那位小姐"],
      new_name: "沈薇薇",
    },
  ]);
  assert.equal(entities.length, 2);
  const main = entities.find((e) => e.name === "洛雪棠" || e.aliases.includes("洛大小姐"));
  const other = entities.find((e) => e.name === "沈薇薇" || e.aliases.includes("那位小姐") || e.name === "那位小姐");
  assert.ok(main);
  assert.ok(other);
  assert.ok(!(main!.aliases || []).includes("那位小姐"));
}

// --- local entities from unit hits ---
{
  const units: TextUnit[] = [
    {
      index: 0,
      label: "第1章",
      start: 0,
      end: 50,
      text: "洛雪棠，洛大小姐堪称人间绝色",
    },
  ];
  const full = units[0].text;
  const hits: UnitNameHit[][] = [
    [{ name: "洛雪棠", aliases: ["洛大小姐"], count: 1 }],
  ];
  const locals = buildLocalEntitiesFromUnitHits(units, hits, full);
  assert.equal(locals.length, 1);
  assert.equal(locals[0].name, "洛雪棠");
  assert.deepEqual(locals[0].aliases, ["洛大小姐"]);
  assert.ok((locals[0].anchors?.length || 0) >= 1);
}

console.log("character-entity-ops.test.ts OK");
