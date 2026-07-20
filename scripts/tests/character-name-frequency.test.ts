/**
 * Frequency threshold + entity counting after coref (pipeline A).
 */
import { assert, suite, suiteAsync, test, testAsync } from "../lib/test-harness";
import {
  aggregateUnitHits,
  defaultMentionThreshold,
  filterByMentionFrequency,
  type UnitNameHit,
} from "../../src/core/extractor/character-name-aggregate";
import {
  buildNameScanUnits,
  packUnitsForMentionScan,
} from "../../src/core/extractor/character-name-units";
import {
  distributeHitsToUnits,
  formatMentionScanBatchText,
} from "../../src/core/extractor/character-name-scan";
import { buildSurfaceCatalog } from "../../src/core/extractor/character-surface-catalog";
import { countResolvedEntities } from "../../src/core/extractor/character-entity-frequency";
import {
  findFirstSecondPersonAliasIssues,
  isFirstOrSecondPersonDeictic,
  mergeResolvedEntities,
  normalizeResolvedEntities,
} from "../../src/core/extractor/character-entity-types";
import {
  buildRosterCandidateCards,
  gateRosterWithLlm,
} from "../../src/core/extractor/character-roster-gate";
import {
  LOOKUP_OFFSET_BATCH_MAX,
  LOOKUP_SURFACE_BATCH_MAX,
  parseOffsetBatch,
  parseSurfaceBatch,
} from "../../src/core/agents/agents/character-extract-tools";
import { formatBatchOverflowNotice } from "../../src/core/agents/batch-tool-limits";
import {
  formatSurfaceCandidatesForPrompt,
} from "../../src/core/extractor/character-surface-catalog";
import {
  formatAnchorId,
  normalizeAnchors,
  sampleAnchors,
} from "../../src/core/extractor/mention-anchor";
import type { LLMProvider } from "../../src/types";

export async function runCharacterNameFrequencyTests(): Promise<void> {
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

    test("packUnitsForMentionScan merges under char budget", () => {
      const units = Array.from({ length: 10 }, (_, i) => ({
        index: i,
        label: `第${i + 1}章`,
        start: i * 1000,
        end: (i + 1) * 1000,
        text: "字".repeat(1000),
      }));
      const batches = packUnitsForMentionScan(units, {
        maxChars: 3500,
        maxUnits: 6,
      });
      assert.ok(batches.length >= 3);
      assert.ok(batches.every((b) => b.length >= 1 && b.length <= 6));
      const total = batches.reduce((n, b) => n + b.length, 0);
      assert.equal(total, 10);
    });

    test("distributeHitsToUnits attributes by presence", () => {
      const batch = [
        {
          index: 0,
          label: "A",
          start: 0,
          end: 10,
          text: "孙悟空来了",
        },
        {
          index: 1,
          label: "B",
          start: 10,
          end: 20,
          text: "唐僧取经",
        },
      ];
      const hits = [
        { name: "孙悟空", aliases: ["齐天大圣"], count: 1 },
        { name: "唐僧", aliases: [], count: 1 },
      ];
      const d = distributeHitsToUnits(batch, hits);
      assert.equal(d[0].length, 1);
      assert.equal(d[0][0].name, "孙悟空");
      assert.equal(d[1].length, 1);
      assert.equal(d[1][0].name, "唐僧");
      const fmt = formatMentionScanBatchText(batch, 50_000);
      assert.ok(fmt.text.includes("### A"));
      assert.ok(fmt.text.includes("### B"));
    });

    test("entity count sums surfaces after coref (孙悟空 + 齐天大圣)", () => {
      const fullText =
        "话说孙悟空大闹天宫。齐天大圣又来了。猪八戒天蓬元帅来也。悟空打了妖精。";
      const mid = fullText.indexOf("猪八戒");
      const units = [
        {
          index: 0,
          label: "第1回",
          start: 0,
          end: mid,
          text: fullText.slice(0, mid),
        },
        {
          index: 1,
          label: "第2回",
          start: mid,
          end: fullText.length,
          text: fullText.slice(mid),
        },
      ];
      const unitHits: UnitNameHit[][] = [
        [
          { name: "孙悟空", aliases: ["齐天大圣"], count: 1 },
          { name: "悟空", count: 1 },
        ],
        [
          { name: "猪八戒", aliases: ["天蓬元帅"], count: 1 },
          { name: "悟空", count: 1 },
        ],
      ];
      const catalog = buildSurfaceCatalog(unitHits, units, fullText);
      const counted = countResolvedEntities(
        [
          {
            name: "孙悟空",
            aliases: ["齐天大圣", "悟空"],
            surfaces: ["孙悟空", "齐天大圣", "悟空"],
          },
          {
            name: "猪八戒",
            aliases: ["天蓬元帅"],
            surfaces: ["猪八戒", "天蓬元帅"],
          },
        ],
        catalog,
      );
      const swk = counted.find((c) => c.name === "孙悟空");
      assert.ok(swk, "missing 孙悟空");
      assert.ok((swk!.unitHits || 0) >= 2, `unitHits=${swk!.unitHits}`);
      assert.ok((swk!.mentions || 0) >= 2, `mentions=${swk!.mentions}`);
      assert.ok(swk!.aliases.includes("齐天大圣") || swk!.aliases.includes("悟空"));
    });

    test("entity frequency gate keeps frequent people only", () => {
      const units: UnitNameHit[][] = [];
      for (let u = 0; u < 10; u++) {
        units.push([
          { name: "孙悟空", count: 1 },
          { name: "猪八戒", count: 1 },
          ...(u === 0 ? [{ name: "路人甲", count: 1 }] : []),
        ]);
      }
      const agg = aggregateUnitHits(units);
      // Simulate post-coref entities (one row per person)
      const asEntities = agg.map((a) => ({
        ...a,
        unitIndices: undefined as number[] | undefined,
      }));
      const r = filterByMentionFrequency(asEntities, {
        textLength: 200_000,
        unitCount: 10,
      });
      const names = r.kept.map((k) => k.name);
      assert.ok(names.includes("孙悟空") || names.includes("猪八戒"), names.join(","));
      const passerby = r.kept.find((k) => k.name === "路人甲");
      assert.ok(!passerby || passerby.unitHits > 1);
    });

    test("buildRosterCandidateCards exposes mentions as model features", () => {
      const entities = [
        {
          name: "周屿",
          aliases: ["屿哥"],
          role: "protagonist",
          briefDescription: "男主",
          surfaces: ["周屿", "屿哥"],
        },
        {
          name: "周屿的母亲",
          aliases: [],
          role: "supporting",
          briefDescription: "已故",
          surfaces: ["周屿的母亲"],
        },
      ];
      const counted = [
        {
          name: "周屿",
          mentions: 50,
          unitHits: 20,
          aliases: ["屿哥"],
          firstUnit: 0,
          lastUnit: 19,
        },
        {
          name: "周屿的母亲",
          mentions: 1,
          unitHits: 1,
          aliases: [] as string[],
          firstUnit: 0,
          lastUnit: 0,
        },
      ];
      const cards = buildRosterCandidateCards(entities as any, counted);
      assert.equal(cards.length, 2);
      assert.equal(cards[0].name, "周屿");
      assert.equal(cards[0].mentions, 50);
      assert.ok(cards.some((c) => c.name === "周屿的母亲" && c.mentions === 1));
    });

  });

  suite("third-person-aliases-on-submit", () => {
    test("findFirstSecondPersonAliasIssues flags 我爸/你妈 for submit reject", () => {
      assert.ok(isFirstOrSecondPersonDeictic("我爸"));
      assert.ok(isFirstOrSecondPersonDeictic("我屿哥"));
      assert.ok(!isFirstOrSecondPersonDeictic("周屿的父亲"));
      assert.ok(!isFirstOrSecondPersonDeictic("屿哥"));

      const issues = findFirstSecondPersonAliasIssues([
        {
          name: "周伯彦",
          aliases: ["周总", "我爸", "你爸"],
        },
        { name: "周屿", aliases: ["屿哥"] },
      ]);
      assert.ok(issues.some((x) => x.includes("我爸")), issues.join(","));
      assert.ok(issues.some((x) => x.includes("你爸")), issues.join(","));
      assert.ok(!issues.some((x) => x.includes("屿哥")));
    });

    test("normalize preserves agent names; validate catches deictic aliases", () => {
      const {
        validateSubmitEntities,
      } = require("../../src/core/extractor/character-entity-types") as typeof import("../../src/core/extractor/character-entity-types");
      const ents = normalizeResolvedEntities([
        {
          name: "周伯彦",
          aliases: ["周总", "我爸", "周屿的父亲"],
          surfaces: ["周伯彦", "我爸"],
        },
      ]);
      assert.equal(ents.length, 1);
      assert.equal(ents[0].name, "周伯彦");
      assert.ok(ents[0].aliases.includes("周总"));
      // No silent strip — agent must fix; validate reports 我爸
      assert.ok(ents[0].aliases.includes("我爸"));
      const issues = validateSubmitEntities(ents);
      assert.ok(issues.some((x) => x.includes("我爸")), issues.join(","));
    });

    test("mergeResolvedEntities accumulates batches by name", () => {
      const batch1 = normalizeResolvedEntities([
        { name: "周屿", aliases: ["屿哥"], role: "protagonist" },
        { name: "周伯彦", aliases: ["周总"] },
      ]);
      const batch2 = normalizeResolvedEntities([
        { name: "周屿", aliases: ["周屿哥哥"] },
        { name: "黑仔", aliases: [] },
      ]);
      const merged = mergeResolvedEntities(batch1, batch2);
      assert.equal(merged.length, 3);
      const yu = merged.find((e) => e.name === "周屿")!;
      assert.ok(yu.aliases.includes("屿哥"));
      assert.ok(yu.aliases.includes("周屿哥哥"));
      assert.ok(merged.some((e) => e.name === "黑仔"));
      assert.ok(merged.some((e) => e.name === "周伯彦"));
    });

    test("parseSurfaceBatch accepts surfaces array and de-dupes", () => {
      const s = parseSurfaceBatch({
        surfaces: ["周总", "周伯彦", "周总"],
      });
      assert.deepEqual(s, ["周总", "周伯彦"]);
      assert.ok(LOOKUP_SURFACE_BATCH_MAX >= 8);
      assert.ok(LOOKUP_OFFSET_BATCH_MAX >= 8);
    });

    test("parseOffsetBatch accepts offsets_json objects", () => {
      const r = parseOffsetBatch({
        offsets_json: JSON.stringify([
          { offset: 100, length: 200 },
          500,
          { offset: 100 },
        ]),
      });
      assert.equal(r.length, 2);
      assert.equal(r[0].offset, 100);
      assert.equal(r[0].length, 200);
      assert.equal(r[1].offset, 500);
    });

    test("formatBatchOverflowNotice steers shrink-batch then single", () => {
      const n = formatBatchOverflowNotice({
        itemLabel: "称呼",
        toolHint: "lookup_surface(surfaces=[...])",
        requested: 12,
        returned: 10,
        omitted: ["甲", "乙"],
        reason: "count_cap",
        countCap: 10,
      });
      assert.ok(n.includes("输出超限"), n);
      assert.ok(n.includes("缩小批量") || n.includes("优先仍批量"), n);
      assert.ok(n.includes("单独调用") || n.includes("单条"), n);
      assert.ok(n.includes("甲"));
    });

    test("buildSurfaceCatalog attaches position anchors", () => {
      const text =
        "第一章 孙悟空出世。\n\n".repeat(3) +
        "中间填充字样".repeat(50) +
        "\n\n后文 齐天大圣大闹天宫。孙悟空又现。";
      const units = buildNameScanUnits(text);
      const unitHits = units.map((u) => {
        const hits: UnitNameHit[] = [];
        if (u.text.includes("孙悟空")) hits.push({ name: "孙悟空", count: 1 });
        if (u.text.includes("齐天大圣"))
          hits.push({ name: "齐天大圣", aliases: ["孙悟空"], count: 1 });
        return hits;
      });
      const catalog = buildSurfaceCatalog(unitHits, units, text);
      const st = catalog.getStat("孙悟空");
      assert.ok(st, "孙悟空 in catalog");
      assert.ok((st!.anchors?.length || 0) >= 1, JSON.stringify(st));
      assert.ok(st!.anchors![0].offset >= 0);
      const listed = formatSurfaceCandidatesForPrompt([st!]);
      assert.ok(listed.includes("a@") || listed.includes("锚点"), listed);
      const hits = catalog.lookup("孙悟空", 3);
      assert.ok(hits.length >= 1);
      assert.ok(hits[0].anchorId.startsWith("a@"), hits[0].anchorId);
    });

    test("normalizeAnchors accepts a@offset strings", () => {
      const a = normalizeAnchors(["a@100", { offset: 200, unitLabel: "第2章" }, 100]);
      assert.equal(a.length, 2);
      assert.equal(a[0].offset, 100);
      assert.equal(a[1].offset, 200);
      assert.equal(formatAnchorId(a[0]), "a@100");
    });

    test("sampleAnchors keeps first and last", () => {
      const many = Array.from({ length: 20 }, (_, i) => ({ offset: i * 10 }));
      const s = sampleAnchors(many, 4);
      assert.ok(s.length <= 4);
      assert.equal(s[0].offset, 0);
      assert.equal(s[s.length - 1].offset, 190);
    });
  });

  await suiteAsync("character-roster-llm-gate", async () => {
    await testAsync(
      "LLM roster gate uses model keep list; mentions are not hard drop",
      async () => {
        const entities = [
          {
            name: "周屿",
            aliases: [],
            role: "protagonist",
            surfaces: ["周屿"],
          },
          {
            name: "周屿的母亲",
            aliases: [],
            role: "supporting",
            briefDescription: "已故",
            surfaces: ["周屿的母亲"],
          },
          {
            name: "路人甲",
            aliases: [],
            role: "extra",
            surfaces: ["路人甲"],
          },
        ];
        const counted = [
          {
            name: "周屿",
            mentions: 50,
            unitHits: 20,
            aliases: [] as string[],
            firstUnit: 0,
            lastUnit: 19,
          },
          {
            name: "周屿的母亲",
            mentions: 1,
            unitHits: 1,
            aliases: [] as string[],
            firstUnit: 0,
            lastUnit: 0,
          },
          {
            name: "路人甲",
            mentions: 1,
            unitHits: 1,
            aliases: [] as string[],
            firstUnit: 0,
            lastUnit: 0,
          },
        ];
        const mockLlm = {
          async chatWithTool() {
            return {
              keep: [
                { name: "周屿", reason: "主角" },
                { name: "周屿的母亲", reason: "主角母亲虽少出场" },
              ],
            };
          },
          async chat() {
            return '{"keep":[]}';
          },
        } as unknown as LLMProvider;

        const r = await gateRosterWithLlm(mockLlm, entities as any, counted, {
          textLength: 140_000,
          unitCount: 26,
        });
        const names = r.kept.map((k) => k.name);
        assert.ok(names.includes("周屿"), names.join(","));
        assert.ok(names.includes("周屿的母亲"), names.join(","));
        assert.ok(!names.includes("路人甲"), names.join(","));
        assert.ok(!r.fallbackAll);
        assert.ok((r.reasons["周屿的母亲"] || "").includes("母亲"));
      },
    );
  });
}
