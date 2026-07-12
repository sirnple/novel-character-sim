# Agent Framework Spec

---

## 1. Tool 注册表

所有工具统一注册为 `ToolDefinition`。Agent 工具共用 `name: "agent"`，通过 `agent_type` 参数区分。

```typescript
interface ToolDefinition {
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

interface ToolContext {
  novelText: string;
  novelTitle?: string;
  characters: any[];
  timeline?: any;
  worldBible?: any;
  continueFromOffset?: number;
  continueFromLabel?: string;
}

interface ToolResult {
  content: string;
  messages: { role: "user" | "assistant"; content: string }[];
}
```

### 注册示例

```typescript
// Agent 入口 — 所有 agent 共用
register({
  name: "agent",
  description: "调用创作Agent。先用内置工具获取上下文，再把角色、前文、大纲等信息写入prompt。",
  parameters: {
    type: "object",
    properties: {
      agent_type: {
        type: "string",
        enum: [
          "generate_outline", "write_prose",
          "review_character", "review_continuity", "review_foreshadowing",
          "review_style", "review_world", "review_pacing"
        ],
        description: "要调用的Agent类型"
      },
      prompt: {
        type: "string",
        description: "传给Agent的完整任务描述。把角色信息、大纲内容、前文片段等关键上下文都放进来。"
      }
    },
    required: ["agent_type", "prompt"]
  },
  execute: (args, ctx, llm, onChunk) => {
    const agentDef = agentRegistry.get(args.agent_type);
    return agentDef.execute({ prompt: args.prompt, ...ctx }, llm, onChunk);
  }
});

// 内置工具 — 各自独立
register({
  name: "get_characters",
  description: "获取角色档案",
  parameters: { type: "object", properties: {} },
  execute: (_, ctx) => ({ content: formatCharacters(ctx.characters), messages: [] })
});

register({
  name: "get_novel_context",
  description: "获取续写点上下文",
  parameters: { type: "object", properties: {} },
  execute: (_, ctx) => ({ content: (ctx.novelText || "").slice(-6000) || "无前文", messages: [] })
});
```

### Agent 内部注册表

与工具注册表分离，只存 agent 执行逻辑：

```typescript
interface AgentDef {
  execute(ctx: AgentContext, llm: LLMProvider, onChunk?: (text: string) => void): Promise<AgentResult>;
}
```

Agent 内部可以有自己的工具列表（仅限内置工具，不能调其他 agent，防无限递归）。

---

## 2. Registry API

```typescript
// registry.ts
register(def: ToolDefinition): void
getTool(name: string): ToolDefinition
listTools(): ToolDefinition[]

// agentRegistry.ts（内部）
registerAgent(type: string, def: AgentDef): void
getAgent(type: string): AgentDef
listAgents(): string[]
```

启动时 `initRegistry()` 一次性注册所有工具和 agent。加新 agent = 写文件 + init 加一行。

---

## 3. Function Calling

新增 `chatWithTools()` 替代 `chatWithTool`，使用原生 function calling。

```typescript
// LLMProvider 新增
chatWithTools(
  messages: LLMMessage[],
  tools: ToolSchema[],
  options?: { temperature?: number; maxTokens?: number }
): AsyncGenerator<StreamEvent>;

type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; name: string; args: Record<string, any> }
  | { type: "done" };
```

Adapter 负责把 `ToolDefinition.parameters` 转成对应 SDK 的 tool schema。Claude 用 `tool_use`，OpenAI 用 `tool_calls`。

---

## 4. 主 Agent 循环

`POST /api/agent/chat`

```
while maxSteps:
  1. chatWithTools(conversation, listTools()) → 流式消费
     - text_delta → 发送 chunk SSE
     - tool_use   → 解析 name + args
     - done       → break
  2. 获取 toolCall.name → getTool(name)
  3. 发送 tool_call running
  4. tool.execute(args, ctx, llm, onChunk)
     - onChunk → 发送 tool_chunk SSE
  5. 发送 tool_call done (result + messages)
  6. conversation 塞入 tool_use assistant + tool_result user
  7. 继续循环
```

---

## 5. 直接调用 API

`POST /api/agent/run`

```json
{ "agent_type": "write_prose", "prompt": "...", "context": { ... } }
```

Response: SSE stream `tool_chunk` + `tool_call done`。

绕过主 LLM 对话，独立执行。

---

## 6. SSE 协议

| 事件 | 触发 | 前端 |
|---|---|---|
| `chunk` | LLM 流式文本输出 | agent 气泡实时渲染 |
| `thinking` | LLM 跳过文本直接发 tool_use（2秒内无文本） | 气泡短暂显示"决策中..." |
| `tool_call` `{tool, status:"running"\|"done", toolCallId, result?, messages?}` | 工具开始/完成 | tool card 状态 |
| `tool_chunk` `{toolCallId, content}` | agent 工具流式输出 | tool card 实时滚动 |

---

## 7. 错误处理

| 错误类型 | 策略 |
|---|---|
| 网络错误（超时、连接断开） | 自动重试 2 次，指数退避 |
| Tool schema 不匹配 / JSON 解析失败 | 抛给 LLM 自己处理（塞回 conversation） |
| Agent 执行超时 | 60s 超时，返回截断结果 |
| 未注册的 tool name | 返回错误消息，LLM 重试 |

---

## 8. 文件结构

```
src/core/agents/
  types.ts              — ToolDefinition, ToolContext, ToolResult, AgentDef, StreamEvent
  registry.ts           — 工具注册中心 + buildToolSchemas
  agent-registry.ts     — Agent 内部注册表
  init.ts               — initRegistry() 注册所有工具和 agent
  agents/
    outline.ts          — generate_outline agent
    writer.ts           — write_prose agent
    review.ts           — 6 个审查 agent
    data-tools.ts       — 5 个内置工具

src/core/llm/
  types.ts              — + chatWithTools, StreamEvent
  claude.ts             — + chatWithTools 实现
  openai.ts             — + chatWithTools 实现
  factory.ts            — 不变

src/app/api/agent/
  chat/route.ts         — 主 Agent ReAct 循环
  run/route.ts          — 直接调用 agent（新增）
```

---

## 9. 数据流总览

```
主 Agent 对话:
  chat/route.ts
    → chatWithTools(messages, registry 构建的 tools)
    → stream: text_delta → chunk SSE
              tool_use   → getTool(name).execute(args, ctx, onChunk)
                         → sender sends tool_call/tool_chunk SSE
                         → conversation 塞入 tool_result
    → 循环直到 done / maxSteps

直接调用:
  run/route.ts
    → agentRegistry.get(agent_type)
    → executor.execute(ctx, llm, onChunk)
    → tool_chunk + done SSE

加新 Agent:
  写 src/core/agents/agents/new-agent.ts
  在 init.ts 加 registerAgent("new_agent", { execute })
  → 主 LLM 下次调用自动感知（agent_type enum 更新）
```
