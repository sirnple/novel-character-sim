# Timeline QA Product (P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make timeline analysis a reliable branch-scoped QA product: jobs survive process restarts (SQLite), timeline/chapter_states do not clobber across IF branches, and the reader rail works on mobile with documented jump precision.

**Architecture:** Extend `timelines` / `chapter_states` primary keys with `branch_id` (migrate existing rows → `main`). Persist `TimelineJob` rows in a new `timeline_jobs` table; keep in-memory runner for active process work but hydrate/list/cancel from SQLite. Reader adds a mobile drawer for the same rail; jump accuracy remains ratio-based but is documented in UI copy.

**Tech Stack:** TypeScript, better-sqlite3 (`src/lib/db.ts`), `src/core/form/timeline-job.ts`, Next.js API `src/app/api/timeline/job`, reader `src/app/novel/[id]/read/page.tsx`, `npm test` harness.

**Spec:** `docs/specs/analysis-and-chaptering.md` §9 P1 items 4–7 (item 6 form-before-timeline already done in P0 — only soft-fail polish remains).

## Global Constraints

- User-facing: **分析** only, never **拆解**.
- Timeline units still come after form/segmentation (D7/D8).
- Single-process async is OK; durable job **state** in SQLite so restart can show last status; **resume mid-unit** is optional (cancel + re-run is enough for P1).
- Do not introduce Redis/multi-instance queue.
- Prefer migration that keeps existing `main` timelines readable.
- LLM only via `createLLMProvider()`; JSON via `extractJSON()` if needed.
- Tests via existing `scripts/tests` + `npm test`.

## Out of scope

| Item | Why |
|------|-----|
| Full job resume after crash mid-unit | Cancel + re-run; progressive timeline data already on disk if saveTimeline ran |
| Hierarchy 部→卷→章→节 tree | Separate design |
| Per-unit retry UI (P2) | Spec P2 |
| Perfect DOM offset mapping | Document ratio MVP; improve only if cheap |

## File map

| File | Responsibility |
|------|----------------|
| `src/lib/db.ts` | Migrate timelines/chapter_states + timeline_jobs CRUD; branch-scoped get/save |
| `src/types/index.ts` | Optional `branchId` on `ChapterTimeline` |
| `src/core/form/timeline-job.ts` | Persist job; hydrate; cancel; saveTimeline with branchId |
| `src/core/extractor/run-modular-extract.ts` | Soft-fail auto form; pass branchId to timeline get/save |
| Call sites of getTimeline/saveTimeline/getChapterStates/saveChapterStates | Add branchId (default `"main"`) |
| `src/app/novel/[id]/read/page.tsx` | Mobile rail drawer; jump precision hint |
| `scripts/tests/timeline-branch-scope.test.ts` | Branch isolation + job persist (if testable without LLM) |
| `docs/specs/analysis-and-chaptering.md` | Update §7 P1 rows |

---

### Task 1: Branch-scoped timeline + chapter_states storage

**Files:**
- Modify: `src/lib/db.ts` (schema + save/get)
- Modify: `src/types/index.ts` (optional `branchId?: string` on ChapterTimeline)
- Test: `scripts/tests/timeline-branch-scope.test.ts`
- Modify: `scripts/run-tests.ts`

**Interfaces:**
- `saveTimeline(userId, novelId, timeline, branchId?: string)` — default `"main"`
- `getTimeline(userId, novelId, branchId?: string)`
- `saveChapterStates(userId, novelId, states, branchId?: string)`
- `getChapterStates(userId, novelId, branchId?: string)`

- [ ] **Step 1: Write failing tests**

```ts
// scripts/tests/timeline-branch-scope.test.ts
import { randomUUID } from "node:crypto";
import { assert, suite, test } from "../lib/test-harness";
import {
  deleteNovel,
  getTimeline,
  importNovel,
  saveTimeline,
  getChapterStates,
  saveChapterStates,
} from "../../src/lib/db";
import type { ChapterTimeline, CharacterChapterState } from "../../src/types";

export function runTimelineBranchScopeTests(): void {
  suite("timeline branch scope", () => {
    test("main and if branch timelines do not clobber each other", () => {
      const userId = `tu_${randomUUID().slice(0, 8)}`;
      const novelId = `tn_${randomUUID().slice(0, 8)}`;
      try {
        importNovel(userId, novelId, "t", "前文。".repeat(20));
        const mainTl: ChapterTimeline = {
          novelId,
          totalChapters: 1,
          chapters: [{ chapterNumber: 1, title: "主线", events: [], characterStates: [] }],
        };
        const ifTl: ChapterTimeline = {
          novelId,
          totalChapters: 1,
          chapters: [{ chapterNumber: 1, title: "支线", events: [], characterStates: [] }],
        };
        saveTimeline(userId, novelId, mainTl, "main");
        saveTimeline(userId, novelId, ifTl, "if_test");
        assert.equal(getTimeline(userId, novelId, "main")?.chapters[0]?.title, "主线");
        assert.equal(getTimeline(userId, novelId, "if_test")?.chapters[0]?.title, "支线");
      } finally {
        deleteNovel(userId, novelId);
      }
    });

    test("default branchId is main for get/save", () => {
      const userId = `tu_${randomUUID().slice(0, 8)}`;
      const novelId = `tn_${randomUUID().slice(0, 8)}`;
      try {
        importNovel(userId, novelId, "t", "文");
        saveTimeline(userId, novelId, {
          novelId,
          totalChapters: 0,
          chapters: [],
        });
        assert.ok(getTimeline(userId, novelId) != null);
        assert.ok(getTimeline(userId, novelId, "main") != null);
      } finally {
        deleteNovel(userId, novelId);
      }
    });
  });
}
```

Register in `run-tests.ts`.

- [ ] **Step 2: Run tests — expect FAIL** (old PK ignores branch)

- [ ] **Step 3: Migrate schema in `getDb()` init**

After existing CREATE TABLE IF NOT EXISTS timelines, run migration helper:

```ts
function ensureTimelineBranchColumns(d: Database.Database): void {
  // If old schema (no branch_id), rebuild
  const cols = d.prepare("PRAGMA table_info(timelines)").all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  if (names.has("branch_id")) return;

  d.exec(`
    CREATE TABLE IF NOT EXISTS timelines_v2 (
      novel_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'guest',
      branch_id TEXT NOT NULL DEFAULT 'main',
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (novel_id, user_id, branch_id)
    );
    INSERT OR IGNORE INTO timelines_v2 (novel_id, user_id, branch_id, data, created_at)
      SELECT novel_id, user_id, 'main', data, created_at FROM timelines;
    DROP TABLE timelines;
    ALTER TABLE timelines_v2 RENAME TO timelines;
  `);

  // same pattern for chapter_states → chapter_states with branch_id
}
```

Also update CREATE TABLE IF NOT EXISTS for fresh DBs to include `branch_id` in PK from the start.

- [ ] **Step 4: Update save/get signatures**

```ts
export function saveTimeline(
  userId: string,
  novelId: string,
  timeline: ChapterTimeline,
  branchId = "main",
): void {
  const d = getDb();
  const data = { ...timeline, novelId, branchId };
  d.prepare(
    `INSERT OR REPLACE INTO timelines (novel_id, user_id, branch_id, data)
     VALUES (?, ?, ?, ?)`,
  ).run(novelId, userId, branchId, JSON.stringify(data));
}

export function getTimeline(
  userId: string,
  novelId: string,
  branchId = "main",
): ChapterTimeline | null {
  const d = getDb();
  const row = d
    .prepare(
      `SELECT data FROM timelines WHERE novel_id = ? AND user_id = ? AND branch_id = ?`,
    )
    .get(novelId, userId, branchId) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : null;
}
```

Mirror for chapter_states. Update `deleteNovel` to still wipe by novel_id (DELETE WHERE novel_id AND user_id without branch is fine).

- [ ] **Step 5: npm test PASS + commit**

```bash
git commit -m "feat(db): branch-scoped timeline and chapter_states"
```

---

### Task 2: Wire all timeline call sites to branchId

**Files:** grep for `saveTimeline|getTimeline|saveChapterStates|getChapterStates` and update.

Known:
- `src/core/form/timeline-job.ts` — pass `job.branchId`
- `src/core/extractor/run-modular-extract.ts` — cache checks use branchId
- `src/core/agents/agents/branch-tools.ts` — `get_branch_timeline` should use ctx.branchId
- Any novels load / novel-context that hydrates timeline

- [ ] **Step 1: Grep and update each call**

Default `"main"` keeps backward compat for accidental misses.

- [ ] **Step 2: `get_branch_timeline` tool**

```ts
const tl = getTimeline(userId, novelId, branchId);
```

- [ ] **Step 3: tsc + commit**

```bash
git commit -m "feat(timeline): pass branchId through save/get and agent tools"
```

---

### Task 3: Durable timeline jobs in SQLite

**Files:**
- Modify: `src/lib/db.ts` — table `timeline_jobs`
- Modify: `src/core/form/timeline-job.ts` — persist on every touch; hydrate get/list/cancel

**Schema:**

```sql
CREATE TABLE IF NOT EXISTS timeline_jobs (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  novel_id TEXT NOT NULL,
  branch_id TEXT NOT NULL DEFAULT 'main',
  status TEXT NOT NULL,
  data TEXT NOT NULL,  -- full TimelineJob JSON (units, completed, error, …)
  updated_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_timeline_jobs_novel
  ON timeline_jobs (user_id, novel_id, branch_id, updated_at);
```

**Interfaces:**
- `saveTimelineJob(job: TimelineJob): void`
- `getTimelineJobRow(id: string): TimelineJob | null`
- `listTimelineJobRows(userId, novelId, branchId): TimelineJob[]`
- `deleteTimelineJob(id: string): void` optional

**Behavior:**
1. `startTimelineJob`: create job → `saveTimelineJob` → memory map → fire runJob
2. `touch(job)`: also `saveTimelineJob(job)`
3. `getTimelineJob(id)`: memory first, else SQLite hydrate into memory (status may be done/error from last run; do not auto-resume running jobs after restart — set stuck `running`/`queued` to `error` with message `进程已重启，请重新分析时间线` on hydrate)
4. `listTimelineJobsForNovel`: union memory + SQLite, prefer newer updatedAt
5. `cancelTimelineJob`: set cancelled + persist

- [ ] **Step 1: Pure test for hydrate stuck-running → error**

If hard without DB, unit-test a small pure function:

```ts
export function normalizeJobAfterHydrate(job: TimelineJob): TimelineJob {
  if (job.status === "running" || job.status === "queued") {
    return {
      ...job,
      status: "error",
      error: job.error || "进程已重启，请重新分析时间线",
      updatedAt: new Date().toISOString(),
    };
  }
  return job;
}
```

- [ ] **Step 2: Implement DB + timeline-job wiring**

- [ ] **Step 3: npm test + commit**

```bash
git commit -m "feat(timeline): persist timeline jobs in SQLite"
```

---

### Task 4: Soft-fail auto form before timeline

**Files:** `src/core/extractor/run-modular-extract.ts`

When auto form (timeline selected, form missing) throws, log and still `startTimelineJob` (D8 scene/window units).

```ts
try {
  // analyzeNovelForm ...
} catch (e) {
  console.warn("[Extract] auto form before timeline failed:", (e as Error).message);
  result.skipped.push({ module: "form", reason: (e as Error).message || "形态分析失败，时间线将按场景/窗口切分" });
}
// startTimelineJob still runs
```

- [ ] Implement + commit

```bash
git commit -m "fix(extract): soft-fail form before timeline so job still starts"
```

---

### Task 5: Mobile rail drawer + jump precision copy

**Files:**
- `src/app/novel/[id]/read/page.tsx`
- Possibly small button in reader header

**UX:**
- Desktop: keep left rail (`hidden sm:flex` → `hidden sm:block` as today)
- Mobile (`sm:hidden`): floating button「目录」opens sheet/drawer with same `ReaderTimelineRail`
- Under rail title or footer: short note「跳转按字数比例估算，长文可能略有偏差」

- [ ] Implement drawer with existing design tokens (panel/card)
- [ ] Manual smoke: no automated browser test required
- [ ] Commit

```bash
git commit -m "feat(reader): mobile timeline rail drawer and jump precision note"
```

---

### Task 6: Spec update + full verify

- [ ] `npm test` all green
- [ ] `npx tsc --noEmit`
- [ ] Update `docs/specs/analysis-and-chaptering.md` §7:
  - Timeline per branch: **done**
  - Job durable SQLite: **done** (no mid-unit resume)
  - Mobile rail: **done** (drawer)
  - Async job: **done**/partial as accurate
- [ ] Mark §8 D target (survives restart) appropriately
- [ ] Commit `docs(spec): mark timeline P1 storage and jobs done`

---

## Self-review

| Spec P1 item | Task |
|--------------|------|
| 4 Persist jobs + cancel | Task 3 |
| 5 Branch-scoped timeline | Tasks 1–2 |
| 6 Form before timeline | Done P0; soft-fail Task 4 |
| 7 Mobile rail + jump accuracy | Task 5 (accuracy = documented MVP) |

---

## Execution handoff

After plan is saved, implement on branch `feat/timeline-qa-p1` using subagent-driven or inline execution.
