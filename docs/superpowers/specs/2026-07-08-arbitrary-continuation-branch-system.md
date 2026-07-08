# Arbitrary-Position Continuation & Branch System

**Date:** 2026-07-08
**Status:** draft

## Problem

Currently continuation is locked to chapter boundaries — users select "第N章末" from a dropdown. There's no way to continue from an arbitrary point within the text. Additionally, the linear append model (`appendNovelContent`) means every continuation permanently modifies the novel text, with no support for branching storylines.

## Goal

1. Click anywhere in the novel reader to set a continuation point
2. Generated prose lives in named branches, not appended to the original text
3. Side-by-side diff view: original text at continuation point vs generated prose, with synchronized scrolling
4. Save dialog lets user choose: append to main text OR save to a named branch

## Design

### 1. Data Model

#### New table: `branches`

```sql
CREATE TABLE IF NOT EXISTS branches (
  id TEXT NOT NULL,
  novel_id TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT 'guest',
  name TEXT NOT NULL DEFAULT '',
  parent_offset INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_branches_novel ON branches(novel_id);
```

- `parent_offset`: character position in the original `novels.text` where this branch diverges
- `text`: accumulated prose for this branch (appended to on each save)
- `name`: user-given name, displayed in the branch switcher

#### Modified type: `WritingTask`

```typescript
interface WritingTask {
  // ... existing fields
  continueFromOffset: number;          // character offset in novel text
  continueFromLabel: string;           // e.g. "第12章 · 偏移3421字"
  branchId?: string;                   // null if going to main text
  savedToBranch?: boolean;             // true after branch save
}
```

Replace `continueFrom` (string like "第3章末") and `continueFromChapter` (number) with the above. The chapter number can be derived from `continueFromOffset` by scanning chapter boundaries.

### 2. Click-to-Continue in Reader

**In the right panel reader (`readerRef`):**

- The novel text is rendered in a `<div>` with `onClick` handler
- On click: `document.caretRangeFromPoint(e.clientX, e.clientY)` gives the text node and offset within that node
- Walk all text nodes in the reader div, accumulating character counts to compute the global character offset
- Store `continueFromOffset` in component state
- Show a visual marker at the click point (a pulsing cursor line or highlighted text block)
- Compute `continueFromContext`: text.slice(offset - 200, offset + 200) for preview display

**Creating a task from the click point:**

Instead of the chapter dropdown dialog, show:

```
新建写作任务

续写点：第12章 · 偏移3421字

上下文预览：
"...他推开房门，看到院子里站着一个陌生的人影。月光洒在他的脸上，轮廓分明。| （续写点）..."

[任务名称（可选）：___]
[创建任务]
```

The `|` marker shows where continuation begins.

**`previousProse` for AI:** Text from position 0 to `continueFromOffset` — everything before the click point.

### 3. Save Dialog

After prose generation, the "保存为最新章节" button opens a save dialog:

```
┌─ 保存到 ——————————————————————┐
│                               │
│ ○ 正文（原文末尾）              │
│                               │
│ ○ 分支：                       │
│   ┌─────────────────────┐    │
│   │ 分支名称              │    │
│   └─────────────────────┘    │
│                               │
│   已有分支：                   │
│   ○ 暗黑结局线 (3200字)       │
│   ○ 隐藏身份线 (1800字)       │
│                               │
│   [取消]  [保存]              │
└───────────────────────────────┘
```

- "正文" → `appendNovelContent` as before, updates `novels.text`
- "分支" → creates new branch OR appends to existing branch
- Existing branches listed by name with word count

### 4. Side-by-Side Comparison View

After prose is generated and before saving:

```
┌─ 左栏：续写点上下文 —————————┐ ┌─ 右栏：续写正文 ————————————┐
│                               │ │                               │
│  ...前文内容...               │ │  AI 生成的 prose ...          │
│  他推开房门，看到院子里        │ │  他走入院中，月光勾勒出       │
│  站着一个陌生的人影。月光      │ │  那人的轮廓。一阵冷风吹       │
│  洒在他的脸上，轮廓分明。      │ │  过，他不禁打了个寒颤。       │
│  ────── 续写点 ──────       │ │  ...                          │
│  （之后内容灰显）             │ │                               │
│                               │ │                               │
└───────────────────────────────┘ └───────────────────────────────┘
```

- **Left panel:** Original text around the continuation point. Shows ~500 chars before the point, with a highlighted divider at the continuation point. Text after the point is greyed out. Located by `continueFromOffset` — NOT a static snapshot, but a live view into `novelText`.
- **Right panel:** Generated prose (the current reader panel content).
- **Synchronized scrolling:** Left and right scroll together. The scroll ratio is computed relative to content height, similar to IDE diff views. When `scrollTop` changes on one side, the other side follows proportionally:
  ```
  leftRatio = left.scrollTop / (left.scrollHeight - left.clientHeight)
  right.scrollTop = rightRatio * (right.scrollHeight - right.clientHeight)
  ```

The comparison view is active while `status === "completed" && annotations.length === 0` (post-generation, pre-save). After save, the view returns to normal single-panel reader.

### 5. Branch Management

**Branch switcher in reader:** When viewing a novel, a dropdown or tab bar shows:
```
[ 原文 ] [ 暗黑结局线 ] [ 隐藏身份线 ] [ + 新建分支 ]
```

Selecting a branch loads that branch's text into the reader. The branch text is the accumulated prose of that storyline.

**Branch loading:** `GET /api/branches?novelId=X` returns all branches for a novel. `GET /api/branches?novelId=X&branchId=Y` returns a specific branch's full text.

### 6. Click Point Visual Marker

In the reader, the continuation point is shown as:

```
...前文内容...
他推开房门，看到院子里站着一个陌生的人影。
▌ ← 续写点（闪烁或固定高亮线）
月光洒在他的脸上，轮廓分明。
...后文内容（变灰）...
```

- The marker is positioned absolutely based on the character offset
- When creating a task from this point, the marker persists in the comparison view
- In normal reading mode, no marker is shown

### 7. Files Changed

| File | Change |
|------|--------|
| `src/lib/db.ts` | Add `branches` table, CRUD functions |
| `src/types/index.ts` | Add `Branch` type |
| `src/components/writing-workspace.tsx` | Click-to-continue, side-by-side comparison, save dialog, branch switcher |
| `src/app/page.tsx` | Load branches, pass to WritingWorkspace |
| `src/app/api/writer/save/route.ts` | Handle branch save (save to branches table vs append to novels) |
| `src/app/api/branches/route.ts` | New: GET/POST for branch CRUD |
| `src/app/api/simulation/stream/route.ts` | Pass `continueFromOffset` + `previousProse` to outline agent and engine |

### 8. Edge Cases

- **Click on whitespace between paragraphs:** Snap to nearest paragraph boundary
- **Very short novel (no previous prose):** `previousProse` is empty string
- **Click at position 0:** Same as "从开头续写", previousProse = ""
- **Click at very end of novel:** Equivalent to append (same as current behavior)
- **Branch with same name:** Auto-append number suffix ("暗黑结局线 (2)")
- **Long generated prose in comparison:** Right panel scrolls independently; left stays fixed at the continuation point context

### 9. Out of Scope

- Branch merging (combining two branches)
- Visual branch tree/graph display
- Editing/deleting branches via UI (DB-level operations only for now)
- Re-basing a branch (changing its parent offset)
- Branch from a branch (nested branches) — initial version only supports branching from original text
