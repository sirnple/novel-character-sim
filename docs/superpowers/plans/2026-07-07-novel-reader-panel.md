# Novel Reader Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the writer's right panel into a full novel reader that shows original text + generated prose, with save-on-parse and save-returns-full-text for immediate refresh.

**Architecture:** Four files changed. Two API routes (parse saves immediately, writer save returns updated full text), the writer workspace component (right panel becomes scrollable full-novel reader), and the parent page (wires novelText through). No new files, no schema changes.

**Tech Stack:** Next.js App Router, React, SQLite (better-sqlite3)

---

### Task 1: Save novel immediately on parse

**Files:**
- Modify: `src/app/api/novel/parse/route.ts`

- [ ] **Step 1: Add imports for saveNovel and novelFingerprint**

At the top of the file, after the existing imports, add:

```typescript
import { saveNovel } from "@/lib/db";
import { novelFingerprint } from "@/lib/utils";
```

The import block should now be:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { parseNovel } from "@/core/parser/novel-parser";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import { saveNovel } from "@/lib/db";
import { novelFingerprint } from "@/lib/utils";
import iconv from "iconv-lite";
import AdmZip from "adm-zip";
```

- [ ] **Step 2: Add saveNovel call after parsing**

After line 108 (`const parsed = parseNovel(novelText);`), add the save call:

```typescript
    const parsed = parseNovel(novelText);

    // Persist immediately so the novel survives page refresh
    const novelId = novelFingerprint(novelText);
    saveNovel(userId, novelId, title, novelText);

    return NextResponse.json({
```

- [ ] **Step 3: Verify the build compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: no new errors related to this file.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/novel/parse/route.ts
git commit -m "fix: save novel to DB on parse, not just on character extraction"
```

---

### Task 2: Writer save returns updated full text

**Files:**
- Modify: `src/app/api/writer/save/route.ts`

- [ ] **Step 1: Import getNovel from db**

Change the import line from:

```typescript
import { appendNovelContent, saveTimeline } from "@/lib/db";
```

to:

```typescript
import { appendNovelContent, getNovel } from "@/lib/db";
```

(Remove `saveTimeline` since it's unused.)

- [ ] **Step 2: Return fullText in the response**

Replace the success return (line 25):

```typescript
    // Append generated prose to the novel text
    appendNovelContent(userId, novelId, content);

    // Return the updated full text so the client can refresh its reader
    const updated = getNovel(userId, novelId);

    return NextResponse.json({ success: true, fullText: updated?.text || "" });
```

- [ ] **Step 3: Verify the build compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/writer/save/route.ts
git commit -m "feat: writer save returns updated fullText for client-side refresh"
```

---

### Task 3: Rewrite right panel as full novel reader

**Files:**
- Modify: `src/components/writing-workspace.tsx`

- [ ] **Step 1: Add new props and state**

Add `onNovelSaved` to the props interface. In `WritingWorkspaceProps` (line 8-21), add after `initialFullNovel`:

```typescript
interface WritingWorkspaceProps {
  novelId: string;
  novelTitle: string;
  characters: CharacterProfile[];
  scene: SceneDefinition;
  writingStyle?: WritingStyle;
  onSceneChange: (scene: SceneDefinition) => void;
  onBack: () => void;
  onComplete?: (fullNovel: string) => void;
  initialFullNovel?: string;
  onNovelSaved?: (fullText: string) => void;
  timeline?: ChapterTimeline | null;
  lastChapterStates?: CharacterChapterState[];
  storyInfo?: import("@/types").StoryInfo | null;
}
```

Add `savedToNovel` to `WritingTask` interface (line 23-38), after `status`:

```typescript
interface WritingTask {
  id: string;
  novelId: string;
  label: string;
  script: string;
  continueFrom: string;
  continueFromChapter: number;
  scene: SceneDefinition;
  output?: string;
  outline?: SceneOutline | null;
  outlinePrompt?: { system: string; user: string } | null;
  review?: ReviewReport | null;
  writerPrompt?: { systemPrompt: string; userPrompt: string } | null;
  status: "draft" | "writing" | "completed";
  savedToNovel?: boolean;
  createdAt: string;
}
```

Add destructuring of `onNovelSaved` in the component function signature (line 46-50):

```typescript
export default function WritingWorkspace({
  novelId, novelTitle, characters, scene, writingStyle,
  onSceneChange, onBack, onComplete, initialFullNovel,
  onNovelSaved,
  timeline, lastChapterStates, storyInfo,
}: WritingWorkspaceProps) {
```

- [ ] **Step 2: Add saveError state and readerRef**

After the existing state declarations (after line 72, before `const abortRef`), add:

```typescript
  const [saveError, setSaveError] = useState(false);
  const readerRef = useRef<HTMLDivElement>(null);
```

- [ ] **Step 3: Add auto-scroll effect**

After the existing effects (after line 111), add this new effect:

```typescript
  // Auto-scroll reader to bottom when novel content or output changes
  useEffect(() => {
    if (readerRef.current) {
      readerRef.current.scrollTop = readerRef.current.scrollHeight;
    }
  }, [initialFullNovel, outputText]);
```

- [ ] **Step 4: Load savedToNovel from task on task switch**

In the existing `useEffect` that loads active task state (lines 95-104), add saving of `savedToNovel`:

```typescript
  // Load active task into state
  useEffect(() => {
    if (!activeTask) return;
    setScriptText(activeTask.script || "");
    setOutputText(activeTask.output || "");
    setOutline(activeTask.outline || null);
    setOutlinePrompt(activeTask.outlinePrompt || null);
    setWriterPrompt(activeTask.writerPrompt || null);
    setReview(activeTask.review || null);
    setSaved(!!activeTask.savedToNovel);
    setSaveError(false);
    setStatus(activeTask.output ? "completed" : "idle");
  }, [activeTaskId]);
```

- [ ] **Step 5: Rewrite handleSave**

Replace the existing `handleSave` function (lines 384-399):

```typescript
  const handleSave = async () => {
    if (!outputText || !novelId) return;
    setSaving(true);
    setSaveError(false);
    try {
      const res = await fetch("/api/writer/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ novelId, content: outputText }),
      });
      if (res.ok) {
        const data = await res.json();
        setSaved(true);
        setSaveError(false);
        if (data.fullText && onNovelSaved) {
          onNovelSaved(data.fullText);
        }
        updateTask(activeTaskId!, { savedToNovel: true, status: "completed" });
      } else {
        setSaveError(true);
      }
    } catch {
      setSaveError(true);
    }
    setSaving(false);
  };
```

- [ ] **Step 6: Clear saveError when outputText changes**

In the `useEffect` that auto-saves script (line 107-110), add a companion effect that resets save state when output changes:

After line 111, insert:

```typescript
  // Reset save state when output changes
  useEffect(() => {
    setSaved(false);
    setSaveError(false);
  }, [outputText]);
```

- [ ] **Step 7: Rewrite the right panel JSX**

Replace the entire RIGHT panel section (lines 534-583) with the unified reader panel:

```jsx
      {/* RIGHT */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="bg-[#0c0c0c] border border-neutral-800/60 rounded-lg flex flex-col flex-1 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-800/40 bg-[#0e0e0e] shrink-0">
            <div className="flex items-center gap-3">
              <h3 className="text-[10px] font-semibold text-neutral-400 font-mono uppercase tracking-widest">小说正文</h3>
              {status === "completed" && !saved && <span className="text-[9px] text-orange-500/70 font-mono">有未保存内容</span>}
              {status === "completed" && saved && <span className="text-[9px] text-green-500/70 font-mono">已保存</span>}
              {status === "generating" && <span className="text-[9px] text-orange-500/70 font-mono flex items-center gap-1"><Loader2 className="w-2.5 h-2.5 animate-spin" />写作中...</span>}
            </div>
            <div className="flex items-center gap-3">
              {status === "completed" && !saved && (
                <button onClick={handleSave} disabled={saving}
                  className={`flex items-center gap-1 text-[10px] font-mono transition-colors ${saveError ? "text-red-400 hover:text-red-300" : "text-neutral-500 hover:text-green-400"}`}>
                  {saveError ? (
                    <><AlertCircle className="w-3 h-3 text-red-400" /> 保存失败，点击重试</>
                  ) : saving ? (
                    <><Loader2 className="w-3 h-3 animate-spin" /> 保存中...</>
                  ) : (
                    <><Save className="w-3 h-3" /> 保存为最新章节</>
                  )}
                </button>
              )}
              {status === "completed" && saved && (
                <span className="flex items-center gap-1 text-[10px] text-green-500 font-mono">
                  <Check className="w-3 h-3" /> 已保存
                </span>
              )}
              {outlinePrompt && <button onClick={() => setShowOutlinePrompt(!showOutlinePrompt)} className={`flex items-center gap-1 text-[10px] font-mono transition-colors ${showOutlinePrompt ? "text-neutral-300" : "text-neutral-500 hover:text-neutral-300"}`}>
                <ScrollText className="w-3 h-3" />大纲Prompt</button>}
              {review && <button onClick={() => setShowReview(!showReview)} className={`flex items-center gap-1 text-[10px] font-mono transition-colors ${showReview ? "text-green-400" : "text-neutral-500 hover:text-green-400"}`}>
                <Shield className="w-3 h-3" />审查 ({review.findings.length})</button>}
              {writerPrompt && <button onClick={() => setShowPrompt(!showPrompt)} className={`flex items-center gap-1 text-[10px] font-mono transition-colors ${showPrompt ? "text-neutral-300" : "text-neutral-500 hover:text-neutral-300"}`}>
                <ScrollText className="w-3 h-3" />Writer Prompt</button>}
              <button onClick={handleCopy} className="flex items-center gap-1 text-[10px] text-neutral-500 hover:text-neutral-300 font-mono">{copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}</button>
            </div>
          </div>

          {/* Reader body */}
          <div ref={readerRef} className="flex-1 overflow-y-auto custom-scrollbar">
            <div className="p-6">
              {!initialFullNovel && !outputText && status !== "generating" ? (
                <div className="flex items-center justify-center py-20">
                  <div className="text-center">
                    <Bot className="w-12 h-12 mx-auto mb-4 text-neutral-700 opacity-50" />
                    <p className="text-base text-neutral-500 font-mono">剧本已就绪</p>
                    <p className="text-sm text-neutral-700 mt-2">编辑左侧剧本后点击"开始写作"</p>
                    <p className="text-xs text-neutral-700 mt-1">也可以点击"AI 生成剧本"让大纲 Agent 自动生成大纲</p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Full novel text (read-only, scrollable) */}
                  {initialFullNovel && (
                    <div className="text-base text-neutral-200 leading-relaxed whitespace-pre-wrap font-serif max-w-[800px] mx-auto">
                      {initialFullNovel}
                    </div>
                  )}

                  {/* Unsaved generated prose */}
                  {outputText && !saved && (
                    <>
                      <div className="max-w-[800px] mx-auto my-6 flex items-center gap-3">
                        <div className="flex-1 h-px bg-orange-500/30" />
                        <span className="text-xs text-orange-500 font-mono bg-orange-500/10 px-2 py-0.5 rounded shrink-0">待保存</span>
                        <div className="flex-1 h-px bg-orange-500/30" />
                      </div>
                      <div className="text-base text-neutral-200 leading-relaxed whitespace-pre-wrap font-serif max-w-[800px] mx-auto bg-orange-500/[0.03] rounded-lg p-4 border border-orange-500/10">
                        {outputText}
                      </div>
                    </>
                  )}

                  {/* Loading spinner for generation in progress */}
                  {status === "generating" && !outputText && (
                    <div className="flex items-center justify-center py-20">
                      <div className="flex flex-col items-center gap-3">
                        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
                        <p className="text-sm text-neutral-500 font-mono">Writer 创作中...</p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            {showReview && review && <ReviewSection review={review} />}
            {showPrompt && writerPrompt && <PromptSection label="Writer Prompt" systemPrompt={writerPrompt.systemPrompt} userPrompt={writerPrompt.userPrompt} />}
            {showOutlinePrompt && outlinePrompt && <PromptSection label="大纲 Agent Prompt" systemPrompt={outlinePrompt.system} userPrompt={outlinePrompt.user} />}
          </div>
        </div>
        {error && <ErrorBanner error={error} onRetry={startWriting} />}
      </div>
```

- [ ] **Step 8: Verify no unused variables**

The `hasContent` variable (line 404) is no longer used after this change. Remove it:

Delete line 404:
```typescript
  const hasContent = !!outputText;
```

- [ ] **Step 9: Verify the build compiles**

Run: `npx tsc --noEmit 2>&1 | head -30`

Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/components/writing-workspace.tsx
git commit -m "feat: unify writer right panel into full novel reader with save-then-refresh"
```

---

### Task 4: Wire novelText through page.tsx

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Add handleNovelSaved callback**

After the `handleNovelParsed` function (after line 176), add:

```typescript
  const handleNovelSaved = (fullText: string) => {
    setNovelText(fullText);
  };
```

- [ ] **Step 2: Pass props to WritingWorkspace**

In the WritingWorkspace JSX (lines 727-739), add `initialFullNovel` and `onNovelSaved`:

```jsx
                  <WritingWorkspace
                    novelId={novelId}
                    novelTitle={novelTitle}
                    characters={characters}
                    scene={scene}
                    onSceneChange={setScene}
                    writingStyle={storyInfo?.writingStyle}
                    storyInfo={storyInfo}
                    onBack={() => {}}
                    onComplete={handleSimulationComplete}
                    initialFullNovel={novelText}
                    onNovelSaved={handleNovelSaved}
                    timeline={timeline}
                    lastChapterStates={lastChapterStates}
                  />
```

- [ ] **Step 3: Verify the build compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: pass novelText to WritingWorkspace and handle save-then-refresh"
```

---

### Post-Implementation Verification

- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] Upload a novel → parse succeeds → check `data/novels.db` has a row in the `novels` table
- [ ] Open a writing task → right panel shows full novel text
- [ ] Generate prose → prose appears below novel with orange "待保存" separator
- [ ] Click "保存为最新章节" → separator disappears, button shows "已保存", novel text refreshes
- [ ] Scroll up in the reader → can read previous chapters
- [ ] Refresh the page → novel is still in the sidebar library (was saved on parse)
- [ ] Save error simulation: stop the server, click save → red "保存失败，点击重试"
