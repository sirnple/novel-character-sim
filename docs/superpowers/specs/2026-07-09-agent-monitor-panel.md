# Agent Live Monitoring Panel

**Date:** 2026-07-09
**Status:** draft

## Problem

The writing pipeline runs 9+ LLM calls (outline, writer, 6 review agents, rewrite), all invisible to the user. There's no way to see what prompts were sent or what each agent returned.

## Goal

Show every agent as a floating dot in the corner of the writing workspace. Each dot pulsates while the agent is working, turns green when done. Clicking opens a chat-bubble view showing the messages (system/user/assistant). This replaces the current `prompt` SSE event with a unified `agent` event.

## Design

### 1. SSE Event

Add one new event type to `SimulationEvent`:

```typescript
| { type: "agent"; agentId: string; name: string; status: "running" | "done"; messages?: LLMMessage[] }
```

- `"running"`: agent started. Dot appears, pulsates. `messages` can be omitted or empty.
- `"done"`: agent finished. Dot turns green, stores full `messages`.

The existing `"prompt"` event is superseded by the Writer's `"agent"` event and should be removed (or kept but deprecated).

### 2. Agents Emitting Events

| Agent | name | When emitted |
|-------|------|-------------|
| Outline Agent | "大纲" | Before LLM call (running) + after (done, with messages) |
| Writer | "Writer" | Before LLM call (running) + after (done, with messages) |
| Character Review | "角色一致性" | Before LLM call (running) + after (done, with messages) |
| Continuity Review | "连贯性" | Before LLM call (running) + after (done, with messages) |
| Foreshadowing Review | "伏笔追踪" | Before LLM call (running) + after (done, with messages) |
| Style Review | "风格" | Before LLM call (running) + after (done, with messages) |
| World Review | "世界观" | Before LLM call (running) + after (done, with messages) |
| Pacing Review | "节奏" | Before LLM call (running) + after (done, with messages) |
| Rewrite Agent | "修正" | Before LLM call (running) + after (done, with messages) |

**Implementation approach:**

Each agent that makes an LLM call receives an `onEvent` callback. Before the call, emit `{ type: "agent", agentId, name, status: "running" }`. After the call completes, emit `{ type: "agent", agentId, name, status: "done", messages }`.

The engine already has `this.onEvent`. Pass it down to:
- `rewriteProse()` — add an optional `onEvent` parameter
- `runFullReview()` — add an optional `onEvent` parameter, which is forwarded to each review agent function

For the outline agent running in outline-only mode (stream/route.ts), the stream route's `sendEvent` closure can emit the agent events directly.

### 3. UI: Floating Dots

Bottom-right corner of the writing workspace. A row of small circles (12px), one per agent that has been seen in this session.

```
┌────────────────────────────────────┐
│                                    │
│                            ● ● ●  │  ← 9 dots, right-aligned
│                            ○ ○ ○  │  ← ○ = running (pulsating orange)
│                            ○ ○ ○  │  ← ○ = running
│                                    │  ← ● = done (green, solid)
└────────────────────────────────────┘
```

- Running: orange circle with `animate-pulse`, slightly larger (16px)
- Done: green circle, 12px
- Hover: tooltip showing agent name
- Click: opens chat messages panel

### 4. UI: Chat Messages Panel

Modal or slide-out panel from the right. Shows the clicked agent's messages:

```
┌─ 大纲 Agent ──────────────────────┐
│                                    │
│ ┌─ System (可折叠) ────────────┐  │
│ │ 你是小说续写的大纲设计师...    │  │  ← collapsed by default
│ └──────────────────────────────┘  │
│                                    │
│ ┌─ User ───────────────────────┐  │
│ │ 请为第5章设计场景大纲...       │  │
│ └──────────────────────────────┘  │
│                                    │
│ ┌─ Assistant ──────────────────┐  │
│ │ { "chapterTitle": "...",     │  │
│ │   "beats": [...] }            │  │
│ └──────────────────────────────┘  │
│                                    │
│ [复制] [关闭]                      │
└────────────────────────────────────┘
```

- System prompt: collapsed by default, expandable
- User prompt: always visible
- Assistant output: always visible (JSON is formatted with `JSON.stringify(data, null, 2)`)
- Copy button copies the full conversation
- Bottom bar has "复制全部" and "关闭"

### 5. Messages Data

`LLMMessage[]` is already defined in the codebase:

```typescript
interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
```

Each agent builds its messages:
- For agents with shared system prompt + domain prompt: `[{ role: "system", content: sharedPrompt }, { role: "user", content: domainPrompt }]`
- For writer: `[{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }]`
- Assistant content: the raw LLM response string (prose, JSON, etc.)

### 6. Files Changed

| File | Change |
|------|--------|
| `src/core/simulation/engine.ts` | Emit agent events for Writer, outline, review agents |
| `src/core/codex/review-orchestrator.ts` | Accept `onEvent` callback, emit agent events per review agent + rewrite |
| `src/core/simulation/outline-agent.ts` | Accept `onEvent` callback, emit agent events |
| `src/app/api/simulation/stream/route.ts` | Emit agent events for outline-only mode |
| `src/components/writing-workspace.tsx` | Handle `agent` event, render floating dots + chat panel |

### 7. Out of Scope

- Persisting agent messages (session-only)
- Search/filter within messages
- Side-by-side agent comparison
- Mobile responsive floating dots
