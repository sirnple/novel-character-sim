# Task 2 Report: Agent tools — `get_novel_form` + extend `get_branch_meta`

## Status

**Completed**

## Summary

Wired form analysis into agent tools so outline/writer agents can load novel form (形态/章法) and chapter boundaries without new LLM calls. Tools only read DB and shape via `buildFormAgentContext` / `formatFormAgentContextForTool`.

## Changes

### `src/core/agents/agents/branch-tools.ts`

- Extended imports: `getNovelForm`, `getBranchChapterMeta` from `@/lib/db`; `buildFormAgentContext`, `formatFormAgentContextForTool` from `@/core/form/form-context`.
- **`get_branch_meta`**: description updated; execute now attaches `form: FormAgentContext` (form + branch chapter meta) alongside name/parent_offset/novel_id/total_chars.
- **`get_novel_form`** (new): returns `formatFormAgentContextForTool(...)` JSON; prefers `ctx.novelId`/`ctx.branchId`; critical-miss when novelId missing.

Auto-registered via existing `branchTools` loop in `init.ts` (no manual register).

### `src/app/api/agent/chat/route.ts`

- Added `"get_novel_form"` to `MASTER_TOOL_ALLOW`.

### `src/components/agent-panel.tsx`

- Tool label: `get_novel_form: "获取形态/章法"`.

## Commit

```
feat(agents): get_novel_form tool and form-aware branch meta
```

Files staged per brief only.

## Verification

| Check | Result |
|--------|--------|
| `npx tsc --noEmit` | **pass** (exit 0) |
| Unit tests | Not required for this task (pure helpers already covered in Task 1) |

## Concerns / follow-ups

- None blocking. Outline/writer prompt wiring and tool-list tightening remain later plan tasks (not in Task 2 YAGNI scope).
- Master can now call `get_novel_form` / enriched `get_branch_meta`; sub-agents that spread full `branchTools` (e.g. outline) pick up `get_novel_form` automatically.

## Report path

`.superpowers/sdd/task-2-report.md`
