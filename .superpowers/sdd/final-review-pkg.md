# Final branch review package
Base: 36b92c572435c9fcf6e2ec11f53acc4d27bfc17a
Head: 67d11abdf83936aa539816d50f485234eb02907e

## Commits
67d11ab docs(spec): mark agent form consumption P0 as implemented
b5d3581 fix(extract): analyze form before timeline job when missing
176cbc1 test(form): strengthen disabled chaptering accept guard
e68b455 test(form): accept continuation chapter meta boundary cases
f3b94a0 feat(agents): outline/writer consume novel form chaptering rules
99e12ce feat(agents): get_novel_form tool and form-aware branch meta
5edf6a0 feat(form): pure agent context payload for chaptering rules
df014a4 docs(plan): analysis form agent consume P0 plan

## Stat
 docs/specs/analysis-and-chaptering.md              |  14 +-
 .../2026-07-18-analysis-form-agent-consume.md      | 976 +++++++++++++++++++++
 scripts/run-tests.ts                               |   4 +
 scripts/tests/accept-chapter-meta.test.ts          | 157 ++++
 scripts/tests/form-context.test.ts                 | 145 +++
 src/app/api/agent/chat/route.ts                    |   1 +
 src/components/agent-panel.tsx                     |   1 +
 src/core/agents/agents/branch-tools.ts             |  79 +-
 src/core/agents/agents/writer.ts                   |   8 +-
 src/core/extractor/run-modular-extract.ts          |  29 +-
 src/core/form/form-context.ts                      | 102 +++
 src/core/prompts/outline-agent-contract.md         |   7 +-
 src/core/prompts/outline-system.md                 |   6 +-
 src/core/prompts/writer-create-system.md           |  14 +-
 src/core/prompts/writer-create-user.md             |   2 +-
 src/core/prompts/writer-rewrite-system.md          |   4 +
 16 files changed, 1520 insertions(+), 29 deletions(-)

## Diff
diff --git a/docs/specs/analysis-and-chaptering.md b/docs/specs/analysis-and-chaptering.md
index f07f52c..11ea0c4 100644
--- a/docs/specs/analysis-and-chaptering.md
+++ b/docs/specs/analysis-and-chaptering.md
@@ -1,9 +1,9 @@
 # Spec: 鍒嗘瀽锛堣倝/楠級路 绔犳硶 路 鏃堕棿绾?路 闃呰绔栬建
 
 **Status:** Accepted design (grill frozen); implementation **partial**  
-**Last updated:** 2026-07-17  
+**Last updated:** 2026-07-18  
 **Related commits (implementation so far):**  
 `1c4441c` form/catalog/rail 路 `04578b1` async timeline job 路 `6758ba5` UI 鍒嗘瀽 rename 路 earlier perf CoW/virtual scroll  
 
 This document is the source of truth for product + engineering. Chat history is not.
 
@@ -162,13 +162,13 @@ Legend: **done** | **partial** | **todo**
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
@@ -191,13 +191,13 @@ Legend: **done** | **partial** | **todo**
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
diff --git a/docs/superpowers/plans/2026-07-18-analysis-form-agent-consume.md b/docs/superpowers/plans/2026-07-18-analysis-form-agent-consume.md
new file mode 100644
index 0000000..5392479
--- /dev/null
+++ b/docs/superpowers/plans/2026-07-18-analysis-form-agent-consume.md
@@ -0,0 +1,976 @@
+# Analysis Form 鈫?Agent Consume (P0) Implementation Plan
+
+> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
+
+**Goal:** Make outline and writer agents actually read and obey novel form (楠?: chaptering on/off, title samples, continuationRules, and branch chapter boundary/catalog 鈥?closing the critical gap where analysis produces form but continuation ignores it.
+
+**Architecture:** Extract a pure `buildFormAgentContext()` helper that shapes DB form + branch chapter meta into a stable JSON payload. Expose it via a new tool `get_novel_form` and an extended `get_branch_meta`. Wire outline + writer tool lists and prompt steps so agents must load form context before planning/writing. Add pure-logic tests (payload shape, enable/disable rules, accept boundary) without requiring live LLM.
+
+**Tech Stack:** TypeScript, existing agent tool registry (`branch-tools.ts`), SQLite helpers in `src/lib/db.ts`, prompt markdown under `src/core/prompts/`, test harness in `scripts/tests/` via `npm test`.
+
+**Spec source of truth:** `docs/specs/analysis-and-chaptering.md` (搂3 D1鈥揇8, 搂8 C, 搂9 P0).
+
+## Global Constraints
+
+- User-facing copy: **銆屽垎鏋愩€?* only 鈥?never reintroduce **鎷嗚В** in UI strings.
+- Conservative chaptering: if confidence low / disabled 鈫?agents must not invent `绗琋绔燻 unless user explicitly asks (D3, D8).
+- Catalog remains program-first; this plan does **not** rebuild multi-level 閮ㄢ啋鍗封啋绔犫啋鑺?trees (future plan).
+- Timeline job durability / mobile rail / SQLite job persist = **out of scope** (P1).
+- All LLM calls still go through `createLLMProvider()`; JSON parsing still via `extractJSON()` if any LLM path is touched (prefer no new LLM calls in this plan).
+- Prefer pure helpers + existing `npm test` harness over new test frameworks.
+- Do not delete `data/` or rewrite unrelated extract modules.
+
+## Out of scope (do not implement in this plan)
+
+| Item | Why deferred |
+|------|----------------|
+| Full hierarchy tree (閮?鍗?绔?鑺? | Domain types partially ready; needs separate design for catalog tree + primary boundary unit |
+| Durable timeline jobs in SQLite | P1 |
+| Branch-scoped timeline DB rows | P1 |
+| Mobile reader rail drawer | P1 |
+| Overview form summary card polish | P2 |
+| Export TXT TOC | P2 |
+
+## File map
+
+| File | Responsibility |
+|------|----------------|
+| `src/core/form/form-context.ts` | **Create.** Pure payload builder for agents (no DB import of side effects beyond types). |
+| `src/core/agents/agents/branch-tools.ts` | Add `get_novel_form`; extend `get_branch_meta` to include form + chapter meta summary. |
+| `src/core/agents/agents/outline.ts` | Ensure outline has form tools (via full `branchTools`); strengthen user-side instructions after load. |
+| `src/core/agents/agents/writer.ts` | Add `get_novel_form` / `get_branch_meta` to CREATE (and optionally REWRITE) tool schemas. |
+| `src/core/prompts/outline-system.md` | Require reading form; chapter plan keywords stay machine-grep-friendly. |
+| `src/core/prompts/outline-agent-contract.md` | Document `get_novel_form` / extended meta in steps. |
+| `src/core/prompts/writer-create-system.md` | Require `get_novel_form` before write; hard forbid inventing 绗琋绔?when disabled. |
+| `src/core/prompts/writer-create-user.md` | Short reminder block if present. |
+| `src/core/prompts/writer-rewrite-system.md` | Same chaptering constraint on rewrite (no new fake titles). |
+| `src/core/prompts/defaults.ts` | Only if admin defaults embed stale copies 鈥?sync if needed. |
+| `src/app/api/agent/chat/route.ts` | Add `get_novel_form` to master allowlist if master should see it. |
+| `src/components/agent-panel.tsx` | Chinese label for `get_novel_form`. |
+| `src/core/extractor/run-modular-extract.ts` | Hard dependency: if timeline selected and form missing, run form first (or await form in phase1 when both wanted). |
+| `scripts/tests/form-context.test.ts` | **Create.** Payload + enable/disable contract tests. |
+| `scripts/tests/accept-chapter-meta.test.ts` | **Create.** Accept boundary / catalog rebuild behaviors. |
+| `scripts/run-tests.ts` | Register new suites. |
+| `docs/specs/analysis-and-chaptering.md` | Update 搂7 status for agent tools after done. |
+
+---
+
+### Task 1: Pure form agent context helper
+
+**Files:**
+- Create: `src/core/form/form-context.ts`
+- Test: `scripts/tests/form-context.test.ts`
+- Modify: `scripts/run-tests.ts`
+
+**Interfaces:**
+- Consumes: `NovelFormProfile`, `BranchChapterMeta` from `@/types`
+- Produces:
+  - `export interface FormAgentContext { ... }`
+  - `export function buildFormAgentContext(input: { form: NovelFormProfile | null; chapterMeta: BranchChapterMeta | null; novelId: string; branchId: string }): FormAgentContext`
+  - `export function formatFormAgentContextForTool(ctx: FormAgentContext): string` (JSON.stringify pretty)
+
+- [ ] **Step 1: Write the failing test file**
+
+Create `scripts/tests/form-context.test.ts`:
+
+```ts
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
+```
+
+- [ ] **Step 2: Register suite in `scripts/run-tests.ts`**
+
+Add import and call:
+
+```ts
+import { runFormContextTests } from "./tests/form-context.test";
+// ...
+runFormContextTests();
+```
+
+- [ ] **Step 3: Run tests 鈥?expect FAIL**
+
+Run: `npm test`
+
+Expected: FAIL 鈥?cannot find module `../../src/core/form/form-context` (or similar).
+
+- [ ] **Step 4: Implement `src/core/form/form-context.ts`**
+
+```ts
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
+```
+
+- [ ] **Step 5: Run tests 鈥?expect PASS**
+
+Run: `npm test`
+
+Expected: `form-context` suite all 鉁?
+
+- [ ] **Step 6: Commit**
+
+```bash
+git add src/core/form/form-context.ts scripts/tests/form-context.test.ts scripts/run-tests.ts
+git commit -m "feat(form): pure agent context payload for chaptering rules"
+```
+
+---
+
+### Task 2: Agent tools 鈥?`get_novel_form` + extend `get_branch_meta`
+
+**Files:**
+- Modify: `src/core/agents/agents/branch-tools.ts`
+- Modify: `src/app/api/agent/chat/route.ts` (master allowlist)
+- Modify: `src/components/agent-panel.tsx` (label map)
+
+**Interfaces:**
+- Consumes: `buildFormAgentContext`, `formatFormAgentContextForTool` from `@/core/form/form-context`; `getNovelForm`, `getBranchChapterMeta`, `getBranchProse` from `@/lib/db`
+- Produces: tool names `get_novel_form`, enhanced `get_branch_meta` registered via existing `branchTools` array (auto-registered in `init.ts`)
+
+- [ ] **Step 1: Extend `branch-tools.ts` imports**
+
+At top of `src/core/agents/agents/branch-tools.ts`, change imports to:
+
+```ts
+import type { ToolDefinition } from "../types";
+import {
+  getBranchProse,
+  getCharacters,
+  getTimeline,
+  getStoryInfo,
+  getNovelForm,
+  getBranchChapterMeta,
+} from "@/lib/db";
+import {
+  buildFormAgentContext,
+  formatFormAgentContextForTool,
+} from "@/core/form/form-context";
+import { formatCriticalMiss } from "../critical-miss";
+```
+
+- [ ] **Step 2: Replace `get_branch_meta` execute to include form context**
+
+Keep the tool name `get_branch_meta`. Update description and execute:
+
+```ts
+{
+  name: "get_branch_meta",
+  description:
+    "鑾峰彇鍒嗘敮鍏冧俊鎭細name/瀛楁暟锛屼互鍙婂舰鎬?绔犳硶鎽樿锛堟槸鍚﹀垎绔犮€佺珷鍚嶆牱渚嬨€乧ontinuationRules銆佺珷寮€闂竟鐣屻€佺洰褰曟潯鏁帮級銆傚ぇ绾蹭笌鍐欐墜缁啓鍓嶅簲璋冪敤銆?,
+  parameters: {
+    type: "object",
+    properties: {
+      novelId: { type: "string", description: "灏忚 ID" },
+      branchId: { type: "string", description: "鍒嗘敮 ID锛堜富绾夸负 main锛? },
+    },
+    required: ["novelId", "branchId"],
+  },
+  execute: async (args, ctx) => {
+    const userId = ctx.userId || "guest";
+    const novelId = (ctx.novelId || args.novelId || "") as string;
+    const branchId = (ctx.branchId || args.branchId || "main") as string;
+    const { text, branch } = getBranchProse(userId, novelId, branchId);
+    if (!branch) return { content: "鍒嗘敮涓嶅瓨鍦?, messages: [] };
+
+    const form = getNovelForm(userId, novelId);
+    const chapterMeta = getBranchChapterMeta(userId, novelId, branchId);
+    const formCtx = buildFormAgentContext({
+      form,
+      chapterMeta,
+      novelId,
+      branchId,
+    });
+
+    return {
+      content: JSON.stringify(
+        {
+          name: branch.name,
+          parent_offset: branch.parent_offset,
+          novel_id: branch.novel_id,
+          total_chars: text.length,
+          form: formCtx,
+        },
+        null,
+        2,
+      ),
+      messages: [],
+    };
+  },
+},
+```
+
+- [ ] **Step 3: Append new tool `get_novel_form` to `branchTools` array**
+
+```ts
+{
+  name: "get_novel_form",
+  description:
+    "鑾峰彇灏忚褰㈡€?绔犳硶锛堥锛夛細formType銆佹槸鍚﹀垎绔犮€佺珷鍚?samples銆乧ontinuationRules銆佸垎鏀珷杈圭晫涓庣洰褰曟憳瑕併€傚ぇ绾蹭笌鍐欐墜鍦ㄨ鍒掔珷鑺傚墠搴旇皟鐢紱寮卞垎绔犳椂蹇呴』閬靛畧 forbidInventChapterTitles銆?,
+  parameters: {
+    type: "object",
+    properties: {
+      novelId: { type: "string", description: "灏忚 ID" },
+      branchId: { type: "string", description: "鍒嗘敮 ID锛堢敤浜庤竟鐣?鐩綍锛涗富绾?main锛? },
+    },
+    required: ["novelId", "branchId"],
+  },
+  execute: async (args, ctx) => {
+    const userId = ctx.userId || "guest";
+    const novelId = (ctx.novelId || args.novelId || "") as string;
+    const branchId = (ctx.branchId || args.branchId || "main") as string;
+    if (!novelId) {
+      return {
+        content: formatCriticalMiss("novelId", "缂哄皯 novelId锛屾棤娉曡鍙栧舰鎬佸垎鏋愩€?),
+        messages: [],
+      };
+    }
+    const form = getNovelForm(userId, novelId);
+    const chapterMeta = getBranchChapterMeta(userId, novelId, branchId);
+    const formCtx = buildFormAgentContext({
+      form,
+      chapterMeta,
+      novelId,
+      branchId,
+    });
+    return {
+      content: formatFormAgentContextForTool(formCtx),
+      messages: [],
+    };
+  },
+},
+```
+
+- [ ] **Step 4: Master allowlist + UI label**
+
+In `src/app/api/agent/chat/route.ts`, extend `MASTER_TOOL_ALLOW`:
+
+```ts
+"get_branch_text", "get_branch_characters", "get_branch_timeline", "get_branch_world", "get_branch_meta",
+"get_novel_form",
+```
+
+In `src/components/agent-panel.tsx` tool name map, add:
+
+```ts
+get_novel_form: "鑾峰彇褰㈡€?绔犳硶",
+```
+
+- [ ] **Step 5: Smoke-check TypeScript**
+
+Run: `npx tsc --noEmit`  
+(or `npm run build` if that is the project鈥檚 typecheck path)
+
+Expected: no errors in touched files.
+
+- [ ] **Step 6: Commit**
+
+```bash
+git add src/core/agents/agents/branch-tools.ts src/app/api/agent/chat/route.ts src/components/agent-panel.tsx
+git commit -m "feat(agents): get_novel_form tool and form-aware branch meta"
+```
+
+---
+
+### Task 3: Wire outline + writer tools and prompts
+
+**Files:**
+- Modify: `src/core/agents/agents/writer.ts` (CREATE_TOOLS / REWRITE_TOOLS schemas)
+- Modify: `src/core/prompts/outline-system.md`
+- Modify: `src/core/prompts/outline-agent-contract.md`
+- Modify: `src/core/prompts/writer-create-system.md`
+- Modify: `src/core/prompts/writer-rewrite-system.md`
+- Modify: `src/core/prompts/writer-create-user.md` (if it lists tools)
+- Note: `outline.ts` already spreads full `branchTools` 鈥?after Task 2 it already includes `get_novel_form`. Still update prompts.
+
+**Interfaces:**
+- Consumes: tool names `get_novel_form`, `get_branch_meta` from Task 2
+- Produces: prompt instructions that force load-before-plan/write; no new TypeScript types
+
+- [ ] **Step 1: Writer CREATE_TOOLS include form tools**
+
+In `src/core/agents/agents/writer.ts`, change CREATE_TOOLS schema list:
+
+```ts
+const CREATE_TOOLS = [
+  ...schemas([
+    "get_outline",
+    "get_branch_text",
+    "get_branch_characters",
+    "get_branch_timeline",
+    "get_branch_world",
+    "get_branch_meta",
+    "get_novel_form",
+  ]),
+  ...FS_READ,
+  SAVE_SCHEMA,
+];
+```
+
+Optionally add `get_novel_form` to REWRITE_TOOLS as well (recommended 鈥?rewrite must not invent chapters either):
+
+```ts
+const REWRITE_TOOLS = [
+  ...schemas(["get_prose", "get_findings", "get_branch_text", "get_novel_form"]),
+  ...FS_READ,
+  SAVE_SCHEMA,
+];
+```
+
+- [ ] **Step 2: Update `outline-agent-contract.md` steps**
+
+In step 1 tools list, require form:
+
+```markdown
+### 姝ラ 1锛氬彇璇锛堟寜闇€锛岀珷娉曞繀鍙栵級
+闈欓粯璋冪敤锛?+- **`get_novel_form`**锛堝繀鍋氫竴娆★級锛氭槸鍚﹀垎绔犮€佺珷鍚?samples銆乧ontinuationRules銆佺珷杈圭晫
+- `get_branch_text` / `get_branch_characters` / `get_branch_timeline` / `get_branch_world`
+- `get_foreshadowing_ledger`锛堣嫢鏈夋椿璺冧紡绗旓級
+
+鑻?`forbidInventChapterTitles=true`锛氬ぇ绾蹭腑绂佹瑙勫垝銆岀N绔犮€嶆爣棰橈紝闄ら潪鐢ㄦ埛鏄庣‘瑕佹眰鍒嗙珷銆?+鑻?`chapteringEnabled=true`锛氬繀椤诲啓娓?`缁啓鏈珷` / `鏀舵潫鏈珷骞舵柊寮€` / `鏂板紑涓€绔燻锛屾柊绔犳爣棰樿创鍚?samples銆?+```
+
+Update the tools table to include `get_novel_form`.
+
+- [ ] **Step 3: Update `outline-system.md` 绡囧箙涓庣珷鑺傝鍒?*
+
+Ensure the chapter strategy section explicitly says:
+
+```markdown
+- **鍏堣皟鐢?`get_novel_form`锛堟垨璇?`get_branch_meta.form`锛?* 鍐嶅啓绔犺妭瑙勫垝
+- 鑻?`chapteringEnabled=false` / `forbidInventChapterTitles=true`锛氫笉瑕佺紪閫犮€岀N绔犮€嶏紝鐢ㄥ満鏅?娈佃惤瑙勫垝鍗冲彲
+- 鑻?`chapteringEnabled=true`锛氭柊绔犳爣棰樺繀椤昏创杩?`chapterTitleSamples` 鐨勬牸寮忥紱骞堕伒瀹?`continuationRules`
+- 蹇呴』浣跨敤鍙绱㈠叧閿瘝涔嬩竴鍐欐竻绛栫暐锛歚缁啓鏈珷` / `鏀舵潫鏈珷` / `鏂板紑涓€绔燻锛坅ccept 杈圭晫鍚彂寮忎緷璧栬繖浜涜瘝锛?+```
+
+- [ ] **Step 4: Update `writer-create-system.md`**
+
+Replace the soft 鈥滅珷鏍囬鈥?section with a hard step:
+
+```markdown
+### 2b. 褰㈡€?绔犳硶锛堝繀鍋氫竴娆★級
+- 璋冪敤 `get_novel_form`锛堟垨 `get_branch_meta` 涓殑 form锛?+- 鑻?`forbidInventChapterTitles=true`锛?*绂佹**鍦ㄦ鏂囦腑鍐欍€岀N绔犫€︺€嶆爣棰樿锛岄櫎闈炵敤鎴?prompt 鏄庣‘瑕佹眰鍒嗙珷
+- 鑻?`chapteringEnabled=true`锛?+  - 澶х翰鍐欍€屾柊寮€銆嶁啋 姝ｆ枃浠ヤ笌 `chapterTitleSamples` 涓€鑷寸殑鏍囬璧风瑪锛堢嫭鍗犱竴琛岋級
+  - 澶х翰鍐欍€岀画鍐欐湰绔犮€嶁啋 **涓嶈**鏃犳晠鏂拌捣绔犳爣棰?+  - 閬靛畧 `continuationRules` 鍏ㄦ枃
+```
+
+Also list `get_novel_form` in the tools table.
+
+- [ ] **Step 5: Update `writer-rewrite-system.md`**
+
+Add constraint block:
+
+```markdown
+## 绔犳硶
+鏀瑰啓鏃惰皟鐢?`get_novel_form` 涓€娆°€傝嫢 `forbidInventChapterTitles=true`锛屼笉瑕佹柊澧炪€岀N绔犮€嶆爣棰樿銆傝嫢鍘熻崏绋垮凡鏈夌珷鏍囬锛屼繚鎸佹牸寮忎竴鑷达紝鍕挎敼鎴愬彟涓€绉嶇紪鍙蜂綋绯汇€?+```
+
+- [ ] **Step 6: Typecheck + commit**
+
+Run: `npx tsc --noEmit`  
+Expected: clean.
+
+```bash
+git add src/core/agents/agents/writer.ts src/core/prompts/outline-system.md src/core/prompts/outline-agent-contract.md src/core/prompts/writer-create-system.md src/core/prompts/writer-rewrite-system.md src/core/prompts/writer-create-user.md
+git commit -m "feat(agents): outline/writer consume novel form chaptering rules"
+```
+
+---
+
+### Task 4: Accept boundary tests (catalog + non-chaptering)
+
+**Files:**
+- Create: `scripts/tests/accept-chapter-meta.test.ts`
+- Modify: `scripts/run-tests.ts`
+- Possibly small export if `updateChapterMetaAfterAccept` is private 鈥?prefer testing via `acceptContinuation` public API + `getBranchChapterMeta`
+
+**Interfaces:**
+- Consumes: `acceptContinuation` from `@/core/foreshadowing/accept-continuation`; `importNovel`, `deleteNovel`, `saveNovelForm`, `getBranchChapterMeta`, `saveBranchChapterMeta` from `@/lib/db`; intermediate store `saveProse` / `_resetStore`
+- Produces: regression tests for D4 hybrid boundary
+
+- [ ] **Step 1: Write failing/acceptance tests**
+
+Create `scripts/tests/accept-chapter-meta.test.ts`:
+
+```ts
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
+          meta.chapters.some((c) => c.number === 3 || c.title.includes("妗?) || c.title.includes("绗?绔?)),
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
+```
+
+- [ ] **Step 2: Register in `scripts/run-tests.ts`**
+
+```ts
+import { runAcceptChapterMetaTests } from "./tests/accept-chapter-meta.test";
+// ...
+runAcceptChapterMetaTests();
+```
+
+- [ ] **Step 3: Run tests**
+
+Run: `npm test`
+
+Expected: both accept chapter meta tests pass. If the 鈥済ains chapter鈥?test fails because catalog rebuild uses full text offsets differently, fix assertions to match `extractChapterCatalog` real output (still require non-empty catalog and boundary closed when draft opens with `绗?绔燻).
+
+- [ ] **Step 4: If early-return on disabled is missing, fix `accept-continuation.ts`**
+
+Confirm `updateChapterMetaAfterAccept` still has:
+
+```ts
+const form = getNovelForm(userId, novelId);
+if (form && !form.chaptering.enabled) return;
+```
+
+If `form` is null, either skip or treat as disabled (prefer skip update). Do not invent chapters.
+
+- [ ] **Step 5: Commit**
+
+```bash
+git add scripts/tests/accept-chapter-meta.test.ts scripts/run-tests.ts src/core/foreshadowing/accept-continuation.ts
+git commit -m "test(form): accept continuation chapter meta boundary cases"
+```
+
+---
+
+### Task 5: Hard dependency 鈥?form before timeline job units
+
+**Files:**
+- Modify: `src/core/extractor/run-modular-extract.ts`
+- Optional log-only; no new public API required
+
+**Interfaces:**
+- Consumes: existing `analyzeNovelForm`, `want("form")`, `want("timeline")`, `startTimelineJob`
+- Produces: when user selects timeline without form cache, form is analyzed before job starts so units can use chapters
+
+- [ ] **Step 1: Read current phase1/phase2 ordering**
+
+Confirm: form and other modules run in `Promise.all` phase1; timeline starts in phase2. If user checks **only timeline** and form is missing, job falls back to scene/window units (OK). If user checks **form + timeline** in parallel, form might still be finishing when鈥?actually form is in same phase1 Promise.all, so when phase1 completes, form is saved before phase2. Soft ordering already exists **if form is selected**.
+
+Gap: user selects timeline only, no form cache 鈫?no chapters. Spec P1.6: 鈥淓nsure form runs before timeline when both selected鈥?鈥?already soft. Strengthen to:
+
+**When `want("timeline")` and no usable form (`!getNovelForm` or forceRefresh form empty), auto-run form once before `startTimelineJob`.**
+
+- [ ] **Step 2: Implement auto form-before-timeline**
+
+In phase2 block of `run-modular-extract.ts`, before `startTimelineJob`:
+
+```ts
+if (want("timeline")) {
+  let form = result.form || getNovelForm(userId, novelId);
+  if (!form || forceRefresh) {
+    // Hard dependency: units need form/catalog when possible (D7)
+    console.log("[Extract] timeline requires form first 鈥?analyzing form...");
+    const llm = createLLMProvider();
+    const formResult = await runWithTokenContext({ agentId: "extract_form" }, () =>
+      analyzeNovelForm(novelId, text, llm),
+    );
+    saveNovelForm(userId, novelId, formResult.profile);
+    ensureMainBranch(userId, novelId);
+    if (formResult.profile.chaptering.enabled && formResult.catalog.length > 0) {
+      const existing = getBranchChapterMeta(userId, novelId, branchId);
+      saveBranchChapterMeta(userId, {
+        ...existing,
+        novelId,
+        branchId,
+        chapters: formResult.catalog,
+        chapterBoundary: existing.chapterBoundary || "closed",
+      });
+    }
+    result.form = formResult.profile;
+    result.chapterCatalogCount = formResult.catalog.length;
+    if (!result.ran.includes("form")) result.ran.push("form");
+    form = formResult.profile;
+  }
+  // ... then startTimelineJob as today
+}
+```
+
+Avoid double-running form when phase1 already ran it: only enter this block when `!result.form && !result.ran.includes("form")` or when form missing in DB.
+
+Refined guard:
+
+```ts
+if (want("timeline")) {
+  if (!result.form) {
+    result.form = getNovelForm(userId, novelId);
+  }
+  if (!result.form) {
+    // auto form as above
+  }
+  // start job...
+}
+```
+
+- [ ] **Step 3: Typecheck**
+
+Run: `npx tsc --noEmit`
+
+- [ ] **Step 4: Commit**
+
+```bash
+git add src/core/extractor/run-modular-extract.ts
+git commit -m "fix(extract): analyze form before timeline job when missing"
+```
+
+---
+
+### Task 6: Spec status + verification gate
+
+**Files:**
+- Modify: `docs/specs/analysis-and-chaptering.md` 搂7 / 搂8 C checkboxes where true
+
+- [ ] **Step 1: Run full test suite**
+
+Run: `npm test`
+
+Expected: all suites pass including `form-context`, `accept chapter meta`, `chapter-catalog`.
+
+- [ ] **Step 2: Update spec 搂7 rows**
+
+Set:
+
+| Area | New status |
+|------|------------|
+| Agent tools load form/boundary | **done** (get_novel_form + get_branch_meta.form) |
+| Outline/writer prompt text | **partial鈫抜mproved** (tool-required; still no structured chapterPlan JSON) |
+| Accept boundary + catalog | **partial** (tests cover happy paths; outline keyword still heuristic) |
+
+Mark 搂8 C items checked only if truly done:
+
+- [x] Outline/writer can read form via tool  
+- [x] When chaptering disabled, writer prompts forbid inventing 绗琋绔? 
+
+- [ ] **Step 3: Commit**
+
+```bash
+git add docs/specs/analysis-and-chaptering.md
+git commit -m "docs(spec): mark agent form consumption P0 as implemented"
+```
+
+---
+
+## Self-review (plan vs spec)
+
+### Spec coverage (P0)
+
+| Spec 搂9 P0 item | Task |
+|-----------------|------|
+| Tool: get_novel_form / extend get_branch_meta | Task 2 |
+| Wire outline + writer to consume data | Task 3 |
+| Automated tests: form enable/disable, accept boundary, tool payload | Tasks 1 + 4 |
+
+| Spec 搂8 C | Task |
+|-----------|------|
+| Read continuationRules + samples + boundary | Tasks 1鈥? |
+| Disabled 鈫?forbid invent 绗琋绔?| Tasks 1, 3 |
+
+| Bonus (P1.6 light) | Task 5 form-before-timeline |
+
+Not covered (correctly deferred): durable jobs, mobile rail, hierarchy tree, export TOC, overview card.
+
+### Placeholder scan
+
+No TBD/TODO steps; code blocks included for helpers, tools, tests, extract guard.
+
+### Type consistency
+
+- `FormAgentContext` / `buildFormAgentContext` / `formatFormAgentContextForTool` used consistently in Task 1鈥?.
+- Tool name `get_novel_form` consistent across branch-tools, writer schemas, chat allowlist, agent-panel, prompts.
+
+---
+
+## Execution handoff
+
+Plan saved to `docs/superpowers/plans/2026-07-18-analysis-form-agent-consume.md`.
+
+**Two execution options:**
+
+1. **Subagent-Driven (recommended)** 鈥?fresh subagent per task, review between tasks  
+2. **Inline Execution** 鈥?this session, batch with checkpoints  
+
+**Which approach?**
diff --git a/scripts/run-tests.ts b/scripts/run-tests.ts
index 8875229..2eb8d14 100644
--- a/scripts/run-tests.ts
+++ b/scripts/run-tests.ts
@@ -10,10 +10,12 @@ import { runSaveVerifyTests } from "./tests/save-verify.test";
 import { runCommitRealizationTests } from "./tests/commit-realization.test";
 import { runAcceptContinuationTests } from "./tests/accept-continuation.test";
 import { runTextWindowTests } from "./tests/text-window.test";
 import { runBranchCowTests } from "./tests/branch-cow.test";
 import { runChapterCatalogTests } from "./tests/chapter-catalog.test";
+import { runFormContextTests } from "./tests/form-context.test";
+import { runAcceptChapterMetaTests } from "./tests/accept-chapter-meta.test";
 
 function main() {
   resetCounters();
   console.log("novel-character-sim 鈥?agent continuation core tests\n");
 
@@ -24,10 +26,12 @@ function main() {
   runCommitRealizationTests();
   runAcceptContinuationTests();
   runTextWindowTests();
   runBranchCowTests();
   runChapterCatalogTests();
+  runFormContextTests();
+  runAcceptChapterMetaTests();
 
   const { failed } = summary();
   if (failed > 0) process.exitCode = 1;
 }
 
diff --git a/scripts/tests/accept-chapter-meta.test.ts b/scripts/tests/accept-chapter-meta.test.ts
new file mode 100644
index 0000000..b1c4207
--- /dev/null
+++ b/scripts/tests/accept-chapter-meta.test.ts
@@ -0,0 +1,157 @@
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
+        // Draft starts with a chapter title so a regressing (non-early-return)
+        // updateChapterMetaAfterAccept would catalog it via extractChapterCatalog.
+        const draft = `绗?9绔?涓嶈鍏ュ簱\n${BODY}`;
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
+        assert.ok(
+          !meta.chapters.some(
+            (c) =>
+              c.number === 99 ||
+              c.title.includes("涓嶈鍏ュ簱") ||
+              c.title.includes("绗?9绔?),
+          ),
+          `disabled chaptering must not catalog draft title: ${JSON.stringify(meta.chapters)}`,
+        );
+      } finally {
+        deleteNovel(userId, novelId);
+        _resetStore();
+      }
+    });
+  });
+}
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
diff --git a/src/app/api/agent/chat/route.ts b/src/app/api/agent/chat/route.ts
index 958b7d9..39997df 100644
--- a/src/app/api/agent/chat/route.ts
+++ b/src/app/api/agent/chat/route.ts
@@ -47,10 +47,11 @@ export async function POST(request: NextRequest) {
     "agent",
     "ask_question",
     "run_reviews",
     "accept_continuation",
     "get_branch_text", "get_branch_characters", "get_branch_timeline", "get_branch_world", "get_branch_meta",
+    "get_novel_form",
     "get_outline", "get_findings", "clear_findings",
   ]);
   const toolSchemas: ToolSchema[] = buildToolSchemas().filter(t => MASTER_TOOL_ALLOW.has(t.name));
   const baseSys = resolveAgentSystem("master", "zh", { novelId, branchId });
   const sysPrompt = autoPass
diff --git a/src/components/agent-panel.tsx b/src/components/agent-panel.tsx
index 1a4f042..c831e21 100644
--- a/src/components/agent-panel.tsx
+++ b/src/components/agent-panel.tsx
@@ -87,10 +87,11 @@ const TOOL_LABELS: Record<string, string> = {
   get_branch_text: "鑾峰彇鍒嗘敮鍓嶆枃",
   get_branch_characters: "鑾峰彇瑙掕壊",
   get_branch_timeline: "鑾峰彇鏃堕棿绾?,
   get_branch_world: "鑾峰彇涓栫晫瑙?,
   get_branch_meta: "鑾峰彇鍒嗘敮淇℃伅",
+  get_novel_form: "鑾峰彇褰㈡€?绔犳硶",
   save_outline: "淇濆瓨澶х翰",
   save_prose: "淇濆瓨姝ｆ枃",
   save_findings: "淇濆瓨瀹℃煡鍙戠幇",
   clear_findings: "娓呯┖瀹℃煡鍙戠幇",
 };
diff --git a/src/core/agents/agents/branch-tools.ts b/src/core/agents/agents/branch-tools.ts
index 593619e..3ccac4c 100644
--- a/src/core/agents/agents/branch-tools.ts
+++ b/src/core/agents/agents/branch-tools.ts
@@ -1,7 +1,18 @@
 import type { ToolDefinition } from "../types";
-import { getBranchProse, getCharacters, getTimeline, getStoryInfo } from "@/lib/db";
+import {
+  getBranchProse,
+  getCharacters,
+  getTimeline,
+  getStoryInfo,
+  getNovelForm,
+  getBranchChapterMeta,
+} from "@/lib/db";
+import {
+  buildFormAgentContext,
+  formatFormAgentContextForTool,
+} from "@/core/form/form-context";
 import { formatCriticalMiss } from "../critical-miss";
 
 const TEXT_TAIL = 30000;
 
 /** Rough genre 鈫?logic strictness for review agents (prompt hint only). */
@@ -149,11 +160,12 @@ export const branchTools: ToolDefinition[] = [
       };
     },
   },
   {
     name: "get_branch_meta",
-    description: "鑾峰彇鍒嗘敮鍏冧俊鎭細name/parent_offset/鎬诲瓧鏁般€?,
+    description:
+      "鑾峰彇鍒嗘敮鍏冧俊鎭細name/瀛楁暟锛屼互鍙婂舰鎬?绔犳硶鎽樿锛堟槸鍚﹀垎绔犮€佺珷鍚嶆牱渚嬨€乧ontinuationRules銆佺珷寮€闂竟鐣屻€佺洰褰曟潯鏁帮級銆傚ぇ绾蹭笌鍐欐墜缁啓鍓嶅簲璋冪敤銆?,
     parameters: {
       type: "object",
       properties: {
         novelId: { type: "string", description: "灏忚 ID" },
         branchId: { type: "string", description: "鍒嗘敮 ID锛堜富绾夸负 main锛? },
@@ -164,17 +176,68 @@ export const branchTools: ToolDefinition[] = [
       const userId = ctx.userId || "guest";
       const novelId = (ctx.novelId || args.novelId || "") as string;
       const branchId = (ctx.branchId || args.branchId || "main") as string;
       const { text, branch } = getBranchProse(userId, novelId, branchId);
       if (!branch) return { content: "鍒嗘敮涓嶅瓨鍦?, messages: [] };
+
+      const form = getNovelForm(userId, novelId);
+      const chapterMeta = getBranchChapterMeta(userId, novelId, branchId);
+      const formCtx = buildFormAgentContext({
+        form,
+        chapterMeta,
+        novelId,
+        branchId,
+      });
+
+      return {
+        content: JSON.stringify(
+          {
+            name: branch.name,
+            parent_offset: branch.parent_offset,
+            novel_id: branch.novel_id,
+            total_chars: text.length,
+            form: formCtx,
+          },
+          null,
+          2,
+        ),
+        messages: [],
+      };
+    },
+  },
+  {
+    name: "get_novel_form",
+    description:
+      "鑾峰彇灏忚褰㈡€?绔犳硶锛堥锛夛細formType銆佹槸鍚﹀垎绔犮€佺珷鍚?samples銆乧ontinuationRules銆佸垎鏀珷杈圭晫涓庣洰褰曟憳瑕併€傚ぇ绾蹭笌鍐欐墜鍦ㄨ鍒掔珷鑺傚墠搴旇皟鐢紱寮卞垎绔犳椂蹇呴』閬靛畧 forbidInventChapterTitles銆?,
+    parameters: {
+      type: "object",
+      properties: {
+        novelId: { type: "string", description: "灏忚 ID" },
+        branchId: { type: "string", description: "鍒嗘敮 ID锛堢敤浜庤竟鐣?鐩綍锛涗富绾?main锛? },
+      },
+      required: ["novelId", "branchId"],
+    },
+    execute: async (args, ctx) => {
+      const userId = ctx.userId || "guest";
+      const novelId = (ctx.novelId || args.novelId || "") as string;
+      const branchId = (ctx.branchId || args.branchId || "main") as string;
+      if (!novelId) {
+        return {
+          content: formatCriticalMiss("novelId", "缂哄皯 novelId锛屾棤娉曡鍙栧舰鎬佸垎鏋愩€?),
+          messages: [],
+        };
+      }
+      const form = getNovelForm(userId, novelId);
+      const chapterMeta = getBranchChapterMeta(userId, novelId, branchId);
+      const formCtx = buildFormAgentContext({
+        form,
+        chapterMeta,
+        novelId,
+        branchId,
+      });
       return {
-        content: JSON.stringify({
-          name: branch.name,
-          parent_offset: branch.parent_offset,
-          novel_id: branch.novel_id,
-          total_chars: text.length,
-        }, null, 2),
+        content: formatFormAgentContextForTool(formCtx),
         messages: [],
       };
     },
   },
 ];
diff --git a/src/core/agents/agents/writer.ts b/src/core/agents/agents/writer.ts
index d287c1b..c0d5ecb 100644
--- a/src/core/agents/agents/writer.ts
+++ b/src/core/agents/agents/writer.ts
@@ -41,26 +41,28 @@ const FS_READ = foreshadowTools
     name: t.name,
     description: t.description,
     parameters: t.parameters as Record<string, unknown>,
   }));
 
-/** Create: outline + branch + foreshadow + save_prose */
+/** Create: outline + branch + form + foreshadow + save_prose */
 const CREATE_TOOLS = [
   ...schemas([
     "get_outline",
     "get_branch_text",
     "get_branch_characters",
     "get_branch_timeline",
     "get_branch_world",
+    "get_branch_meta",
+    "get_novel_form",
   ]),
   ...FS_READ,
   SAVE_SCHEMA,
 ];
 
-/** Rewrite: prose + findings + save_prose */
+/** Rewrite: prose + findings + form + save_prose */
 const REWRITE_TOOLS = [
-  ...schemas(["get_prose", "get_findings", "get_branch_text"]),
+  ...schemas(["get_prose", "get_findings", "get_branch_text", "get_novel_form"]),
   ...FS_READ,
   SAVE_SCHEMA,
 ];
 
 /** Did the agent successfully call save_prose? (tool_result in trail) */
diff --git a/src/core/extractor/run-modular-extract.ts b/src/core/extractor/run-modular-extract.ts
index 871f522..446b943 100644
--- a/src/core/extractor/run-modular-extract.ts
+++ b/src/core/extractor/run-modular-extract.ts
@@ -275,14 +275,39 @@ async function runModularExtractInner(input: ModularExtractInput): Promise<Modul
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
diff --git a/src/core/prompts/outline-agent-contract.md b/src/core/prompts/outline-agent-contract.md
index a859b68..8ff3040 100644
--- a/src/core/prompts/outline-agent-contract.md
+++ b/src/core/prompts/outline-agent-contract.md
@@ -1,12 +1,16 @@
 ## 宸ュ叿涓庢搷浣滄楠わ紙Agent 妗嗘灦锛? 
-### 姝ラ 1锛氬彇璇锛堟寜闇€锛?+### 姝ラ 1锛氬彇璇锛堟寜闇€锛岀珷娉曞繀鍙栵級
 闈欓粯璋冪敤锛?+- **`get_novel_form`**锛堝繀鍋氫竴娆★級锛氭槸鍚﹀垎绔犮€佺珷鍚?samples銆乧ontinuationRules銆佺珷杈圭晫
 - `get_branch_text` / `get_branch_characters` / `get_branch_timeline` / `get_branch_world`
 - `get_foreshadowing_ledger`锛堣嫢鏈夋椿璺冧紡绗旓級
 
+鑻?`forbidInventChapterTitles=true`锛氬ぇ绾蹭腑绂佹瑙勫垝銆岀N绔犮€嶆爣棰橈紝闄ら潪鐢ㄦ埛鏄庣‘瑕佹眰鍒嗙珷銆?+鑻?`chapteringEnabled=true`锛氬繀椤诲啓娓?`缁啓鏈珷` / `鏀舵潫鏈珷骞舵柊寮€` / `鏂板紑涓€绔燻锛屾柊绔犳爣棰樿创鍚?samples銆?+
 ### 姝ラ 2锛氳惤鐩橈紙蹇呴』锛岀▼搴忓彧璁ゅ伐鍏凤級
 1. **`save_outline`**锛歚content` = **瀹屾暣澶х翰姝ｆ枃**锛堢粨鏋勬竻鏅扮殑鑷劧璇█锛?*涓嶆槸 JSON**锛? 2. **`save_foreshadowing_plan`**锛歚plan` = JSON 瀛楃涓? 
    `{ "plant":[], "advance":[], "reveal":[], "abandon":[], "rationale":"" }`
 
@@ -15,10 +19,11 @@
 - 涓?agent / 鐢ㄦ埛閫氳繃 `get_outline` 璇诲叏鏂? 
 ## 鍙敤宸ュ叿
 | 宸ュ叿 | 鐢ㄩ€?|
 |------|------|
+| **get_novel_form** | 褰㈡€?绔犳硶锛堝繀鍋氫竴娆★級 |
 | get_branch_* | 璇 |
 | get_foreshadowing_ledger | 娲昏穬浼忕瑪 |
 | list_ideas / get_ideas | 鐐瑰瓙搴?|
 | **save_outline** | **淇濆瓨澶х翰锛堝繀鍋氾級** |
 | **save_foreshadowing_plan** | **淇濆瓨浼忕瑪鎰忓浘锛堝繀鍋氾級** |
diff --git a/src/core/prompts/outline-system.md b/src/core/prompts/outline-system.md
index 0b63013..fa9ee6b 100644
--- a/src/core/prompts/outline-system.md
+++ b/src/core/prompts/outline-system.md
@@ -9,17 +9,19 @@
 ## 澶х翰鏍稿績瑕佺礌
 
 涓€涓畬鏁寸殑缁啓澶х翰锛屽繀椤绘槑纭互涓嬩俊鎭細
 
 ### 1. 绡囧箙涓庣珷鑺傝鍒?+- **鍏堣皟鐢?`get_novel_form`锛堟垨璇?`get_branch_meta.form`锛?* 鍐嶅啓绔犺妭瑙勫垝
 - 棰勮缁啓瀛楁暟锛堟牴鎹墠鏂囬暱搴﹀拰鎯呰妭闇€瑕侊紝寤鸿2000-8000瀛楋級
 - 棰勮鍒嗕负鍑犵珷锛堝缓璁?-3绔狅紝濡傛灉鎯呰妭璺ㄥ害杈冨ぇ鍙€傚綋澧炲姞锛?-- **蹇呴』鍐欐竻鏈珷绛栫暐**锛堜笁閫変竴鎴栫粍鍚堬級锛?+- 鑻?`chapteringEnabled=false` / `forbidInventChapterTitles=true`锛氫笉瑕佺紪閫犮€岀N绔犮€嶏紝鐢ㄥ満鏅?娈佃惤瑙勫垝鍗冲彲
+- 鑻?`chapteringEnabled=true`锛氭柊绔犳爣棰樺繀椤昏创杩?`chapterTitleSamples` 鐨勬牸寮忥紱骞堕伒瀹?`continuationRules`
+- **蹇呴』浣跨敤鍙绱㈠叧閿瘝涔嬩竴鍐欐竻绛栫暐**锛歚缁啓鏈珷` / `鏀舵潫鏈珷` / `鏂板紑涓€绔燻锛坅ccept 杈圭晫鍚彂寮忎緷璧栬繖浜涜瘝锛?   - `缁啓鏈珷`锛氫笉鏂拌捣绔犳爣棰?   - `鏀舵潫鏈珷骞舵柊寮€`锛氬啓瀹屽綋鍓嶇珷鍚庢柊寮€绔狅紝骞剁粰鍑烘柊绔犳爣棰橈紙鏍煎紡璐村悎鍘熻憲锛屽銆岀N绔?鏍囬銆嶏級
   - `鏂板紑涓€绔?澶氱珷`锛氬垪鍑烘瘡绔犳嫙瀹氭爣棰樹笌涓€鍙ヨ瘽鑺傛媿
-- 鑻ュ師钁楀急鍒嗙珷/涓嶅垎绔狅細涓嶈缂栭€犮€岀N绔犮€? 
 ### 2. 鏃堕棿
 鏈缁啓鍙戠敓鍦ㄤ粈涔堟椂闂达紵绱ф帴鍓嶆枃杩樻槸璺宠穬浜嗗嚑澶?鍑犱釜鏈?鍑犲勾锛熶粈涔堝鑺傦紵鐧藉ぉ杩樻槸澶滄櫄锛? 
 ### 3. 绌洪棿
diff --git a/src/core/prompts/writer-create-system.md b/src/core/prompts/writer-create-system.md
index d3e6224..6502117 100644
--- a/src/core/prompts/writer-create-system.md
+++ b/src/core/prompts/writer-create-system.md
@@ -11,25 +11,29 @@
 
 ### 2. 琛ュ厖璇锛堟寜闇€锛? 鍙€夛細`get_branch_text` / `get_branch_characters` / `get_branch_timeline` / `get_branch_world`  
 璋冨伐鍏锋椂涓嶈鍐欒繃绋嬫梺鐧姐€? 
+### 2b. 褰㈡€?绔犳硶锛堝繀鍋氫竴娆★級
+- 璋冪敤 `get_novel_form`锛堟垨 `get_branch_meta` 涓殑 form锛?+- 鑻?`forbidInventChapterTitles=true`锛?*绂佹**鍦ㄦ鏂囦腑鍐欍€岀N绔犫€︺€嶆爣棰樿锛岄櫎闈炵敤鎴?prompt 鏄庣‘瑕佹眰鍒嗙珷
+- 鑻?`chapteringEnabled=true`锛?+  - 澶х翰鍐欍€屾柊寮€銆嶁啋 姝ｆ枃浠ヤ笌 `chapterTitleSamples` 涓€鑷寸殑鏍囬璧风瑪锛堢嫭鍗犱竴琛岋級
+  - 澶х翰鍐欍€岀画鍐欐湰绔犮€嶁啋 **涓嶈**鏃犳晠鏂拌捣绔犳爣棰?+  - 閬靛畧 `continuationRules` 鍏ㄦ枃
+
 ### 3. 鍐欎綔骞朵繚瀛橈紙蹇呭仛锛? 1. 鍦ㄥ績涓紙鎴栬崏绋夸腑锛夊畬鎴?*瀹屾暣鍙欎簨姝ｆ枃**
 2. **蹇呴』璋冪敤** `save_prose`锛屽弬鏁?`content` = **瀹屾暣灏忚姝ｆ枃鍏ㄦ枃**
 3. 绛夊緟宸ュ叿杩斿洖銆屾鏂囧凡瀛橈紙N 瀛楋級銆嶆墠绠楁垚鍔? 4. 鑻ヨ繑鍥炪€屾嫆缁濅繚瀛樸€嶁啋 鎸夋彁绀轰慨姝?content锛屽啀娆?`save_prose`
 
-### 绔犳爣棰橈紙鑻ユ湰涔﹀垎绔狅級
-- 鑻ュぇ绾叉爣鏄?*鏂板紑绔?/ 绗?N 绔?*锛屾鏂囬』浠ヤ笌鍘熻憲涓€鑷寸殑绔犳爣棰樿捣绗旓紙濡?`绗?2绔?闆ㄥ`锛夛紝鐙崰涓€琛?-- 鑻ュぇ绾叉爣鏄?*缁啓鏈珷 / 鍚屼竴绔?*锛?*涓嶈**鏃犳晠鏂拌捣銆岀N绔犮€?-- 鑻ヨ澧冩樉绀烘湰涔﹀急鍒嗙珷/涓嶅垎绔狅紝涓嶈纭姞绔犳爣棰?-
 ## 鍙敤宸ュ叿
 | 宸ュ叿 | 鐢ㄩ€?|
 |------|------|
 | get_outline | 澶х翰锛堝繀鍋氾級 |
+| **get_novel_form** / get_branch_meta | 褰㈡€?绔犳硶锛堝繀鍋氫竴娆★級 |
 | get_branch_text / characters / timeline / world | 璇锛堝彲閫夛級 |
 | **save_prose** | **淇濆瓨瀹屾暣姝ｆ枃锛堝繀鍋氾紝浠诲姟瀹屾垚鐨勬爣蹇楋級** |
 
 ## 绂佹
 - 涓嶈璋冪敤 get_prose / get_findings
diff --git a/src/core/prompts/writer-create-user.md b/src/core/prompts/writer-create-user.md
index e2cb47c..8b9c86f 100644
--- a/src/core/prompts/writer-create-user.md
+++ b/src/core/prompts/writer-create-user.md
@@ -1,6 +1,6 @@
 {{prompt}}
 
 ## 褰撳墠缁戝畾鍒嗘敮
 novelId={{novelId}}, branchId={{branchId}}
 
-鎸夋楠わ細get_outline 鈫掞紙鍙€?get_branch_*锛夆啋 **save_prose(瀹屾暣姝ｆ枃)**銆備换鍔′互 save_prose 鎴愬姛涓哄噯銆?+鎸夋楠わ細get_outline 鈫?get_novel_form 鈫掞紙鍙€?get_branch_*锛夆啋 **save_prose(瀹屾暣姝ｆ枃)**銆備换鍔′互 save_prose 鎴愬姛涓哄噯銆?diff --git a/src/core/prompts/writer-rewrite-system.md b/src/core/prompts/writer-rewrite-system.md
index c1825b4..4fdc56b 100644
--- a/src/core/prompts/writer-rewrite-system.md
+++ b/src/core/prompts/writer-rewrite-system.md
@@ -13,10 +13,13 @@
 - 璋冪敤 `get_findings`锛堟爣璁颁负銆屽鏌ラ棶棰樻竻鍗曘€嶏紝鍙綔淇敼渚濇嵁锛? 
 ### 3. 鎸夐渶瀵圭収
 鍙€夛細`get_branch_text`
 
+## 绔犳硶
+鏀瑰啓鏃惰皟鐢?`get_novel_form` 涓€娆°€傝嫢 `forbidInventChapterTitles=true`锛屼笉瑕佹柊澧炪€岀N绔犮€嶆爣棰樿銆傝嫢鍘熻崏绋垮凡鏈夌珷鏍囬锛屼繚鎸佹牸寮忎竴鑷达紝鍕挎敼鎴愬彟涓€绉嶇紪鍙蜂綋绯汇€?+
 ### 4. 淇敼骞朵繚瀛橈紙蹇呭仛锛? 1. 鍦ㄦ楠?1 鐨勬鏂囦笂锛屽彧鏀规楠?2 鎸囧嚭鐨勯棶棰? 2. 寰楀埌**淇敼鍚庣殑瀹屾暣绔犺妭**锛堥暱搴︽帴杩戝師鏂囷紝涓嶆槸鍑犳潯瑕佺偣锛? 3. **蹇呴』璋冪敤** `save_prose`锛宍content` = 淇敼鍚庣殑**瀹屾暣灏忚姝ｆ枃**
 4. 鐪嬪埌銆屾鏂囧凡瀛橈紙N 瀛楋級銆嶆墠绠楀畬鎴?@@ -26,10 +29,11 @@
 | 宸ュ叿 | 鐢ㄩ€?|
 |------|------|
 | get_prose | 寰呮敼姝ｆ枃锛堝繀鍋氾級 |
 | get_findings | 闂娓呭崟锛堝繀鍋氾級 |
 | get_branch_text | 鍙€?|
+| **get_novel_form** | 褰㈡€?绔犳硶锛堟敼鍐欐椂鍋氫竴娆★級 |
 | **save_prose** | **淇濆瓨淇敼鍚庢鏂囷紙蹇呭仛锛屼换鍔″畬鎴愮殑鏍囧織锛?* |
 
 ## 绂佹锛堣繚鍙嶅垯 save 浼氳鎷掔粷 / 浠诲姟澶辫触锛? `save_prose` 鐨?content **缁濆涓嶈兘**鏄細
 - 銆岀幇鍦ㄦ垜宸茶幏鍙栤€﹀紑濮嬩慨鏀规鏂囥€?

