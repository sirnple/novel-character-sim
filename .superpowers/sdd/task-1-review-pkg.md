# Review package Task 1
Base: df014a4d3f7cccfd1abf81a4724cbf72cd9c0712
Head: 5edf6a0a061a1c62e0726502d310e826879d2a40

## Commits
5edf6a0 feat(form): pure agent context payload for chaptering rules


## Stat
 scripts/run-tests.ts               |   2 +
 scripts/tests/form-context.test.ts | 145 +++++++++++++++++++++++++++++++++++++
 src/core/form/form-context.ts      | 102 ++++++++++++++++++++++++++
 3 files changed, 249 insertions(+)


## Diff
diff --git a/scripts/run-tests.ts b/scripts/run-tests.ts
index 8875229..7e25275 100644
--- a/scripts/run-tests.ts
+++ b/scripts/run-tests.ts
@@ -5,30 +5,32 @@
 import { resetCounters, summary } from "./lib/test-harness";
 import { runProseGuardTests } from "./tests/prose-guard.test";
 import { runIntermediateStoreTests } from "./tests/intermediate-store.test";
 import { runCriticalMissTests } from "./tests/critical-miss.test";
 import { runSaveVerifyTests } from "./tests/save-verify.test";
 import { runCommitRealizationTests } from "./tests/commit-realization.test";
 import { runAcceptContinuationTests } from "./tests/accept-continuation.test";
 import { runTextWindowTests } from "./tests/text-window.test";
 import { runBranchCowTests } from "./tests/branch-cow.test";
 import { runChapterCatalogTests } from "./tests/chapter-catalog.test";
+import { runFormContextTests } from "./tests/form-context.test";
 
 function main() {
   resetCounters();
   console.log("novel-character-sim 鈥?agent continuation core tests\n");
 
   runProseGuardTests();
   runIntermediateStoreTests();
   runCriticalMissTests();
   runSaveVerifyTests();
   runCommitRealizationTests();
   runAcceptContinuationTests();
   runTextWindowTests();
   runBranchCowTests();
   runChapterCatalogTests();
+  runFormContextTests();
 
   const { failed } = summary();
   if (failed > 0) process.exitCode = 1;
 }
 
 main();
diff --git a/scripts/tests/form-context.test.ts b/scripts/tests/form-context.test.ts
new file mode 100644
index 0000000..1d10873
--- /dev/null
+++ b/scripts/tests/form-context.test.ts
@@ -0,0 +1,145 @@
+/**
+ * Form agent context payload 鈥?shape + conservative chaptering rules.
+ */
+import { assert, suite, test } from "../lib/test-harness";
+import {
+  buildFormAgentContext,
+  formatFormAgentContextForTool,
+} from "../../src/core/form/form-context";
+import type { BranchChapterMeta, NovelFormProfile } from "../../src/types";
+
+function baseForm(over: Partial<NovelFormProfile> = {}): NovelFormProfile {
+  return {
+    novelId: "n1",
+    formType: "web_novel",
+    unitHierarchy: { volume: "absent", chapter: "present", section: "absent" },
+    chaptering: {
+      enabled: true,
+      confidence: 0.9,
+      numbering: "arabic_di_n_zhang",
+      titlePattern: "绗琋绔?,
+      separator: " ",
+      samples: ["绗?绔?寮€绔?, "绗?绔?鍙戝睍"],
+      chapterEndTendency: "cliffhanger",
+    },
+    narrativeArchitecture: {
+      primaryTemplate: "episodic",
+      genreHints: ["鐜勫够"],
+      evidenceNotes: "dense chapter titles",
+      povScheme: "绗笁浜虹О",
+      timeScheme: "linear",
+    },
+    continuationRules: [
+      "鏈功鍒嗙珷锛氭柊寮€绔犳椂浣跨敤涓?samples 涓€鑷寸殑绔犳爣棰樻牸寮忋€?,
+      "缁啓鍚屼竴绔犳椂涓嶈鏃犳晠鏂拌捣銆岀N绔犮€嶃€?,
+    ],
+    ...over,
+  };
+}
+
+function baseMeta(over: Partial<BranchChapterMeta> = {}): BranchChapterMeta {
+  return {
+    novelId: "n1",
+    branchId: "main",
+    chapterBoundary: "open",
+    openChapter: { number: 2, title: "绗?绔?鍙戝睍", startedAtOffset: 100 },
+    chapters: [
+      {
+        id: "c1",
+        number: 1,
+        title: "绗?绔?寮€绔?,
+        startOffset: 0,
+        endOffset: 99,
+        source: "regex",
+      },
+      {
+        id: "c2",
+        number: 2,
+        title: "绗?绔?鍙戝睍",
+        startOffset: 100,
+        source: "regex",
+      },
+    ],
+    ...over,
+  };
+}
+
+export function runFormContextTests(): void {
+  suite("form-context", () => {
+    test("enabled form exposes samples + rules + boundary", () => {
+      const ctx = buildFormAgentContext({
+        form: baseForm(),
+        chapterMeta: baseMeta(),
+        novelId: "n1",
+        branchId: "main",
+      });
+      assert.equal(ctx.chapteringEnabled, true);
+      assert.equal(ctx.forbidInventChapterTitles, false);
+      assert.ok(ctx.chapterTitleSamples.includes("绗?绔?寮€绔?));
+      assert.equal(ctx.chapterBoundary, "open");
+      assert.equal(ctx.catalogCount, 2);
+      assert.ok(ctx.continuationRules.length >= 1);
+      assert.equal(ctx.formType, "web_novel");
+    });
+
+    test("null form 鈫?conservative forbid invent titles", () => {
+      const ctx = buildFormAgentContext({
+        form: null,
+        chapterMeta: null,
+        novelId: "n1",
+        branchId: "main",
+      });
+      assert.equal(ctx.chapteringEnabled, false);
+      assert.equal(ctx.forbidInventChapterTitles, true);
+      assert.ok(ctx.continuationRules.some((r) => r.includes("绗琋绔?) || r.includes("鍒嗙珷")));
+    });
+
+    test("disabled chaptering 鈫?forbidInventChapterTitles true", () => {
+      const ctx = buildFormAgentContext({
+        form: baseForm({
+          formType: "essay_prose",
+          chaptering: {
+            enabled: false,
+            confidence: 0.2,
+            numbering: "none",
+            titlePattern: "",
+            separator: "",
+            samples: [],
+          },
+          continuationRules: ["鏈功鎸変繚瀹堢瓥鐣ヨ涓哄急鍒嗙珷/涓嶅垎绔狅細闄ら潪鐢ㄦ埛瑕佹眰锛屼笉瑕佹坊鍔犮€岀N绔犮€嶆爣棰樸€?],
+        }),
+        chapterMeta: baseMeta({ chapterBoundary: "closed", chapters: [] }),
+        novelId: "n1",
+        branchId: "main",
+      });
+      assert.equal(ctx.chapteringEnabled, false);
+      assert.equal(ctx.forbidInventChapterTitles, true);
+      assert.equal(ctx.catalogCount, 0);
+    });
+
+    test("formatFormAgentContextForTool is parseable JSON with required keys", () => {
+      const ctx = buildFormAgentContext({
+        form: baseForm(),
+        chapterMeta: baseMeta(),
+        novelId: "n1",
+        branchId: "main",
+      });
+      const raw = formatFormAgentContextForTool(ctx);
+      const parsed = JSON.parse(raw) as Record<string, unknown>;
+      for (const k of [
+        "novelId",
+        "branchId",
+        "formType",
+        "chapteringEnabled",
+        "forbidInventChapterTitles",
+        "chapterTitleSamples",
+        "continuationRules",
+        "chapterBoundary",
+        "catalogCount",
+        "unitHierarchy",
+      ]) {
+        assert.ok(k in parsed, `missing key ${k}`);
+      }
+    });
+  });
+}
diff --git a/src/core/form/form-context.ts b/src/core/form/form-context.ts
new file mode 100644
index 0000000..e69fa92
--- /dev/null
+++ b/src/core/form/form-context.ts
@@ -0,0 +1,102 @@
+/**
+ * Stable agent-facing view of novel form (楠? + branch chapter meta.
+ * Pure: no DB, no LLM.
+ */
+import type { BranchChapterMeta, NovelFormProfile, UnitPresence } from "@/types";
+
+export interface FormAgentContext {
+  novelId: string;
+  branchId: string;
+  /** Whether analysis found usable chaptering */
+  chapteringEnabled: boolean;
+  chapteringConfidence: number;
+  formType: string;
+  unitHierarchy: {
+    volume: UnitPresence;
+    chapter: UnitPresence;
+    section: UnitPresence;
+  };
+  /** When true, writer/outline must not invent 绗琋绔?unless user asks */
+  forbidInventChapterTitles: boolean;
+  chapterTitleSamples: string[];
+  titlePattern: string;
+  numbering: string;
+  continuationRules: string[];
+  chapterBoundary: "open" | "closed" | "unknown";
+  openChapter?: { number?: number; title?: string; startedAtOffset: number };
+  lastClosedChapter?: { number?: number; title?: string; endOffset: number };
+  /** Truncated catalog for prompt size */
+  catalogTail: Array<{ number?: number; title: string; startOffset: number }>;
+  catalogCount: number;
+  /** One-line human hint for prompts */
+  summaryLine: string;
+}
+
+const DEFAULT_NO_CHAPTER_RULES = [
+  "褰㈡€佹湭鍒嗘瀽鎴栧急鍒嗙珷锛氶櫎闈炵敤鎴锋槑纭姹傚垎绔狅紝涓嶈娣诲姞銆岀N绔犮€嶆爣棰樸€?,
+];
+
+export function buildFormAgentContext(input: {
+  form: NovelFormProfile | null;
+  chapterMeta: BranchChapterMeta | null;
+  novelId: string;
+  branchId: string;
+}): FormAgentContext {
+  const { novelId, branchId } = input;
+  const form = input.form;
+  const meta = input.chapterMeta;
+
+  const enabled = !!form?.chaptering?.enabled;
+  const confidence = form?.chaptering?.confidence ?? 0;
+  const samples = form?.chaptering?.samples?.slice(0, 8) || [];
+  const rules =
+    form?.continuationRules?.filter(Boolean).slice(0, 8) ||
+    DEFAULT_NO_CHAPTER_RULES;
+
+  const chapters = meta?.chapters || [];
+  const catalogTail = chapters.slice(-12).map((c) => ({
+    number: c.number,
+    title: c.title,
+    startOffset: c.startOffset,
+  }));
+
+  const chapterBoundary = meta?.chapterBoundary ?? "unknown";
+  const forbidInventChapterTitles = !enabled;
+
+  let summaryLine: string;
+  if (!form) {
+    summaryLine = "鏈壘鍒板舰鎬佸垎鏋愶細鎸夊急鍒嗙珷澶勭悊锛岀姝㈠彂鏄庣N绔犮€?;
+  } else if (enabled) {
+    summaryLine = `鍒嗙珷寮€鍚紙confidence=${confidence.toFixed(2)}锛夛紱杈圭晫=${chapterBoundary}锛涚洰褰?${chapters.length} 鏉★紱鏍蜂緥锛?{samples.slice(0, 2).join(" / ") || "鏃?}`;
+  } else {
+    summaryLine = `寮卞垎绔?涓嶅垎绔狅紙formType=${form.formType}锛夛細绂佹鍙戞槑绗琋绔狅紝闄ら潪鐢ㄦ埛瑕佹眰銆俙;
+  }
+
+  return {
+    novelId,
+    branchId,
+    chapteringEnabled: enabled,
+    chapteringConfidence: confidence,
+    formType: form?.formType || "unknown",
+    unitHierarchy: form?.unitHierarchy || {
+      volume: "absent",
+      chapter: "absent",
+      section: "absent",
+    },
+    forbidInventChapterTitles,
+    chapterTitleSamples: samples,
+    titlePattern: form?.chaptering?.titlePattern || "",
+    numbering: form?.chaptering?.numbering || "none",
+    continuationRules: rules,
+    chapterBoundary,
+    openChapter: meta?.openChapter,
+    lastClosedChapter: meta?.lastClosedChapter,
+    catalogTail,
+    catalogCount: chapters.length,
+    summaryLine,
+  };
+}
+
+export function formatFormAgentContextForTool(ctx: FormAgentContext): string {
+  return JSON.stringify(ctx, null, 2);
+}

