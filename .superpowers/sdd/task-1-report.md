# Task 1 Report: Pure form agent context helper

**Status:** DONE  
**Branch:** `feat/analysis-form-agent-consume`  
**Commit:** `5edf6a0` — `feat(form): pure agent context payload for chaptering rules`  
**Date:** 2026-07-18

## Summary

Implemented a pure (no DB, no LLM) agent-facing context builder that maps `NovelFormProfile` + `BranchChapterMeta` into a stable `FormAgentContext` payload for later outline/writer tooling. Followed TDD as specified in the brief: failing test first → implementation → green suite → commit.

## Files touched

| Path | Action |
|------|--------|
| `src/core/form/form-context.ts` | **Created** — `FormAgentContext`, `buildFormAgentContext`, `formatFormAgentContextForTool` |
| `scripts/tests/form-context.test.ts` | **Created** — 4 unit tests for shape + enable/disable rules |
| `scripts/run-tests.ts` | **Modified** — import + call `runFormContextTests()` |

## Implementation notes

### API (verbatim from brief)

- `FormAgentContext` — stable agent-facing shape including:
  - `chapteringEnabled`, `chapteringConfidence`, `formType`, `unitHierarchy`
  - `forbidInventChapterTitles` (`!chaptering.enabled`)
  - `chapterTitleSamples` (≤8), `titlePattern`, `numbering`
  - `continuationRules` (≤8, or default no-chapter rules when form missing)
  - `chapterBoundary` (`open` | `closed` | `unknown`)
  - `openChapter` / `lastClosedChapter` passthrough from meta
  - `catalogTail` (last 12 catalog entries), `catalogCount`
  - `summaryLine` (one-line human hint)
- `buildFormAgentContext({ form, chapterMeta, novelId, branchId })`
- `formatFormAgentContextForTool(ctx)` → pretty `JSON.stringify(ctx, null, 2)`

### Behavior verified by tests

1. **Enabled chaptering** — samples, rules, open boundary, catalog count, `forbidInventChapterTitles === false`
2. **Null form/meta** — conservative defaults: chaptering off, forbid invent titles, default rules mention 第N章/分章
3. **Disabled chaptering** (`essay_prose`) — forbid invent titles, empty catalog
4. **JSON tool format** — parseable pretty JSON with required keys

### Conservative chaptering rule

`forbidInventChapterTitles = !enabled` — when form is null or `chaptering.enabled` is false, agents must not invent `第N章` unless the user explicitly asks. Default continuation rules cover the null-form path.

## TDD execution log

1. Wrote `scripts/tests/form-context.test.ts` (verbatim from brief)
2. Registered suite in `scripts/run-tests.ts`
3. `npm test` → **FAIL** (`Cannot find module '../../src/core/form/form-context'`) as expected
4. Implemented `src/core/form/form-context.ts` (verbatim from brief)
5. `npm test` → **PASS** — All tests passed ✓ (54 passed), including 4 `form-context` tests
6. Commit as specified

## Test summary

```
== form-context ==
  ✓ enabled form exposes samples + rules + boundary
  ✓ null form → conservative forbid invent titles
  ✓ disabled chaptering → forbidInventChapterTitles true
  ✓ formatFormAgentContextForTool is parseable JSON with required keys

All tests passed ✓ (54 passed)
```

## Self-review

- [x] No LLM / no DB imports in `form-context.ts`
- [x] Pure helper only — YAGNI respected (only `buildFormAgentContext` + `formatFormAgentContextForTool`)
- [x] Types from `@/types` (`NovelFormProfile`, `BranchChapterMeta`, `UnitPresence`)
- [x] Test imports use relative paths as in brief
- [x] Commit message matches brief exactly
- [x] No unrelated modules rewritten; `data/` untouched
- [x] Implementation matches brief code (including sample/rule caps and `summaryLine` branches)

### Minor notes (non-blocking)

- `chapterBoundary` on `FormAgentContext` widens to `"unknown"` when meta is null; `BranchChapterMeta.chapterBoundary` is only `"open" | "closed"`. This is intentional per brief.
- Empty `continuationRules: []` on a form would fall through to `DEFAULT_NO_CHAPTER_RULES` because `[]` is falsy for `||` — acceptable and safer for agents; no test requires empty-array preservation.

## Out of scope (later tasks)

- Tool wiring (`get_novel_form`, `get_branch_meta`)
- Outline/writer prompt integration
- Accept-continuation chapter meta updates

## Concerns

None.
