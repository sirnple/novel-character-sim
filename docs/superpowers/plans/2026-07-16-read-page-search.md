# Read Page Search Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add always-visible find-in-page on `/novel/[id]/read` with highlights, prev/next, and Ctrl/Cmd+F.

**Architecture:** Pure client-side substring search over `readingText` in `read/page.tsx`. Match offsets drive `<mark>` rendering and `scrollIntoView` for the current hit.

**Tech Stack:** Next.js 14 App Router, React client component, Tailwind, lucide-react.

## Global Constraints

- Scope: `src/app/novel/[id]/read/page.tsx` only (no writing workspace)
- Case-insensitive, non-overlapping substring matches
- No new API/DB; no regex; no case-sensitive toggle
- Preserve click-to-continue + branch selector

---

### Task 1: Match helper + search UI + highlighted render

**Files:**
- Modify: `src/app/novel/[id]/read/page.tsx`

**Produces:**
- `findMatchOffsets(text: string, query: string): number[]`
- Header search bar + keyboard handlers + mark rendering with continue marker coexistence

- [ ] **Step 1: Implement pure `findMatchOffsets`**

```ts
function findMatchOffsets(text: string, query: string): number[] {
  if (!query) return [];
  const hay = text.toLowerCase();
  const needle = query.toLowerCase();
  if (!needle) return [];
  const out: number[] = [];
  let from = 0;
  while (from <= hay.length - needle.length) {
    const i = hay.indexOf(needle, from);
    if (i === -1) break;
    out.push(i);
    from = i + needle.length;
  }
  return out;
}
```

- [ ] **Step 2: Wire state, debounce (150ms), keyboard, header UI**

- `query`, `debouncedQuery`, `currentIndex`, `searchInputRef`
- Ctrl/Cmd+F → focus + preventDefault
- Enter / Shift+Enter → next/prev (wrap)
- Esc → clear query + blur

- [ ] **Step 3: Render marks + continue marker; scroll current match into view**

- [ ] **Step 4: `npm run build` (typecheck) and manual smoke of acceptance list**

- [ ] **Step 5: Commit**

```bash
git add src/app/novel/[id]/read/page.tsx
git commit -m "feat(read): add in-page search with highlight and navigation"
```

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| Always-visible search bar | 1 |
| Case-insensitive match | 1 (`findMatchOffsets`) |
| Highlight all + stronger current | 1 |
| Counter current/total | 1 |
| Prev/next wrap | 1 |
| Ctrl/Cmd+F, Enter, Esc | 1 |
| Branch recompute | 1 (depends on `readingText`) |
| Continue point coexistence | 1 |
| No server search | N/A (client only) |
