# Analysis Form → Agent Consume (P0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make outline and writer agents actually read and obey novel form (骨): chaptering on/off, title samples, continuationRules, and branch chapter boundary/catalog — closing the critical gap where analysis produces form but continuation ignores it.

**Architecture:** Extract a pure `buildFormAgentContext()` helper that shapes DB form + branch chapter meta into a stable JSON payload. Expose it via a new tool `get_novel_form` and an extended `get_branch_meta`. Wire outline + writer tool lists and prompt steps so agents must load form context before planning/writing. Add pure-logic tests (payload shape, enable/disable rules, accept boundary) without requiring live LLM.

**Tech Stack:** TypeScript, existing agent tool registry (`branch-tools.ts`), SQLite helpers in `src/lib/db.ts`, prompt markdown under `src/core/prompts/`, test harness in `scripts/tests/` via `npm test`.

**Spec source of truth:** `docs/specs/analysis-and-chaptering.md` (§3 D1–D8, §8 C, §9 P0).

## Global Constraints

- User-facing copy: **「分析」** only — never reintroduce **拆解** in UI strings.
- Conservative chaptering: if confidence low / disabled → agents must not invent `第N章` unless user explicitly asks (D3, D8).
- Catalog remains program-first; this plan does **not** rebuild multi-level 部→卷→章→节 trees (future plan).
- Timeline job durability / mobile rail / SQLite job persist = **out of scope** (P1).
- All LLM calls still go through `createLLMProvider()`; JSON parsing still via `extractJSON()` if any LLM path is touched (prefer no new LLM calls in this plan).
- Prefer pure helpers + existing `npm test` harness over new test frameworks.
- Do not delete `data/` or rewrite unrelated extract modules.

## Out of scope (do not implement in this plan)

| Item | Why deferred |
|------|----------------|
| Full hierarchy tree (部/卷/章/节) | Domain types partially ready; needs separate design for catalog tree + primary boundary unit |
| Durable timeline jobs in SQLite | P1 |
| Branch-scoped timeline DB rows | P1 |
| Mobile reader rail drawer | P1 |
| Overview form summary card polish | P2 |
| Export TXT TOC | P2 |

## File map

| File | Responsibility |
|------|----------------|
| `src/core/form/form-context.ts` | **Create.** Pure payload builder for agents (no DB import of side effects beyond types). |
| `src/core/agents/agents/branch-tools.ts` | Add `get_novel_form`; extend `get_branch_meta` to include form + chapter meta summary. |
| `src/core/agents/agents/outline.ts` | Ensure outline has form tools (via full `branchTools`); strengthen user-side instructions after load. |
| `src/core/agents/agents/writer.ts` | Add `get_novel_form` / `get_branch_meta` to CREATE (and optionally REWRITE) tool schemas. |
| `src/core/prompts/outline-system.md` | Require reading form; chapter plan keywords stay machine-grep-friendly. |
| `src/core/prompts/outline-agent-contract.md` | Document `get_novel_form` / extended meta in steps. |
| `src/core/prompts/writer-create-system.md` | Require `get_novel_form` before write; hard forbid inventing 第N章 when disabled. |
| `src/core/prompts/writer-create-user.md` | Short reminder block if present. |
| `src/core/prompts/writer-rewrite-system.md` | Same chaptering constraint on rewrite (no new fake titles). |
| `src/core/prompts/defaults.ts` | Only if admin defaults embed stale copies — sync if needed. |
| `src/app/api/agent/chat/route.ts` | Add `get_novel_form` to master allowlist if master should see it. |
| `src/components/agent-panel.tsx` | Chinese label for `get_novel_form`. |
| `src/core/extractor/run-modular-extract.ts` | Hard dependency: if timeline selected and form missing, run form first (or await form in phase1 when both wanted). |
| `scripts/tests/form-context.test.ts` | **Create.** Payload + enable/disable contract tests. |
| `scripts/tests/accept-chapter-meta.test.ts` | **Create.** Accept boundary / catalog rebuild behaviors. |
| `scripts/run-tests.ts` | Register new suites. |
| `docs/specs/analysis-and-chaptering.md` | Update §7 status for agent tools after done. |

---

### Task 1: Pure form agent context helper

**Files:**
- Create: `src/core/form/form-context.ts`
- Test: `scripts/tests/form-context.test.ts`
- Modify: `scripts/run-tests.ts`

**Interfaces:**
- Consumes: `NovelFormProfile`, `BranchChapterMeta` from `@/types`
- Produces:
  - `export interface FormAgentContext { ... }`
  - `export function buildFormAgentContext(input: { form: NovelFormProfile | null; chapterMeta: BranchChapterMeta | null; novelId: string; branchId: string }): FormAgentContext`
  - `export function formatFormAgentContextForTool(ctx: FormAgentContext): string` (JSON.stringify pretty)

- [ ] **Step 1: Write the failing test file**

Create `scripts/tests/form-context.test.ts`:

```ts
/**
 * Form agent context payload — shape + conservative chaptering rules.
 */
import { assert, suite, test } from "../lib/test-harness";
import {
  buildFormAgentContext,
  formatFormAgentContextForTool,
} from "../../src/core/form/form-context";
import type { BranchChapterMeta, NovelFormProfile } from "../../src/types";

function baseForm(over: Partial<NovelFormProfile> = {}): NovelFormProfile {
  return {
    novelId: "n1",
    formType: "web_novel",
    unitHierarchy: { volume: "absent", chapter: "present", section: "absent" },
    chaptering: {
      enabled: true,
      confidence: 0.9,
      numbering: "arabic_di_n_zhang",
      titlePattern: "第N章",
      separator: " ",
      samples: ["第1章 开端", "第2章 发展"],
      chapterEndTendency: "cliffhanger",
    },
    narrativeArchitecture: {
      primaryTemplate: "episodic",
      genreHints: ["玄幻"],
      evidenceNotes: "dense chapter titles",
      povScheme: "第三人称",
      timeScheme: "linear",
    },
    continuationRules: [
      "本书分章：新开章时使用与 samples 一致的章标题格式。",
      "续写同一章时不要无故新起「第N章」。",
    ],
    ...over,
  };
}

function baseMeta(over: Partial<BranchChapterMeta> = {}): BranchChapterMeta {
  return {
    novelId: "n1",
    branchId: "main",
    chapterBoundary: "open",
    openChapter: { number: 2, title: "第2章 发展", startedAtOffset: 100 },
    chapters: [
      {
        id: "c1",
        number: 1,
        title: "第1章 开端",
        startOffset: 0,
        endOffset: 99,
        source: "regex",
      },
      {
        id: "c2",
        number: 2,
        title: "第2章 发展",
        startOffset: 100,
        source: "regex",
      },
    ],
    ...over,
  };
}

export function runFormContextTests(): void {
  suite("form-context", () => {
    test("enabled form exposes samples + rules + boundary", () => {
      const ctx = buildFormAgentContext({
        form: baseForm(),
        chapterMeta: baseMeta(),
        novelId: "n1",
        branchId: "main",
      });
      assert.equal(ctx.chapteringEnabled, true);
      assert.equal(ctx.forbidInventChapterTitles, false);
      assert.ok(ctx.chapterTitleSamples.includes("第1章 开端"));
      assert.equal(ctx.chapterBoundary, "open");
      assert.equal(ctx.catalogCount, 2);
      assert.ok(ctx.continuationRules.length >= 1);
      assert.equal(ctx.formType, "web_novel");
    });

    test("null form → conservative forbid invent titles", () => {
      const ctx = buildFormAgentContext({
        form: null,
        chapterMeta: null,
        novelId: "n1",
        branchId: "main",
      });
      assert.equal(ctx.chapteringEnabled, false);
      assert.equal(ctx.forbidInventChapterTitles, true);
      assert.ok(ctx.continuationRules.some((r) => r.includes("第N章") || r.includes("分章")));
    });

    test("disabled chaptering → forbidInventChapterTitles true", () => {
      const ctx = buildFormAgentContext({
        form: baseForm({
          formType: "essay_prose",
          chaptering: {
            enabled: false,
            confidence: 0.2,
            numbering: "none",
            titlePattern: "",
            separator: "",
            samples: [],
          },
          continuationRules: ["本书按保守策略视为弱分章/不分章：除非用户要求，不要添加「第N章」标题。"],
        }),
        chapterMeta: baseMeta({ chapterBoundary: "closed", chapters: [] }),
        novelId: "n1",
        branchId: "main",
      });
      assert.equal(ctx.chapteringEnabled, false);
      assert.equal(ctx.forbidInventChapterTitles, true);
      assert.equal(ctx.catalogCount, 0);
    });

    test("formatFormAgentContextForTool is parseable JSON with required keys", () => {
      const ctx = buildFormAgentContext({
        form: baseForm(),
        chapterMeta: baseMeta(),
        novelId: "n1",
        branchId: "main",
      });
      const raw = formatFormAgentContextForTool(ctx);
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const k of [
        "novelId",
        "branchId",
        "formType",
        "chapteringEnabled",
        "forbidInventChapterTitles",
        "chapterTitleSamples",
        "continuationRules",
        "chapterBoundary",
        "catalogCount",
        "unitHierarchy",
      ]) {
        assert.ok(k in parsed, `missing key ${k}`);
      }
    });
  });
}
```

- [ ] **Step 2: Register suite in `scripts/run-tests.ts`**

Add import and call:

```ts
import { runFormContextTests } from "./tests/form-context.test";
// ...
runFormContextTests();
```

- [ ] **Step 3: Run tests — expect FAIL**

Run: `npm test`

Expected: FAIL — cannot find module `../../src/core/form/form-context` (or similar).

- [ ] **Step 4: Implement `src/core/form/form-context.ts`**

```ts
/**
 * Stable agent-facing view of novel form (骨) + branch chapter meta.
 * Pure: no DB, no LLM.
 */
import type { BranchChapterMeta, NovelFormProfile, UnitPresence } from "@/types";

export interface FormAgentContext {
  novelId: string;
  branchId: string;
  /** Whether analysis found usable chaptering */
  chapteringEnabled: boolean;
  chapteringConfidence: number;
  formType: string;
  unitHierarchy: {
    volume: UnitPresence;
    chapter: UnitPresence;
    section: UnitPresence;
  };
  /** When true, writer/outline must not invent 第N章 unless user asks */
  forbidInventChapterTitles: boolean;
  chapterTitleSamples: string[];
  titlePattern: string;
  numbering: string;
  continuationRules: string[];
  chapterBoundary: "open" | "closed" | "unknown";
  openChapter?: { number?: number; title?: string; startedAtOffset: number };
  lastClosedChapter?: { number?: number; title?: string; endOffset: number };
  /** Truncated catalog for prompt size */
  catalogTail: Array<{ number?: number; title: string; startOffset: number }>;
  catalogCount: number;
  /** One-line human hint for prompts */
  summaryLine: string;
}

const DEFAULT_NO_CHAPTER_RULES = [
  "形态未分析或弱分章：除非用户明确要求分章，不要添加「第N章」标题。",
];

export function buildFormAgentContext(input: {
  form: NovelFormProfile | null;
  chapterMeta: BranchChapterMeta | null;
  novelId: string;
  branchId: string;
}): FormAgentContext {
  const { novelId, branchId } = input;
  const form = input.form;
  const meta = input.chapterMeta;

  const enabled = !!form?.chaptering?.enabled;
  const confidence = form?.chaptering?.confidence ?? 0;
  const samples = form?.chaptering?.samples?.slice(0, 8) || [];
  const rules =
    form?.continuationRules?.filter(Boolean).slice(0, 8) ||
    DEFAULT_NO_CHAPTER_RULES;

  const chapters = meta?.chapters || [];
  const catalogTail = chapters.slice(-12).map((c) => ({
    number: c.number,
    title: c.title,
    startOffset: c.startOffset,
  }));

  const chapterBoundary = meta?.chapterBoundary ?? "unknown";
  const forbidInventChapterTitles = !enabled;

  let summaryLine: string;
  if (!form) {
    summaryLine = "未找到形态分析：按弱分章处理，禁止发明第N章。";
  } else if (enabled) {
    summaryLine = `分章开启（confidence=${confidence.toFixed(2)}）；边界=${chapterBoundary}；目录 ${chapters.length} 条；样例：${samples.slice(0, 2).join(" / ") || "无"}`;
  } else {
    summaryLine = `弱分章/不分章（formType=${form.formType}）：禁止发明第N章，除非用户要求。`;
  }

  return {
    novelId,
    branchId,
    chapteringEnabled: enabled,
    chapteringConfidence: confidence,
    formType: form?.formType || "unknown",
    unitHierarchy: form?.unitHierarchy || {
      volume: "absent",
      chapter: "absent",
      section: "absent",
    },
    forbidInventChapterTitles,
    chapterTitleSamples: samples,
    titlePattern: form?.chaptering?.titlePattern || "",
    numbering: form?.chaptering?.numbering || "none",
    continuationRules: rules,
    chapterBoundary,
    openChapter: meta?.openChapter,
    lastClosedChapter: meta?.lastClosedChapter,
    catalogTail,
    catalogCount: chapters.length,
    summaryLine,
  };
}

export function formatFormAgentContextForTool(ctx: FormAgentContext): string {
  return JSON.stringify(ctx, null, 2);
}
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `npm test`

Expected: `form-context` suite all ✓.

- [ ] **Step 6: Commit**

```bash
git add src/core/form/form-context.ts scripts/tests/form-context.test.ts scripts/run-tests.ts
git commit -m "feat(form): pure agent context payload for chaptering rules"
```

---

### Task 2: Agent tools — `get_novel_form` + extend `get_branch_meta`

**Files:**
- Modify: `src/core/agents/agents/branch-tools.ts`
- Modify: `src/app/api/agent/chat/route.ts` (master allowlist)
- Modify: `src/components/agent-panel.tsx` (label map)

**Interfaces:**
- Consumes: `buildFormAgentContext`, `formatFormAgentContextForTool` from `@/core/form/form-context`; `getNovelForm`, `getBranchChapterMeta`, `getBranchProse` from `@/lib/db`
- Produces: tool names `get_novel_form`, enhanced `get_branch_meta` registered via existing `branchTools` array (auto-registered in `init.ts`)

- [ ] **Step 1: Extend `branch-tools.ts` imports**

At top of `src/core/agents/agents/branch-tools.ts`, change imports to:

```ts
import type { ToolDefinition } from "../types";
import {
  getBranchProse,
  getCharacters,
  getTimeline,
  getStoryInfo,
  getNovelForm,
  getBranchChapterMeta,
} from "@/lib/db";
import {
  buildFormAgentContext,
  formatFormAgentContextForTool,
} from "@/core/form/form-context";
import { formatCriticalMiss } from "../critical-miss";
```

- [ ] **Step 2: Replace `get_branch_meta` execute to include form context**

Keep the tool name `get_branch_meta`. Update description and execute:

```ts
{
  name: "get_branch_meta",
  description:
    "获取分支元信息：name/字数，以及形态/章法摘要（是否分章、章名样例、continuationRules、章开闭边界、目录条数）。大纲与写手续写前应调用。",
  parameters: {
    type: "object",
    properties: {
      novelId: { type: "string", description: "小说 ID" },
      branchId: { type: "string", description: "分支 ID（主线为 main）" },
    },
    required: ["novelId", "branchId"],
  },
  execute: async (args, ctx) => {
    const userId = ctx.userId || "guest";
    const novelId = (ctx.novelId || args.novelId || "") as string;
    const branchId = (ctx.branchId || args.branchId || "main") as string;
    const { text, branch } = getBranchProse(userId, novelId, branchId);
    if (!branch) return { content: "分支不存在", messages: [] };

    const form = getNovelForm(userId, novelId);
    const chapterMeta = getBranchChapterMeta(userId, novelId, branchId);
    const formCtx = buildFormAgentContext({
      form,
      chapterMeta,
      novelId,
      branchId,
    });

    return {
      content: JSON.stringify(
        {
          name: branch.name,
          parent_offset: branch.parent_offset,
          novel_id: branch.novel_id,
          total_chars: text.length,
          form: formCtx,
        },
        null,
        2,
      ),
      messages: [],
    };
  },
},
```

- [ ] **Step 3: Append new tool `get_novel_form` to `branchTools` array**

```ts
{
  name: "get_novel_form",
  description:
    "获取小说形态/章法（骨）：formType、是否分章、章名 samples、continuationRules、分支章边界与目录摘要。大纲与写手在规划章节前应调用；弱分章时必须遵守 forbidInventChapterTitles。",
  parameters: {
    type: "object",
    properties: {
      novelId: { type: "string", description: "小说 ID" },
      branchId: { type: "string", description: "分支 ID（用于边界/目录；主线 main）" },
    },
    required: ["novelId", "branchId"],
  },
  execute: async (args, ctx) => {
    const userId = ctx.userId || "guest";
    const novelId = (ctx.novelId || args.novelId || "") as string;
    const branchId = (ctx.branchId || args.branchId || "main") as string;
    if (!novelId) {
      return {
        content: formatCriticalMiss("novelId", "缺少 novelId，无法读取形态分析。"),
        messages: [],
      };
    }
    const form = getNovelForm(userId, novelId);
    const chapterMeta = getBranchChapterMeta(userId, novelId, branchId);
    const formCtx = buildFormAgentContext({
      form,
      chapterMeta,
      novelId,
      branchId,
    });
    return {
      content: formatFormAgentContextForTool(formCtx),
      messages: [],
    };
  },
},
```

- [ ] **Step 4: Master allowlist + UI label**

In `src/app/api/agent/chat/route.ts`, extend `MASTER_TOOL_ALLOW`:

```ts
"get_branch_text", "get_branch_characters", "get_branch_timeline", "get_branch_world", "get_branch_meta",
"get_novel_form",
```

In `src/components/agent-panel.tsx` tool name map, add:

```ts
get_novel_form: "获取形态/章法",
```

- [ ] **Step 5: Smoke-check TypeScript**

Run: `npx tsc --noEmit`  
(or `npm run build` if that is the project’s typecheck path)

Expected: no errors in touched files.

- [ ] **Step 6: Commit**

```bash
git add src/core/agents/agents/branch-tools.ts src/app/api/agent/chat/route.ts src/components/agent-panel.tsx
git commit -m "feat(agents): get_novel_form tool and form-aware branch meta"
```

---

### Task 3: Wire outline + writer tools and prompts

**Files:**
- Modify: `src/core/agents/agents/writer.ts` (CREATE_TOOLS / REWRITE_TOOLS schemas)
- Modify: `src/core/prompts/outline-system.md`
- Modify: `src/core/prompts/outline-agent-contract.md`
- Modify: `src/core/prompts/writer-create-system.md`
- Modify: `src/core/prompts/writer-rewrite-system.md`
- Modify: `src/core/prompts/writer-create-user.md` (if it lists tools)
- Note: `outline.ts` already spreads full `branchTools` — after Task 2 it already includes `get_novel_form`. Still update prompts.

**Interfaces:**
- Consumes: tool names `get_novel_form`, `get_branch_meta` from Task 2
- Produces: prompt instructions that force load-before-plan/write; no new TypeScript types

- [ ] **Step 1: Writer CREATE_TOOLS include form tools**

In `src/core/agents/agents/writer.ts`, change CREATE_TOOLS schema list:

```ts
const CREATE_TOOLS = [
  ...schemas([
    "get_outline",
    "get_branch_text",
    "get_branch_characters",
    "get_branch_timeline",
    "get_branch_world",
    "get_branch_meta",
    "get_novel_form",
  ]),
  ...FS_READ,
  SAVE_SCHEMA,
];
```

Optionally add `get_novel_form` to REWRITE_TOOLS as well (recommended — rewrite must not invent chapters either):

```ts
const REWRITE_TOOLS = [
  ...schemas(["get_prose", "get_findings", "get_branch_text", "get_novel_form"]),
  ...FS_READ,
  SAVE_SCHEMA,
];
```

- [ ] **Step 2: Update `outline-agent-contract.md` steps**

In step 1 tools list, require form:

```markdown
### 步骤 1：取语境（按需，章法必取）
静默调用：
- **`get_novel_form`**（必做一次）：是否分章、章名 samples、continuationRules、章边界
- `get_branch_text` / `get_branch_characters` / `get_branch_timeline` / `get_branch_world`
- `get_foreshadowing_ledger`（若有活跃伏笔）

若 `forbidInventChapterTitles=true`：大纲中禁止规划「第N章」标题，除非用户明确要求分章。
若 `chapteringEnabled=true`：必须写清 `续写本章` / `收束本章并新开` / `新开一章`，新章标题贴合 samples。
```

Update the tools table to include `get_novel_form`.

- [ ] **Step 3: Update `outline-system.md` 篇幅与章节规划**

Ensure the chapter strategy section explicitly says:

```markdown
- **先调用 `get_novel_form`（或读 `get_branch_meta.form`）** 再写章节规划
- 若 `chapteringEnabled=false` / `forbidInventChapterTitles=true`：不要编造「第N章」，用场景/段落规划即可
- 若 `chapteringEnabled=true`：新章标题必须贴近 `chapterTitleSamples` 的格式；并遵守 `continuationRules`
- 必须使用可检索关键词之一写清策略：`续写本章` / `收束本章` / `新开一章`（accept 边界启发式依赖这些词）
```

- [ ] **Step 4: Update `writer-create-system.md`**

Replace the soft “章标题” section with a hard step:

```markdown
### 2b. 形态/章法（必做一次）
- 调用 `get_novel_form`（或 `get_branch_meta` 中的 form）
- 若 `forbidInventChapterTitles=true`：**禁止**在正文中写「第N章…」标题行，除非用户 prompt 明确要求分章
- 若 `chapteringEnabled=true`：
  - 大纲写「新开」→ 正文以与 `chapterTitleSamples` 一致的标题起笔（独占一行）
  - 大纲写「续写本章」→ **不要**无故新起章标题
  - 遵守 `continuationRules` 全文
```

Also list `get_novel_form` in the tools table.

- [ ] **Step 5: Update `writer-rewrite-system.md`**

Add constraint block:

```markdown
## 章法
改写时调用 `get_novel_form` 一次。若 `forbidInventChapterTitles=true`，不要新增「第N章」标题行。若原草稿已有章标题，保持格式一致，勿改成另一种编号体系。
```

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit`  
Expected: clean.

```bash
git add src/core/agents/agents/writer.ts src/core/prompts/outline-system.md src/core/prompts/outline-agent-contract.md src/core/prompts/writer-create-system.md src/core/prompts/writer-rewrite-system.md src/core/prompts/writer-create-user.md
git commit -m "feat(agents): outline/writer consume novel form chaptering rules"
```

---

### Task 4: Accept boundary tests (catalog + non-chaptering)

**Files:**
- Create: `scripts/tests/accept-chapter-meta.test.ts`
- Modify: `scripts/run-tests.ts`
- Possibly small export if `updateChapterMetaAfterAccept` is private — prefer testing via `acceptContinuation` public API + `getBranchChapterMeta`

**Interfaces:**
- Consumes: `acceptContinuation` from `@/core/foreshadowing/accept-continuation`; `importNovel`, `deleteNovel`, `saveNovelForm`, `getBranchChapterMeta`, `saveBranchChapterMeta` from `@/lib/db`; intermediate store `saveProse` / `_resetStore`
- Produces: regression tests for D4 hybrid boundary

- [ ] **Step 1: Write failing/acceptance tests**

Create `scripts/tests/accept-chapter-meta.test.ts`:

```ts
/**
 * After acceptContinuation: chapter meta boundary + catalog (D4).
 */
import { randomUUID } from "node:crypto";
import { assert, suite, test } from "../lib/test-harness";
import { acceptContinuation } from "../../src/core/foreshadowing/accept-continuation";
import { _resetStore, saveProse } from "../../src/core/agents/intermediate-store";
import {
  deleteNovel,
  getBranchChapterMeta,
  importNovel,
  saveNovelForm,
  saveBranchChapterMeta,
  emptyBranchChapterMeta,
} from "../../src/lib/db";
import type { NovelFormProfile } from "../../src/types";

const BODY =
  "雨落在青石板上，发出细碎的声响。顾深把斗笠压低，沿着巷口那盏将灭未灭的灯走去，" +
  "怀中的信纸被雨水洇出一圈淡痕，却仍能辨认出「旧桥」二字。巷更深了。";

function enabledForm(novelId: string): NovelFormProfile {
  return {
    novelId,
    formType: "web_novel",
    unitHierarchy: { volume: "absent", chapter: "present", section: "absent" },
    chaptering: {
      enabled: true,
      confidence: 0.9,
      numbering: "arabic_di_n_zhang",
      titlePattern: "第N章",
      separator: " ",
      samples: ["第1章 序", "第2章 雨"],
    },
    narrativeArchitecture: {
      primaryTemplate: "episodic",
      genreHints: [],
      evidenceNotes: "",
      povScheme: "unknown",
      timeScheme: "linear",
    },
    continuationRules: ["本书分章"],
  };
}

function disabledForm(novelId: string): NovelFormProfile {
  const f = enabledForm(novelId);
  f.formType = "essay_prose";
  f.chaptering = {
    enabled: false,
    confidence: 0.1,
    numbering: "none",
    titlePattern: "",
    separator: "",
    samples: [],
  };
  f.continuationRules = ["弱分章"];
  return f;
}

export function runAcceptChapterMetaTests(): void {
  suite("accept chapter meta", () => {
    test("enabled + draft starts with 第K章 → catalog gains chapter, boundary closed", () => {
      _resetStore();
      const userId = `tu_${randomUUID().slice(0, 8)}`;
      const novelId = `tn_${randomUUID().slice(0, 8)}`;
      try {
        const base =
          "第1章 序\n" + "甲".repeat(80) + "\n\n第2章 雨\n" + "乙".repeat(80);
        importNovel(userId, novelId, "chap-novel", base);
        saveNovelForm(userId, novelId, enabledForm(novelId));
        saveBranchChapterMeta(userId, {
          ...emptyBranchChapterMeta(novelId, "main"),
          chapterBoundary: "open",
          chapters: [
            {
              id: "c1",
              number: 1,
              title: "第1章 序",
              startOffset: 0,
              source: "regex",
            },
          ],
        });

        const draft = `第3章 桥\n${BODY}`;
        saveProse(novelId, "main", draft);
        // outline keyword optional — prose wins for new chapter title
        const r = acceptContinuation({
          userId,
          novelId,
          branchId: "main",
          content: draft,
        });
        assert.equal(r.ok, true, r.error || "accept failed");

        const meta = getBranchChapterMeta(userId, novelId, "main");
        assert.equal(meta.chapterBoundary, "closed");
        assert.ok(
          meta.chapters.some((c) => c.number === 3 || c.title.includes("桥") || c.title.includes("第3章")),
          `catalog missing ch3: ${JSON.stringify(meta.chapters)}`,
        );
      } finally {
        deleteNovel(userId, novelId);
        _resetStore();
      }
    });

    test("disabled chaptering → accept does not require chapter titles in meta", () => {
      _resetStore();
      const userId = `tu_${randomUUID().slice(0, 8)}`;
      const novelId = `tn_${randomUUID().slice(0, 8)}`;
      try {
        importNovel(userId, novelId, "prose-novel", "长文无章。".repeat(20));
        saveNovelForm(userId, novelId, disabledForm(novelId));
        saveBranchChapterMeta(userId, {
          ...emptyBranchChapterMeta(novelId, "main"),
          chapters: [],
          chapterBoundary: "closed",
        });

        const draft = BODY;
        saveProse(novelId, "main", draft);
        const r = acceptContinuation({
          userId,
          novelId,
          branchId: "main",
          content: draft,
        });
        assert.equal(r.ok, true, r.error || "accept failed");

        const meta = getBranchChapterMeta(userId, novelId, "main");
        // updateChapterMetaAfterAccept should early-return when disabled
        assert.equal(meta.chapters.length, 0);
      } finally {
        deleteNovel(userId, novelId);
        _resetStore();
      }
    });
  });
}
```

- [ ] **Step 2: Register in `scripts/run-tests.ts`**

```ts
import { runAcceptChapterMetaTests } from "./tests/accept-chapter-meta.test";
// ...
runAcceptChapterMetaTests();
```

- [ ] **Step 3: Run tests**

Run: `npm test`

Expected: both accept chapter meta tests pass. If the “gains chapter” test fails because catalog rebuild uses full text offsets differently, fix assertions to match `extractChapterCatalog` real output (still require non-empty catalog and boundary closed when draft opens with `第3章`).

- [ ] **Step 4: If early-return on disabled is missing, fix `accept-continuation.ts`**

Confirm `updateChapterMetaAfterAccept` still has:

```ts
const form = getNovelForm(userId, novelId);
if (form && !form.chaptering.enabled) return;
```

If `form` is null, either skip or treat as disabled (prefer skip update). Do not invent chapters.

- [ ] **Step 5: Commit**

```bash
git add scripts/tests/accept-chapter-meta.test.ts scripts/run-tests.ts src/core/foreshadowing/accept-continuation.ts
git commit -m "test(form): accept continuation chapter meta boundary cases"
```

---

### Task 5: Hard dependency — form before timeline job units

**Files:**
- Modify: `src/core/extractor/run-modular-extract.ts`
- Optional log-only; no new public API required

**Interfaces:**
- Consumes: existing `analyzeNovelForm`, `want("form")`, `want("timeline")`, `startTimelineJob`
- Produces: when user selects timeline without form cache, form is analyzed before job starts so units can use chapters

- [ ] **Step 1: Read current phase1/phase2 ordering**

Confirm: form and other modules run in `Promise.all` phase1; timeline starts in phase2. If user checks **only timeline** and form is missing, job falls back to scene/window units (OK). If user checks **form + timeline** in parallel, form might still be finishing when… actually form is in same phase1 Promise.all, so when phase1 completes, form is saved before phase2. Soft ordering already exists **if form is selected**.

Gap: user selects timeline only, no form cache → no chapters. Spec P1.6: “Ensure form runs before timeline when both selected” — already soft. Strengthen to:

**When `want("timeline")` and no usable form (`!getNovelForm` or forceRefresh form empty), auto-run form once before `startTimelineJob`.**

- [ ] **Step 2: Implement auto form-before-timeline**

In phase2 block of `run-modular-extract.ts`, before `startTimelineJob`:

```ts
if (want("timeline")) {
  let form = result.form || getNovelForm(userId, novelId);
  if (!form || forceRefresh) {
    // Hard dependency: units need form/catalog when possible (D7)
    console.log("[Extract] timeline requires form first — analyzing form...");
    const llm = createLLMProvider();
    const formResult = await runWithTokenContext({ agentId: "extract_form" }, () =>
      analyzeNovelForm(novelId, text, llm),
    );
    saveNovelForm(userId, novelId, formResult.profile);
    ensureMainBranch(userId, novelId);
    if (formResult.profile.chaptering.enabled && formResult.catalog.length > 0) {
      const existing = getBranchChapterMeta(userId, novelId, branchId);
      saveBranchChapterMeta(userId, {
        ...existing,
        novelId,
        branchId,
        chapters: formResult.catalog,
        chapterBoundary: existing.chapterBoundary || "closed",
      });
    }
    result.form = formResult.profile;
    result.chapterCatalogCount = formResult.catalog.length;
    if (!result.ran.includes("form")) result.ran.push("form");
    form = formResult.profile;
  }
  // ... then startTimelineJob as today
}
```

Avoid double-running form when phase1 already ran it: only enter this block when `!result.form && !result.ran.includes("form")` or when form missing in DB.

Refined guard:

```ts
if (want("timeline")) {
  if (!result.form) {
    result.form = getNovelForm(userId, novelId);
  }
  if (!result.form) {
    // auto form as above
  }
  // start job...
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/core/extractor/run-modular-extract.ts
git commit -m "fix(extract): analyze form before timeline job when missing"
```

---

### Task 6: Spec status + verification gate

**Files:**
- Modify: `docs/specs/analysis-and-chaptering.md` §7 / §8 C checkboxes where true

- [ ] **Step 1: Run full test suite**

Run: `npm test`

Expected: all suites pass including `form-context`, `accept chapter meta`, `chapter-catalog`.

- [ ] **Step 2: Update spec §7 rows**

Set:

| Area | New status |
|------|------------|
| Agent tools load form/boundary | **done** (get_novel_form + get_branch_meta.form) |
| Outline/writer prompt text | **partial→improved** (tool-required; still no structured chapterPlan JSON) |
| Accept boundary + catalog | **partial** (tests cover happy paths; outline keyword still heuristic) |

Mark §8 C items checked only if truly done:

- [x] Outline/writer can read form via tool  
- [x] When chaptering disabled, writer prompts forbid inventing 第N章  

- [ ] **Step 3: Commit**

```bash
git add docs/specs/analysis-and-chaptering.md
git commit -m "docs(spec): mark agent form consumption P0 as implemented"
```

---

## Self-review (plan vs spec)

### Spec coverage (P0)

| Spec §9 P0 item | Task |
|-----------------|------|
| Tool: get_novel_form / extend get_branch_meta | Task 2 |
| Wire outline + writer to consume data | Task 3 |
| Automated tests: form enable/disable, accept boundary, tool payload | Tasks 1 + 4 |

| Spec §8 C | Task |
|-----------|------|
| Read continuationRules + samples + boundary | Tasks 1–3 |
| Disabled → forbid invent 第N章 | Tasks 1, 3 |

| Bonus (P1.6 light) | Task 5 form-before-timeline |

Not covered (correctly deferred): durable jobs, mobile rail, hierarchy tree, export TOC, overview card.

### Placeholder scan

No TBD/TODO steps; code blocks included for helpers, tools, tests, extract guard.

### Type consistency

- `FormAgentContext` / `buildFormAgentContext` / `formatFormAgentContextForTool` used consistently in Task 1–2.
- Tool name `get_novel_form` consistent across branch-tools, writer schemas, chat allowlist, agent-panel, prompts.

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-07-18-analysis-form-agent-consume.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session, batch with checkpoints  

**Which approach?**
