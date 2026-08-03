/**
 * Intermediate session store: round-trip, isolation, clear-on-outline.
 * Imports shipped intermediate-store (not a reimplementation).
 */
import { assert, suiteAsync, test, testAsync } from "../lib/test-harness";
import {
  _resetStore,
  clearFindings,
  getFindings,
  getOutline,
  getProse,
  saveFindings,
  saveOutline,
  saveProse,
} from "../../src/core/agents/intermediate-store";

export async function runIntermediateStoreTests(): Promise<void> {
  await suiteAsync("intermediate-store", async () => {
    test("setup: reset store", () => {
      _resetStore();
    });

    test("saveOutline → getOutline round-trip", () => {
      saveOutline("novel_a", "main", "大纲正文");
      assert.equal(getOutline("novel_a", "main"), "大纲正文");
    });

    test("saveProse → getProse round-trip", () => {
      saveProse("novel_a", "main", "正文内容足够长一点用于存取");
      assert.equal(getProse("novel_a", "main"), "正文内容足够长一点用于存取");
    });

    await testAsync("saveFindings → getFindings round-trip", async () => {
      await saveFindings("novel_a", "main", [
        {
          dimension: "character",
          severity: "major",
          description: "问题1",
          suggestion: "改",
        },
      ]);
      const f = getFindings("novel_a", "main");
      assert.equal(f.length, 1);
      assert.equal(f[0].dimension, "character");
    });

    test("saveOutline clears prose + findings (keeps new outline)", () => {
      saveOutline("novel_a", "main", "新版大纲");
      assert.equal(getProse("novel_a", "main"), undefined, "prose should be cleared");
      assert.equal(getFindings("novel_a", "main").length, 0, "findings should be cleared");
      assert.equal(getOutline("novel_a", "main"), "新版大纲");
    });

    await testAsync("parallel saveFindings does not drop other dims", async () => {
      _resetStore();
      await Promise.all(
        (
          [
            ["character", "角色问题"],
            ["continuity", "连贯问题"],
            ["style", "风格问题"],
            ["world", "世界问题"],
            ["pacing", "节奏问题"],
            ["foreshadowing", "伏笔问题"],
          ] as const
        ).map(([dim, desc]) =>
          saveFindings(
            "novel_a",
            "main",
            [
              {
                dimension: dim,
                severity: "major",
                description: desc,
                suggestion: "改",
              },
            ],
            { dimension: dim, overwrite: true },
          ),
        ),
      );
      const f = getFindings("novel_a", "main");
      assert.equal(
        f.length,
        6,
        `expected 6 dims, got ${f.length}: ${JSON.stringify(f)}`,
      );
      for (const dim of [
        "character",
        "continuity",
        "style",
        "world",
        "pacing",
        "foreshadowing",
      ]) {
        assert.ok(f.some((x) => x.dimension === dim), `missing dim ${dim}`);
      }
    });

    await testAsync("saveFindings overwrites by dimension", async () => {
      _resetStore();
      await saveFindings("novel_a", "main", [
        {
          dimension: "character",
          severity: "minor",
          description: "旧的",
          suggestion: "忽略",
        },
      ]);
      await saveFindings("novel_a", "main", [
        {
          dimension: "continuity",
          severity: "major",
          description: "旧的连续",
          suggestion: "改",
        },
      ]);
      assert.equal(getFindings("novel_a", "main").length, 2);

      await saveFindings("novel_a", "main", [
        {
          dimension: "character",
          severity: "critical",
          description: "新的",
          suggestion: "改",
        },
      ]);
      const f = getFindings("novel_a", "main");
      assert.equal(f.length, 2, "still 2 total (1 character + 1 continuity)");
      const charFind = f.find((x) => x.dimension === "character");
      assert.equal(charFind?.description, "新的");
      assert.equal(charFind?.severity, "critical");
      const contFind = f.find((x) => x.dimension === "continuity");
      assert.equal(contFind?.description, "旧的连续");
    });

    await testAsync("empty findings + dimension clears only that dim", async () => {
      _resetStore();
      await saveFindings("novel_a", "main", [
        {
          dimension: "character",
          severity: "major",
          description: "角色问题",
          suggestion: "改",
        },
      ]);
      await saveFindings("novel_a", "main", [
        {
          dimension: "continuity",
          severity: "major",
          description: "连贯问题",
          suggestion: "改",
        },
      ]);
      await saveFindings("novel_a", "main", [], {
        dimension: "review_character",
        overwrite: true,
      });
      const f = getFindings("novel_a", "main");
      assert.equal(f.length, 1);
      assert.equal(f[0].dimension, "continuity");
    });

    await testAsync("overwrite=false appends same dimension", async () => {
      _resetStore();
      await saveFindings("novel_a", "main", [
        {
          dimension: "style",
          severity: "minor",
          description: "A",
          suggestion: "改",
        },
      ]);
      await saveFindings(
        "novel_a",
        "main",
        [
          {
            dimension: "style",
            severity: "minor",
            description: "B",
            suggestion: "改",
          },
        ],
        { dimension: "style", overwrite: false },
      );
      const f = getFindings("novel_a", "main").filter(
        (x) => x.dimension === "style",
      );
      assert.equal(f.length, 2);
    });

    await testAsync("clearFindings keeps outline + prose", async () => {
      saveOutline("novel_a", "main", "大纲");
      saveProse("novel_a", "main", "正文");
      await saveFindings("novel_a", "main", [
        {
          dimension: "test",
          severity: "minor",
          description: "测试",
          suggestion: "",
        },
      ]);
      await clearFindings("novel_a", "main");
      assert.equal(getFindings("novel_a", "main").length, 0);
      assert.equal(getOutline("novel_a", "main"), "大纲");
      assert.equal(getProse("novel_a", "main"), "正文");
    });

    await testAsync("clearFindings by dimension only", async () => {
      await saveFindings("novel_a", "main", [
        {
          dimension: "world",
          severity: "minor",
          description: "W",
          suggestion: "改",
        },
      ]);
      await saveFindings("novel_a", "main", [
        {
          dimension: "pacing",
          severity: "minor",
          description: "P",
          suggestion: "改",
        },
      ]);
      await clearFindings("novel_a", "main", "review_world");
      const f = getFindings("novel_a", "main");
      assert.equal(f.length, 1);
      assert.equal(f[0].dimension, "pacing");
    });

    test("per-branch isolation (same novel)", () => {
      saveOutline("novel_a", "main", "主线大纲");
      saveOutline("novel_a", "if_branch", "IF分支大纲");
      assert.equal(getOutline("novel_a", "main"), "主线大纲");
      assert.equal(getOutline("novel_a", "if_branch"), "IF分支大纲");
      saveProse("novel_a", "main", "主线正文");
      assert.equal(getProse("novel_a", "main"), "主线正文");
      assert.equal(getProse("novel_a", "if_branch"), undefined);
    });

    test("per-novel isolation", () => {
      saveOutline("novel_a", "main", "小说A大纲");
      saveOutline("novel_b", "main", "小说B大纲");
      assert.equal(getOutline("novel_a", "main"), "小说A大纲");
      assert.equal(getOutline("novel_b", "main"), "小说B大纲");
    });

    test("getOutline before save is undefined", () => {
      assert.equal(getOutline("nonexistent", "unknown"), undefined);
    });

    test("getFindings empty for unknown key", () => {
      const f = getFindings("nonexistent", "unknown");
      assert.ok(Array.isArray(f));
      assert.equal(f.length, 0);
    });
  });
}
