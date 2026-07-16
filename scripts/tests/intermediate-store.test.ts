/**
 * Intermediate session store: round-trip, isolation, clear-on-outline.
 * Imports shipped intermediate-store (not a reimplementation).
 */
import { assert, suite, test } from "../lib/test-harness";
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

export function runIntermediateStoreTests(): void {
  suite("intermediate-store", () => {
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

    test("saveFindings → getFindings round-trip", () => {
      saveFindings("novel_a", "main", [
        { dimension: "char", severity: "major", description: "问题1", suggestion: "改" },
      ]);
      const f = getFindings("novel_a", "main");
      assert.equal(f.length, 1);
      assert.equal(f[0].dimension, "char");
    });

    test("saveOutline clears prose + findings (keeps new outline)", () => {
      saveOutline("novel_a", "main", "新版大纲");
      assert.equal(getProse("novel_a", "main"), undefined, "prose should be cleared");
      assert.equal(getFindings("novel_a", "main").length, 0, "findings should be cleared");
      assert.equal(getOutline("novel_a", "main"), "新版大纲");
    });

    test("saveFindings overwrites by dimension", () => {
      saveFindings("novel_a", "main", [
        { dimension: "char", severity: "minor", description: "旧的", suggestion: "忽略" },
      ]);
      saveFindings("novel_a", "main", [
        { dimension: "cont", severity: "major", description: "旧的连续", suggestion: "改" },
      ]);
      assert.equal(getFindings("novel_a", "main").length, 2);

      saveFindings("novel_a", "main", [
        { dimension: "char", severity: "critical", description: "新的", suggestion: "改" },
      ]);
      const f = getFindings("novel_a", "main");
      assert.equal(f.length, 2, "still 2 total (1 char + 1 cont)");
      const charFind = f.find((x) => x.dimension === "char");
      assert.equal(charFind?.description, "新的");
      assert.equal(charFind?.severity, "critical");
      const contFind = f.find((x) => x.dimension === "cont");
      assert.equal(contFind?.description, "旧的连续");
    });

    test("clearFindings keeps outline + prose", () => {
      saveOutline("novel_a", "main", "大纲");
      saveProse("novel_a", "main", "正文");
      saveFindings("novel_a", "main", [
        { dimension: "test", severity: "minor", description: "测试", suggestion: "" },
      ]);
      clearFindings("novel_a", "main");
      assert.equal(getFindings("novel_a", "main").length, 0);
      assert.equal(getOutline("novel_a", "main"), "大纲");
      assert.equal(getProse("novel_a", "main"), "正文");
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
