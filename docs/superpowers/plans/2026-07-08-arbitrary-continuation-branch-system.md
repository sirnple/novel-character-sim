# Arbitrary-Position Continuation & Branch System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Click anywhere in the novel reader to start a continuation, save to named branches instead of only appending to main text, with side-by-side diff comparison.

**Architecture:** New `branches` table for named storylines. Click-to-continue via Range API computes character offset. Side-by-side comparison with synchronized scroll. Save dialog lets user choose main text or branch. 7 files changed across 4 tasks.

**Tech Stack:** Next.js App Router, React, TypeScript, SQLite (better-sqlite3)

---

### Task 1: Database + types + branches API

**Files:**
- Modify: `src/lib/db.ts`
- Modify: `src/types/index.ts`
- Create: `src/app/api/branches/route.ts`

- [ ] **Step 1: Add `branches` table to DB schema**

In `src/lib/db.ts`, inside `initSchema()`, add after the `codex_data` table:

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

- [ ] **Step 2: Add branch CRUD functions**

After the `deleteCodex` function, add:

```typescript
// ---- Branches ----

export interface BranchRow {
  id: string;
  novel_id: string;
  name: string;
  parent_offset: number;
  text: string;
  created_at: string;
  updated_at: string;
}

export function saveBranch(
  userId: string,
  branchId: string,
  novelId: string,
  name: string,
  parentOffset: number,
  text: string
): void {
  const d = getDb();
  d.prepare(
    `INSERT OR REPLACE INTO branches (id, novel_id, user_id, name, parent_offset, text, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(branchId, novelId, userId, name, parentOffset, text);
}

export function appendBranchContent(
  userId: string,
  branchId: string,
  newContent: string
): void {
  const d = getDb();
  const branch = d.prepare(
    "SELECT text FROM branches WHERE id = ? AND user_id = ?"
  ).get(branchId, userId) as { text: string } | undefined;
  if (!branch) return;
  const combined = branch.text + "\n\n" + newContent;
  d.prepare(
    "UPDATE branches SET text = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?"
  ).run(combined, branchId, userId);
}

export function getBranch(
  userId: string,
  branchId: string
): BranchRow | null {
  const d = getDb();
  return d.prepare(
    "SELECT id, novel_id, name, parent_offset, text, created_at, updated_at FROM branches WHERE id = ? AND user_id = ?"
  ).get(branchId, userId) as BranchRow | null;
}

export function getBranchByNovelAndName(
  userId: string,
  novelId: string,
  name: string
): BranchRow | null {
  const d = getDb();
  return d.prepare(
    "SELECT id, novel_id, name, parent_offset, text, created_at, updated_at FROM branches WHERE novel_id = ? AND user_id = ? AND name = ?"
  ).get(novelId, userId, name) as BranchRow | null;
}

export function listBranches(
  userId: string,
  novelId: string
): BranchRow[] {
  const d = getDb();
  return d.prepare(
    "SELECT id, novel_id, name, parent_offset, text, created_at, updated_at FROM branches WHERE novel_id = ? AND user_id = ? ORDER BY updated_at DESC"
  ).all(novelId, userId) as BranchRow[];
}
```

- [ ] **Step 3: Add `Branch` type**

In `src/types/index.ts`, add:

```typescript
export interface Branch {
  id: string;
  novelId: string;
  name: string;
  parentOffset: number;
  text: string;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 4: Create branches API route**

Create `src/app/api/branches/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { saveBranch, getBranch, listBranches, appendBranchContent } from "@/lib/db";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "branches_get", { windowMs: 60_000, maxRequests: 30 });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }

  const novelId = request.nextUrl.searchParams.get("novelId");
  const branchId = request.nextUrl.searchParams.get("branchId");

  if (branchId) {
    const branch = getBranch(userId, branchId);
    if (!branch) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ branch });
  }

  if (novelId) {
    const branches = listBranches(userId, novelId);
    return NextResponse.json({ branches });
  }

  return NextResponse.json({ error: "novelId or branchId required" }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "branches_post", { windowMs: 60_000, maxRequests: 20 });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }

  const { novelId, branchId, name, parentOffset, content, append } = await request.json();

  if (!novelId || !name) {
    return NextResponse.json({ error: "novelId and name are required" }, { status: 400 });
  }

  if (append && branchId) {
    appendBranchContent(userId, branchId, content);
    const updated = getBranch(userId, branchId);
    return NextResponse.json({ success: true, branch: updated });
  }

  const id = branchId || `branch_${Date.now()}`;
  saveBranch(userId, id, novelId, name, parentOffset || 0, content || "");
  const branch = getBranch(userId, id);
  return NextResponse.json({ success: true, branch });
}
```

- [ ] **Step 5: Verify build**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db.ts src/types/index.ts src/app/api/branches/route.ts
git commit -m "feat: add branches table, types, and CRUD API"
```

---

### Task 2: Backend wiring — writer save + stream route + page.tsx

**Files:**
- Modify: `src/app/api/writer/save/route.ts`
- Modify: `src/app/api/simulation/stream/route.ts`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Update writer save to support branch saves**

In `src/app/api/writer/save/route.ts`, replace the POST handler:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { appendNovelContent, getNovel, appendBranchContent, getBranch, saveBranch, getBranchByNovelAndName } from "@/lib/db";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "writer_save", { windowMs: 60_000, maxRequests: 20 });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }

  try {
    const { novelId, content, branchId, branchName, parentOffset } = await request.json();
    if (!novelId || !content) {
      return NextResponse.json({ error: "novelId and content are required" }, { status: 400 });
    }

    // Branch save
    if (branchId || branchName) {
      if (branchId) {
        // Append to existing branch
        appendBranchContent(userId, branchId, content);
        const updated = getBranch(userId, branchId);
        return NextResponse.json({ success: true, fullText: updated?.text || "", branch: updated });
      }
      // Create new branch
      const id = `branch_${Date.now()}`;
      saveBranch(userId, id, novelId, branchName, parentOffset || 0, content);
      const created = getBranch(userId, id);
      return NextResponse.json({ success: true, fullText: created?.text || "", branch: created });
    }

    // Main text save (existing behavior)
    appendNovelContent(userId, novelId, content);
    const updated = getNovel(userId, novelId);
    return NextResponse.json({ success: true, fullText: updated?.text || "" });
  } catch (error) {
    console.error("Writer save error:", error);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Pass `continueFromOffset` from simulation stream to engine**

In `src/app/api/simulation/stream/route.ts`, add `continueFromOffset` to the body destructuring (after `outlineOnly`):

```typescript
    continueFromOffset,
```

And in the `SimulationEngine` constructor call, pass it. Also, compute `previousProse` differently when `continueFromOffset` is provided (the novel text up to the offset):

In the engine constructor section (around line 112-122), when `continueFromOffset` is provided, use `dbNovelText.slice(0, continueFromOffset)` as the timeline context for previous prose.

Add to the destructured body type after `outlineOnly?`:
```typescript
    continueFromOffset?: number;
```

And pass `continueFromOffset` or `dbNovelText` info into the engine. The simplest approach: when `continueFromOffset` is set, store it on the engine so it can use `dbNovelText.slice(0, continueFromOffset)` as context. Add a `previousProseOverride` field to the engine or pass `fullNovelOutput` pre-set.

Actually, the simplest approach: set `previousProse` from the body when available, and pass it to the engine. Add a field to the engine constructor options:

In the engine constructor (let the stream route pass it), add `previousProse?: string` option. When set, it overrides `fullNovelOutput` for the initial state.

- [ ] **Step 3: Load branches in page.tsx and pass to WritingWorkspace**

In `src/app/page.tsx`:

Add branch state:
```typescript
const [branches, setBranches] = useState<import("@/types").Branch[]>([]);
```

In `loadNovel`, after fetching the novel, also fetch branches:
```typescript
fetch(`/api/branches?novelId=${id}`).then(r => r.json()).then(d => {
  if (d.branches) setBranches(d.branches);
}).catch(() => {});
```

Pass `branches` and `setBranches` to `WritingWorkspace`:
```jsx
<WritingWorkspace
  // ... existing props
  branches={branches}
  onBranchesChange={setBranches}
/>
```

- [ ] **Step 4: Verify build and commit**

```bash
npx tsc --noEmit
git add src/app/api/writer/save/route.ts src/app/api/simulation/stream/route.ts src/app/page.tsx
git commit -m "feat: wire branch save, continueFromOffset, and branches loading"
```

---

### Task 3: Click-to-continue in reader + task creation changes

**Files:**
- Modify: `src/components/writing-workspace.tsx`

- [ ] **Step 1: Update WritingTask interface**

Replace `continueFrom: string` and `continueFromChapter: number` with:

```typescript
interface WritingTask {
  id: string;
  novelId: string;
  label: string;
  script: string;
  continueFromOffset: number;
  continueFromLabel: string;
  scene: SceneDefinition;
  output?: string;
  outline?: SceneOutline | null;
  outlinePrompt?: { system: string; user: string } | null;
  review?: ReviewReport | null;
  writerPrompt?: { systemPrompt: string; userPrompt: string } | null;
  status: "draft" | "writing" | "completed";
  savedToNovel?: boolean;
  branchId?: string;
  createdAt: string;
}
```

- [ ] **Step 2: Add click-to-continue handler**

Add state for the continuation point:
```typescript
const [continuePoint, setContinuePoint] = useState<{
  offset: number;
  label: string;
  contextPreview: string;
} | null>(null);
```

Add click handler on the reader. The reader div already has `ref={readerRef}`. Add `onClick`:

In the reader body div (the one with `ref={readerRef}`), add an `onClick` handler:

```typescript
const handleReaderClick = (e: React.MouseEvent) => {
  if (!initialFullNovel) return;
  
  // Get click position
  const range = document.caretRangeFromPoint(e.clientX, e.clientY);
  if (!range) return;
  
  // Compute character offset by walking text nodes
  const readerEl = readerRef.current;
  if (!readerEl) return;
  
  let offset = 0;
  const walker = document.createTreeWalker(readerEl, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (node === range.startContainer) {
      offset += range.startOffset;
      break;
    }
    offset += node.textContent?.length || 0;
  }
  
  const contextStart = Math.max(0, offset - 200);
  const contextEnd = Math.min(initialFullNovel.length, offset + 200);
  const contextPreview = initialFullNovel.slice(contextStart, contextEnd);
  
  setContinuePoint({
    offset,
    label: `第${estimateChapter(offset, timeline)}章 · 偏移${offset}字`,
    contextPreview,
  });
};
```

The `estimateChapter` helper: scan `timeline.chapters` for the one containing this offset. If no timeline, just show the offset.

- [ ] **Step 3: Add visual marker at continue point**

After clicking, render a marker in the reader. Add after the novel text div:

```jsx
{continuePoint && !outputText && (
  <div className="max-w-[800px] mx-auto my-2 flex items-center gap-2">
    <div className="flex-1 h-px bg-orange-500/50" />
    <span className="text-[10px] text-orange-500 font-mono shrink-0">续写点 · {continuePoint.label}</span>
    <button
      onClick={() => setCreatingTask(true)}
      className="text-[10px] bg-orange-600 hover:bg-orange-500 text-white px-2 py-0.5 rounded font-mono transition-colors"
    >
      从此处续写
    </button>
  </div>
)}
```

- [ ] **Step 4: Update task creation dialog**

Replace the chapter dropdown dialog. When `creatingTask` is true and `continuePoint` is set, show:

```jsx
{creatingTask && continuePoint && (
  <div className="...">
    <h3>新建写作任务</h3>
    <div className="text-xs text-neutral-400 mb-2">
      续写点：{continuePoint.label}
    </div>
    <div className="bg-neutral-800/30 rounded p-2 text-xs text-neutral-500 mb-4 max-h-20 overflow-y-auto">
      ...{continuePoint.contextPreview.slice(0, 100)}...
      <span className="text-orange-500 font-bold">|</span>
      {continuePoint.contextPreview.slice(100)}...
    </div>
    <input placeholder="任务名称（可选）" ... />
    <button onClick={handleCreateTaskFromPoint}>创建任务</button>
  </div>
)}
```

- [ ] **Step 5: Update `handleCreateTaskFromPoint`**

```typescript
const handleCreateTaskFromPoint = useCallback(() => {
  if (!continuePoint) return;
  const sc: SceneDefinition = {
    ...scene,
    location: scene.location || "",
    characterIds: characters.map(c => c.id),
  };
  const task: WritingTask = {
    id: `task_${Date.now()}`,
    novelId,
    label: newTaskLabel || continuePoint.label,
    script: `# 写作剧本\n\n## 场景\n承接：${continuePoint.label}\n\n> 请点击"AI 生成剧本"按钮生成场景大纲`,
    continueFromOffset: continuePoint.offset,
    continueFromLabel: continuePoint.label,
    scene: sc,
    status: "draft",
    savedToNovel: false,
    createdAt: new Date().toISOString(),
  };
  const updated = [task, ...tasks];
  persistTasks(updated);
  setActiveTaskId(task.id);
  setScriptText(task.script);
  setOutputText("");
  setWriterPrompt(null);
  setReview(null);
  setAnnotations([]);
  setStatus("idle");
  setCreatingTask(false);
  setContinuePoint(null);
}, [continuePoint, newTaskLabel, scene, characters, buildScript, novelId, tasks, persistTasks]);
```

- [ ] **Step 6: Update outline and prose generation to pass `continueFromOffset`**

In `handleGenerateOutline` and `startWriting`, pass `continueFromOffset` instead of/in addition to `continueFromChapter`:

```typescript
body: JSON.stringify({
  // ... existing
  continueFromOffset: activeTask?.continueFromOffset,
  continueFromLabel: activeTask?.continueFromLabel,
})
```

- [ ] **Step 7: Verify build and commit**

```bash
npx tsc --noEmit
git add src/components/writing-workspace.tsx
git commit -m "feat: add click-to-continue in reader with offset-based task creation"
```

---

### Task 4: Side-by-side comparison + save dialog + branch switcher

**Files:**
- Modify: `src/components/writing-workspace.tsx`

- [ ] **Step 1: Add branch-related state**

```typescript
const [branches, setBranches] = useState<import("@/types").Branch[]>([]);
const [showSaveDialog, setShowSaveDialog] = useState(false);
const [saveTarget, setSaveTarget] = useState<"main" | "branch">("main");
const [saveBranchName, setSaveBranchName] = useState("");
const [saveBranchId, setSaveBranchId] = useState<string | null>(null);
```

Add props:
```typescript
  branches?: import("@/types").Branch[];
  onBranchesChange?: (branches: import("@/types").Branch[]) => void;
```

- [ ] **Step 2: Replace single "保存为最新章节" button with save dialog trigger**

Change the save button (currently around line 575-592) to open the dialog:

```jsx
{status === "completed" && !saved && (
  <button onClick={() => setShowSaveDialog(true)} disabled={saving}
    className={`flex items-center gap-1 text-[10px] font-mono transition-colors ${saveError ? "text-red-400 hover:text-red-300" : "text-neutral-500 hover:text-green-400"}`}>
    {saveError ? (
      <><AlertCircle className="w-3 h-3 text-red-400" /> 保存失败，点击重试</>
    ) : (
      <><Save className="w-3 h-3" /> 保存...</>
    )}
  </button>
)}
```

- [ ] **Step 3: Add save dialog modal**

When `showSaveDialog` is true, render a modal overlay:

```jsx
{showSaveDialog && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
    <div className="w-full max-w-sm bg-[#0e0e0e] border border-neutral-800 rounded-lg p-6 shadow-2xl">
      <h3 className="text-sm font-semibold text-neutral-300 font-mono mb-5">保存到</h3>
      
      <div className="space-y-3 mb-5">
        <label className="flex items-center gap-3 p-3 rounded border border-neutral-700 hover:border-neutral-600 cursor-pointer">
          <input type="radio" name="saveTarget" checked={saveTarget === "main"}
            onChange={() => setSaveTarget("main")} />
          <span className="text-sm text-neutral-300">正文（原文末尾）</span>
        </label>
        
        <label className="flex items-center gap-3 p-3 rounded border border-neutral-700 hover:border-neutral-600 cursor-pointer">
          <input type="radio" name="saveTarget" checked={saveTarget === "branch"}
            onChange={() => setSaveTarget("branch")} />
          <span className="text-sm text-neutral-300">分支</span>
        </label>
        
        {saveTarget === "branch" && (
          <div className="ml-8 space-y-2">
            <input type="text" value={saveBranchName}
              onChange={e => setSaveBranchName(e.target.value)}
              placeholder="分支名称"
              className="w-full px-3 py-2 bg-[#111110] border border-neutral-800 rounded text-sm text-neutral-300 font-mono outline-none focus:border-orange-600/50" />
            
            {branches.filter(b => b.novelId === novelId).length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] text-neutral-600 font-mono uppercase mb-1">已有分支</div>
                {branches.filter(b => b.novelId === novelId).map(b => (
                  <label key={b.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-neutral-800/30 cursor-pointer">
                    <input type="radio" name="existingBranch"
                      checked={saveBranchId === b.id}
                      onChange={() => { setSaveBranchId(b.id); setSaveBranchName(b.name); }} />
                    <span className="text-xs text-neutral-400">{b.name}</span>
                    <span className="text-[10px] text-neutral-600">({b.text.length}字)</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      
      <div className="flex gap-3">
        <button onClick={() => setShowSaveDialog(false)}
          className="flex-1 py-2 text-sm text-neutral-500 hover:text-neutral-300 font-mono border border-neutral-700 rounded-lg">取消</button>
        <button onClick={handleSaveFromDialog} disabled={saving || (saveTarget === "branch" && !saveBranchName)}
          className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white text-sm font-mono rounded-lg">
          {saving ? "保存中..." : "保存"}
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 4: Implement `handleSaveFromDialog`**

```typescript
const handleSaveFromDialog = async () => {
  if (!outputText || !novelId) return;
  setSaving(true);
  setSaveError(false);
  try {
    const body: any = { novelId, content: outputText };
    if (saveTarget === "branch") {
      if (saveBranchId) {
        body.branchId = saveBranchId;
      } else {
        body.branchName = saveBranchName;
        body.parentOffset = activeTask?.continueFromOffset || 0;
      }
    }
    const res = await fetch("/api/writer/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = await res.json();
      setSaved(true);
      setSaveError(false);
      setShowSaveDialog(false);
      if (data.fullText && onNovelSaved && saveTarget === "main") {
        onNovelSaved(data.fullText);
      }
      if (data.branch && onBranchesChange) {
        onBranchesChange([data.branch, ...branches.filter(b => b.id !== data.branch.id)]);
      }
      updateTask(activeTaskId!, { savedToNovel: true, status: "completed", branchId: data.branch?.id });
    } else {
      setSaveError(true);
    }
  } catch {
    setSaveError(true);
  }
  setSaving(false);
};
```

- [ ] **Step 5: Side-by-side comparison view**

When `status === "completed"` and `continuePoint`/task has a `continueFromOffset`, replace the single-panel reader with a dual-panel comparison:

Add a second ref for the right panel:
```typescript
const rightPanelRef = useRef<HTMLDivElement>(null);
```

Add synchronized scroll handler:
```typescript
const handleLeftScroll = () => {
  if (!readerRef.current || !rightPanelRef.current) return;
  const left = readerRef.current;
  const right = rightPanelRef.current;
  const ratio = left.scrollTop / (left.scrollHeight - left.clientHeight);
  right.scrollTop = ratio * (right.scrollHeight - right.clientHeight);
};

const handleRightScroll = () => {
  if (!readerRef.current || !rightPanelRef.current) return;
  const left = readerRef.current;
  const right = rightPanelRef.current;
  const ratio = right.scrollTop / (right.scrollHeight - right.clientHeight);
  left.scrollTop = ratio * (left.scrollHeight - left.clientHeight);
};
```

When `status === "completed"` and `activeTask?.continueFromOffset` exists, render:

```jsx
{status === "completed" && activeTask?.continueFromOffset != null ? (
  <div className="flex flex-1 overflow-hidden">
    {/* Left: original context */}
    <div ref={readerRef} onScroll={handleLeftScroll}
      className="w-1/2 overflow-y-auto custom-scrollbar border-r border-neutral-700/50">
      <div className="p-4">
        <div className="text-[10px] text-neutral-500 font-mono uppercase mb-2">续写点上下文</div>
        <div className="text-sm text-neutral-400 leading-relaxed whitespace-pre-wrap font-serif">
          {initialFullNovel?.slice(Math.max(0, activeTask.continueFromOffset - 500), activeTask.continueFromOffset)}
        </div>
        <div className="my-3 flex items-center gap-2">
          <div className="flex-1 h-px bg-orange-500/50" />
          <span className="text-[10px] text-orange-500 font-mono shrink-0">续写点</span>
          <div className="flex-1 h-px bg-orange-500/50" />
        </div>
        <div className="text-sm text-neutral-600 leading-relaxed whitespace-pre-wrap font-serif">
          {initialFullNovel?.slice(activeTask.continueFromOffset, activeTask.continueFromOffset + 500)}
        </div>
      </div>
    </div>
    {/* Right: generated prose */}
    <div ref={rightPanelRef} onScroll={handleRightScroll}
      className="w-1/2 overflow-y-auto custom-scrollbar">
      <div className="p-4">
        <div className="text-[10px] text-green-500/70 font-mono uppercase mb-2">续写正文</div>
        <div className="text-base text-neutral-200 leading-relaxed whitespace-pre-wrap font-serif">
          {outputText}
        </div>
      </div>
    </div>
  </div>
) : (
  // existing single-panel reader
  <div ref={readerRef} className="flex-1 overflow-y-auto custom-scrollbar">
    ...
  </div>
)}
```

- [ ] **Step 6: Verify build and commit**

```bash
npx tsc --noEmit
git add src/components/writing-workspace.tsx
git commit -m "feat: add side-by-side comparison, save dialog, and branch support"
```

---

### Post-Implementation Verification

- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] Click anywhere in the reader → visual marker appears at click position
- [ ] "从此处续写" button creates a task with correct offset
- [ ] Generate prose → side-by-side comparison view shows (left: original context, right: prose)
- [ ] Scrolling left or right synchronizes the other panel
- [ ] Save dialog shows main text + branch options
- [ ] Save to new branch → branch appears in list
- [ ] Save to existing branch → appends content
- [ ] Save to main text → works as before
- [ ] Branches table has rows in the database after saving
