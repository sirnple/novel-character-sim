/**
 * Test shared store semantics: outline reset, dimension overwrite, save/get consistency.
 * Run: `ts-node scripts/test-shared-store.ts` or compile+run.
 */
const assert = require("node:assert/strict");
const {
  _resetStore,
  saveOutline, getOutline,
  saveProse, getProse,
  saveFindings, getFindings, clearFindings,
} = require("../src/core/agents/intermediate-store");

async function test(name: string, fn: () => void | Promise<void>) {
  console.log(`[test] ${name}...`);
  try {
    await fn();
    console.log(`  ✓`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  ✗ FAILED: ${msg}`);
    process.exitCode = 1;
  }
}

async function main() {
  _resetStore();
  const N1 = "novel_a", B1 = "main";
  const N2 = "novel_a", B2 = "if_branch"; // same novel, different branch
  const N3 = "novel_b", B3 = "main"; // different novel

  // 1. save→get round-trip
  await test("saveOutline → getOutline", () => {
    saveOutline(N1, B1, "大纲正文");
    assert.equal(getOutline(N1, B1), "大纲正文");
  });

  await test("saveProse → getProse", () => {
    saveProse(N1, B1, "正文内容");
    assert.equal(getProse(N1, B1), "正文内容");
  });

  await test("saveFindings → getFindings", async () => {
    await saveFindings(N1, B1, [{ dimension: "character", severity: "major", description: "问题1", suggestion: "改" }]);
    const f = getFindings(N1, B1);
    assert.equal(f.length, 1);
    assert.equal(f[0].dimension, "character");
  });

  // 2. outline reset clears prose + findings
  await test("saveOutline clears prose + findings", () => {
    saveOutline(N1, B1, "新版大纲");
    assert.equal(getProse(N1, B1), undefined, "prose should be cleared");
    assert.equal(getFindings(N1, B1).length, 0, "findings should be cleared");
    assert.equal(getOutline(N1, B1), "新版大纲", "outline set correctly");
  });

  // 3. dimension overwrite: same dimension replaces, different dims accumulate
  await test("saveFindings overwrites by dimension", async () => {
    await saveFindings(N1, B1, [{ dimension: "character", severity: "minor", description: "旧的", suggestion: "忽略" }]);
    await saveFindings(N1, B1, [{ dimension: "continuity", severity: "major", description: "旧的连续", suggestion: "改" }]);
    assert.equal(getFindings(N1, B1).length, 2);

    await saveFindings(N1, B1, [{ dimension: "character", severity: "critical", description: "新的", suggestion: "改" }]);
    const f = getFindings(N1, B1);
    assert.equal(f.length, 2, "still 2 total (1 character + 1 continuity)");
    const charFind = f.find((x: any) => x.dimension === "character");
    assert.equal(charFind?.description, "新的", "character dimension should be replaced");
    assert.equal(charFind?.severity, "critical", "severity updated");
    const contFind = f.find((x: any) => x.dimension === "continuity");
    assert.equal(contFind?.description, "旧的连续", "continuity dimension unchanged");
  });

  // 4. clearFindings only clears findings, keeps outline+prose
  await test("clearFindings", async () => {
    saveOutline(N1, B1, "大纲");
    saveProse(N1, B1, "正文");
    await saveFindings(N1, B1, [{ dimension: "test", severity: "minor", description: "测试", suggestion: "" }]);
    await clearFindings(N1, B1);
    assert.equal(getFindings(N1, B1).length, 0, "findings empty");
    assert.equal(getOutline(N1, B1), "大纲", "outline kept");
    assert.equal(getProse(N1, B1), "正文", "prose kept");
  });

  // 5. per-branch isolation
  await test("per-branch isolation (same novel, different branch)", () => {
    saveOutline(N1, B1, "主线大纲");
    saveOutline(N1, B2, "IF分支大纲");
    assert.equal(getOutline(N1, B1), "主线大纲");
    assert.equal(getOutline(N1, B2), "IF分支大纲");
    saveProse(N1, B1, "主线正文");
    assert.equal(getProse(N1, B1), "主线正文");
    assert.equal(getProse(N1, B2), undefined, "IF should not have prose");
  });

  await test("per-novel isolation (different novel)", () => {
    saveOutline(N1, B1, "小说A大纲");
    saveOutline(N3, B3, "小说B大纲");
    assert.equal(getOutline(N1, B1), "小说A大纲");
    assert.equal(getOutline(N3, B3), "小说B大纲");
  });

  // 6. edge: get_outline before save returns undefined
  await test("getOutline before save", () => {
    const o = getOutline("nonexistent", "unknown");
    assert.equal(o, undefined);
  });

  // 7. getFindings empty
  await test("getFindings after clear is empty array", () => {
    const f = getFindings("nonexistent", "unknown");
    assert.ok(Array.isArray(f));
    assert.equal(f.length, 0);
  });
}

main().then(() => {
  if (!process.exitCode) console.log("\nAll tests passed ✓");
  else console.log("\nSome tests FAILED ✗");
});
