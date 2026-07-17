# Review package Task 4
Base: f3b94a0fb11fa06eebb1f5803a393ca21911453a
Head: e68b455a8f4284e56f42a50680ba42ed2ef7d218

## Commits
e68b455 test(form): accept continuation chapter meta boundary cases

## Stat
 scripts/run-tests.ts                      |   2 +
 scripts/tests/accept-chapter-meta.test.ts | 146 ++++++++++++++++++++++++++++++
 2 files changed, 148 insertions(+)

## Diff
diff --git a/scripts/run-tests.ts b/scripts/run-tests.ts
index 7e25275..2eb8d14 100644
--- a/scripts/run-tests.ts
+++ b/scripts/run-tests.ts
@@ -8,29 +8,31 @@ import { runIntermediateStoreTests } from "./tests/intermediate-store.test";
 import { runCriticalMissTests } from "./tests/critical-miss.test";
 import { runSaveVerifyTests } from "./tests/save-verify.test";
 import { runCommitRealizationTests } from "./tests/commit-realization.test";
 import { runAcceptContinuationTests } from "./tests/accept-continuation.test";
 import { runTextWindowTests } from "./tests/text-window.test";
 import { runBranchCowTests } from "./tests/branch-cow.test";
 import { runChapterCatalogTests } from "./tests/chapter-catalog.test";
 import { runFormContextTests } from "./tests/form-context.test";
+import { runAcceptChapterMetaTests } from "./tests/accept-chapter-meta.test";
 
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
   runFormContextTests();
+  runAcceptChapterMetaTests();
 
   const { failed } = summary();
   if (failed > 0) process.exitCode = 1;
 }
 
 main();
diff --git a/scripts/tests/accept-chapter-meta.test.ts b/scripts/tests/accept-chapter-meta.test.ts
new file mode 100644
index 0000000..faa50ca
--- /dev/null
+++ b/scripts/tests/accept-chapter-meta.test.ts
@@ -0,0 +1,146 @@
+/**
+ * After acceptContinuation: chapter meta boundary + catalog (D4).
+ */
+import { randomUUID } from "node:crypto";
+import { assert, suite, test } from "../lib/test-harness";
+import { acceptContinuation } from "../../src/core/foreshadowing/accept-continuation";
+import { _resetStore, saveProse } from "../../src/core/agents/intermediate-store";
+import {
+  deleteNovel,
+  getBranchChapterMeta,
+  importNovel,
+  saveNovelForm,
+  saveBranchChapterMeta,
+  emptyBranchChapterMeta,
+} from "../../src/lib/db";
+import type { NovelFormProfile } from "../../src/types";
+
+const BODY =
+  "闆ㄨ惤鍦ㄩ潚鐭虫澘涓婏紝鍙戝嚭缁嗙鐨勫０鍝嶃€傞【娣辨妸鏂楃瑺鍘嬩綆锛屾部鐫€宸峰彛閭ｇ洀灏嗙伃鏈伃鐨勭伅璧板幓锛? +
+  "鎬€涓殑淇＄焊琚洦姘存磭鍑轰竴鍦堟贰鐥曪紝鍗翠粛鑳借鲸璁ゅ嚭銆屾棫妗ャ€嶄簩瀛椼€傚贩鏇存繁浜嗐€?;
+
+function enabledForm(novelId: string): NovelFormProfile {
+  return {
+    novelId,
+    formType: "web_novel",
+    unitHierarchy: { volume: "absent", chapter: "present", section: "absent" },
+    chaptering: {
+      enabled: true,
+      confidence: 0.9,
+      numbering: "arabic_di_n_zhang",
+      titlePattern: "绗琋绔?,
+      separator: " ",
+      samples: ["绗?绔?搴?, "绗?绔?闆?],
+    },
+    narrativeArchitecture: {
+      primaryTemplate: "episodic",
+      genreHints: [],
+      evidenceNotes: "",
+      povScheme: "unknown",
+      timeScheme: "linear",
+    },
+    continuationRules: ["鏈功鍒嗙珷"],
+  };
+}
+
+function disabledForm(novelId: string): NovelFormProfile {
+  const f = enabledForm(novelId);
+  f.formType = "essay_prose";
+  f.chaptering = {
+    enabled: false,
+    confidence: 0.1,
+    numbering: "none",
+    titlePattern: "",
+    separator: "",
+    samples: [],
+  };
+  f.continuationRules = ["寮卞垎绔?];
+  return f;
+}
+
+export function runAcceptChapterMetaTests(): void {
+  suite("accept chapter meta", () => {
+    test("enabled + draft starts with 绗琄绔?鈫?catalog gains chapter, boundary closed", () => {
+      _resetStore();
+      const userId = `tu_${randomUUID().slice(0, 8)}`;
+      const novelId = `tn_${randomUUID().slice(0, 8)}`;
+      try {
+        const base =
+          "绗?绔?搴廫n" + "鐢?.repeat(80) + "\n\n绗?绔?闆╘n" + "涔?.repeat(80);
+        importNovel(userId, novelId, "chap-novel", base);
+        saveNovelForm(userId, novelId, enabledForm(novelId));
+        saveBranchChapterMeta(userId, {
+          ...emptyBranchChapterMeta(novelId, "main"),
+          chapterBoundary: "open",
+          chapters: [
+            {
+              id: "c1",
+              number: 1,
+              title: "绗?绔?搴?,
+              startOffset: 0,
+              source: "regex",
+            },
+          ],
+        });
+
+        const draft = `绗?绔?妗n${BODY}`;
+        saveProse(novelId, "main", draft);
+        // outline keyword optional 鈥?prose wins for new chapter title
+        const r = acceptContinuation({
+          userId,
+          novelId,
+          branchId: "main",
+          content: draft,
+        });
+        assert.equal(r.ok, true, r.error || "accept failed");
+
+        const meta = getBranchChapterMeta(userId, novelId, "main");
+        assert.equal(meta.chapterBoundary, "closed");
+        assert.ok(
+          meta.chapters.some(
+            (c) =>
+              c.number === 3 ||
+              c.title.includes("妗?) ||
+              c.title.includes("绗?绔?),
+          ),
+          `catalog missing ch3: ${JSON.stringify(meta.chapters)}`,
+        );
+      } finally {
+        deleteNovel(userId, novelId);
+        _resetStore();
+      }
+    });
+
+    test("disabled chaptering 鈫?accept does not require chapter titles in meta", () => {
+      _resetStore();
+      const userId = `tu_${randomUUID().slice(0, 8)}`;
+      const novelId = `tn_${randomUUID().slice(0, 8)}`;
+      try {
+        importNovel(userId, novelId, "prose-novel", "闀挎枃鏃犵珷銆?.repeat(20));
+        saveNovelForm(userId, novelId, disabledForm(novelId));
+        saveBranchChapterMeta(userId, {
+          ...emptyBranchChapterMeta(novelId, "main"),
+          chapters: [],
+          chapterBoundary: "closed",
+        });
+
+        const draft = BODY;
+        saveProse(novelId, "main", draft);
+        const r = acceptContinuation({
+          userId,
+          novelId,
+          branchId: "main",
+          content: draft,
+        });
+        assert.equal(r.ok, true, r.error || "accept failed");
+
+        const meta = getBranchChapterMeta(userId, novelId, "main");
+        // updateChapterMetaAfterAccept should early-return when disabled
+        assert.equal(meta.chapters.length, 0);
+      } finally {
+        deleteNovel(userId, novelId);
+        _resetStore();
+      }
+    });
+  });
+}

