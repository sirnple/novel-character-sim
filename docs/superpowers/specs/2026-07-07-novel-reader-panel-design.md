# Novel Reader-Writer Panel Design

**Date:** 2026-07-07
**Status:** draft

## Problem

When a user uploads a novel or appends generated content via the writer, there is no way to browse/read the full novel text in the UI. This makes it impossible to verify how well AI-generated continuations connect with the original text.

Two related issues:

1. `POST /api/novel/parse` does not save the novel to the database — it only returns parsed data to the client. The novel only gets persisted during character extraction (`POST /api/characters/extract`), so refreshing the page before extraction loses all uploaded text.
2. The writer workspace's right panel only shows the generated prose output, not the surrounding novel context. Users cannot scroll back to check the transition quality after appending content.

## Goal

Make the writer workspace's right panel a unified novel reader: display the full novel text with generated prose appended at the end, scrollable from top to bottom. Save the novel on upload so it persists immediately.

## Design

### 1. Save novel on parse

**`src/app/api/novel/parse/route.ts`**

After parsing the novel text, call `saveNovel(userId, novelId, title, text)` before returning the response. The parse endpoint already has access to the user ID and all required fields.

No changes to the response shape needed. The novel is now saved immediately on upload, independent of character extraction.

### 2. Writer save returns full text

**`src/app/api/writer/save/route.ts`**

Currently `appendNovelContent` appends content server-side but the response is just `{ success: true }`. Change the response to include the updated full text:

```typescript
// Before
return NextResponse.json({ success: true });

// After
const updated = getNovel(userId, novelId);
return NextResponse.json({ success: true, fullText: updated?.text || "" });
```

### 3. Parent component changes

**`src/app/page.tsx`**

- Pass `novelText` to `WritingWorkspace` via the existing `initialFullNovel` prop (currently unused)
- Add `onNovelSaved` callback that updates `novelText` state when the writer saves new content

```typescript
// New callback
const handleNovelSaved = (fullText: string) => {
  setNovelText(fullText);
};

// In JSX
<WritingWorkspace
  // ... existing props
  initialFullNovel={novelText}
  onNovelSaved={handleNovelSaved}
/>
```

### 4. Writer workspace: unified reader panel

**`src/components/writing-workspace.tsx`**

#### Props

- `initialFullNovel?: string` — already exists but currently unused; pass `novelText` from parent
- `onNovelSaved?: (fullText: string) => void` — new; called after save succeeds with the updated full text

#### Right panel rendering

Three states for the right panel:

1. **No output, writing has not started**: display full novel text, scrollable, scrolled to end
2. **Writing in progress / output available**: full novel text + separator + generated prose
3. **Save error**: prose still visible with unsaved marker, error message shown

The rendered content:

```
┌──────────────────────────────────┐
│  原文 chapter 1 ...               │
│  ...                              │  ← scrollable
│  原文 chapter N                   │
│  ────── 📝 待保存 ──────         │  ← visual separator
│  新生成的 prose 正文...           │  ← subtle orange background
│                                   │
│  [保存为最新章节]                 │
└──────────────────────────────────┘
```

#### Visual distinction for unsaved content

- A separator line with a "待保存" label between original and generated content
- Generated content has a subtle orange-tinted background (`bg-orange-500/[0.03]`) or a left border
- When saved, the separator and styling disappear (content is now part of the full novel)
- Button text changes to "已保存 ✓" for 2 seconds

#### Auto-scroll

Panel scrolls to bottom on mount and whenever `outputText` changes (new content generated).

#### Save flow

```
User clicks "保存为最新章节"
  → setSaving(true)
  → POST /api/writer/save { novelId, content: outputText }
  → Success: setSaved(true), onNovelSaved(res.fullText), clear visual markers
  → Error: show error message with retry option
  → setSaving(false)
```

#### Error state

When save fails:
- Button shows red text: "保存失败，点击重试"
- Unsaved content remains visible with its visual markers
- Retry re-attempts the same save call

### 5. Edge cases

- **Empty novel text** (`initialFullNovel` is falsy): render only the generated prose, no separator needed. This covers the case where a user navigates to the writer without having loaded a novel.
- **Very long novels**: full text rendered as plain div, no virtual scrolling. Browsers handle multi-million character text rendering adequately.
- **Completed task re-opened**: if a task with status "completed" and existing `output` is re-opened, show full novel + output with a green "saved" indicator (no unsaved marker, save button disabled).
- **Re-generation**: if user clicks "重新生成" after a completed generation, the old output is replaced by new streaming prose. Old save state resets.

### 6. Files changed

| File | Change |
|------|--------|
| `src/app/api/novel/parse/route.ts` | Add `saveNovel()` call after parsing |
| `src/app/api/writer/save/route.ts` | Return `fullText` in response |
| `src/app/page.tsx` | Pass `novelText` to WritingWorkspace; handle `onNovelSaved` |
| `src/components/writing-workspace.tsx` | Right panel becomes full novel reader with save flow |

### 7. Out of scope

- Chapter splitting / chapter table in DB
- Text search within the reader
- Virtual scrolling / performance optimization
- Editing the novel text inline
- Mobile responsiveness
