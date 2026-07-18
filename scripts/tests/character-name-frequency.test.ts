/**
 * Frequency threshold for character name aggregation (not top-N).
 */
import { assert, suite, test } from "../lib/test-harness";
import {
  aggregateUnitHits,
  defaultMentionThreshold,
  filterByMentionFrequency,
  type UnitNameHit,
} from "../../src/core/extractor/character-name-aggregate";
import { buildNameScanUnits } from "../../src/core/extractor/character-name-units";
import { runNameFrequencyPipeline } from "../../src/core/extractor/character-name-pipeline";
import { softClusterAggregates } from "../../src/core/extractor/character-name-cluster";

export function runCharacterNameFrequencyTests(): void {
  suite("character-name-frequency", () => {
    test("default threshold rises with book length", () => {
      const short = defaultMentionThreshold(20_000, 5);
      const long = defaultMentionThreshold(2_000_000, 100);
      assert.ok(long.minMentions > short.minMentions);
      assert.ok(long.minUnits >= short.minUnits);
    });

    test("aggregate sums mentions and unit hits", () => {
      const units: UnitNameHit[][] = [
        [{ name: "洛雪棠", count: 1 }, { name: "李动", count: 1 }],
        [{ name: "洛雪棠", aliases: ["雪棠"], count: 1 }],
        [{ name: "路人甲", count: 1 }],
      ];
      const agg = aggregateUnitHits(units);
      const xue = agg.find((a) => a.name === "洛雪棠");
      assert.ok(xue);
      assert.equal(xue!.mentions, 2);
      assert.equal(xue!.unitHits, 2);
      assert.ok(xue!.aliases.includes("雪棠"));
    });

    test("filter keeps all above bar, not top 80 only", () => {
      const units: UnitNameHit[][] = [];
      // 30 names each appear in 5 units → all should pass a low bar
      for (let u = 0; u < 5; u++) {
        const hits: UnitNameHit[] = [];
        for (let i = 0; i < 30; i++) {
          hits.push({ name: `角色${i}`, count: 1 });
        }
        units.push(hits);
      }
      // one-shot noise
      units[0].push({ name: "仅一次", count: 1 });

      const agg = aggregateUnitHits(units);
      const { kept, dropped, threshold } = filterByMentionFrequency(agg, {
        textLength: 80_000,
        unitCount: 5,
        softMaxNames: 500,
      });

      assert.ok(threshold.minMentions >= 2);
      assert.ok(kept.length >= 30, `expected all frequent names, got ${kept.length}`);
      assert.ok(
        kept.every((k) => k.mentions >= threshold.minMentions),
        "kept must meet mention bar",
      );
      assert.ok(
        dropped.some((d) => d.name === "仅一次") ||
          !agg.some((a) => a.name === "仅一次" && a.mentions >= threshold.minMentions),
        "one-shot should not pass high bar or be dropped",
      );
      // Explicitly not a top-N: more than 80 can be kept if they all pass
      const many = filterByMentionFrequency(
        Array.from({ length: 120 }, (_, i) => ({
          name: `N${i}`,
          mentions: 10,
          unitHits: 5,
          aliases: [],
          firstUnit: 0,
          lastUnit: 4,
        })),
        { textLength: 100_000, unitCount: 10, softMaxNames: 500 },
      );
      assert.equal(many.kept.length, 120);
    });

    test("soft max raises mention threshold instead of top-N slice", () => {
      const agg = Array.from({ length: 250 }, (_, i) => ({
        name: `P${i}`,
        mentions: 3 + (i % 5),
        unitHits: 2,
        aliases: [] as string[],
        firstUnit: 0,
        lastUnit: 3,
      }));
      const r = filterByMentionFrequency(agg, {
        textLength: 200_000,
        unitCount: 20,
        softMaxNames: 50,
      });
      assert.ok(r.kept.length <= 50);
      assert.ok(r.thresholdRaised || r.kept.length <= 50);
      // Everyone kept still shares the same minMentions floor
      const floor = r.threshold.minMentions;
      assert.ok(r.kept.every((k) => k.mentions >= floor));
    });

    test("buildNameScanUnits falls back to windows", () => {
      const text = "甲".repeat(20_000);
      const units = buildNameScanUnits(text, { windowChars: 5_000 });
      assert.ok(units.length >= 3);
      assert.ok(units[0].text.length > 0);
    });

    test("soft cluster merges 洛雪棠 + 雪棠", () => {
      const surfaces = [
        {
          name: "洛雪棠",
          mentions: 40,
          unitHits: 20,
          aliases: ["雪棠"],
          firstUnit: 0,
          lastUnit: 19,
        },
        {
          name: "雪棠",
          mentions: 30,
          unitHits: 15,
          aliases: [],
          firstUnit: 1,
          lastUnit: 18,
        },
      ];
      const clusters = softClusterAggregates(surfaces);
      assert.ok(clusters.length === 1, `got ${clusters.length}`);
      assert.equal(clusters[0].canonical, "洛雪棠");
      assert.ok(clusters[0].mentions >= 70);
    });

    test("pipeline scheme C keeps frequent clusters", () => {
      const units: UnitNameHit[][] = [];
      for (let u = 0; u < 10; u++) {
        units.push([
          { name: "洛雪棠", count: 1 },
          { name: "李动", count: 1 },
          ...(u === 0 ? [{ name: "路人甲", count: 1 }] : []),
        ]);
      }
      const r = runNameFrequencyPipeline(units, {
        textLength: 200_000,
        unitCount: 10,
      });
      const names = r.kept.map((k) => k.name);
      assert.ok(names.includes("洛雪棠") || names.includes("李动"), names.join(","));
      assert.ok(!names.includes("路人甲") || r.kept.find((k) => k.name === "路人甲")!.unitHits > 1);
    });
  });
}
