# Review package Task 6
Base: b5d3581cca28ece8b07dfa9ab8727094f30b1c85
Head: 67d11abdf83936aa539816d50f485234eb02907e

## Commits
67d11ab docs(spec): mark agent form consumption P0 as implemented

## Stat
 docs/specs/analysis-and-chaptering.md | 14 +++++++-------
 1 file changed, 7 insertions(+), 7 deletions(-)

## Diff
diff --git a/docs/specs/analysis-and-chaptering.md b/docs/specs/analysis-and-chaptering.md
index f07f52c..11ea0c4 100644
--- a/docs/specs/analysis-and-chaptering.md
+++ b/docs/specs/analysis-and-chaptering.md
@@ -1,12 +1,12 @@
 # Spec: 鍒嗘瀽锛堣倝/楠級路 绔犳硶 路 鏃堕棿绾?路 闃呰绔栬建
 
 **Status:** Accepted design (grill frozen); implementation **partial**  
-**Last updated:** 2026-07-17  
+**Last updated:** 2026-07-18  
 **Related commits (implementation so far):**  
 `1c4441c` form/catalog/rail 路 `04578b1` async timeline job 路 `6758ba5` UI 鍒嗘瀽 rename 路 earlier perf CoW/virtual scroll  
 
 This document is the source of truth for product + engineering. Chat history is not.
 
 ---
 
 ## 1. Goals
@@ -159,19 +159,19 @@ save BranchChapterMeta
 Legend: **done** | **partial** | **todo**
 
 | Area | Status | Notes |
 |------|--------|--------|
 | Types + DB tables | **done** | `novel_form`, `branch_chapter_meta` |
 | Program catalog | **done** | `chapter-catalog.ts` + tests |
 | Form analyzer + LLM QA | **partial** | Works; QA not a separate strict schema contract |
 | Analysis UI rename + defaults | **done** | 鍒嗘瀽 / DEFAULT_ANALYSIS_MODULES |
-| Outline/writer prompt text | **partial** | Prose instructions only; no structured chapterPlan |
-| Accept boundary + catalog | **partial** | Heuristic outline keywords; brittle |
-| **Agent tools load form/boundary** | **todo** | **Critical gap:** agents do not call getNovelForm |
+| Outline/writer prompt text | **partial** (improved) | Tool-required form context; still no structured chapterPlan JSON |
+| Accept boundary + catalog | **partial** | Tests cover happy paths; outline keyword still heuristic |
+| **Agent tools load form/boundary** | **done** | `get_novel_form` + `get_branch_meta.form` |
 | Reader rail + click + scroll-sync | **partial** | Desktop only; jump uses scroll ratio not true layout |
 | Async timeline job | **partial** | In-memory jobs (lost on restart); works in one process |
 | Timeline **per branch** storage | **todo** | Still novel-scoped in DB helpers |
 | Job durable in SQLite | **todo** | |
 | Mobile rail | **todo** | `hidden sm:flex` |
 | Overview form summary UI | **todo** | Only one-line result string |
 | Per-unit retry UI | **todo** | |
 | Export TOC in TXT | **todo** | |
@@ -188,19 +188,19 @@ Legend: **done** | **partial** | **todo**
 - [ ] Running form on a no-heading long prose sample yields `chaptering.enabled=false`.
 
 ### B. Catalog & boundary
 - [ ] Program finds `绗?绔燻鈥绗琋绔燻 with correct increasing `startOffset`.
 - [ ] Fork copies chapter meta; child edits do not rewrite parent catalog.
 - [ ] Accept after draft starting with `绗琄绔?鈥 updates catalog and boundary per D4.
 - [ ] Accept on non-chaptering novel does not force new chapter titles in meta.
 
-### C. Agents (P0 gap)
-- [ ] Outline and/or writer path can **read** form.continuationRules + chaptering.samples + boundary (tool or injected context).
-- [ ] When chaptering disabled, writer system constraints forbid inventing 绗琋绔?unless user asks.
+### C. Agents (P0 鈥?form consumption)
+- [x] Outline and/or writer path can **read** form.continuationRules + chaptering.samples + boundary (tool or injected context).
+- [x] When chaptering disabled, writer system constraints forbid inventing 绗琋绔?unless user asks.
 
 ### D. Timeline async
 - [ ] Selecting timeline returns quickly with `timelineJobId` (no multi-minute HTTP).
 - [ ] Job progresses unit-by-unit; partial timeline readable before done.
 - [ ] Reader rail shows pending/done and summaries while job runs.
 - [ ] (Target) Job survives server restart **or** is explicitly documented as process-local until durable jobs ship.
 
 ### E. Reader rail

