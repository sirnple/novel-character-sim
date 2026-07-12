# Agent Panel 分支绑定 + 主线分支 + 子 agent tool-loop 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 agent panel 续写完全绑定分支——前端只传 branchId+novelId，主编/子 agent 通过统一一套"分支查询工具"自己查 DB；子 agent 改用 chatWithTools 跑 tool-loop；导入小说即落库 id="main" 的主线分支。

**Architecture:** branches 表重建 PK 为 `(novel_id, id, user_id)` 以允许多部小说各自 id="main"。新增 5 个分支查询工具（双参 novelId+branchId）下线旧 data-tools。抽出共享 `runToolLoop` 供主编 route 与子 agent 复用。前端 `agent-panel` 只发标识符不发正文，layout/write 串一个非 null activeBranchId。

**Tech Stack:** Next.js 14 App Router · TypeScript · better-sqlite3 · OpenAI/Anthropic provider · SSE streaming · React。

---

## File Structure

**新增**
- `src/core/agents/agents/branch-tools.ts` — 5 个分支查询 `ToolDefinition`。
- `src/core/agents/tool-loop.ts` — 共享 `runToolLoop(llm, conversation, tools, ctx, onChunk)`。

**修改**
- `src/lib/db.ts` — branches 重建 PK 改 `novel_id`；新增 `ensureMainBranch`/`getBranchByNovelAndId`；`getBranch`/`appendBranchContent`/`saveBranch` 签名加 `novelId`。
- `src/core/agents/types.ts` — `ToolContext`/`AgentContext` 改为 `{ novelId, branchId, userId, prompt }`。
- `src/core/agents/agents/data-tools.ts` — 删除旧工具导出（保留文件壳或删，留壳作旧参照不再注册）。
- `src/core/agents/init.ts` — 注册分支工具代替旧工具。
- `src/core/agents/agents/outline.ts` · `writer.ts` · `review.ts` — 改用 `runToolLoop`。
- `src/app/api/agent/chat/route.ts` — context 改 `{branchId,novelId,userId}`、SYSTEM_PROMPT 注入、loop 用 `runToolLoop`、runDataTool 旧路径整删（已并入主编 loop）。
- `src/app/api/novel/parse/route.ts` · `src/app/api/characters/extract/route.ts` — saveNovel 后调 `ensureMainBranch`。
- `src/app/api/branches/route.ts` · `src/app/api/writer/save/route.ts` — `getBranch`/`appendBranchContent`/`saveBranch` 调用补 `novelId`。
- `src/components/agent-panel.tsx` — props 加 `branchId/novelId`，body 只发标识符。
- `src/app/novel/[id]/layout.tsx` · `src/app/novel/[id]/write/page.tsx` — activeBranchId 串到 AgentPanel，主线默认 `"main"`。

---

## Task 1: branches 表重建 PK + 新增主线分支 DB 函数

**Files:**
- Modify: `src/lib/db.ts:170-181` (branches schema)、`src/lib/db.ts:32-55` (migrateOldData)、`src/lib/db.ts:536-585` (branch CRUD)

- [ ] **Step 1: 重建 branches schema 改 PK 含 novel_id**

`src/lib/db.ts` 第 170 行 CREATE TABLE branches 改为：

```ts
    CREATE TABLE IF NOT EXISTS branches (
      id TEXT NOT NULL,
      novel_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'guest',
      name TEXT NOT NULL DEFAULT '',
      parent_offset INTEGER NOT NULL DEFAULT 0,
      text TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (novel_id, id, user_id)
    );
```

- [ ] **Step 2: 在 migrateOldData 末尾加 branches 表重建迁移**

`src/lib/db.ts:32` 的 `migrateOldData(d)` 函数末尾（第 201 行的循环之后、`}` 之前）插入重建逻辑。新建的 branches 表已带新 PK（CREATE TABLE IF NOT EXISTS 不会重定义），所以只处理"老 PK 表尚存在"的情况：尝试 rename 旧表、create 新表、copy 数据。

```ts
  // Migrate branches table to (novel_id, id, user_id) PK so multiple novels can each have id="main".
  try {
    const cols = d.prepare("PRAGMA table_info(branches)").all() as { name: string }[];
    if (cols.length > 0) {
      d.exec(`ALTER TABLE branches RENAME TO branches_old_pk`);
      d.exec(`
        CREATE TABLE branches (
          id TEXT NOT NULL,
          novel_id TEXT NOT NULL,
          user_id TEXT NOT NULL DEFAULT 'guest',
          name TEXT NOT NULL DEFAULT '',
          parent_offset INTEGER NOT NULL DEFAULT 0,
          text TEXT NOT NULL DEFAULT '',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          PRIMARY KEY (novel_id, id, user_id)
        )
      `);
      d.exec(`
        INSERT INTO branches (id, novel_id, user_id, name, parent_offset, text, created_at, updated_at)
        SELECT id, novel_id, user_id, name, parent_offset, text, created_at, updated_at FROM branches_old_pk
      `);
      d.exec(`DROP TABLE branches_old_pk`);
      console.log("[DB] Migrated branches PK to (novel_id, id, user_id)");
    }
  } catch (e) {
    console.warn("[DB] branches migration skipped:", (e as Error).message);
  }
```

- [ ] **Step 3: 改 getBranch/saveBranch/appendBranchContent/getBranchByNovelAndId**

替换 `src/lib/db.ts:536-585` 整段为（新增 getBranchByNovelAndId、改 getBranch 加 novelId 入参）：

```ts
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
  novelId: string,
  branchId: string,
  newContent: string
): void {
  const d = getDb();
  const branch = d.prepare(
    "SELECT text FROM branches WHERE novel_id = ? AND id = ? AND user_id = ?"
  ).get(novelId, branchId, userId) as { text: string } | undefined;
  if (!branch) return;
  const combined = branch.text + "\n\n" + newContent;
  d.prepare(
    "UPDATE branches SET text = ?, updated_at = datetime('now') WHERE novel_id = ? AND id = ? AND user_id = ?"
  ).run(combined, novelId, branchId, userId);
}

export function getBranch(
  userId: string,
  novelId: string,
  branchId: string
): BranchRow | null {
  const d = getDb();
  return getBranchByNovelAndId(d, userId, novelId, branchId);
}

export function getBranchByNovelAndId(
  d: Database.Database,
  userId: string,
  novelId: string,
  branchId: string
): BranchRow | null {
  return d.prepare(
    "SELECT id, novel_id, name, parent_offset, text, created_at, updated_at FROM branches WHERE novel_id = ? AND id = ? AND user_id = ?"
  ).get(novelId, branchId, userId) as BranchRow | null;
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

export function ensureMainBranch(userId: string, novelId: string): void {
  const d = getDb();
  const existing = getBranchByNovelAndId(d, userId, novelId, "main");
  if (existing) return;
  const novel = getNovel(userId, novelId);
  const text = novel?.text || "";
  saveBranch(userId, "main", novelId, "主线", 0, text);
}
```

需在文件顶部 import 区确认已有 `import type Database from "better-sqlite3"` 或 `import { Database }`。如无，在 `src/lib/db.ts:1` 行附近补：

```ts
import type Database from "better-sqlite3";
```

- [ ] **Step 4: 更新 branches route 调用 补 novelId**

`src/app/api/branches/route.ts` 的 GET 里 `getBranch(userId, branchId)` 改为先取 `novelId` query 再调 `getBranch(userId, novelId, branchId)`。完整替换为：

```ts
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
    if (!novelId) return NextResponse.json({ error: "novelId required with branchId" }, { status: 400 });
    const branch = getBranch(userId, novelId, branchId);
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
    appendBranchContent(userId, novelId, branchId, content || "");
    const updated = getBranch(userId, novelId, branchId);
    return NextResponse.json({ success: true, branch: updated });
  }

  const id = branchId || `branch_${Date.now()}`;
  saveBranch(userId, id, novelId, name, parentOffset || 0, content || "");
  const branch = getBranch(userId, novelId, id);
  return NextResponse.json({ success: true, branch });
}
```

- [ ] **Step 5: 更新 writer/save route 调用补 novelId**

`src/app/api/writer/save/route.ts` 第 28 行的 `saveBranch(userId, id, novelId, branchName, parentOffset || 0, content)` 签名碰巧已含 novelId，无需改；但其中如有 `appendBranchContent(userId, branchId, content)` 调用须补 novelId。grep 之：

Run: `grep -n "appendBranchContent\|getBranch" src/app/api/writer/save/route.ts`
Expected: 列出调用行号。逐行补 novelId 入参（appendBranchContent 改为 `appendBranchContent(userId, novelId, branchId, content)`；getBranch 改 `getBranch(userId, novelId, branchId)`）。

- [ ] **Step 6: type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "lib/db|branches|writer/save" | head`
Expected: 无新增 error（baseline 50 行照旧但不含本步引入的 db 调用签名错误）。

- [ ] **Step 7: commit**

```bash
git add src/lib/db.ts src/app/api/branches/route.ts src/app/api/writer/save/route.ts
git commit -m "feat(db): branches PK adds novel_id, add ensureMainBranch + main branch CRUD"
```

---

## Task 2: 导入小说后创建主线分支

**Files:**
- Modify: `src/app/api/novel/parse/route.ts:133`、`src/app/api/characters/extract/route.ts:44`

- [ ] **Step 1: 在 parse route saveNovel 后调 ensureMainBranch**

`src/app/api/novel/parse/route.ts` 顶部 import 区加：

```ts
import { saveNovel, ensureMainBranch } from "@/lib/db";
```

（若 saveNovel 已 import 则只追加 ensureMainBranch）

第 133 行 `saveNovel(userId, novelId, title, novelText);` 后插入：

```ts
    saveNovel(userId, novelId, title, novelText);
    ensureMainBranch(userId, novelId);
```

- [ ] **Step 2: 在 extract route saveNovel 后调 ensureMainBranch**

`src/app/api/characters/extract/route.ts` 顶部 import 区追加 `ensureMainBranch`。第 44 行 `saveNovel(userId, novelId, parsed.title, text);` 后插入：

```ts
    saveNovel(userId, novelId, parsed.title, text);
    ensureMainBranch(userId, novelId);
```

- [ ] **Step 3: 手动验证（可选，dev DB 已有小说时）**

删除 `data/novels.db` 后跑 dev、上传新小说、`sqlite3 data/novels.db "SELECT id, novel_id, name FROM branches WHERE id='main'"` 应返回主线行。
**注意**：删 DB 是破坏性操作，仅在用户首肯时执行。否则跳过本步、用兜底逻辑覆盖。

- [ ] **Step 4: commit**

```bash
git add src/app/api/novel/parse/route.ts src/app/api/characters/extract/route.ts
git commit -m "feat: create main branch on novel import"
```

---

## Task 3: 抽出共享 runToolLoop

**Files:**
- Create: `src/core/agents/tool-loop.ts`

- [ ] **Step 1: 写 runToolLoop**

`src/core/agents/tool-loop.ts`：

```ts
import { getTool } from "./registry";
import { getAgent } from "./agent-registry";
import type { LLMProvider, LLMMessage, AssistantMessage, ToolSchema } from "@/types";
import type { ToolContext } from "./types";

export interface ToolLoopResult {
  finalText: string;
  trail: { role: "system" | "user" | "assistant"; content: string }[];
}

/**
 * Drive an LLM through chatWithTools, dispatching tool_use events to tools
 * (data tools) or sub-agents (via the "agent" tool) and feeding results back.
 * Reused by both the master route and sub-agents.
 */
export async function runToolLoop(
  llm: LLMProvider,
  conversation: LLMMessage[],
  tools: ToolSchema[],
  ctx: ToolContext,
  onChunk?: (text: string) => void
): Promise<ToolLoopResult> {
  let maxSteps = 15;
  while (maxSteps-- > 0) {
    let hasToolUse = false;
    let fullText = "";
    const eventStream = llm.chatWithTools(conversation, tools, { temperature: 0.4, maxTokens: 4096 });

    for await (const event of eventStream) {
      if (event.type === "text_delta") {
        fullText += event.text;
        if (onChunk) onChunk(fullText);
      } else if (event.type === "tool_use") {
        hasToolUse = true;
        const toolName = event.name;
        const toolId = event.id;
        const args = event.args as Record<string, any>;

        conversation.push({
          role: "assistant",
          content: [{ type: "tool_use", id: toolId, name: toolName, input: args }],
        } as AssistantMessage);

        const toolDef = getTool(toolName);
        if (toolDef) {
          let resultContent = "工具未注册或返回空";
          try {
            const r = await toolDef.execute({ ...args, novelId: ctx.novelId, branchId: ctx.branchId }, ctx, llm);
            resultContent = typeof r.content === "string" ? r.content : JSON.stringify(r.content);
            resultContent = resultContent.slice(0, 5000);
          } catch (e) {
            resultContent = "工具执行失败: " + (e as Error).message;
          }
          conversation.push({
            role: "user",
            content: [{ type: "tool_result", tool_use_id: toolId, content: resultContent }],
          });
        } else {
          conversation.push({
            role: "user",
            content: [{ type: "tool_result", tool_use_id: toolId, content: `未知工具: ${toolName}` }],
          });
        }
      }
    }

    if (!hasToolUse) break;
  }

  const trail = conversation
    .filter(m => m.role !== "tool")
    .map(m => ({
      role: m.role as "system" | "user" | "assistant",
      content: typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content) ? JSON.stringify(m.content).slice(0, 8000) : "",
    }));
  return { finalText: "", trail };
}

/** Drive a sub-agent: prepend its system prompt + user prompt, run loop, return final text + trail. */
export async function runSubAgentToolLoop(
  llm: LLMProvider,
  systemPrompt: string,
  userPrompt: string,
  tools: ToolSchema[],
  ctx: ToolContext,
  onChunk?: (text: string) => void
): Promise<ToolLoopResult> {
  const conversation: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
  return runToolLoop(llm, conversation, tools, ctx, onChunk);
}

// Re-export getAgent so callers can dispatch agent tools if needed.
export { getAgent };
```

note: `finalText` 留空字符串实属占位——chatWithTools 产出的 text_delta 经 onChunk 已实时转发，本循环不持有 final text。让 runSubAgentToolLoop 末尾不再依赖 finalText，返回的 finalText 不重要；onChunk 转给前端即可。

- [ ] **Step 2: 类型一致性确认**

`ToolContext` 当前是 `{ prompt; novelText; ... }`——本 plan Task 5 会改它。Task 3 此处先加 `import type { ToolContext }` 但 Task 5 才填字段；若 tsc 报 ctx.novelId 不存在暂可绕（先 cast ctx as any），下个 task 修正。为简化：Task 3 里直接 `import type { ToolContext }` 但行内 `ctx.novelId` 留作 Task 5 之后才 type-correct——为连续，写 `ctx as any` 适配：

将 runToolLoop 里 `const r = await toolDef.execute({ ...args, novelId: ctx.novelId, branchId: ctx.branchId }, ctx, llm);` 改为：

```ts
            const r = await toolDef.execute({ ...args, novelId: (ctx as any).novelId, branchId: (ctx as any).branchId }, ctx, llm);
```

- [ ] **Step 3: type-check (允许 baseline + 7 行未完成 ctx 时编译)**

Run: `npx tsc --noEmit 2>&1 | grep "tool-loop" | head`
Expected: 无关于 tool-loop.ts 的 error（其它 error 待后续 task 解决）。

- [ ] **Step 4: commit**

```bash
git add src/core/agents/tool-loop.ts
git commit -m "feat: shared runToolLoop for master route and sub-agents"
```

---

## Task 4: 改 ToolContext/AgentContext 精简为分支字段（类型前置）

**Files:**
- Modify: `src/core/agents/types.ts`

- [ ] **Step 1: 改 types**

替换 `src/core/agents/types.ts:18-46` 整段为：

```ts
export interface ToolContext {
  novelId: string;
  branchId: string;
  userId: string;
}

export interface ToolResult {
  content: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
}

export interface AgentDef {
  execute(ctx: AgentContext, llm: LLMProvider, onChunk?: (text: string) => void): Promise<ToolResult>;
}

export interface AgentContext {
  prompt: string;
  novelId: string;
  branchId: string;
  userId: string;
}
```

- [ ] **Step 2: 回到 tool-loop.ts 去掉 `as any`**

Task 3 Step 2 里写的 `(ctx as any).novelId`、`(ctx as any).branchId` 改回正常：

```ts
            const r = await toolDef.execute({ ...args, novelId: ctx.novelId, branchId: ctx.branchId }, ctx, llm);
```

- [ ] **Step 3: type-check（其它 consume 端未改、报错若干，下个 task 修）**

Run: `npx tsc --noEmit 2>&1 | grep -E "types\.ts|tool-loop" | head`
Expected: tool-loop.ts 与 types.ts 无 error。

- [ ] **Step 4: commit**

```bash
git add src/core/agents/types.ts src/core/agents/tool-loop.ts
git commit -m "refactor(agents): ToolContext/AgentContext shrink to branch fields"
```

---

## Task 5: 新增分支查询工具 + 下线旧 data-tools

**Files:**
- Create: `src/core/agents/agents/branch-tools.ts`
- Modify: `src/core/agents/agents/data-tools.ts`、`src/core/agents/init.ts`

- [ ] **Step 1: 写分支查询工具**

`src/core/agents/agents/branch-tools.ts`：

```ts
import type { ToolDefinition } from "../types";
import { getBranch, getCharacters, getTimeline, getStoryInfo } from "@/lib/db";

const TEXT_TAIL = 30000;

export const branchTools: ToolDefinition[] = [
  {
    name: "get_branch_text",
    description: "获取当前分支的正文尾部（最近若干字）作为续写起点。要求 novelsId+branchId 双参。",
    parameters: {
      type: "object",
      properties: {
        novelId: { type: "string", description: "小说 ID" },
        branchId: { type: "string", description: "分支 ID（主线为 main）" },
      },
      required: ["novelId", "branchId"],
    },
    execute: async (args, ctx) => {
      const branch = getBranch(ctx.userId, args.novelId, args.branchId);
      if (!branch) return { content: "分支不存在", messages: [] };
      const text = branch.text || "";
      return { content: text.slice(-TEXT_TAIL) || "无前文", messages: [] };
    },
  },
  {
    name: "get_branch_characters",
    description: "获取该小说的角色档案名 + 性格描述。按 novelId 查。要求 novelsId+branchId。",
    parameters: {
      type: "object",
      properties: {
        novelId: { type: "string", description: "小说 ID" },
        branchId: { type: "string", description: "分支 ID（主线为 main）" },
      },
      required: ["novelId", "branchId"],
    },
    execute: async (args, ctx) => {
      const chars = getCharacters(ctx.userId, args.novelId) || [];
      return {
        content: JSON.stringify(chars.map((c: any) => ({ name: c.name, desc: c.personality?.description?.slice(0, 200) })), null, 2),
        messages: [],
      };
    },
  },
  {
    name: "get_branch_timeline",
    description: "获取该小说的章节时间线。按 novelId 查。",
    parameters: {
      type: "object",
      properties: {
        novelId: { type: "string", description: "小说 ID" },
        branchId: { type: "string", description: "分支 ID（主线为 main）" },
      },
      required: ["novelId", "branchId"],
    },
    execute: async (args, ctx) => {
      const tl = getTimeline(ctx.userId, args.novelId);
      return { content: JSON.stringify((tl?.chapters || []).slice(-10), null, 2) || "无数据", messages: [] };
    },
  },
  {
    name: "get_branch_world",
    description: "获取该小说的世界观设定（来自 storyInfo.worldSetting）。",
    parameters: {
      type: "object",
      properties: {
        novelId: { type: "string", description: "小说 ID" },
        branchId: { type: "string", description: "分支 ID（主线为 main）" },
      },
      required: ["novelId", "branchId"],
    },
    execute: async (args, ctx) => {
      const info = getStoryInfo(ctx.userId, args.novelId);
      return { content: JSON.stringify(info?.worldSetting || {}, null, 2), messages: [] };
    },
  },
  {
    name: "get_branch_meta",
    description: "获取分支元信息：name/parent_offset/总字数。",
    parameters: {
      type: "object",
      properties: {
        novelId: { type: "string", description: "小说 ID" },
        branchId: { type: "string", description: "分支 ID（主线为 main）" },
      },
      required: ["novelId", "branchId"],
    },
    execute: async (args, ctx) => {
      const branch = getBranch(ctx.userId, args.novelId, args.branchId);
      if (!branch) return { content: "分支不存在", messages: [] };
      return {
        content: JSON.stringify({
          name: branch.name, parent_offset: branch.parent_offset,
          novel_id: branch.novel_id, total_chars: (branch.text || "").length,
        }, null, 2),
        messages: [],
      };
    },
  },
];
```

- [ ] **Step 2: 下线旧 data-tools**

清空 `src/core/agents/agents/data-tools.ts` 内容，替换为：

```ts
// Old data-tools (get_novel_context / get_characters / etc.) retired in favor of
// branch-tools.ts. Kept as a marker so imports elsewhere fail loudly at build time.
export const dataTools = [];
```

- [ ] **Step 3: 改 init.ts 注册分支工具**

打开 `src/core/agents/init.ts`，查看其注册 `dataTools` 与各 agent 的结构。run:

```bash
grep -n "dataTools\|register\|branchTools\|import" src/core/agents/init.ts
```

预期输出列每个 register 行。把 `dataTools` 的导入与 `register` 循环改为导入 `branchTools` 并注册。示例（按实际 init 形态调整）：

```ts
import { branchTools } from "./agents/branch-tools";
// ...
for (const t of branchTools) register(t);
// 删除原 for (const t of dataTools) register(t);
```

- [ ] **Step 4: type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "branch-tools|data-tools|init" | head`
Expected: 无 error（agent consume 端尚未适配、余 error 见下个 task）。

- [ ] **Step 5: commit**

```bash
git add src/core/agents/agents/branch-tools.ts src/core/agents/agents/data-tools.ts src/core/agents/init.ts
git commit -m "feat: branch query tools (novelId+branchId), retire data-tools"
```

---

## Task 6: 子 agent 改用 runToolLoop（outline/writer/review）

**Files:**
- Modify: `src/core/agents/agents/outline.ts` · `writer.ts` · `review.ts`
- Modify: `src/core/codex/review-orchestrator.ts`（review 收尾）

- [ ] **Step 1: outline agent 改 runSubAgentToolLoop**

替换 `src/core/agents/agents/outline.ts` 整文件为：

```ts
import type { AgentDef } from "../types";
import { renderPrompt } from "@/core/prompts/renderer";
import { runSubAgentToolLoop } from "../tool-loop";
import { branchTools } from "./branch-tools";

const BRANCH_TOOL_SCHEMAS = branchTools.map(t => ({
  name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown>,
}));

export const outlineAgent: AgentDef = {
  execute: async (ctx, llm, onChunk) => {
    const sys = renderPrompt("outline-system.md", {});
    const uc = `${ctx.prompt}\n\n## 当前绑定分支\nnovelId=${ctx.novelId}, branchId=${ctx.branchId}\n\n如需前文/角色/时间线，请调用 get_branch_* 工具自取（参数 novelId 与 branchId 同上）。`;
    const { trail } = await runSubAgentToolLoop(llm, sys, uc, BRANCH_TOOL_SCHEMAS, ctx, onChunk);
    const finalText = trail.filter(m => m.role === "assistant").pop()?.content || "";
    return {
      content: finalText,
      messages: trail,
    };
  },
};
```

- [ ] **Step 2: writer agent 改 runSubAgentToolLoop**

替换 `src/core/agents/agents/writer.ts` 整文件为：

```ts
import type { AgentDef } from "../types";
import { runSubAgentToolLoop } from "../tool-loop";
import { branchTools } from "./branch-tools";

const BRANCH_TOOL_SCHEMAS = branchTools.map(t => ({
  name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown>,
}));

export const writerAgent: AgentDef = {
  execute: async (ctx, llm, onChunk) => {
    const isRewrite = ctx.prompt.includes("修改") || ctx.prompt.includes("修复");
    const sys = isRewrite
      ? `你是小说审校编辑。你的任务是**精确修改**正文中的具体问题。\n## 铁律\n1. **只改列出的问题**。问题列表以外的一切，哪怕你觉得不好，也不准改\n2. **最小化改动**。改一个词能解决的，不改一句话；改一句能解决的，不改一段\n3. **禁止新增任何内容**。不添加新对话、新描写、新情节\n4. 输出完整正文，不要任何解释`
      : `你是小说执行写手。根据大纲创作正文。\n## 核心规则\n1. **严格遵循大纲**。大纲规定的场景顺序、事件因果、人物出场顺序，必须一一执行。不得跳过、不得重组、不得添加大纲中没有的场景\n2. **禁止创造事件**。大纲没写的新事件、新人物、新地点、新道具，一个字都不准加。你无权决定"发生了什么"\n3. **你的创造力用在文字上**：\n   - 环境氛围与感官细节（气味、光线、温度）\n   - 人物对话的节奏与措辞\n   - 心理活动的层次与分寸\n   - 动作描写的画面感\n4. **禁止编造原文未提及的设定**。所有人物关系、道具去向、已发生事件以原文为准\n5. 直接输出正文，不要写"以下是续写"之类的引导语`;

    const uc = `${ctx.prompt}\n\n## 当前绑定分支\nnovelId=${ctx.novelId}, branchId=${ctx.branchId}\n\n如需前文/角色/设定，请调用 get_branch_* 工具自取（参数同上）。直接输出正文。`;
    const { trail } = await runSubAgentToolLoop(llm, sys, uc, BRANCH_TOOL_SCHEMAS, ctx, onChunk);
    const finalText = trail.filter(m => m.role === "assistant").pop()?.content || "";
    return {
      content: finalText,
      messages: trail,
    };
  },
};
```

- [ ] **Step 3: review agent 改 runSubAgentToolLoop + chatWithTool 收尾**

替换 `src/core/agents/agents/review.ts` 整文件为：

```ts
import type { AgentDef } from "../types";
import { runSubAgentToolLoop } from "../tool-loop";
import { branchTools } from "./branch-tools";
import { extractJSON } from "@/lib/utils";

const BRANCH_TOOL_SCHEMAS = branchTools.map(t => ({
  name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown>,
}));

function makeReviewAgent(dimension: string, guideline: string): AgentDef {
  return {
    execute: async (ctx, llm) => {
      const sys = `${guideline}\n\n当前审查的分支为 novelId=${ctx.novelId}, branchId=${ctx.branchId}。如需原文或角色档案，调 get_branch_* 工具自取（参数同上）。`;
      const uc = `附在被审的内容下方，请审校：\n\n${ctx.prompt}\n\n审查完成后用 JSON 返回 findings 与 converged，无需其他文本。`;
      const { trail } = await runSubAgentToolLoop(llm, sys, uc, BRANCH_TOOL_SCHEMAS, ctx);
      const collected = trail.filter(m => m.role === "assistant").map(m => m.content).join("\n\n");
      let findings = [] as { dimension: string; severity: string; description: string; suggestion: string }[];
      let converged = true;
      try {
        const parsed = extractJSON<{ findings: any[]; converged: boolean }>(collected || "{}");
        converged = parsed.converged ?? parsed.findings.length === 0;
        findings = parsed.findings.map(f => ({
          dimension, severity: f.severity, description: f.description, suggestion: f.suggestion || "",
        }));
      } catch {
        converged = false;
        findings = [{ dimension, severity: "major", description: collected.slice(0, 500), suggestion: "" }];
      }
      const result = { converged, findings };
      return { content: JSON.stringify(result), messages: trail };
    },
  };
}

export const reviewCharacterAgent = makeReviewAgent("角色一致性", "你是角色一致性审查员。对照原文中角色的性格和说话方式，检查生成文字中是否有角色行为/语言偏离设定。");
export const reviewContinuityAgent = makeReviewAgent("连贯性", "你是连贯性审查员。检查生成文字是否与原文已建立的事实存在逻辑矛盾。");
export const reviewForeshadowingAgent = makeReviewAgent("伏笔", "你是伏笔追踪审查员。检查伏笔是否被合理推进或回收。");
export const reviewStyleAgent = makeReviewAgent("风格", "你是风格审查员。检查生成文字是否保持原文文风。");
export const reviewWorldAgent = makeReviewAgent("世界观", "你是世界观审查员。检查生成文字是否与原文世界观一致。");
export const reviewPacingAgent = makeReviewAgent("节奏", "你是节奏审查员。检查生成文字的叙事节奏是否合理。");
```

- [ ] **Step 4: 评估 review-orchestrator 是否受影响**

Run: `grep -rn "reviewCharacterConsistencyClean\|reviewContinuityClean\|makeReviewAgent" src/app src/core | head`
Expected: 仅 `review.ts` 与 orchestrator 自己的 export 行。orchestrator 里其它路径（runFullReviewClean 等）由 writing-workspace 调用，本 spec 不动 workspace；orchestrator 文件**不动**。若 review.ts 的旧实现的 awaiting 信号还从来查 orchestrator，已通过 Step 3 移除依赖——Confirm import 区无 residual `from "@/core/codex/review-orchestrator"`。

- [ ] **Step 5: type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "agents/agents/(outline|writer|review)" | head`
Expected: 无 error。

- [ ] **Step 6: commit**

```bash
git add src/core/agents/agents/outline.ts src/core/agents/agents/writer.ts src/core/agents/agents/review.ts
git commit -m "feat: outline/writer/review agents use runToolLoop + branch tools"
```

---

## Task 7: 主编 route 改用 runToolLoop + 分支 context

**Files:**
- Modify: `src/app/api/agent/chat/route.ts`

- [ ] **Step 1: 替换 route 整文件**

替换 `src/app/api/agent/chat/route.ts` 整文件为：

```ts
import { NextRequest } from "next/server";
import { createLLMProvider } from "@/core/llm/factory";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import { logSession } from "@/lib/session-log";
import { buildToolSchemas } from "@/core/agents/registry";
import { initRegistry } from "@/core/agents/init";
import { runToolLoop } from "@/core/agents/tool-loop";
import { getAgent } from "@/core/agents/agent-registry";
import type { LLMMessage, SystemMessage, ToolMessage, AssistantMessage, UserMessage } from "@/types";
import type { ToolContext } from "@/core/agents/types";

export const dynamic = "force-dynamic";

let initialized = false;
function ensureInit() { if (!initialized) { initRegistry(); initialized = true; } }

const SYSTEM_PROMPT_TPL = (branchId: string, novelId: string) => `你是小说创作主编。按以下流程工作。

## 当前绑定分支
- novelId = ${novelId}
- branchId = ${branchId}（"main" 代表主线，其他为 IF 分支）

## 续写流程
1. 必要时调 get_branch_text / get_branch_characters 等分支查询工具了解当前分支
2. 规划大纲: agent(agent_type="generate_outline")，prompt 里写用户要求 + 分支标识
3. 展示大纲等用户反馈。用户说"改"/"修改"重新调 generate_outline，"写"/"继续"/"确认"进入下一步
4. 写作: agent(agent_type="write_prose")，prompt 里放大纲 + 分支标识
5. 子 agent 自行调 get_branch_* 工具取所需信息

## 可用工具
- agent(agent_type, prompt): agent_type 可选 generate_outline, write_prose, review_character, review_continuity, review_foreshadowing, review_style, review_world, review_pacing
- 分支查询: get_branch_text, get_branch_characters, get_branch_timeline, get_branch_world, get_branch_meta（参数均为 novelId + branchId）

## 规则
- 一次一个工具
- 中文回复`;

export async function POST(request: NextRequest) {
  ensureInit();

  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "agent_chat", { windowMs: 60_000, maxRequests: 10 });
  if (!rate.allowed) return new Response(JSON.stringify({ error: rateLimitMessage(rate) }), { status: 429, headers: { "Content-Type": "application/json" } });

  const { messages, branchId, novelId } = await request.json();
  if (!branchId || !novelId) return new Response(JSON.stringify({ error: "branchId and novelId required" }), { status: 400, headers: { "Content-Type": "application/json" } });

  const llm = createLLMProvider();
  const encoder = new TextEncoder();
  const toolSchemas = buildToolSchemas();
  const ctx: ToolContext = { novelId, branchId, userId };

  const stream = new ReadableStream({
    async start(controller) {
      const signal = request.signal;
      const checkAbort = () => { if (signal.aborted) throw new Error("ABORTED"); };
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      const sendChunk = (text: string) => send({ type: "chunk", content: text });

      try {
        const conversation: LLMMessage[] = [
          { role: "system", content: SYSTEM_PROMPT_TPL(branchId, novelId) } as SystemMessage,
          ...messages.map((mRecord: any) => {
            if (mRecord.role === "tool" && mRecord.tool_call_id) {
              return { role: "tool", content: mRecord.content, tool_call_id: mRecord.tool_call_id } as ToolMessage;
            }
            if (mRecord.tool_calls) {
              return { role: "assistant", content: mRecord.content, tool_calls: mRecord.tool_calls } as AssistantMessage;
            }
            return { role: mRecord.role === "agent" ? "assistant" : mRecord.role, content: mRecord.content } as UserMessage | AssistantMessage;
          }),
        ];

        let maxAgentSteps = 15;
        while (maxAgentSteps-- > 0) {
          checkAbort();
          const stepConversation = [...conversation];
          const onChunkWrapped = (text: string) => sendChunk(text);

          let pendingAgentDispatch: { agentType: string; prompt: string; toolId: string } | null = null;
          let stepProducedText = false;

          const eventStream = llm.chatWithTools(stepConversation, toolSchemas, { temperature: 0.4, maxTokens: 4096 });
          for await (const event of eventStream) {
            if (event.type === "text_delta") {
              stepProducedText = true;
              sendChunk(event.text);
            } else if (event.type === "tool_use") {
              const toolName = event.name;
              const toolId = event.id;
              const args = event.args as Record<string, any>;
              conversation.push({
                role: "assistant",
                content: [{ type: "tool_use", id: toolId, name: toolName, input: args }],
              } as AssistantMessage);

              if (toolName === "agent") {
                pendingAgentDispatch = { agentType: args.agent_type, prompt: args.prompt, toolId };
              } else {
                // dispatch data tool via runToolLoop's shared path
                const toolCtx: ToolContext = { novelId, branchId, userId };
                const { default: getToolFromRegistry } = await import("@/core/agents/registry");
                const toolDef = getToolFromRegistry(toolName);
                let resultContent = `未知工具: ${toolName}`;
                if (toolDef) {
                  try {
                    const r = await toolDef.execute({ ...args, novelId, branchId }, toolCtx, llm);
                    resultContent = (typeof r.content === "string" ? r.content : JSON.stringify(r.content)).slice(0, 5000);
                  } catch (e) {
                    resultContent = "工具执行失败: " + (e as Error).message;
                  }
                }
                send({ type: "tool_call", tool: toolName, status: "done", toolCallId: toolId, result: resultContent, messages: [] });
                conversation.push({
                  role: "user",
                  content: [{ type: "tool_result", tool_use_id: toolId, content: resultContent }],
                });
              }
            }
          }

          if (pendingAgentDispatch) {
            checkAbort();
            const agentDef = getAgent(pendingAgentDispatch.agentType);
            if (!agentDef) throw new Error(`Unknown agent: ${pendingAgentDispatch.agentType}`);
            send({ type: "tool_call", tool: pendingAgentDispatch.agentType, status: "running", toolCallId: pendingAgentDispatch.toolId });
            let acc = "";
            const result = await agentDef.execute(
              { prompt: pendingAgentDispatch.prompt, novelId, branchId, userId },
              llm,
              (text) => { acc = text; send({ type: "tool_chunk", toolCallId: pendingAgentDispatch!.toolId, content: text, tool: pendingAgentDispatch!.agentType }); }
            );
            send({ type: "tool_call", tool: pendingAgentDispatch.agentType, status: "done", toolCallId: pendingAgentDispatch.toolId, result: result.content.slice(0, 5000), messages: result.messages });
            conversation.push({
              role: "user",
              content: [{ type: "tool_result", tool_use_id: pendingAgentDispatch.toolId, content: `子 agent 输出:\n${result.content.slice(0, 5000)}` }],
            });
          }

          if (!pendingAgentDispatch && !stepProducedText) break;
        }
      } catch (e) {
        if ((e as Error).message === "ABORTED") send({ type: "stopped" });
        else {
          logSession({ ts: new Date().toISOString(), type: "error", error: (e as Error).message });
          send({ type: "error", message: (e as Error).message });
        }
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
```

- [ ] **Step 2: 校验 import**

Task 7 Step 1 顶部 import 行已是真实路径（`@/types` 与 `@/core/agents/types`）。如手抄漏了再补。

- [ ] **Step 3: type-check**

Run: `npx tsc --noEmit 2>&1 | grep "api/agent/chat" | head`
Expected: 无 error。

- [ ] **Step 4: commit**

```bash
git add src/app/api/agent/chat/route.ts
git commit -m "feat: master chat route binds branchId+novelId, sub-agent dispatch via runToolLoop"
```

---

## Task 8: 前端 agent-panel 只发标识符

**Files:**
- Modify: `src/components/agent-panel.tsx`

- [ ] **Step 1: 加 branchId/novelId props + 改 body**

`src/components/agent-panel.tsx` 第 15-22 行 `AgentPanelProps` 加两个字段：

```ts
interface AgentPanelProps {
  novelTitle?: string;
  characters?: any[];
  novelText?: string;
  continueFromOffset?: number;
  continueFromLabel?: string;
  branchId?: string;
  novelId?: string;
  onOutlineGenerated?: (outline: any) => void;
}
```

解构处（约第 24 行）加 `branchId, novelId`：

```ts
export default function AgentPanel({ novelTitle, characters, novelText, continueFromOffset, continueFromLabel, branchId, novelId, onOutlineGenerated }: AgentPanelProps) {
```

`body: JSON.stringify({...})` 段（约第 54-62 行 buildOutgoingMessages 调用后的 context 字段）改为：

```ts
        body: JSON.stringify({
          messages: buildOutgoingMessages(messages, userMsg),
          branchId,
          novelId,
        }),
```

如 AgentPanel 之前把 `useNovel` 用来存 generatedProse，保留不动；仅移除 context 那行里 dump 的字段。

- [ ] **Step 2: type-check**

Run: `npx tsc --noEmit 2>&1 | grep "agent-panel" | head`
Expected: 无 error（layout 调用点未补 props、报 props 不全由下个 task 修）。

- [ ] **Step 3: commit**

```bash
git add src/components/agent-panel.tsx
git commit -m "feat(agent-panel): send branchId+novelId to /api/agent/chat, drop context dump"
```

---

## Task 9: 串 activeBranchId 到 AgentPanel

**Files:**
- Modify: `src/lib/novel-context.tsx`、`src/app/novel/[id]/layout.tsx`、`src/app/novel/[id]/write/page.tsx`

- [ ] **Step 1: novel-context 加 activeBranchId**

`src/lib/novel-context.tsx` 第 5-18 的 `NovelState` 增字段：

```ts
interface NovelState {
  novelId: string;
  novelTitle: string;
  novelText: string;
  characters: CharacterProfile[];
  storyInfo: StoryInfo | null;
  timeline: ChapterTimeline | null;
  lastChapterStates: CharacterChapterState[];
  branches: Branch[];
  activeBranchId?: string;
  sessionNovelText?: string;
  sessionContinueOffset?: number;
  sessionContinueLabel?: string;
  generatedProse?: string;
}
```

`NovelContextType` 加 `setActiveBranchId: (id: string | undefined) => void;`（紧跟 `setBranches` 行后）。

`DEFAULT` 不动（`activeBranchId` 可选）。在 NovelProvider 体里加：

```ts
const setActiveBranchId = useCallback((id: string | undefined) => {
  setState(prev => ({ ...prev, activeBranchId: id }));
}, []);
```

并把 Context value 改 `...state, setNovel, clearNovel, setCharacters, setStoryInfo, setTimeline, setBranches, setActiveBranchId, setNovelText`。

- [ ] **Step 2: write page 维护 activeBranchId**

`src/app/novel/[id]/write/page.tsx` 第 9 解构加 `setActiveBranchId`：

```ts
const { novelId, novelTitle, novelText, setNovelText, setNovel, generatedProse, setActiveBranchId } = useNovel();
```

第 21 行 `const activeBranchId` 是页面本地 useState——改为读 context 单一份源：删本地 `useState<string|null>`、用 `const activeBranchId = useNovel().activeBranchId || (queryOffset ? undefined : "main")`。

简化版方案（保留本地 state、但同步上 context）：在第 38-64 的 useEffect 各分支最后一行 setNovel 调用里追加 `setActiveBranchId(...)`：

```ts
if (activeBranchId && activeBranch) {
  setNovel({ sessionNovelText: activeBranch.text, ... });
  setActiveBranchId(activeBranchId);
} else if (freeMode) {
  setNovel({ ..., sessionContinueLabel: "自由创作" });
  setActiveBranchId(undefined);
} else {
  setNovel({ ..., sessionContinueLabel: undefined });
  setActiveBranchId("main");
}
```

主线按钮（约 117 行 onClick）把 `setActiveBranchId(null)` 改为 `setActiveBranchId("main")`。各 IF 分行按钮 onClick `setActiveBranchId(b.id)` 保持（b.id 即为 IF 分支 id）。自由模式 `setActiveBranchId(undefined)`。

注意 write page 第 11 行本地 `const [activeBranchId, setActiveBranchId] = useState<string | null>(null)` 仍存——为了保留本地 state、不和 context 重名冲突，把本地 setter 改名 `setLocalBranchId`：

```ts
const [activeBranchId, setLocalBranchId] = useState<string | null>(null);
```

第 38-64 的同步 useEffect 里其调用均用 setLocalBranchId 触发、然后追加 context 同步 `setActiveBranchId(...)`。

(若回过头更简：直接 `const activeBranchId = useContextActiveBranchId` 单源。 但保留本地简单些，按上处理。)

- [ ] **Step 3: layout 把 activeBranchId 传 AgentPanel**

`src/app/novel/[id]/layout.tsx` 第 13 解构加 `activeBranchId, novelId`：

```ts
const { novelTitle, novelText, characters, timeline, storyInfo, setNovel, setCharacters, setStoryInfo, setTimeline, sessionNovelText, sessionContinueOffset, sessionContinueLabel, activeBranchId, novelId } = useNovel();
```

第 137 行 AgentPanel 调用改为：

```ts
<AgentPanelWrapper novelTitle={novelTitle} novelText={sessionNovelText || novelText} characters={characters} continueFromOffset={sessionContinueOffset} continueFromLabel={sessionContinueLabel} branchId={activeBranchId} novelId={novelId} />
```

第 165 的 `AgentPanelWrapper` props 加 `branchId?: string`、`novelId?: string`，透传：

```ts
function AgentPanelWrapper({ novelTitle, novelText, characters, continueFromOffset, continueFromLabel, branchId, novelId }: { novelTitle?: string; novelText?: string; characters?: any[]; continueFromOffset?: number; continueFromLabel?: string; branchId?: string; novelId?: string }) {
  return <AgentPanel novelTitle={novelTitle} characters={characters} novelText={novelText} continueFromOffset={continueFromOffset} continueFromLabel={continueFromLabel} branchId={branchId} novelId={novelId} />;
}
```

- [ ] **Step 4: 兜底——write 页加载若 activeBranchId 未设，主线默认 "main"**

第 38 useEffect 之外、write page 顶部增加一个 effect：

```ts
useEffect(() => {
  if (!activeBranchId && !freeMode && !queryOffset) {
    setLocalBranchId("main");
    setActiveBranchId("main");
  }
}, [activeBranchId, freeMode, queryOffset, setActiveBranchId]);
```

(若已 setLocalBranchId("main") 的初始化足够，此 effect 可省——保留以防 UI 切换态空窗。)

- [ ] **Step 5: type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "novel-context|layout|write/page" | head`
Expected: 无 error。

- [ ] **Step 6: commit**

```bash
git add src/lib/novel-context.tsx src/app/novel/[id]/layout.tsx src/app/novel/[id]/write/page.tsx
git commit -m "feat: wire activeBranchId (default main) through context to AgentPanel"
```

---

## Task 10: end-to-end 手动验证

**Files:**
- 无改文件，验证行为

- [ ] **Step 1: 全量 type-check**

Run: `npx tsc --noEmit 2>&1 | wc -l`
Expected: ≤ 50（baseline；新增 0）。

- [ ] **Step 2: 构建冒烟**

Run: `npm run build 2>&1 | tail -20`
Expected: build 成功（Next 14 tsc-lint 之外、production build 通过）。

- [ ] **Step 3: dev 启动**

Run: `npm run dev`（用户已在 3000 端口跑；此步由用户手动）

- [ ] **Step 4: 场景验证**

在 agent panel 里：
1. 选主线 → 说"续写" → 主编读到 branchId=main；调 outline 子 agent；子 agent tool card 展开"对话记录"可见它调了 `get_branch_text` / `get_branch_characters` 等工具。
2. 子 agent 输出大纲后、回 yes 说"继续"进入 write_prose；writer 子 agent 同样可见 tool-loop。
3. 切到某 IF 分支后说"续写" → branchId 变为 IF id；主编 SYSTEM_PROMPT 注入正确；子 agent 查到 IF 分支的正文而非主线。
4. 旧小说（branches 里无 main 行）首次触发→ `ensureMainBranch` 兜底、续写通畅。

把异常贴回会话根因调查。

- [ ] **Step 5: commit final notes（可选）**

无源码改动、无需 commit。

---

## Self-Review 已盖 spec 范围

- §主线分支约定 id="main"+PK 含 novel_id → Task 1
- §分支查询工具双参 → Task 4
- §旧 data-tools 下线 → Task 4
- §子 agent tool-loop（含 review） → Task 6
- §共享 runToolLoop → Task 3
- §context 简化 + SYSTEM_PROMPT 注入 → Task 7
- §前端只传标识符 + activeBranchId 串 → Task 8+9
- §导入小说建主线 → Task 2
- §手动验证 → Task 10
- worldBible=storyInfo.worldSetting → Task 4 get_branch_world
- review 末尾用 chatWithTool 收 JSON → Task 6 Step 3（loop 后用 extractJSON 解析 assistant 聚合输出，等价收尾）