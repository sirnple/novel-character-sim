# Agent Live Monitoring Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show every LLM agent as a floating dot in the writing workspace corner, pulsating while running, clickable to view full chat messages.

**Architecture:** New `agent` SSE event emitted by each agent before/after its LLM call. Engine, review orchestrator, outline agent all get `onEvent` callback. WritingWorkspace collects agent state into a map, renders floating dots and a chat panel modal.

**Tech Stack:** Next.js App Router, React, TypeScript, SSE streaming

---

### Task 1: Add `agent` event type + backend emission

**Files:**
- Modify: `src/core/simulation/engine.ts`
- Modify: `src/core/codex/review-orchestrator.ts`
- Modify: `src/core/simulation/outline-agent.ts`
- Modify: `src/app/api/simulation/stream/route.ts`

- [ ] **Step 1: Add `agent` event type to SimulationEvent**

In `src/core/simulation/engine.ts`, find the `SimulationEvent` type and add:

```typescript
  | { type: "agent"; agentId: string; name: string; status: "running" | "done"; messages?: import("@/types").LLMMessage[] }
```

- [ ] **Step 2: Emit agent events from engine for Writer**

In `engine.ts` `run()`, before the Writer LLM call (around line 213), emit running:

```typescript
    const writerAgentId = "writer";
    this.onEvent({ type: "agent", agentId: writerAgentId, name: "Writer", status: "running" });
```

After the prose is returned (around line 219), emit done with messages:

```typescript
    this.onEvent({
      type: "agent",
      agentId: writerAgentId,
      name: "Writer",
      status: "done",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
        { role: "assistant", content: prose },
      ],
    });
```

- [ ] **Step 3: Emit agent events from inside `runFullReview` for review + rewrite agents**

Modify `runFullReview` in `src/core/codex/review-orchestrator.ts` to accept an optional `onEvent` callback:

```typescript
export async function runFullReview(
  input: ReviewInput,
  onEvent?: (event: any) => void
): Promise<ReviewReport> {
```

Inside, for each of the 6 review functions, emit running + done agents. The review functions need to be modified to return `{ findings, messages }` so the caller has the prompt data.

Add a helper to emit an agent event from `runFullReview`:

```typescript
function emitAgent(agentId: string, name: string, status: "running" | "done", messages?: any[]) {
  if (onEvent) onEvent({ type: "agent", agentId, name, status, messages });
}
```

For each review agent (character, continuity, foreshadowing, style, world, pacing):
- Before the LLM call: `emitAgent("review_char", "角色一致性", "running")`
- After: `emitAgent("review_char", "角色一致性", "done", messages)`

Also for `rewriteProse` — modify to accept optional `onEvent` and emit:
- Before: `emitAgent("rewrite", "修正", "running")`
- After: `emitAgent("rewrite", "修正", "done", messages)`

- [ ] **Step 4: Emit agent events for outline agent**

In `src/core/simulation/outline-agent.ts`, modify `runOutlineWriter` to accept optional `onEvent` callback:

```typescript
export async function runOutlineWriter(
  input: OutlineWriterInput,
  onEvent?: (event: any) => void
): Promise<{ outline: SceneOutline; prompt?: { system: string; user: string } }> {
```

Before the LLM call, emit:
```typescript
if (onEvent) onEvent({ type: "agent", agentId: "outline", name: "大纲", status: "running" });
```

After, emit with messages.

- [ ] **Step 5: Wire `onEvent` from stream route and engine**

In `src/app/api/simulation/stream/route.ts`, pass `sendEvent` as `onEvent` to `runOutlineWriter`.

In `engine.ts`, create `runFullReview` call, pass `this.onEvent` as the callback.

In `engine.ts`, call `runOutlineWriter`, pass `this.onEvent` as the callback.

- [ ] **Step 6: Verify build and commit**

```bash
npx tsc --noEmit
git add src/core/simulation/engine.ts src/core/codex/review-orchestrator.ts src/core/simulation/outline-agent.ts src/app/api/simulation/stream/route.ts
git commit -m "feat: add agent SSE event type and emit from all pipeline agents"
```

---

### Task 2: Floating dots UI

**Files:**
- Modify: `src/components/writing-workspace.tsx`

- [ ] **Step 1: Add agent state**

```typescript
interface AgentState {
  agentId: string;
  name: string;
  status: "running" | "done";
  messages?: import("@/types").LLMMessage[];
}

const [agents, setAgents] = useState<Map<string, AgentState>>(new Map());
```

- [ ] **Step 2: Handle `agent` event in SSE switch**

In `startWriting` SSE event switch, add:

```typescript
case "agent":
  setAgents(prev => {
    const next = new Map(prev);
    next.set(event.agentId, {
      agentId: event.agentId,
      name: event.name,
      status: event.status,
      messages: event.messages || prev.get(event.agentId)?.messages,
    });
    return next;
  });
  break;
```

Clear agents when starting new generation in `startWriting`:

```typescript
setAgents(new Map());
```

- [ ] **Step 3: Render floating dots**

Bottom-right corner of the right column. After the reader body:

```jsx
{agents.size > 0 && (
  <div className="absolute bottom-4 right-4 flex items-center gap-1.5 z-40">
    {Array.from(agents.values()).map(a => (
      <div key={a.agentId}
        onClick={() => setSelectedAgent(a.agentId)}
        title={a.name + (a.status === "running" ? " (运行中)" : " (完成)")}
        className={`rounded-full cursor-pointer transition-all hover:scale-125 ${
          a.status === "running"
            ? "w-4 h-4 bg-orange-500 animate-pulse"
            : "w-3 h-3 bg-green-500"
        }`}
      />
    ))}
  </div>
)}
```

Add `selectedAgent` state:
```typescript
const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
```

The dots container needs `absolute` positioning. Make the parent `relative`. The right column div (the outer `flex-1 flex flex-col min-w-0` div) needs `className="flex-1 flex flex-col min-w-0 relative"`.

- [ ] **Step 4: Verify build and commit**

```bash
npx tsc --noEmit
git add src/components/writing-workspace.tsx
git commit -m "feat: add floating agent dots with running/done states"
```

---

### Task 3: Chat messages panel

**Files:**
- Modify: `src/components/writing-workspace.tsx`

- [ ] **Step 1: Add chat panel modal**

When `selectedAgent` is set, render a modal overlay:

```jsx
{selectedAgent && (() => {
  const agent = agents.get(selectedAgent);
  if (!agent) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={() => setSelectedAgent(null)}>
      <div className="w-full max-w-2xl max-h-[80vh] bg-[#0e0e0e] border border-neutral-800 rounded-lg shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-800/40">
          <h3 className="text-sm font-semibold text-neutral-300 font-mono">{agent.name}</h3>
          <span className={`text-[10px] font-mono ${agent.status === "running" ? "text-orange-500" : "text-green-500"}`}>
            {agent.status === "running" ? "运行中" : "完成"}
          </span>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">
          {agent.messages?.map((msg, i) => (
            <div key={i} className="space-y-1">
              <div className="text-[10px] text-neutral-600 font-mono uppercase">
                {msg.role === "system" ? "System" : msg.role === "user" ? "User" : "Assistant"}
              </div>
              {msg.role === "system" ? (
                <details>
                  <summary className="text-xs text-neutral-500 cursor-pointer hover:text-neutral-400">展开 system prompt</summary>
                  <pre className="mt-2 text-xs text-neutral-500 font-mono whitespace-pre-wrap leading-relaxed bg-[#080808] rounded p-4 border border-neutral-800/30 max-h-[300px] overflow-y-auto">{msg.content}</pre>
                </details>
              ) : (
                <div className="text-sm text-neutral-300 leading-relaxed whitespace-pre-wrap font-mono bg-[#080808] rounded-lg p-4 border border-neutral-800/30 max-h-[500px] overflow-y-auto">
                  {msg.content}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-neutral-800/40">
          <button onClick={() => {
            const text = agent.messages?.map(m => `[${m.role}]\n${m.content}`).join("\n\n") || "";
            navigator.clipboard.writeText(text);
          }}
            className="px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-200 font-mono border border-neutral-700 rounded transition-colors">
            复制全部
          </button>
          <button onClick={() => setSelectedAgent(null)}
            className="px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-200 font-mono border border-neutral-700 rounded transition-colors">
            关闭
          </button>
        </div>
      </div>
    </div>
  );
})()}
```

- [ ] **Step 2: Verify build and commit**

```bash
npx tsc --noEmit
git add src/components/writing-workspace.tsx
git commit -m "feat: add chat messages panel for agent inspection"
```

---

### Post-Implementation Verification

- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] Generate prose → floating dots appear in bottom-right (9 agents)
- [ ] Dots pulse orange while agent is running, turn green when done
- [ ] Click a green dot → chat panel shows system/user/assistant messages
- [ ] System prompt is collapsed by default, clickable to expand
- [ ] "复制全部" copies the full conversation
- [ ] Previous `prompt` event still works (backward compat) but agent events provide the same data
