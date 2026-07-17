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

