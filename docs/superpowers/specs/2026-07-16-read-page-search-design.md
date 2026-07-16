# Read Page In-Text Search Design

**Date:** 2026-07-16  
**Status:** approved (product)  
**Scope:** `/novel/[id]/read` only

## Problem

The dedicated reading page shows full branch text but has no in-page find. Users must rely on the browser's default Ctrl+F, which does not match app chrome, does not integrate with the header, and is easy to miss on a content-focused reading UI.

## Goal

Add a permanent find-in-page bar on the read page: type a query, highlight all matches, navigate previous/next with keyboard, and jump the viewport to the current match.

## Non-goals

- Search on writing-workspace reader, simulation output, or other panels
- Server-side / full-library search
- Regex, whole-word, or case-sensitive toggle (v1)
- Virtualized rendering for very long novels

## UX

| Item | Behavior |
|------|----------|
| Placement | Always visible in the read page header row (title / branch selector area) |
| Input | Debounced ~150ms while typing; empty query clears highlights |
| Match rule | Case-insensitive substring (`toLowerCase` on both sides); Chinese matched as-is |
| Highlights | All matches wrapped in `<mark>`; current match uses a stronger style |
| Counter | `current / total` (1-based current); `0 / 0` when no matches |
| Navigation | Previous / next buttons; wraps at ends |
| Keyboard | `Ctrl/Cmd+F` focuses search input and `preventDefault`s browser find; `Enter` next, `Shift+Enter` prev; `Esc` clears query and blurs input |
| Branch change | Recompute matches against new `readingText`; reset `currentIndex` to 0 if still matching, else clear index |

## Architecture

Single-page change primarily in `src/app/novel/[id]/read/page.tsx`.

Optional local helpers in the same file (extract to a component only if the file becomes hard to read):

```ts
function findMatchOffsets(text: string, query: string): number[]
// case-insensitive indexOf loop; returns start offsets of non-overlapping matches
```

### State

- `query: string` — controlled input
- `debouncedQuery: string` — drives match computation
- `currentIndex: number` — index into `matches`
- `searchInputRef` — for Ctrl/Cmd+F focus

Derived:

- `matches: number[]` from `findMatchOffsets(readingText, debouncedQuery)`
- `matchCount = matches.length`

### Rendering

When `debouncedQuery` is empty: keep current render path (plain text or continue-point split).

When searching: walk the text by character ranges and emit:

1. Plain text segments
2. `<mark data-match-index={i}>` for each match (current index gets distinct class, e.g. orange vs amber)
3. If `continueOffset != null`, inject the existing continue marker at that offset without corrupting match ranges (marker is UI chrome, not part of searchable text)

Scroll: `useEffect` on `currentIndex` / `matches` → `document.querySelector('[data-match-index="…"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' })`.

### Click-to-continue

Offset calculation via `TreeWalker` over text nodes remains valid because match `<mark>`s only wrap novel text (no extra characters). The existing continue button label text is a pre-existing offset quirk and is out of scope for this change.

### Styling

Follow existing dark theme tokens:

- Input: same as branch `<select>` (`bg-[#111110]`, `border-neutral-700`, orange focus)
- Match: soft highlight (e.g. `bg-yellow-500/30`)
- Current match: stronger (e.g. `bg-orange-500/50` or ring)

## Error / edge cases

| Case | Behavior |
|------|----------|
| Empty novel | Search still usable; always 0 matches |
| Query longer than text | 0 matches |
| Loading branch text | Disable input or allow type but recompute when text arrives |
| Special characters | Literal substring only; no regex interpretation |

## Testing / acceptance

Manual (no automated test harness required for this UI-only change unless project already has component tests):

1. Open read page with Chinese novel → search a known phrase → counter > 0, highlights visible
2. English mixed case → matches regardless of case
3. Next / Prev wrap correctly
4. Ctrl+F focuses app search (browser find does not open)
5. Esc clears highlights
6. Switch branch → matches recompute for new text
7. Set continue point while search active → both markers and highlights coexist

## Implementation notes

- No new API routes or DB changes
- All LLM / extractor rules unaffected
- Work happens on branch `feat/read-search` in worktree `.worktrees/feat-read-search`
