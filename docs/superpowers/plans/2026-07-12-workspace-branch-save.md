# Spec B — Workspace 主线保存走分支 + novels.text 退场 + READING 分支选择器 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 工作区主线保存改走 main 分支、三处读路径（save/stream/read）从 branches 表读正文、novels.text 退为只读原件、READING 页加分支撑择器。

**Architecture:** writer/save 主线路径改 `appendBranchContent(userId, novelId, "main", content)`；simulation/stream 读 `getBranch().text` 替代 `getNovel().text`；/api/novels GET 接受 `branchId` 默认 "main" 从分支读；前传端 workspace 保存+stream 均传 `branchId`；READING 页新增 local state + fetch 的分支选择器。

**Tech Stack:** Next.js 14 App Router · TypeScript · better-sqlite3 · React useState.

---

## File Structure

**修改**
- `src/lib/db.ts` — `appendNovelContent` deprecated 注释。
- `src/app/api/writer/save/route.ts` — 主线路径改 main 分支。
- `src/app/api/novels/route.ts` — GET 加 `branchId` 读取。
- `src/app/api/simulation/stream/route.ts` — `getNovel`→`getBranch` + 读 `body.branchId`。
- `src/components/writing-workspace.tsx` — 主线保存传 `branchId`；stream 加 `branchId`。
- `src/app/novel/[id]/read/page.tsx` — 分支选择器 + fetch 全文。

---

## Task 1: DB deprecated 标记

**Files:**
- Modify: `src/lib/db.ts:219-226`

- [ ] **Step 1: 标记 appendNovelContent deprecated**

`src/lib/db.ts` 第 219 行 `appendNovelContent` 函数前加注释：

```ts
/** @deprecated Use appendBranchContent(userId, novelId, "main", content) instead. */
export function appendNovelContent(userId: string, id: string, newContent: string): void {
```

- [ ] **Step 2: 验证无误**

Run: `npx tsc --noEmit 2>&1 | grep -c "appendNovelContent"`
Expected: `0`（仅注释改动，无新错误）

- [ ] **Step 3: commit**

```bash
git add src/lib/db.ts
git commit -m "docs(db): mark appendNovelContent deprecated per spec B"
```

---

## Task 2: writer/save route 主线改 main 分支

**Files:**
- Modify: `src/app/api/writer/save/route.ts`

- [ ] **Step 1: 替换 writer/save route 主线保存分支**

`src/app/api/writer/save/route.ts` 第 1-41 行整体替换为：

```ts
import { NextRequest, NextResponse } from "next/server";
import { getNovel, appendBranchContent, getBranch, saveBranch, ensureMainBranch } from "@/lib/db";
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

    // Branch save (IF line or explicit branchId)
    if (branchId || branchName) {
      if (branchId === "main") {
        // Main line — ensure main branch exists then append
        ensureMainBranch(userId, novelId);
        appendBranchContent(userId, novelId, "main", content);
        const updated = getBranch(userId, novelId, "main");
        return NextResponse.json({ success: true, fullText: updated?.text || "", branch: updated });
      }
      if (branchId && branchId !== "main") {
        appendBranchContent(userId, novelId, branchId, content);
        const updated = getBranch(userId, novelId, branchId);
        return NextResponse.json({ success: true, fullText: updated?.text || "", branch: updated });
      }
      // New branch creation
      if (branchName) {
        const id = `branch_${Date.now()}`;
        saveBranch(userId, id, novelId, branchName, parentOffset || 0, content);
        const created = getBranch(userId, novelId, id);
        return NextResponse.json({ success: true, fullText: created?.text || "", branch: created });
      }
    }

    // Fallback: main text save (no branchId — legacy path, treat as main)
    ensureMainBranch(userId, novelId);
    appendBranchContent(userId, novelId, "main", content);
    const updated = getBranch(userId, novelId, "main");
    return NextResponse.json({ success: true, fullText: updated?.text || "" });
  } catch (error) {
    console.error("Writer save error:", error);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}
```

- [ ] **Step 2: type-check**

Run: `npx tsc --noEmit 2>&1 | grep "writer/save" | head`
Expected: 无 error。

- [ ] **Step 3: commit**

```bash
git add src/app/api/writer/save/route.ts
git commit -m "feat(save): mainline save writes to main branch, fallback ensures main branch"
```

---

## Task 3: /api/novels GET 支 branchId

**Files:**
- Modify: `src/app/api/novels/route.ts`

- [ ] **Step 1: 改造 novels GET**

替换 `src/app/api/novels/route.ts` 第 1-26 行为：

```ts
import { NextRequest, NextResponse } from "next/server";
import { listNovels, getNovel, getStoryInfo, getCharacters, deleteNovel, getBranch, ensureMainBranch } from "@/lib/db";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "novels_get", { windowMs: 60_000, maxRequests: 60 });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }
  const id = request.nextUrl.searchParams.get("id");
  const branchId = request.nextUrl.searchParams.get("branchId") || "main";

  if (id) {
    let branch = getBranch(userId, id, branchId);
    if (!branch && branchId === "main") {
      ensureMainBranch(userId, id);
      branch = getBranch(userId, id, "main");
    }
    if (!branch) return NextResponse.json({ error: "Branch not found" }, { status: 404 });
    const novel = getNovel(userId, id);
    const storyInfo = getStoryInfo(userId, id);
    const characters = getCharacters(userId, id);
    return NextResponse.json({ id, title: novel?.title || "", text: branch.text, storyInfo, characters });
  }

  const novels = listNovels(userId);
  return NextResponse.json({ novels });
}
```

- [ ] **Step 2: type-check**

Run: `npx tsc --noEmit 2>&1 | grep "api/novels" | head`
Expected: 无 error。

- [ ] **Step 3: commit**

```bash
git add src/app/api/novels/route.ts
git commit -m "feat(api): novels GET accepts branchId query, defaults to main branch"
```

---

## Task 4: simulation/stream 改读分支

**Files:**
- Modify: `src/app/api/simulation/stream/route.ts:80-91`

- [ ] **Step 1: getNovel 替换为 getBranch**

`src/app/api/simulation/stream/route.ts` 顶部 import 加 `getBranch`：

```ts
import { getNovel, getBranch, getStoryInfo, getTimeline, saveTimeline } from "@/lib/db";
```

第 80-91 行 `dbNovelText` 读取段替换为：

```ts
  let dbNovelText = "";
  try {
    if (novelId) {
      try {
        const branchId = body.branchId as string | undefined;
        const effectiveBranchId = branchId || "main";
        const dbBranch = getBranch(userId, novelId, effectiveBranchId);
        if (dbBranch) {
          dbNovelText = dbBranch.text;
          dbStoryInfo = getStoryInfo(userId, novelId);
          dbTimeline = getTimeline(userId, novelId);
          debugLog("StreamRoute", `Branch loaded: id=${effectiveBranchId}, text=${dbNovelText.length}chars, storyInfo=${dbStoryInfo ? "yes" : "no"}, timeline=${dbTimeline ? `yes(${dbTimeline.chapters?.length || 0}ch)` : "no"}`);
        } else {
          debugLog("StreamRoute", `Branch NOT FOUND novelId=${novelId} branchId=${effectiveBranchId}`);
        }
      } catch (e) {
```

无需动 `import { getNovel }` 如果该 file 别处还用到（第 84 行原来调用移走：此处原有 `const dbNovel = getNovel(userId, novelId)` 已替换）。若 `getNovel` 他在 file 内不再有调用则从 import 移除——保留无妨（不影响正确性）。

- [ ] **Step 2: type-check**

Run: `npx tsc --noEmit 2>&1 | grep "simulation/stream" | head`
Expected: 无 error。

- [ ] **Step 3: commit**

```bash
git add src/app/api/simulation/stream/route.ts
git commit -m "feat(stream): simulation reads branch text instead of novels.text"
```

---

## Task 5: writing-workspace 前端传 branchId

**Files:**
- Modify: `src/components/writing-workspace.tsx:116` / `:392-403` / `:466-473`

- [ ] **Step 1: useNovel 解构加 activeBranchId**

`writing-workspace.tsx` 顶部解构处（约第 114-118 行）里 `useNovel()` 加 `activeBranchId`：

```ts
const { novelId, novelTitle, novelText, setNovelText, setNovel, generatedProse, activeBranchId } = useNovel();
```

- [ ] **Step 2: 主线保存 body 传 branchId="main"**

`handleSaveFromDialog` 里 body 构建（第 466 行）改为：

```ts
const body: any = { novelId, content: outputText };
if (saveTarget === "main") {
  body.branchId = "main";
} else if (saveBranchId) {
  body.branchId = saveBranchId;
} else if (saveBranchName) {
  body.branchName = saveBranchName;
  body.parentOffset = activeTask?.continueFromOffset || 0;
}
```

- [ ] **Step 3: simulation body 加 branchId**

第 390-403 行 stream body 构建加 `branchId`：

```ts
body: JSON.stringify({
  novelTitle, novelId,
  characters: characters.filter(c => taskScene.characterIds.includes(c.id)),
  scene: taskScene, writingStyle,
  outline: activeTask?.outline || undefined,
  timelineEvents: (timeline?.chapters || []).flatMap(ch => (ch.events || [])),
  lastChapterStates,
  continueFromOffset: activeTask?.continueFromOffset ?? 0,
  continueFromLabel: activeTask?.continueFromLabel ?? "",
  branchId: activeBranchId || "main",
  allowAdult: activeTask?.allowAdult || false,
  cleanMode: activeTask?.cleanMode || false,
}),
```

- [ ] **Step 4: type-check**

Run: `npx tsc --noEmit 2>&1 | grep "writing-workspace" | head`
Expected: 无 error。

- [ ] **Step 5: commit**

```bash
git add src/components/writing-workspace.tsx
git commit -m "feat(workspace): send branchId on main save and simulation stream"
```

---

## Task 6: READING 页分支选择器

**Files:**
- Modify: `src/app/novel/[id]/read/page.tsx`

- [ ] **Step 1: 替换 read page**

替换 `src/app/novel/[id]/read/page.tsx` 整文件为：

```tsx
"use client";
import { useRef, useState, useEffect, useCallback } from "react";
import { useNovel } from "@/lib/novel-context";

export default function ReadPage() {
  const { novelText, novelTitle, novelId, timeline, branches, activeBranchId } = useNovel();
  const readerRef = useRef<HTMLDivElement>(null);
  const [continueOffset, setContinueOffset] = useState<number | null>(null);
  const [continueLabel, setContinueLabel] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState<string>(activeBranchId || "main");
  const [readingText, setReadingText] = useState(novelText);
  const [loadingText, setLoadingText] = useState(false);

  const fetchBranchText = useCallback(async (branchId: string) => {
    setLoadingText(true);
    try {
      const res = await fetch(`/api/novels?novelId=${novelId}&branchId=${encodeURIComponent(branchId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.text) setReadingText(data.text);
      } else {
        // fallback to main on error
        if (branchId !== "main") {
          const mainRes = await fetch(`/api/novels?novelId=${novelId}&branchId=main`);
          if (mainRes.ok) {
            const d = await mainRes.json();
            setReadingText(d.text || "");
            setSelectedBranchId("main");
          }
        }
      }
    } catch { /* keep current text */ }
    setLoadingText(false);
  }, [novelId]);

  useEffect(() => {
    fetchBranchText(selectedBranchId);
  }, [selectedBranchId, fetchBranchText]);

  const handleClick = (e: React.MouseEvent) => {
    if (!readingText) return;
    const range = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (!range) return;
    const el = readerRef.current; if (!el) return;
    let offset = 0;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      if (node === range.startContainer) { offset += range.startOffset; break; }
      offset += node.textContent?.length || 0;
    }
    let chapterNum = 1;
    if (timeline?.chapters) {
      let cum = 0;
      for (const ch of timeline.chapters) { cum += (ch.events?.length || 0) * 200; if (cum >= offset) break; chapterNum++; }
    }
    setContinueOffset(offset);
    setContinueLabel(`第${chapterNum}章 · 偏移${offset}字`);
  };

  const openWriter = () => {
    if (continueOffset == null) return;
    window.location.href = `/novel/${novelId}/write?offset=${continueOffset}&label=${encodeURIComponent(continueLabel)}`;
  };

  const branchName = (id: string) => {
    if (id === "main") return "主线";
    const b = branches?.find(b => b.id === id);
    return b?.name || id;
  };

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      {/* Header with branch selector */}
      <div className="max-w-[800px] mx-auto px-6 pt-4 flex items-center gap-3">
        <h2 className="text-sm font-semibold text-neutral-300 font-mono uppercase tracking-wider">阅读 · {novelTitle}</h2>
        <div className="flex items-center gap-2">
          <select
            value={selectedBranchId}
            onChange={e => setSelectedBranchId(e.target.value)}
            disabled={loadingText}
            className="bg-[#111110] border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-300 font-mono outline-none focus:border-orange-600/50 disabled:opacity-50"
          >
            <option value="main">主线</option>
            {(branches || []).filter(b => b.id !== "main").map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          {loadingText && <span className="text-[10px] text-orange-500 font-mono animate-pulse">加载中</span>}
        </div>
      </div>

      {/* Text body */}
      <div ref={readerRef} onClick={handleClick} className="max-w-[800px] mx-auto p-6">
        <div className="text-base text-neutral-200 leading-relaxed whitespace-pre-wrap font-serif">
          {continueOffset != null ? (
            <>
              {readingText.slice(0, continueOffset)}
              <span className="inline-flex items-center gap-1 mx-1">
                <span className="inline-block w-2 h-4 bg-orange-500 animate-pulse rounded-sm" />
                <button onClick={openWriter} className="text-[10px] bg-orange-600 hover:bg-orange-500 text-white px-1.5 py-0.5 rounded font-mono">续写</button>
              </span>
              {readingText.slice(continueOffset)}
            </>
          ) : (
            readingText || novelText
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: type-check**

Run: `npx tsc --noEmit 2>&1 | grep "read/page" | head`
Expected: 无 error。

- [ ] **Step 3: commit**

```bash
git add src/app/novel/[id]/read/page.tsx
git commit -m "feat(read): add branch selector, fetch branch text via API"
```

---

## Task 7: e2e 验证

**Files:**
- 无源码改动

- [ ] **Step 1: 全量 type-check**

Run: `npx tsc --noEmit 2>&1 | wc -l`
Expected: ≤ 50（基线不变）。

- [ ] **Step 2: 建构冒烟**

Run: `npm run build 2>&1 | tail -5`
Expected: Build 成功。

- [ ] **Step 3: 手动场景验证**

1. 主线续写后「保存到主线」→ DB 里 `SELECT text FROM branches WHERE novel_id=X AND id='main'` 正文正确含新产出。
2. 主线再续写→ simulation stream 读 main 分支前文、prompt 含分支正文。
3. READING 页加载 → 选器显示 "主线"、内容显示 main 分支正文。
4. READING 切 IF 分支 → 内容变 IF 分支正文。
5. 旧小说（无 main 分支 rows）→ 写保存首次触发 `ensureMainBranch` 兜底 → 修复后的保存成功。

- [ ] **Step 4: commit final notes（可选）**

无源码改动，不 commit。

---

## Self-Review

- **Spec 覆盖**：Task 2 覆盖 writer/save、Task 3 覆盖 novels GET、Task 4 覆盖 stream、Task 5 覆盖 workspace 前传端、Task 6 覆盖 READ。deprecated 标记在 Task 1。
- **Placeholder**：无 TBD/TODO。全部代码完整。
- **类型一致**：`getBranch(userId, novelId, branchId)` 签名在 Spec A 已改（Task 1-3），Spec B 复用一致。
