# Review package Task 5
Base: 176cbc1e0a91aba50e6af770646933f4f1c204a7
Head: b5d3581cca28ece8b07dfa9ab8727094f30b1c85

## Commits
b5d3581 fix(extract): analyze form before timeline job when missing

## Stat
 src/core/extractor/run-modular-extract.ts | 29 +++++++++++++++++++++++++++--
 1 file changed, 27 insertions(+), 2 deletions(-)

## Diff
diff --git a/src/core/extractor/run-modular-extract.ts b/src/core/extractor/run-modular-extract.ts
index 871f522..446b943 100644
--- a/src/core/extractor/run-modular-extract.ts
+++ b/src/core/extractor/run-modular-extract.ts
@@ -270,24 +270,49 @@ async function runModularExtractInner(input: ModularExtractInput): Promise<Modul
       const novel = getNovel(userId, novelId);
       upsertExtractedStyle(userId, novelId, novel?.title || parsed.title, writingStyle);
       result.ran.push("style");
     } else if (r.mod === "ideas") {
       result.ran.push("ideas");
     }
   }
 
   // ---- Phase 2: timeline (async full job 鈥?does not block HTTP) ----
   if (want("timeline")) {
-    // Prefer form before timeline so units use real chapters when available
-    if (!result.form && !want("form")) {
+    // Hard dependency (D7): form/catalog before timeline units when possible
+    if (!result.form) {
       result.form = getNovelForm(userId, novelId);
     }
+    if (!result.form) {
+      // Auto-run form once when missing (e.g. timeline-only selection).
+      // Skip when phase1 already ran form (result.form would be set).
+      console.log("[Extract] timeline requires form first 鈥?analyzing form...");
+      const llm = createLLMProvider();
+      const formResult = await runWithTokenContext({ agentId: "extract_form" }, () =>
+        analyzeNovelForm(novelId, text, llm),
+      );
+      saveNovelForm(userId, novelId, formResult.profile);
+      ensureMainBranch(userId, novelId);
+      if (formResult.profile.chaptering.enabled && formResult.catalog.length > 0) {
+        const existing = getBranchChapterMeta(userId, novelId, branchId);
+        saveBranchChapterMeta(userId, {
+          ...existing,
+          novelId,
+          branchId,
+          chapters: formResult.catalog,
+          chapterBoundary: existing.chapterBoundary || "closed",
+        });
+      }
+      result.form = formResult.profile;
+      result.chapterCatalogCount = formResult.catalog.length;
+      if (!result.ran.includes("form")) result.ran.push("form");
+    }
+
     const cached = !forceRefresh ? getTimeline(userId, novelId) : null;
     if (cached && cached.chapters?.length && !forceRefresh) {
       result.timeline = cached;
       result.lastChapterStates = getChapterStates(userId, novelId);
       result.skipped.push({ module: "timeline", reason: "宸叉湁缂撳瓨锛堜粛鍙悗鍙伴噸璺戯級" });
     }
     try {
       console.log("[Extract] timeline 鈫?async job");
       const job = startTimelineJob({ userId, novelId, branchId });
       result.timelineJobId = job.id;

