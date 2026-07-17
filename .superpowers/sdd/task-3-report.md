# Task 3 Report: Wire outline + writer tools and prompts

## Status
**done**

## Changes

### `src/core/agents/agents/writer.ts`
- `CREATE_TOOLS`: added `get_branch_meta`, `get_novel_form`
- `REWRITE_TOOLS`: added `get_novel_form` (recommended — rewrite must not invent chapters)

### Prompts
| File | Change |
|------|--------|
| `outline-agent-contract.md` | Step 1: require `get_novel_form` once; chaptering rules for forbid/enable; tools table |
| `outline-system.md` | §1 篇幅与章节规划: load form first; forbid invent titles; keywords `续写本章` / `收束本章` / `新开一章` |
| `writer-create-system.md` | Soft 章标题 → hard `### 2b. 形态/章法（必做一次）`; tools table |
| `writer-rewrite-system.md` | `## 章法` block + tools table |
| `writer-create-user.md` | Pipeline includes `get_novel_form` |

### Outline agent
No code change — already spreads full `branchTools` (includes `get_novel_form` after Task 2).

## Typecheck
`npx tsc --noEmit` — **clean** (exit 0)

## Commit
`feat(agents): outline/writer consume novel form chaptering rules`

## Concerns
- Admin DB prompt overrides still win over md defaults until re-seeded/cleared.
- Keywords `续写本章` / `收束本章` / `新开一章` preserved for accept heuristics.
- When chaptering disabled: prompts forbid inventing 第N章 unless user asks.
