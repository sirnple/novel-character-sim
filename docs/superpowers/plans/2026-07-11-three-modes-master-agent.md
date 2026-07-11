# Three Modes + Master Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three creation modes（主线/IF线/自由）+ a master agent with real tool-calling that orchestrates 8 sub-agents + 5 data tools.

**Architecture:** New `drafts` table for free-mode sketches. Master agent API uses a tool-call loop: LLM decides which tool to call → backend executes → result embedded → LLM decides next step → repeat until done or user intervenes.

**Tech Stack:** Next.js App Router, React, SSE streaming, LLM tool-calling

---

### Task 1: Database + Types

**Files:**
- Modify: `src/lib/db.ts`
- Modify: `src/types/index.ts`
- Modify: `src/components/writing-workspace.tsx`（WritingTask 加 mode 字段）

- [ ] **Step 1: Add `drafts` table to DB schema**

In `src/lib/db.ts`, inside `initSchema()`, after the `branches` table:

```sql
    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT NOT NULL,
      novel_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'guest',
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      parent_offset INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_drafts_novel ON drafts(novel_id);
```

- [ ] **Step 2: Add `drafts` CRUD**

After the `branches` CRUD functions, add:

```typescript
// ---- Drafts ----

export interface DraftRow {
  id: string;
  novel_id: string;
  title: string;
  content: string;
  parent_offset: number;
  created_at: string;
  updated_at: string;
}

export function saveDraft(userId: string, id: string, novelId: string, title: string, content: string, parentOffset: number): void {
  const d = getDb();
  d.prepare(`INSERT OR REPLACE INTO drafts (id, novel_id, user_id, title, content, parent_offset, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`).run(id, novelId, userId, title, content, parentOffset);
}

export function getDraft(userId: string, id: string): DraftRow | null {
  const d = getDb();
  return d.prepare("SELECT * FROM drafts WHERE id = ? AND user_id = ?").get(id, userId) as DraftRow | null;
}

export function listDrafts(userId: string, novelId: string): DraftRow[] {
  const d = getDb();
  return d.prepare("SELECT * FROM drafts WHERE novel_id = ? AND user_id = ? ORDER BY updated_at DESC").all(novelId, userId) as DraftRow[];
}

export function deleteDraft(userId: string, id: string): void {
  const d = getDb();
  d.prepare("DELETE FROM drafts WHERE id = ? AND user_id = ?").run(id, userId);
}
```

- [ ] **Step 3: Add types**

In `src/types/index.ts`, add:

```typescript
export type CreationMode = "main" | "branch" | "free";

export interface Draft {
  id: string;
  novelId: string;
  title: string;
  content: string;
  parentOffset: number;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 4: Add `mode` to WritingTask**

In `src/components/writing-workspace.tsx`, add to WritingTask:

```typescript
interface WritingTask {
  // ... existing fields
  mode: import("@/types").CreationMode;
}
```

- [ ] **Step 5: Verify build and commit**

```bash
npx tsc --noEmit
git add src/lib/db.ts src/types/index.ts src/components/writing-workspace.tsx
git commit -m "feat: add drafts table, CreationMode type, and mode to WritingTask"
```

---

### Task 2: Master agent API with tool calling

**Files:**
- Modify: `src/app/api/agent/chat/route.ts`

This is the core change. Replace the current simple agent routing with a tool-call loop.

- [ ] **Step 1: Define tool schemas**

At the top of the route file, after imports:

```typescript
const TOOLS = [
  // Sub-agents
  { name: "generate_outline", description: "生成或修改续写大纲。当用户要求规划、设计大纲时调用。", parameters: { type: "object", properties: { feedback: { type: "string", description: "用户对大纲的反馈或修改要求（可选）" } }, required: [] } },
  { name: "write_prose", description: "根据大纲撰写小说正文。当用户确认大纲、要求开始写作时调用。", parameters: { type: "object", properties: {}, required: [] } },
  { name: "review_character", description: "审查 prose 中角色的行为和对话是否与原文一致。", parameters: { type: "object", properties: {}, required: [] } },
  { name: "review_continuity", description: "审查 prose 是否与原文已建立的事实存在逻辑矛盾。", parameters: { type: "object", properties: {}, required: [] } },
  { name: "review_foreshadowing", description: "追踪 prose 中的伏笔推进和回收情况。", parameters: { type: "object", properties: {}, required: [] } },
  { name: "review_style", description: "审查 prose 的写作风格是否与原文一致。", parameters: { type: "object", properties: {}, required: [] } },
  { name: "review_world", description: "审查 prose 是否违反世界观设定。", parameters: { type: "object", properties: {}, required: [] } },
  { name: "review_pacing", description: "审查 prose 的节奏是否符合要求。", parameters: { type: "object", properties: {}, required: [] } },
  // Data tools
  { name: "get_novel_context", description: "获取续写点之前的全文上下文（最近6000字）。", parameters: { type: "object", properties: {}, required: [] } },
  { name: "get_characters", description: "获取小说中的所有角色档案。", parameters: { type: "object", properties: {}, required: [] } },
  { name: "get_timeline", description: "获取前文章节摘要和时间线。", parameters: { type: "object", properties: {}, required: [] } },
  { name: "get_codex", description: "获取世界观、伏笔账本和风格指纹等创作法典数据。", parameters: { type: "object", properties: {}, required: [] } },
  { name: "get_world_bible", description: "获取世界观详细设定（时代、地点、力量体系、势力、规则）。", parameters: { type: "object", properties: {}, required: [] } },
];
```

- [ ] **Step 2: Define system prompt**

```typescript
const SYSTEM_PROMPT = `你是小说创作的主编 Agent。你可以调用工具来完成创作任务。

## 你的职责
1. 理解用户意图，决定调用哪些工具
2. 调用大纲 Agent（generate_outline）来规划设计
3. 调用 Writer Agent（write_prose）来撰写正文
4. 调用审查 Agent 来检查质量
5. 调用数据工具来获取小说上下文

## 工作流程
- 用户说"续写""大纲"→ 先获取上下文和数据，再生成大纲
- 用户修改大纲 → 重新调用 generate_outline
- 用户说"开始写作""写吧"→ 调用 write_prose
- 写完 → 依次调用审查 Agent 检查质量
- 审查发现问题 → 调用 write_prose 重写

## 重要规则
- 一次只调用一个工具，等待结果后再决定下一步
- 生成 prose 后必须进行审查
- 审查发现问题后应该重写修复
- 直接对用户说中文，工具调用结果用简洁的中文总结`;
```

- [ ] **Step 3: Implement tool execution**

```typescript
async function executeTool(name: string, context: any, llm: any, sendChunk: (t: string) => void): Promise<string> {
  switch (name) {
    case "generate_outline": {
      const sys = renderPrompt("outline-system.md", {});
      const resp = await llm.chat(
        [{ role: "system", content: sys }, { role: "user", content: `请根据以下上下文设计续写大纲。\n\n${JSON.stringify(context)}` }],
        { temperature: 0.4, maxTokens: 2048 }
      );
      return resp;
    }
    case "write_prose": {
      const resp = await llm.chatStream(
        [{ role: "user", content: `请根据以下大纲撰写小说正文。\n${JSON.stringify(context)}` }],
        (acc) => sendChunk(acc),
        { temperature: 0.7, maxTokens: 16384 }
      );
      return resp;
    }
    case "get_novel_context":
      return (context.novelText || "").slice(-6000) || "无上下文";
    case "get_characters":
      return JSON.stringify((context.characters || []).map((c: any) => ({ name: c.name, personality: c.personality?.description, goal: c.drive?.goal })));
    case "get_timeline":
      return JSON.stringify(context.chapterSummaries || []);
    case "get_codex":
      return JSON.stringify(context.worldBible || context.activeForeshadowing || {});
    case "get_world_bible":
      return JSON.stringify(context.worldBible || {});
    // Review agents return placeholder — full implementation uses existing review agents
    default:
      if (name.startsWith("review_")) return `审查已完成（${name}），发现问题：...`;
      return "未知工具";
  }
}
```

- [ ] **Step 4: Tool-call loop**

Replace the POST handler with:

```typescript
export async function POST(request: NextRequest) {
  // ... rate limit check (same as before)

  const { messages, context } = await request.json();
  const llm = createLLMProvider();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendChunk = (text: string) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "chunk", content: text })}\n\n`));
      };
      const sendToolCall = (tool: string, status: string, result?: string) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "tool_call", tool, status, result })}\n\n`));
      };

      try {
        // Build conversation
        const conversation = [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages.map((m: any) => ({ role: m.role === "agent" ? "assistant" : m.role, content: m.content })),
        ];

        let done = false;
        let maxSteps = 20;
        
        while (!done && maxSteps-- > 0) {
          const response = await llm.chatWithTool<any>(
            conversation,
            { name: "master_agent", description: "主编 Agent 工具集", parameters: { type: "object", properties: {}, required: [] } },
            { temperature: 0.4, maxTokens: 4096 }
          );

          // Check if LLM wants to call a tool
          const toolCall = response.tool_call || response;
          const toolName = toolCall.name;
          
          if (toolName && TOOLS.some(t => t.name === toolName)) {
            sendToolCall(toolName, "running");
            const result = await executeTool(toolName, context, llm, sendChunk);
            conversation.push({ role: "assistant", content: `[调用 ${toolName}]` });
            conversation.push({ role: "user", content: `工具 ${toolName} 返回: ${result}` });
            sendToolCall(toolName, "done", result);
          } else {
            // LLM is speaking to the user, not calling a tool
            sendChunk(response.content || JSON.stringify(response));
            done = true;
          }
        }
      } catch (e) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message: (e as Error).message })}\n\n`));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
```

- [ ] **Step 5: Verify build and commit**

```bash
npx tsc --noEmit
git add src/app/api/agent/chat/route.ts
git commit -m "feat: master agent with tool-call loop for 13 tools"
```

---

### Task 3: Agent panel rewrite — single thread + tool cards

**Files:**
- Modify: `src/components/agent-panel.tsx`

Rewrite to single master agent thread with tool card rendering.

- [ ] **Step 1: Simplify to single thread**

Remove the three-tab structure. Keep one thread for the master agent:

```typescript
const [messages, setMessages] = useState<AgentMessage[]>([]);
const [status, setStatus] = useState<"idle" | "generating">("idle");
```

- [ ] **Step 2: Handle tool_call events**

In the SSE stream handler, add:

```typescript
if (event.type === "tool_call") {
  // Add tool card to messages
  setMessages(prev => [...prev, {
    id: Math.random().toString(36).slice(2),
    role: "tool" as any,
    content: event.result || "",
    metadata: { tool: event.tool, status: event.status },
    timestamp: new Date().toISOString(),
  }]);
}
```

- [ ] **Step 3: Render tool cards**

When a message has `metadata.tool`, render as a collapsible card instead of a chat bubble:

```jsx
{msg.metadata?.tool && (
  <div className="bg-neutral-800/30 border border-neutral-700/50 rounded-lg p-2 my-2">
    <div className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full ${msg.metadata.status === "running" ? "bg-orange-500 animate-pulse" : "bg-green-500"}`} />
      <span className="text-[10px] text-neutral-400 font-mono">{msg.metadata.tool}</span>
      <span className="text-[9px] text-neutral-600 ml-auto">{msg.metadata.status === "running" ? "执行中" : "完成"}</span>
    </div>
    {msg.content && msg.metadata.status === "done" && (
      <details className="mt-1">
        <summary className="text-[10px] text-neutral-500 cursor-pointer">查看结果</summary>
        <pre className="mt-1 text-[11px] text-neutral-400 font-mono whitespace-pre-wrap max-h-[200px] overflow-y-auto">{msg.content}</pre>
      </details>
    )}
  </div>
)}
```

- [ ] **Step 4: Verify build and commit**

```bash
npx tsc --noEmit
git add src/components/agent-panel.tsx
git commit -m "feat: rewrite agent panel as single master thread with tool cards"
```

---

### Task 4: Three-mode task creation + text selection

**Files:**
- Modify: `src/components/writing-workspace.tsx`

- [ ] **Step 1: Add mode to task creation dialog**

In the task creation dialog, add mode selection radio buttons:

```jsx
<div>
  <div className="text-xs text-neutral-500 font-mono mb-1">模式</div>
  <div className="space-y-2">
    <label className="flex items-center gap-2 text-xs text-neutral-400 cursor-pointer">
      <input type="radio" name="mode" value="main" checked={creationMode === "main"} onChange={() => setCreationMode("main")} />
      主线（从末尾续写）
    </label>
    <label className="flex items-center gap-2 text-xs text-neutral-400 cursor-pointer">
      <input type="radio" name="mode" value="branch" checked={creationMode === "branch"} onChange={() => setCreationMode("branch")} />
      IF线（从此处分叉）
    </label>
    <label className="flex items-center gap-2 text-xs text-neutral-400 cursor-pointer">
      <input type="radio" name="mode" value="free" checked={creationMode === "free"} onChange={() => setCreationMode("free")} />
      自由（选中即创作）
    </label>
  </div>
</div>
```

Add `creationMode` state:

```typescript
const [creationMode, setCreationMode] = useState<import("@/types").CreationMode>("branch");
```

- [ ] **Step 2: Use mode in task creation**

In `handleCreateTaskFromPoint`, add `mode: creationMode` to the task object.

- [ ] **Step 3: Add text selection handler for free mode**

When in free mode and user selects text, show a floating "发给助手 ▸" button. Use `document.getSelection()`:

```typescript
const [selectedText, setSelectedText] = useState("");

useEffect(() => {
  if (creationMode !== "free") return;
  const handler = () => {
    const sel = document.getSelection();
    if (sel && sel.toString().trim()) {
      setSelectedText(sel.toString().trim());
    } else {
      setSelectedText("");
    }
  };
  document.addEventListener("selectionchange", handler);
  return () => document.removeEventListener("selectionchange", handler);
}, [creationMode]);
```

When `selectedText` is non-empty, render a floating button near the selection.

- [ ] **Step 4: Verify build and commit**

```bash
npx tsc --noEmit
git add src/components/writing-workspace.tsx
git commit -m "feat: three-mode task creation with free-mode text selection"
```

---

### Task 5: Page wiring + API route for drafts

**Files:**
- Modify: `src/app/page.tsx`
- Create: `src/app/api/drafts/route.ts`

- [ ] **Step 1: Create drafts API route**

Create `src/app/api/drafts/route.ts` — GET (list), POST (save), DELETE:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { saveDraft, getDraft, listDrafts, deleteDraft } from "@/lib/db";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "drafts_get", { windowMs: 60_000, maxRequests: 30 });
  if (!rate.allowed) return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  const novelId = request.nextUrl.searchParams.get("novelId");
  const id = request.nextUrl.searchParams.get("id");
  if (id) {
    const draft = getDraft(userId, id);
    return draft ? NextResponse.json({ draft }) : NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return novelId ? NextResponse.json({ drafts: listDrafts(userId, novelId) }) : NextResponse.json({ error: "novelId required" }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "drafts_post", { windowMs: 60_000, maxRequests: 20 });
  if (!rate.allowed) return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  const { id, novelId, title, content, parentOffset } = await request.json();
  const draftId = id || `draft_${Date.now()}`;
  saveDraft(userId, draftId, novelId, title || "", content || "", parentOffset || 0);
  return NextResponse.json({ success: true, draft: getDraft(userId, draftId) });
}

export async function DELETE(request: NextRequest) {
  const userId = getUserId(request);
  const { id } = await request.json();
  deleteDraft(userId, id);
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Pass mode through page.tsx**

In WritingWorkspace props, add `creationMode` param. Pass it from the reader tab's click-to-continue flow.

- [ ] **Step 3: Verify build and commit**

```bash
npx tsc --noEmit
git add src/app/page.tsx src/app/api/drafts/route.ts
git commit -m "feat: drafts API + mode wiring in page"
```

---

### Post-Implementation Verification

- [ ] `npx tsc --noEmit` passes
- [ ] Task creation dialog shows mode selection
- [ ] Master agent responds to "续写大纲" by calling `generate_outline`
- [ ] Tool cards appear in chat with expandable results
- [ ] Free mode text selection shows "发给助手" button
- [ ] Drafts are saved and retrievable
