# Agent Prompt Management Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone admin page at `/admin` where users can view and edit LLM agent prompts (system prompt + user prompt template) for all 13 agents in the system.

**Architecture:** Independent `/admin` route with its own state management, separate from the main app step flow. A `agent_prompts` SQLite table stores only user-modified prompts; unmodified agents continue using hardcoded defaults (progressive migration, zero performance impact for unchanged agents). Simple password gate via `ADMIN_PASSWORD` env var with in-memory session token.

**Tech Stack:** Next.js 14 App Router, React (client component), better-sqlite3, Tailwind CSS, TypeScript

---

### Task 1: Agent Registry

**Files:**
- Create: `src/core/prompts/registry.ts`

- [ ] **Step 1: Create the agent metadata registry**

Define `AgentPromptMeta` interface and register all 13 agents with their ID, display name, description, category, available template variables, and bilingual status.

```typescript
export interface AgentPromptMeta {
  agentId: string;
  name: string;
  description: string;
  category: "extraction" | "simulation" | "review";
  variables: string[];
  bilingual: boolean;
}

export const AGENT_REGISTRY: AgentPromptMeta[] = [
  // Extraction (6 agents)
  {
    agentId: "character_list",
    name: "角色列表提取 (Pass 1)",
    description: "从小说中识别所有有名有姓的角色，提取名字、别名、角色定位",
    category: "extraction",
    variables: ["novelContext"],
    bilingual: true,
  },
  {
    agentId: "character_detail",
    name: "角色详情提取 (Pass 2)",
    description: "对单个角色进行深度剖析：性格、驱动力、行为模式、说话风格等",
    category: "extraction",
    variables: ["characterName", "characterBrief", "characterRole", "novelContext"],
    bilingual: true,
  },
  {
    agentId: "relationships",
    name: "关系网络提取 (Pass 3)",
    description: "分析角色之间的关系网络（类型、动态、历史）",
    category: "extraction",
    variables: ["characterNames", "novelContext"],
    bilingual: true,
  },
  {
    agentId: "chapter_end_states",
    name: "末章状态提取",
    description: "提取所有角色在小说完结时的最终状态快照",
    category: "extraction",
    variables: ["recentText", "knownNames"],
    bilingual: true,
  },
  {
    agentId: "story_info",
    name: "故事信息提取",
    description: "提取情节摘要、主线、章节概要、世界观设定、文风特点",
    category: "extraction",
    variables: ["novelContext"],
    bilingual: true,
  },
  {
    agentId: "timeline",
    name: "时间线提取",
    description: "提取小说的章节时间线和事件序列",
    category: "extraction",
    variables: ["novelContext", "fullText"],
    bilingual: true,
  },
  // Simulation (4 agents)
  {
    agentId: "outline_writer",
    name: "剧本大纲编写器",
    description: "导演在场景开始前编写完整剧本大纲：节拍、情感弧线、结局",
    category: "simulation",
    variables: ["sceneLocation", "sceneTimeOfDay", "sceneWeather", "sceneAtmosphere", "sceneInitialSituation", "sceneConflictType", "sceneStoryBeat", "sceneStakes", "charSummaries", "previousProse"],
    bilingual: true,
  },
  {
    agentId: "director",
    name: "导演/调度者",
    description: "每轮调度：选择焦点角色、情绪基调、节奏、冲突强度",
    category: "simulation",
    variables: ["characterDescriptions", "sceneLocation", "sceneTimeOfDay", "sceneWeather", "sceneAtmosphere", "sceneInitialSituation", "sceneNarrativeStyle", "outlineContext", "plotContext", "historyContext", "roundNumber"],
    bilingual: true,
  },
  {
    agentId: "character_agent",
    name: "角色扮演代理",
    description: "角色以第一人称参与即兴场景，产出对话、动作、内心想法",
    category: "simulation",
    variables: ["profile", "sceneDescription", "channelContext", "othersText", "historyText", "reactionHint"],
    bilingual: true,
  },
  {
    agentId: "recorder",
    name: "记录者/叙事者",
    description: "将导演调度和角色对话编织成优美的小说叙事文字",
    category: "simulation",
    variables: ["sceneNarrativeStyle", "writingStyle", "roundNumber", "channelReport", "previousProse", "directorGuide"],
    bilingual: true,
  },
  // Review (3 agents)
  {
    agentId: "continuity_reviewer",
    name: "连贯性审查员",
    description: "检查生成文字的逻辑断裂和事实错误：角色状态、因果链、时间线",
    category: "review",
    variables: ["draft", "timelineEvents", "characterStates"],
    bilingual: false,
  },
  {
    agentId: "character_reviewer",
    name: "角色一致性审查员",
    description: "检查角色行为、语言、动机是否符合角色设定",
    category: "review",
    variables: ["draft", "characterStates"],
    bilingual: false,
  },
  {
    agentId: "literary_reviewer",
    name: "文学品质审查员",
    description: "评价写作技艺：节奏、感官细节、对话质量、句式变化、展示vs讲述",
    category: "review",
    variables: ["draft", "writingStyle"],
    bilingual: false,
  },
];

export function getAgentMeta(agentId: string): AgentPromptMeta | undefined {
  return AGENT_REGISTRY.find((a) => a.agentId === agentId);
}

export function getAgentsByCategory(): Record<string, AgentPromptMeta[]> {
  const groups: Record<string, AgentPromptMeta[]> = {
    extraction: [],
    simulation: [],
    review: [],
  };
  for (const agent of AGENT_REGISTRY) {
    groups[agent.category].push(agent);
  }
  return groups;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit src/core/prompts/registry.ts`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/core/prompts/registry.ts
git commit -m "feat: add agent prompt registry with all 13 LLM agents"
```

---

### Task 2: Admin Auth Module

**Files:**
- Create: `src/core/prompts/admin-auth.ts`

- [ ] **Step 1: Create the auth module**

Shared module for password verification and request-level auth check. In-memory session token resets on server restart.

```typescript
import { NextRequest } from "next/server";

const ADMIN_SECRET = process.env.ADMIN_PASSWORD || "admin";
let activeToken: string | null = null;

export function verifyPassword(password: string): string | null {
  if (password !== ADMIN_SECRET) return null;
  activeToken = "admin_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  return activeToken;
}

export function isAdmin(req: NextRequest): boolean {
  const token = req.headers.get("x-admin-token");
  return token === activeToken && activeToken !== null;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit src/core/prompts/admin-auth.ts`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/core/prompts/admin-auth.ts
git commit -m "feat: add admin auth module with password verification"
```

---

### Task 3: DB Schema and CRUD Functions

**Files:**
- Modify: `src/lib/db.ts`

- [ ] **Step 1: Add agent_prompts table to initSchema**

Insert into `initSchema()` function's `db.exec()` call, before the closing backtick-quote (after `chapter_states` table):

```sql
CREATE TABLE IF NOT EXISTS agent_prompts (
  agent_id TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'zh',
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT DEFAULT 'extraction',
  system_prompt TEXT,
  user_prompt_template TEXT,
  is_modified INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (agent_id, language)
);
```

- [ ] **Step 2: Add agent_prompts CRUD functions at end of db.ts**

Add after the `getChapterStates` function:

```typescript
// ---- Agent Prompts ----

export interface AgentPromptRow {
  agent_id: string;
  language: string;
  name: string;
  description: string;
  category: string;
  system_prompt: string | null;
  user_prompt_template: string | null;
  is_modified: number;
  updated_at: string;
}

export function seedAgentPrompts(agents: { agentId: string; name: string; description: string; category: string }[]): void {
  const d = getDb();
  const insert = d.prepare(
    `INSERT OR IGNORE INTO agent_prompts (agent_id, language, name, description, category)
     VALUES (?, 'zh', ?, ?, ?)`
  );
  const tx = d.transaction(() => {
    for (const agent of agents) {
      insert.run(agent.agentId, agent.name, agent.description, agent.category);
    }
  });
  tx();
}

export function listAgentPrompts(): AgentPromptRow[] {
  const d = getDb();
  return d.prepare("SELECT * FROM agent_prompts WHERE language = 'zh' ORDER BY category, agent_id").all() as AgentPromptRow[];
}

export function getAgentPrompt(agentId: string, language: string): AgentPromptRow | null {
  const d = getDb();
  return (d.prepare("SELECT * FROM agent_prompts WHERE agent_id = ? AND language = ?").get(agentId, language) as AgentPromptRow) || null;
}

export function updateAgentPrompt(
  agentId: string,
  language: string,
  fields: { system_prompt?: string | null; user_prompt_template?: string | null }
): void {
  const d = getDb();
  const sets: string[] = ["is_modified = 1", "updated_at = datetime('now')"];
  const params: (string | null)[] = [];
  if (fields.system_prompt !== undefined) {
    sets.push("system_prompt = ?");
    params.push(fields.system_prompt);
  }
  if (fields.user_prompt_template !== undefined) {
    sets.push("user_prompt_template = ?");
    params.push(fields.user_prompt_template);
  }
  params.push(agentId, language);
  d.prepare(`UPDATE agent_prompts SET ${sets.join(", ")} WHERE agent_id = ? AND language = ?`).run(...params);
}

export function resetAgentPrompt(agentId: string, language: string): void {
  const d = getDb();
  d.prepare(
    `UPDATE agent_prompts SET system_prompt = NULL, user_prompt_template = NULL, is_modified = 0, updated_at = datetime('now')
     WHERE agent_id = ? AND language = ?`
  ).run(agentId, language);
}
```

Key design detail: `INSERT OR IGNORE` in seed ensures idempotency — re-running seed won't overwrite user modifications. `is_modified` stays 0 on seed; turns to 1 only on explicit `updateAgentPrompt()`.

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: Compiles successfully, no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat: add agent_prompts table and CRUD functions to DB"
```

---

### Task 4: Admin API Routes

**Files:**
- Create: `src/app/api/admin/auth/route.ts`
- Create: `src/app/api/admin/prompts/route.ts`

- [ ] **Step 1: Create auth API route**

`src/app/api/admin/auth/route.ts` — only exports `POST` (Next.js route handler pattern):

```typescript
import { NextRequest, NextResponse } from "next/server";
import { verifyPassword } from "@/core/prompts/admin-auth";

export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({}));
  const token = verifyPassword(password);
  if (!token) {
    return NextResponse.json({ error: "密码错误" }, { status: 401 });
  }
  return NextResponse.json({ token });
}
```

Important: `verifyPassword` is shared from the auth module, NOT defined inline. The `isAdmin` function is exported from the auth module so other routes can import it without conflicting with Next.js's route handler type constraints.

- [ ] **Step 2: Create prompts API route**

`src/app/api/admin/prompts/route.ts` — exports `GET`, `PUT`, `POST`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { listAgentPrompts, getAgentPrompt, updateAgentPrompt, resetAgentPrompt, seedAgentPrompts } from "@/lib/db";
import { AGENT_REGISTRY } from "@/core/prompts/registry";
import { isAdmin } from "@/core/prompts/admin-auth";

let seeded = false;

function ensureSeed() {
  if (seeded) return;
  seedAgentPrompts(
    AGENT_REGISTRY.map((a) => ({
      agentId: a.agentId,
      name: a.name,
      description: a.description,
      category: a.category,
    }))
  );
  seeded = true;
}

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }
  ensureSeed();
  const agentId = req.nextUrl.searchParams.get("agent");
  const lang = req.nextUrl.searchParams.get("lang") || "zh";

  if (agentId) {
    const row = getAgentPrompt(agentId, lang);
    if (!row) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    return NextResponse.json(row);
  }
  const rows = listAgentPrompts();
  return NextResponse.json(rows);
}

export async function PUT(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }
  const { agentId, language, systemPrompt, userPromptTemplate } = await req.json();
  if (!agentId || !language) {
    return NextResponse.json({ error: "缺少 agentId 或 language" }, { status: 400 });
  }
  updateAgentPrompt(agentId, language, {
    system_prompt: systemPrompt ?? null,
    user_prompt_template: userPromptTemplate ?? null,
  });
  return NextResponse.json({ success: true });
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }
  const { agentId, language } = await req.json();
  if (!agentId || !language) {
    return NextResponse.json({ error: "缺少 agentId 或 language" }, { status: 400 });
  }
  resetAgentPrompt(agentId, language);
  return NextResponse.json({ success: true });
}
```

API semantics:
- `GET /api/admin/prompts` — list all agents (zh only) with their modification status
- `GET /api/admin/prompts?agent=xxx&lang=zh` — get single agent's current prompts
- `PUT /api/admin/prompts` — save edited system_prompt and/or user_prompt_template
- `POST /api/admin/prompts` — reset an agent's prompts to default (NULL)

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: Compiles successfully. Verify `├ ƒ /api/admin/auth` and `├ ƒ /api/admin/prompts` appear in route output.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/
git commit -m "feat: add admin API routes for auth and prompt CRUD"
```

---

### Task 5: Admin Page UI

**Files:**
- Create: `src/app/admin/page.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add dark scrollbar CSS to globals.css**

Append after the existing `@layer base { ... }` block:

```css
/* Admin page dark scrollbar */
.custom-scrollbar::-webkit-scrollbar {
  width: 5px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #333;
  border-radius: 3px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: #555;
}
```

- [ ] **Step 2: Create PasswordGate component**

This is the first part of `src/app/admin/page.tsx`. The PasswordGate is a centered modal with orange-accented dark theme:

```typescript
"use client";

import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, Key, Save, RotateCcw, Terminal, Filter, Check, AlertCircle } from "lucide-react";

// ... AgentRow interface and CATEGORY_LABELS/CATEGORY_ICONS constants ...

function PasswordGate({ onUnlock }: { onUnlock: (token: string) => void }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      const data = await res.json();
      if (res.ok) {
        onUnlock(data.token);
      } else {
        setError(data.error || "验证失败");
      }
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#080808]/95 backdrop-blur-sm">
      <div className="w-full max-w-sm px-8 py-10 border border-neutral-800 rounded-lg bg-[#0e0e0e] shadow-2xl shadow-black/50">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-md bg-orange-600/20 border border-orange-600/40 flex items-center justify-center">
            <Terminal className="w-5 h-5 text-orange-500" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-neutral-200 font-mono tracking-wide">管理后台</h2>
            <p className="text-xs text-neutral-500">Agent 提示词管理</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-neutral-400 mb-1.5 font-mono">
              <Key className="w-3 h-3 inline mr-1.5 -mt-0.5" />
              请输入管理密码
            </label>
            <input
              type="password" value={pw} onChange={(e) => setPw(e.target.value)}
              className="w-full px-3 py-2 bg-[#1a1a1a] border border-neutral-700 rounded text-sm text-neutral-200 font-mono placeholder-neutral-600 focus:outline-none focus:border-orange-600 transition-colors"
              placeholder="······" autoFocus
            />
          </div>
          {error && (
            <p className="text-xs text-red-400 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {error}
            </p>
          )}
          <button type="submit" disabled={loading || !pw}
            className="w-full py-2 bg-orange-600 hover:bg-orange-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white text-sm font-mono rounded transition-colors">
            {loading ? "验证中..." : "进入后台"}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create AdminPage main component**

The `AdminPage` component handles token state, fetches agent list, and renders the sidebar + editor layout:

```typescript
export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedLang, setSelectedLang] = useState<"zh" | "en">("zh");
  const [currentPrompt, setCurrentPrompt] = useState<AgentRow | null>(null);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [userTemplate, setUserTemplate] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Restore session from sessionStorage on mount
  useEffect(() => {
    const stored = sessionStorage.getItem("admin_token");
    if (stored) setToken(stored);
  }, []);

  // Fetch agent list when token is available
  const fetchList = useCallback(async () => {
    if (!token) return;
    const res = await fetch("/api/admin/prompts", {
      headers: { "x-admin-token": token },
    });
    if (res.status === 401) {
      sessionStorage.removeItem("admin_token");
      setToken(null);
      return;
    }
    const data = await res.json();
    setAgents(data);
  }, [token]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // Fetch individual agent prompt when selection changes
  useEffect(() => {
    if (!selectedId || !token) return;
    (async () => {
      const res = await fetch(`/api/admin/prompts?agent=${selectedId}&lang=${selectedLang}`,
        { headers: { "x-admin-token": token } });
      if (res.ok) {
        const data = await res.json();
        setCurrentPrompt(data);
        setSystemPrompt(data.system_prompt || "");
        setUserTemplate(data.user_prompt_template || "");
      }
    })();
  }, [selectedId, selectedLang, token]);

  // Save handler
  const handleSave = async () => {
    if (!selectedId || !token) return;
    setSaving(true);
    setSaved(false);
    await fetch("/api/admin/prompts", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-admin-token": token },
      body: JSON.stringify({
        agentId: selectedId, language: selectedLang,
        systemPrompt: systemPrompt || null,
        userPromptTemplate: userTemplate || null,
      }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    fetchList();
  };

  // Reset handler
  const handleReset = async () => {
    if (!selectedId || !token) return;
    if (!confirm("确定要重置为默认提示词吗？所有修改将丢失。")) return;
    await fetch("/api/admin/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": token },
      body: JSON.stringify({ agentId: selectedId, language: selectedLang }),
    });
    setSystemPrompt("");
    setUserTemplate("");
    fetchList();
  };

  const handleUnlock = (t: string) => {
    sessionStorage.setItem("admin_token", t);
    setToken(t);
  };

  if (!token) return <PasswordGate onUnlock={handleUnlock} />;

  // Render sidebar (grouped by category) + editor
  // ... (see step 4 for layout)
}
```

- [ ] **Step 4: Render the sidebar + editor layout**

The JSX structure after the token check:

```tsx
const selectedMeta = agents.find((a) => a.agent_id === selectedId);
const grouped = agents.reduce((acc, a) => {
  const cat = a.category || "extraction";
  if (!acc[cat]) acc[cat] = [];
  acc[cat].push(a);
  return acc;
}, {} as Record<string, AgentRow[]>);

return (
  <div className="h-screen flex flex-col bg-[#0a0a0a] text-neutral-200 font-sans">
    {/* Top bar */}
    <header className="flex items-center justify-between px-6 py-3 border-b border-neutral-800/60 bg-[#0e0e0e] shrink-0">
      <div className="flex items-center gap-4">
        <a href="/" className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-300 transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> 返回主站
        </a>
        <span className="w-px h-4 bg-neutral-800" />
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-orange-500" />
          <h1 className="text-sm font-bold tracking-wider text-neutral-300 font-mono">AGENT PROMPT 管理</h1>
        </div>
      </div>
      <div className="flex items-center gap-3 text-[10px] text-neutral-600 font-mono">
        <span>{agents.length} agents</span>
        <span>|</span>
        <span>{agents.filter(a => a.is_modified).length} modified</span>
      </div>
    </header>

    <div className="flex flex-1 overflow-hidden">
      {/* Sidebar — 270px, grouped by category */}
      <aside className="w-[270px] shrink-0 border-r border-neutral-800/60 bg-[#0c0c0c] flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-800/40">
          <div className="flex items-center gap-1.5 text-[10px] text-neutral-500 font-mono uppercase tracking-widest">
            <Filter className="w-3 h-3" /> Agents
          </div>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {Object.entries(grouped).map(([cat, list]) => (
            <div key={cat} className="mb-1">
              <div className="px-4 py-2 text-[10px] text-neutral-500 font-mono uppercase tracking-widest">
                {CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat]}
              </div>
              {list.map(agent => (
                <button
                  key={agent.agent_id}
                  onClick={() => setSelectedId(agent.agent_id)}
                  className={`w-full text-left px-4 py-2.5 text-sm transition-colors border-l-2 ${
                    selectedId === agent.agent_id
                      ? "border-orange-500 bg-orange-500/5 text-neutral-200"
                      : "border-transparent hover:bg-neutral-800/30 text-neutral-400 hover:text-neutral-300"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate">{agent.name}</span>
                    {agent.is_modified ? (
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" title="已修改" />
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>
      </aside>

      {/* Editor area */}
      <main className="flex-1 flex flex-col overflow-hidden bg-[#0a0a0a]">
        {selectedMeta ? (
          <>
            {/* Editor header with language switcher */}
            <div className="px-6 py-3 border-b border-neutral-800/40 bg-[#0c0c0c] flex items-center justify-between shrink-0">
              <div>
                <h2 className="text-sm font-semibold text-neutral-300 font-mono">{selectedMeta.name}</h2>
                <p className="text-xs text-neutral-500 mt-0.5">{selectedMeta.description}</p>
              </div>
              <div className="flex rounded border border-neutral-700 overflow-hidden text-[10px] font-mono">
                {(["zh", "en"] as const).map(l => (
                  <button
                    key={l}
                    onClick={() => setSelectedLang(l)}
                    className={`px-2.5 py-1 transition-colors ${
                      selectedLang === l
                        ? "bg-neutral-700 text-neutral-200"
                        : "bg-transparent text-neutral-500 hover:text-neutral-300"
                    }`}
                  >
                    {l === "zh" ? "中文" : "EN"}
                  </button>
                ))}
              </div>
            </div>

            {/* Scrollable body with prompt textareas */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
              {/* System Prompt textarea */}
              <section>
                <label className="block text-[10px] text-neutral-500 font-mono uppercase tracking-widest mb-2">
                  System Prompt
                </label>
                <textarea
                  value={systemPrompt}
                  onChange={e => setSystemPrompt(e.target.value)}
                  className="w-full min-h-[220px] px-4 py-3 bg-[#111110] border border-neutral-800 rounded font-mono text-sm text-neutral-300 leading-relaxed resize-y focus:outline-none focus:border-orange-600/50 transition-colors placeholder-neutral-700"
                  placeholder="未修改 — 使用硬编码默认提示词"
                  spellCheck={false}
                />
                {currentPrompt?.system_prompt !== null && (
                  <p className="text-[10px] text-orange-500/70 mt-1.5 font-mono flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> 已自定义 — 将覆盖默认提示词
                  </p>
                )}
              </section>

              {/* User Prompt Template textarea */}
              <section>
                <label className="block text-[10px] text-neutral-500 font-mono uppercase tracking-widest mb-2">
                  User Prompt Template
                </label>
                <textarea
                  value={userTemplate}
                  onChange={e => setUserTemplate(e.target.value)}
                  className="w-full min-h-[180px] px-4 py-3 bg-[#111110] border border-neutral-800 rounded font-mono text-sm text-neutral-300 leading-relaxed resize-y focus:outline-none focus:border-orange-600/50 transition-colors placeholder-neutral-700"
                  placeholder="未修改 — 使用硬编码默认提示词"
                  spellCheck={false}
                />
              </section>

              {/* Variable reference */}
              <section className="border border-neutral-800/60 rounded bg-[#0c0c0c] p-4">
                <h3 className="text-[10px] text-neutral-500 font-mono uppercase tracking-widest mb-2">可用变量</h3>
                <code className="px-2 py-0.5 bg-[#1a1a1a] border border-neutral-700/50 rounded text-xs text-orange-400/80 font-mono">
                  {"{{变量名}}"}
                </code>
                <span className="text-xs text-neutral-600 ml-2">— 使用双花括号包裹变量名</span>
              </section>
            </div>

            {/* Footer with save/reset buttons */}
            <div className="px-6 py-3 border-t border-neutral-800/40 bg-[#0c0c0c] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 text-[10px] text-neutral-600 font-mono">
                <span>agent_id: <code className="text-neutral-500">{selectedMeta.agent_id}</code></span>
                {selectedMeta.is_modified
                  ? <span className="text-orange-500/60">· modified {selectedMeta.updated_at}</span>
                  : <span className="text-neutral-700">· default</span>
                }
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleReset}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-neutral-500 hover:text-red-400 border border-neutral-700 hover:border-red-500/30 rounded transition-colors font-mono">
                  <RotateCcw className="w-3 h-3" /> 重置默认
                </button>
                <button onClick={handleSave} disabled={saving}
                  className={`flex items-center gap-1.5 px-4 py-1.5 text-xs rounded transition-all font-mono ${
                    saved
                      ? "bg-green-600/20 border border-green-600/30 text-green-400"
                      : "bg-orange-600 hover:bg-orange-500 text-white border border-orange-600"
                  }`}>
                  {saved ? <><Check className="w-3 h-3" /> 已保存</> : saving ? "保存中..." : <><Save className="w-3 h-3" /> 保存修改</>}
                </button>
              </div>
            </div>
          </>
        ) : (
          /* Empty state */
          <div className="flex-1 flex items-center justify-center text-neutral-700">
            <div className="text-center">
              <Terminal className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-mono">选择一个 Agent 开始编辑</p>
            </div>
          </div>
        )}
      </main>
    </div>
  </div>
);
```

- [ ] **Step 5: Build and verify**

Run: `npm run build`
Expected: Compiles successfully. Verify `├ ○ /admin` appears with static page size in route output. Also verify `├ ƒ /api/admin/auth` and `├ ƒ /api/admin/prompts` appear.

- [ ] **Step 6: Manual smoke test**

Run: `npm run dev`
Navigate to `http://localhost:3000/admin`
Expected: Password gate appears. Enter default password `admin`. Agent list loads. Click an agent. Textareas are empty (default state). Enter text, save. Verify green "已保存" flash. Reload page, re-enter password, select agent — verify modified text persists. Reset — verify textareas clear.

- [ ] **Step 7: Commit**

```bash
git add src/app/admin/ src/app/globals.css
git commit -m "feat: add admin page with dark terminal UI for agent prompt management"
```

---

## Self-Review

### 1. Spec coverage
- ✅ Agent prompt 注册表（13 个 Agent 元数据）→ Task 1
- ✅ agent_prompts 数据表 → Task 3
- ✅ 管理页面 UI（侧栏 + 编辑器）→ Task 5
- ✅ 密码验证 → Tasks 2 + 4
- ✅ API CRUD → Task 4
- ✅ 保存/重置功能 → Task 5
- ✅ 语言切换 (zh/en) → Task 5
- ✅ 变量提示 → Task 5
- ✅ 暗色终端风格视觉 → Task 5

### 2. Placeholder scan
- ✅ 无 TBD/TODO
- ✅ 所有代码步骤包含完整实现代码
- ✅ 所有命令包含预期输出

### 3. Type consistency
- ✅ `AgentPromptMeta` 在 Task 1 定义，Task 4 中通过 `AGENT_REGISTRY.map()` 消费
- ✅ `AgentPromptRow` 在 Task 3 定义，Task 5 中通过 `useState<AgentRow[]>` 消费（接口名一致）
- ✅ `isAdmin` 在 Task 2 定义，Task 4 的 prompts route 导入
- ✅ `verifyPassword` 在 Task 2 定义，Task 4 的 auth route 导入
- ✅ `seedAgentPrompts`、`updateAgentPrompt` 等在 Task 3 定义，Task 4 导入
