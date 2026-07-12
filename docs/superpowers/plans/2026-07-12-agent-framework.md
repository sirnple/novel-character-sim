# Agent Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `executeTool` switch-case and prompt-injected JSON tool calling with a registry-based agent framework using native function calling.

**Architecture:** Two-layer registry — `ToolDefinition` for the main LLM's function list, `AgentDef` for sub-agent implementations. All agents share a single `agent` tool with `agent_type` + `prompt` parameters. Built-in tools (`get_characters`, etc.) are independent `ToolDefinition` entries. The LLM provider gains a streaming `chatWithTools` method that returns async generators of `StreamEvent` (text_delta | tool_use | done), wrapping native Anthropic `tool_use` / OpenAI `tool_calls`.

**Tech Stack:** Next.js 14 App Router, Anthropic SDK, OpenAI SDK, SSE

**Spec reference:** `docs/specs/agent-framework.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/core/agents/types.ts` | Create | ToolDefinition, ToolContext, ToolResult, AgentDef, StreamEvent |
| `src/core/agents/registry.ts` | Create | Tool registry (register/get/list/buildToolSchemas) |
| `src/core/agents/agent-registry.ts` | Create | Agent internal registry (registerAgent/getAgent/listAgents) |
| `src/core/agents/agents/data-tools.ts` | Create | 5 built-in tools (get_novel_context, get_characters, get_timeline, get_codex, get_world_bible) |
| `src/core/agents/agents/outline.ts` | Create | generate_outline agent |
| `src/core/agents/agents/writer.ts` | Create | write_prose agent |
| `src/core/agents/agents/review.ts` | Create | 6 review agents (character/continuity/foreshadowing/style/world/pacing) |
| `src/core/agents/init.ts` | Create | initRegistry() — register all tools and agents at startup |
| `src/core/llm/claude.ts` | Modify | Add chatWithTools using Anthropic native tool_use |
| `src/core/llm/openai.ts` | Modify | Add chatWithTools using OpenAI native tool_calls |
| `src/types/index.ts` | Modify | Add StreamEvent to LLMProvider, update ToolSchema |
| `src/app/api/agent/chat/route.ts` | Rewrite | Use registry + chatWithTools, thin ReAct loop |
| `src/app/api/agent/run/route.ts` | Create | Direct agent call API |
| `src/components/agent-panel.tsx` | Modify | Handle `thinking` SSE event |

---

### Task 1: Core Types

**Files:**
- Create: `src/core/agents/types.ts`
- Modify: `src/types/index.ts:360-383`

- [ ] **Step 1: Create `src/core/agents/types.ts` with all agent framework types**

```typescript
import type { LLMProvider } from "@/types";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required: string[];
  };
  execute(args: Record<string, any>, ctx: ToolContext, llm: LLMProvider, onChunk?: (text: string) => void): Promise<ToolResult>;
}

export interface ToolContext {
  novelText: string;
  novelTitle?: string;
  characters: any[];
  timeline?: any;
  worldBible?: any;
  continueFromOffset?: number;
  continueFromLabel?: string;
}

export interface ToolResult {
  content: string;
  messages: { role: "user" | "assistant"; content: string }[];
}

export interface AgentDef {
  execute(ctx: AgentContext, llm: LLMProvider, onChunk?: (text: string) => void): Promise<ToolResult>;
}

export interface AgentContext {
  prompt: string;
  novelText: string;
  novelTitle?: string;
  characters: any[];
  timeline?: any;
  worldBible?: any;
  continueFromOffset?: number;
  continueFromLabel?: string;
}

// Stream events for chatWithTools
export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; id: string; name: string; args: Record<string, any> }
  | { type: "done" };
```

- [ ] **Step 2: Update `src/types/index.ts` — add chatWithTools to LLMProvider interface**

In `src/types/index.ts`, find the `LLMProvider` interface (around line 360). Add the `chatWithTools` method:

```typescript
import type { StreamEvent } from "@/core/agents/types";

export interface LLMProvider {
  chat(
    messages: LLMMessage[],
    options?: { model?: string; maxTokens?: number; temperature?: number }
  ): Promise<string>;

  chatWithTool<T>(
    messages: LLMMessage[],
    toolSchema: ToolSchema,
    options?: { model?: string; maxTokens?: number; temperature?: number }
  ): Promise<T>;

  chatStream(
    messages: LLMMessage[],
    onChunk: (text: string) => void,
    options?: { model?: string; maxTokens?: number; temperature?: number }
  ): Promise<string>;

  chatWithTools(
    messages: LLMMessage[],
    tools: ToolSchema[],
    options?: { model?: string; maxTokens?: number; temperature?: number }
  ): AsyncGenerator<StreamEvent>;
}
```

- [ ] **Step 3: TypeScript check**

Run: `npx tsc --noEmit`
Expected: FAIL — ClaudeProvider and OpenAIProvider don't implement `chatWithTools` yet.

- [ ] **Step 4: Commit**

```bash
git add src/core/agents/types.ts src/types/index.ts
git commit -m "feat: add agent framework types and chatWithTools to LLMProvider"
```

---

### Task 2: Tool Registry + Agent Registry

**Files:**
- Create: `src/core/agents/registry.ts`
- Create: `src/core/agents/agent-registry.ts`

- [ ] **Step 1: Create `src/core/agents/registry.ts`**

```typescript
import type { ToolDefinition } from "./types";

const toolMap = new Map<string, ToolDefinition>();

export function register(def: ToolDefinition): void {
  if (toolMap.has(def.name)) {
    throw new Error(`Tool "${def.name}" is already registered`);
  }
  toolMap.set(def.name, def);
}

export function getTool(name: string): ToolDefinition | undefined {
  return toolMap.get(name);
}

export function listTools(): ToolDefinition[] {
  return Array.from(toolMap.values());
}

export function buildToolSchemas() {
  return listTools().map(def => ({
    name: def.name,
    description: def.description,
    parameters: def.parameters,
  }));
}
```

- [ ] **Step 2: Create `src/core/agents/agent-registry.ts`**

```typescript
import type { AgentDef } from "./types";

const agentMap = new Map<string, AgentDef>();

export function registerAgent(type: string, def: AgentDef): void {
  if (agentMap.has(type)) {
    throw new Error(`Agent "${type}" is already registered`);
  }
  agentMap.set(type, def);
}

export function getAgent(type: string): AgentDef | undefined {
  return agentMap.get(type);
}

export function listAgentTypes(): string[] {
  return Array.from(agentMap.keys());
}
```

- [ ] **Step 3: TypeScript check**

Run: `npx tsc --noEmit`
Expected: PASS (no new imports of unimplemented interfaces)

- [ ] **Step 4: Commit**

```bash
git add src/core/agents/registry.ts src/core/agents/agent-registry.ts
git commit -m "feat: add tool registry and agent registry"
```

---

### Task 3: Built-in Data Tools

**Files:**
- Create: `src/core/agents/agents/data-tools.ts`

- [ ] **Step 1: Create `src/core/agents/agents/data-tools.ts`**

```typescript
import type { ToolDefinition, ToolContext } from "../types";

export const dataTools: ToolDefinition[] = [
  {
    name: "get_novel_context",
    description: "获取续写点之前的上下文。返回最近前文。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => ({
      content: (ctx.novelText || "").slice(-6000) || "无前文",
      messages: [],
    }),
  },
  {
    name: "get_characters",
    description: "获取角色档案。返回角色名和性格描述。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => ({
      content: JSON.stringify(
        (ctx.characters || []).map((c: any) => ({
          name: c.name,
          desc: c.personality?.description?.slice(0, 150),
        })),
        null, 2
      ),
      messages: [],
    }),
  },
  {
    name: "get_timeline",
    description: "获取前文章节摘要。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => ({
      content: JSON.stringify(
        (ctx.timeline?.chapters || []).slice(-10),
        null, 2
      ) || "无数据",
      messages: [],
    }),
  },
  {
    name: "get_codex",
    description: "获取创作法典数据。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => ({
      content: JSON.stringify(
        { world: ctx.worldBible || {}, foreshadowing: [] },
        null, 2
      ),
      messages: [],
    }),
  },
  {
    name: "get_world_bible",
    description: "获取世界观设定。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => ({
      content: JSON.stringify(ctx.worldBible || {}, null, 2),
      messages: [],
    }),
  },
];
```

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/core/agents/agents/data-tools.ts
git commit -m "feat: add built-in data tools"
```

---

### Task 4: Outline Agent

**Files:**
- Create: `src/core/agents/agents/outline.ts`

- [ ] **Step 1: Create `src/core/agents/agents/outline.ts`**

```typescript
import type { AgentDef, AgentContext } from "../types";
import type { LLMProvider } from "@/types";
import { renderPrompt } from "@/core/prompts/renderer";

export const outlineAgent: AgentDef = {
  execute: async (ctx, llm) => {
    const sys = renderPrompt("outline-system.md", {});
    const prevText = (ctx.novelText || "").slice(-3000);
    const uc = `${ctx.prompt}\n\n## 续写点\n${ctx.continueFromLabel || "未知"}\n\n## 最近前文\n${prevText}`;
    const r = await llm.chat(
      [{ role: "system", content: sys }, { role: "user", content: uc }],
      { temperature: 0.4, maxTokens: 2048 }
    );
    return {
      content: r,
      messages: [
        { role: "user", content: uc.slice(0, 1500) },
        { role: "assistant", content: r },
      ],
    };
  },
};
```

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/core/agents/agents/outline.ts
git commit -m "feat: add outline agent"
```

---

### Task 5: Writer Agent

**Files:**
- Create: `src/core/agents/agents/writer.ts`

- [ ] **Step 1: Create `src/core/agents/agents/writer.ts`**

```typescript
import type { AgentDef, AgentContext } from "../types";

export const writerAgent: AgentDef = {
  execute: async (ctx, llm, onChunk) => {
    let prose = "";
    const prevText = (ctx.novelText || "").slice(-5000);
    const uc = `${ctx.prompt}\n\n## 前文\n${prevText}\n\n直接输出正文，不要JSON包裹。`;
    if (onChunk) {
      await llm.chatStream(
        [{ role: "user", content: uc }],
        (acc) => { prose = acc; onChunk(acc); },
        { temperature: 0.7, maxTokens: 16384 }
      );
    } else {
      prose = await llm.chat(
        [{ role: "user", content: uc }],
        { temperature: 0.7, maxTokens: 16384 }
      );
    }
    return {
      content: prose,
      messages: [
        { role: "user", content: uc.slice(0, 800) },
        { role: "assistant", content: prose.slice(0, 500) + "..." },
      ],
    };
  },
};
```

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/core/agents/agents/writer.ts
git commit -m "feat: add writer agent"
```

---

### Task 6: Review Agents

**Files:**
- Create: `src/core/agents/agents/review.ts`

- [ ] **Step 1: Create `src/core/agents/agents/review.ts`**

```typescript
import type { AgentDef, AgentContext } from "../types";
import type { LLMProvider } from "@/types";
import {
  reviewCharacterConsistencyClean,
  reviewContinuityClean,
  reviewForeshadowingClean,
  reviewStyleClean,
  reviewWorldBuildingClean,
  reviewPacingClean,
} from "@/core/codex/review-orchestrator";

type ReviewFn = typeof reviewCharacterConsistencyClean;

function makeReviewAgent(fn: ReviewFn): AgentDef {
  return {
    execute: async (ctx, llm) => {
      const fullText = (ctx.novelText || "").slice(0, 50000);
      const reviewTarget = ctx.prompt || (ctx.novelText || "").slice(-8000);
      const zh = /[一-鿿]/.test(fullText.slice(0, 1000));
      const r = await fn(fullText, reviewTarget, llm, zh);
      const summary = r.findings.length === 0
        ? "审查完成，未发现问题。"
        : r.findings.map((f, i) => `${i + 1}. [${f.severity || "建议"}] ${f.description || ""}`).join("\n");
      return { content: summary, messages: [] };
    },
  };
}

export const reviewCharacterAgent = makeReviewAgent(reviewCharacterConsistencyClean);
export const reviewContinuityAgent = makeReviewAgent(reviewContinuityClean);
export const reviewForeshadowingAgent = makeReviewAgent(reviewForeshadowingClean);
export const reviewStyleAgent = makeReviewAgent(reviewStyleClean);
export const reviewWorldAgent = makeReviewAgent(reviewWorldBuildingClean);
export const reviewPacingAgent = makeReviewAgent(reviewPacingClean);
```

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/core/agents/agents/review.ts
git commit -m "feat: add review agents"
```

---

### Task 7: initRegistry + Agent Tool

**Files:**
- Create: `src/core/agents/init.ts`

- [ ] **Step 1: Create `src/core/agents/init.ts`**

```typescript
import { register } from "./registry";
import { registerAgent } from "./agent-registry";
import { dataTools } from "./agents/data-tools";
import { outlineAgent } from "./agents/outline";
import { writerAgent } from "./agents/writer";
import {
  reviewCharacterAgent, reviewContinuityAgent, reviewForeshadowingAgent,
  reviewStyleAgent, reviewWorldAgent, reviewPacingAgent,
} from "./agents/review";
import type { ToolContext } from "./types";

const AGENT_TYPES = [
  "generate_outline", "write_prose",
  "review_character", "review_continuity", "review_foreshadowing",
  "review_style", "review_world", "review_pacing",
] as const;

export function initRegistry(): void {
  // Register agent internal implementations
  registerAgent("generate_outline", outlineAgent);
  registerAgent("write_prose", writerAgent);
  registerAgent("review_character", reviewCharacterAgent);
  registerAgent("review_continuity", reviewContinuityAgent);
  registerAgent("review_foreshadowing", reviewForeshadowingAgent);
  registerAgent("review_style", reviewStyleAgent);
  registerAgent("review_world", reviewWorldAgent);
  registerAgent("review_pacing", reviewPacingAgent);

  // Register the unified agent tool
  register({
    name: "agent",
    description: "调用创作Agent执行任务。先获取必要上下文，再把角色、前文、大纲等信息写入prompt。",
    parameters: {
      type: "object",
      properties: {
        agent_type: {
          type: "string",
          enum: [...AGENT_TYPES],
          description: "要调用哪个Agent。可选: " + AGENT_TYPES.join(", "),
        },
        prompt: {
          type: "string",
          description: "传给Agent的完整任务描述，包含所有上下文（角色、前文、大纲等）",
        },
      },
      required: ["agent_type", "prompt"],
    },
    execute: async (args, ctx, llm, onChunk) => {
      const agentDef = getAgent(args.agent_type as string);
      if (!agentDef) throw new Error(`Unknown agent: ${args.agent_type}`);
      return agentDef.execute({ prompt: args.prompt as string, ...ctx }, llm, onChunk);
    },
  });

  // Register built-in data tools
  for (const tool of dataTools) {
    register(tool);
  }
}
```

Import `getAgent` at top (already in same module path).

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/core/agents/init.ts
git commit -m "feat: add initRegistry with agent tool and all built-in tools"
```

---

### Task 8: chatWithTools — Claude Provider

**Files:**
- Modify: `src/core/llm/claude.ts`

- [ ] **Step 1: Add chatWithTools to ClaudeProvider**

In `src/core/llm/claude.ts`, add import for `StreamEvent`:

```typescript
import type { StreamEvent } from "@/core/agents/types";
```

Add the `chatWithTools` method to `ClaudeProvider`:

```typescript
async *chatWithTools(
  messages: LLMMessage[],
  tools: ToolSchema[],
  options?: { model?: string; maxTokens?: number; temperature?: number }
): AsyncGenerator<StreamEvent> {
  const systemMsg = messages.find(m => m.role === "system");
  const chatMessages = messages
    .filter(m => m.role !== "system")
    .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

  const anthropicTools = tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: "object" as const,
      properties: t.parameters.properties as Record<string, unknown>,
      required: t.parameters.required,
    },
  }));

  const stream = this.client.messages.stream({
    model: options?.model || this.defaultModel,
    max_tokens: options?.maxTokens || 4096,
    temperature: options?.temperature ?? 0.4,
    system: systemMsg?.content || "",
    messages: chatMessages,
    tools: anthropicTools,
  });

  let currentToolId = "";
  let currentToolName = "";
  let currentToolArgs = "";

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield { type: "text_delta", text: event.delta.text };
    } else if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
      currentToolId = event.content_block.id;
      currentToolName = event.content_block.name;
      currentToolArgs = "";
    } else if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
      currentToolArgs += event.delta.partial_json;
    } else if (event.type === "content_block_stop") {
      if (currentToolId) {
        try {
          const args = JSON.parse(currentToolArgs);
          yield { type: "tool_use", id: currentToolId, name: currentToolName, args };
        } catch {
          // incomplete JSON, skip
        }
        currentToolId = "";
        currentToolName = "";
        currentToolArgs = "";
      }
    }
  }

  yield { type: "done" };
}
```

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: PASS (ClaudeProvider now satisfies LLMProvider)

- [ ] **Step 3: Commit**

```bash
git add src/core/llm/claude.ts
git commit -m "feat: add chatWithTools to ClaudeProvider using native tool_use"
```

---

### Task 9: chatWithTools — OpenAI Provider

**Files:**
- Modify: `src/core/llm/openai.ts`

- [ ] **Step 1: Add chatWithTools to OpenAIProvider**

In `src/core/llm/openai.ts`, add import:

```typescript
import type { StreamEvent } from "@/core/agents/types";
```

Add the `chatWithTools` method to `OpenAIProvider`:

```typescript
async *chatWithTools(
  messages: LLMMessage[],
  tools: ToolSchema[],
  options?: { model?: string; maxTokens?: number; temperature?: number }
): AsyncGenerator<StreamEvent> {
  const openaiTools = tools.map(t => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: "object" as const,
        properties: t.parameters.properties,
        required: t.parameters.required,
      },
    },
  }));

  const stream = await this.client.chat.completions.create({
    model: options?.model || this.defaultModel,
    max_tokens: options?.maxTokens || 4096,
    temperature: options?.temperature ?? 0.4,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    tools: openaiTools,
    stream: true,
  });

  let currentToolId = "";
  let currentToolName = "";
  let currentToolArgs = "";

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;

    if (delta.content) {
      yield { type: "text_delta", text: delta.content };
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        if (tc.id) {
          // If we were building a previous tool, yield it
          if (currentToolId && currentToolId !== tc.id) {
            try {
              yield { type: "tool_use", id: currentToolId, name: currentToolName, args: JSON.parse(currentToolArgs) };
            } catch { /* skip incomplete */ }
          }
          if (tc.id !== currentToolId) {
            currentToolId = tc.id;
            currentToolName = tc.function?.name || "";
            currentToolArgs = "";
          }
        }
        if (tc.function?.arguments) {
          currentToolArgs += tc.function.arguments;
        }
      }
    }

    if (chunk.choices[0]?.finish_reason === "tool_calls") {
      // Will be handled on last chunk
    }
  }

  // Yield final tool call if any
  if (currentToolId) {
    try {
      yield { type: "tool_use", id: currentToolId, name: currentToolName, args: JSON.parse(currentToolArgs) };
    } catch { /* skip */ }
  }

  yield { type: "done" };
}
```

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/core/llm/openai.ts
git commit -m "feat: add chatWithTools to OpenAIProvider using native tool_calls"
```

---

### Task 10: Rewrite agent/chat Route

**Files:**
- Modify: `src/app/api/agent/chat/route.ts`

- [ ] **Step 1: Rewrite `src/app/api/agent/chat/route.ts`**

Replace the entire file content:

```typescript
import { NextRequest } from "next/server";
import { createLLMProvider } from "@/core/llm/factory";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import { logSession } from "@/lib/session-log";
import { getTool, buildToolSchemas } from "@/core/agents/registry";
import { initRegistry } from "@/core/agents/init";
import type { LLMMessage, ToolSchema } from "@/types";

export const dynamic = "force-dynamic";

// Init once at module load
let initialized = false;
function ensureInit() {
  if (!initialized) { initRegistry(); initialized = true; }
}

const SYSTEM_PROMPT = `你是小说创作的主编Agent。你可以调用工具来完成创作任务。

## 工作方式
1. 先获取上下文（get_characters, get_novel_context等）
2. 把关键信息写入prompt，调用agent工具执行创作任务
3. agent返回后，根据结果决定下一步

## 工具调用规则
- agent工具需要 agent_type 和 prompt 参数，prompt里放完整的任务描述和上下文
- 内置工具不需要参数

## 重要
- 所有回复用中文
- 直接对用户说话，不要输出思考过程`;

export async function POST(request: NextRequest) {
  ensureInit();

  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "agent_chat", { windowMs: 60_000, maxRequests: 10 });
  if (!rate.allowed) return new Response(JSON.stringify({ error: rateLimitMessage(rate) }), { status: 429, headers: { "Content-Type": "application/json" } });

  const { messages, context } = await request.json();
  const llm = createLLMProvider();
  const encoder = new TextEncoder();
  const toolSchemas: ToolSchema[] = buildToolSchemas();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      const sendChunk = (text: string) => send({ type: "chunk", content: text });
      let currentToolCallId = "";
      const sendToolChunk = (text: string) => {
        send({ type: "tool_chunk", toolCallId: currentToolCallId, content: text });
      };
      const sendTool = (tool: string, status: string, toolCallId: string, result?: string, msgs?: any[]) => {
        send({ type: "tool_call", tool, status, toolCallId, result, messages: msgs });
      };

      try {
        const sessionId = Math.random().toString(36).slice(2, 10);
        const toolCallLogs: Record<string, unknown>[] = [];
        const conversation: LLMMessage[] = [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages.map((m: any) => ({ role: m.role === "agent" ? "assistant" : m.role, content: m.content })),
        ];

        let maxSteps = 15;
        while (maxSteps-- > 0) {
          const eventStream = llm.chatWithTools(conversation, toolSchemas, { temperature: 0.4, maxTokens: 4096 });

          let hasToolUse = false;
          let thinkingTimer: ReturnType<typeof setTimeout> | null = null;
          let hasTextOutput = false;

          // Start thinking timer — if no text within 2s, show thinking
          thinkingTimer = setTimeout(() => {
            if (!hasTextOutput) send({ type: "thinking", status: "deciding" });
          }, 2000);

          for await (const event of eventStream) {
            if (event.type === "text_delta") {
              if (!hasTextOutput) {
                hasTextOutput = true;
                if (thinkingTimer) { clearTimeout(thinkingTimer); thinkingTimer = null; }
              }
              sendChunk(event.text);
            } else if (event.type === "tool_use") {
              if (thinkingTimer) { clearTimeout(thinkingTimer); thinkingTimer = null; }
              hasToolUse = true;
              const toolDef = getTool(event.name);
              if (!toolDef) {
                conversation.push({ role: "user", content: `工具 ${event.name} 不存在` });
                continue;
              }

              currentToolCallId = Math.random().toString(36).slice(2);
              sendTool(event.name, "running", currentToolCallId);

              const result = await toolDef.execute(event.args, context, llm, sendToolChunk);

              conversation.push({
                role: "assistant",
                content: `[调用 ${event.name}(${JSON.stringify(event.args)})]`,
              });
              conversation.push({
                role: "user",
                content: `工具 ${event.name} 返回:\n${result.content.slice(0, 3000)}`,
              });

              sendTool(event.name, "done", currentToolCallId, result.content.slice(0, 2000), result.messages);
              toolCallLogs.push({ tool: event.name, args: event.args, result: result.content.slice(0, 500) });
              logSession({
                ts: new Date().toISOString(), sessionId, type: "tool_exec",
                userId, tool: event.name, args: event.args, resultPreview: result.content.slice(0, 500),
              });
            }
          }

          if (thinkingTimer) clearTimeout(thinkingTimer);
          if (!hasToolUse) break;
        }

        if (maxSteps <= 0) {
          logSession({ ts: new Date().toISOString(), sessionId, type: "master_agent", status: "max_steps" });
        }
      } catch (e) {
        logSession({ ts: new Date().toISOString(), type: "error", error: (e as Error).message });
        send({ type: "error", message: (e as Error).message });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
```

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/api/agent/chat/route.ts
git commit -m "refactor: rewrite agent chat route with registry-based chatWithTools"
```

---

### Task 11: Create agent/run Route

**Files:**
- Create: `src/app/api/agent/run/route.ts`

- [ ] **Step 1: Create `src/app/api/agent/run/route.ts`**

```typescript
import { NextRequest } from "next/server";
import { createLLMProvider } from "@/core/llm/factory";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import { getAgent } from "@/core/agents/agent-registry";
import { initRegistry } from "@/core/agents/init";

export const dynamic = "force-dynamic";

let initialized = false;
function ensureInit() { if (!initialized) { initRegistry(); initialized = true; } }

export async function POST(request: NextRequest) {
  ensureInit();
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "agent_run", { windowMs: 60_000, maxRequests: 20 });
  if (!rate.allowed) return new Response(JSON.stringify({ error: rateLimitMessage(rate) }), { status: 429, headers: { "Content-Type": "application/json" } });

  const { agent_type, prompt, context } = await request.json();
  if (!agent_type || !prompt) {
    return new Response(JSON.stringify({ error: "agent_type and prompt are required" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const agentDef = getAgent(agent_type);
  if (!agentDef) {
    return new Response(JSON.stringify({ error: `Unknown agent: ${agent_type}` }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const llm = createLLMProvider();
  const encoder = new TextEncoder();
  const toolCallId = Math.random().toString(36).slice(2);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        send({ type: "tool_call", tool: agent_type, status: "running", toolCallId });

        const result = await agentDef.execute(
          { prompt, ...(context || {}), novelText: context?.novelText || "", characters: context?.characters || [] },
          llm,
          (text) => send({ type: "tool_chunk", toolCallId, content: text })
        );

        send({ type: "tool_call", tool: agent_type, status: "done", toolCallId, result: result.content.slice(0, 5000), messages: result.messages });
      } catch (e) {
        send({ type: "error", message: (e as Error).message });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
```

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/api/agent/run/route.ts
git commit -m "feat: add direct agent call API route"
```

---

### Task 12: Frontend — Handle thinking Event

**Files:**
- Modify: `src/components/agent-panel.tsx`

- [ ] **Step 1: Add `thinking` event handler to agent-panel.tsx**

In the SSE event parsing loop (around line 78-113), add after the `chunk` handler:

```typescript
} else if (event.type === "thinking") {
  setMessages(prev => prev.map(m =>
    m.id === agentMsgId ? { ...m, content: "决策中..." } : m
  ));
}
```

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/agent-panel.tsx
git commit -m "feat: handle thinking SSE event in agent panel"
```

---

## Self-Review

### 1. Spec coverage

| Spec section | Task |
|---|---|
| 1. Tool 注册表 (ToolDefinition) | Task 1, 2 |
| 2. Registry API | Task 2 |
| 3. Function Calling (chatWithTools) | Task 8, 9 |
| 4. 主 Agent 循环 (ReAct) | Task 10 |
| 5. 直接调用 API | Task 11 |
| 6. SSE 协议 | Task 10, 12 |
| 7. 错误处理 | Task 10 (network retry in existing withRetry in OpenAI; Claude lacks retry but has it implicitly via SDK) |
| 8. 文件结构 | All tasks |

Gaps identified:
- **Agent 内部工具调用**: Spec says agents can call built-in tools. The current agent implementations (tasks 4-6) don't use this capability. This is a future enhancement, not blocking.
- **initRegistry 懒加载**: Tasks 10/11 use `ensureInit()` pattern (one-time lazy init at module load). The spec says init-once at startup — this is equivalent since Next.js API routes load modules once.

### 2. Placeholder scan

No TBD/TODO/placeholder found. All code is complete.

### 3. Type consistency

- `ToolDefinition.execute(args, ctx, llm, onChunk?)` → consistent across registry, agent tool, chat route
- `AgentDef.execute(ctx, llm, onChunk?)` → consistent across agent implementations
- `StreamEvent` types match what chatWithTools yields and what the chat route consumes
- `buildToolSchemas()` returns `ToolSchema[]` matching `LLMProvider.chatWithTools(messages, tools: ToolSchema[])`
- `getTool(name)` returns `ToolDefinition | undefined` — handled with null check in chat route
- `getAgent(type)` returns `AgentDef | undefined` — handled with throw in agent tool execute

All types cross-checked. No mismatches.
