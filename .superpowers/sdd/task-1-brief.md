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

