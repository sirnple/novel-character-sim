# Agent Assistant Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a unified "助手" panel as a right-side tab where each agent (大纲, Writer, 审查) is a chat thread for iterative feedback.

**Architecture:** New `agent-panel.tsx` component renders agent list + chat UI. New `/api/agent/chat` stream endpoint handles agent-specific LLM calls. Existing comparison view moved from inline to modal.

**Tech Stack:** Next.js App Router, React, SSE streaming

---

### Task 1: Agent panel UI component

**Files:**
- Create: `src/components/agent-panel.tsx`

- [ ] **Step 1: Create the component with agent thread state**

```typescript
"use client";
import { useState, useRef, useEffect } from "react";
import { Bot, Send, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";

interface AgentMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  metadata?: { type?: "outline" | "prose" | "text"; data?: any };
  timestamp: string;
}

interface AgentThread {
  agentId: string;
  name: string;
  messages: AgentMessage[];
  status: "idle" | "generating";
}

interface AgentPanelProps {
  novelTitle?: string;
  characters?: any[];
  novelText?: string;
  continueFromOffset?: number;
  continueFromLabel?: string;
  onOutlineGenerated?: (outline: any) => void;
}

export default function AgentPanel({ novelTitle, characters, novelText, continueFromOffset, continueFromLabel, onOutlineGenerated }: AgentPanelProps) {
  const [threads, setThreads] = useState<AgentThread[]>([
    { agentId: "outline", name: "大纲", messages: [], status: "idle" },
    { agentId: "writer", name: "Writer", messages: [], status: "idle" },
    { agentId: "review", name: "审查", messages: [], status: "idle" },
  ]);
  const [activeAgentId, setActiveAgentId] = useState("outline");
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeThread = threads.find(t => t.agentId === activeAgentId)!;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeThread.messages]);

  const addMessage = (agentId: string, msg: AgentMessage) => {
    setThreads(prev => prev.map(t =>
      t.agentId === agentId ? { ...t, messages: [...t.messages, msg] } : t
    ));
  };

  const setStatus = (agentId: string, status: "idle" | "generating") => {
    setThreads(prev => prev.map(t =>
      t.agentId === agentId ? { ...t, status } : t
    ));
  };

  const handleSend = async () => {
    if (!input.trim() || activeThread.status === "generating") return;
    const userMsg: AgentMessage = {
      id: Math.random().toString(36).slice(2),
      role: "user", content: input.trim(),
      timestamp: new Date().toISOString(),
    };
    addMessage(activeAgentId, userMsg);
    setInput("");
    setStatus(activeAgentId, "generating");

    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: activeAgentId,
          messages: [...activeThread.messages, userMsg],
          context: { novelTitle, characters, novelText, continueFromOffset, continueFromLabel },
        }),
      });
      if (!res.ok) throw new Error("Failed");
      
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");
      
      const decoder = new TextDecoder();
      let buffer = "";
      let agentContent = "";
      const agentMsgId = Math.random().toString(36).slice(2);
      
      // Add empty agent message first
      const agentMsg: AgentMessage = {
        id: agentMsgId, role: "agent", content: "",
        timestamp: new Date().toISOString(),
      };
      addMessage(activeAgentId, agentMsg);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === "chunk") {
                agentContent += event.content;
                setThreads(prev => prev.map(t =>
                  t.agentId === activeAgentId
                    ? { ...t, messages: t.messages.map(m => m.id === agentMsgId ? { ...m, content: agentContent } : m) }
                    : t
                ));
              } else if (event.type === "data" && event.data && onOutlineGenerated) {
                onOutlineGenerated(event.data);
              }
            } catch {}
          }
        }
      }
    } catch (e) {
      addMessage(activeAgentId, {
        id: Math.random().toString(36).slice(2),
        role: "agent", content: "抱歉，出错了：" + (e as Error).message,
        timestamp: new Date().toISOString(),
      });
    }
    setStatus(activeAgentId, "idle");
  };

  return (
    <div className="flex flex-col h-full bg-[#0c0c0c]">
      {/* Agent tabs */}
      <div className="flex border-b border-neutral-800/40 shrink-0">
        {threads.map(t => (
          <button key={t.agentId}
            onClick={() => setActiveAgentId(t.agentId)}
            className={`flex-1 py-2 text-[10px] font-mono transition-colors ${activeAgentId === t.agentId ? "text-orange-400 border-b border-orange-500 bg-orange-500/5" : "text-neutral-500 hover:text-neutral-300"}`}>
            {t.name}
            {t.messages.length > 0 && <span className="ml-1 text-[9px] text-neutral-600">{t.messages.length}</span>}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3">
        {activeThread.messages.length === 0 && (
          <div className="text-center py-8 text-neutral-600 text-xs font-mono">
            <Bot className="w-6 h-6 mx-auto mb-2 opacity-30" />
            与 {activeThread.name} Agent 对话，共同创作
          </div>
        )}
        {activeThread.messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[90%] rounded-lg px-3 py-2 text-xs ${
              msg.role === "user"
                ? "bg-orange-600/20 text-orange-300 border border-orange-600/20"
                : "bg-neutral-800/50 text-neutral-300 border border-neutral-700/50"
            }`}>
              {msg.role === "agent" && msg.metadata?.type === "outline" ? (
                <details>
                  <summary className="cursor-pointer text-neutral-400">大纲结果</summary>
                  <pre className="mt-1 text-[11px] text-neutral-400 font-mono whitespace-pre-wrap">{msg.content}</pre>
                </details>
              ) : (
                <div className="prose prose-invert prose-xs max-w-none">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        ))}
        {activeThread.status === "generating" && (
          <div className="flex justify-start">
            <div className="bg-neutral-800/50 rounded-lg px-3 py-2 text-xs text-neutral-500 border border-neutral-700/50">
              <Loader2 className="w-3 h-3 inline animate-spin mr-1" />
              思考中...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-neutral-800/40 shrink-0">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSend()}
            placeholder={`与 ${activeThread.name} 对话...`}
            disabled={activeThread.status === "generating"}
            className="flex-1 bg-[#111110] border border-neutral-800 rounded px-3 py-1.5 text-xs text-neutral-300 font-mono outline-none focus:border-orange-600/50 disabled:opacity-50"
          />
          <button onClick={handleSend}
            disabled={activeThread.status === "generating" || !input.trim()}
            className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white rounded text-xs font-mono transition-colors">
            <Send className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/agent-panel.tsx
git commit -m "feat: add agent assistant panel with chat threads"
```

---

### Task 2: Agent chat API endpoint

**Files:**
- Create: `src/app/api/agent/chat/route.ts`

- [ ] **Step 1: Create the stream endpoint**

```typescript
import { NextRequest } from "next/server";
import { createLLMProvider } from "@/core/llm/factory";
import { renderPrompt } from "@/core/prompts/renderer";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "agent_chat", { windowMs: 60_000, maxRequests: 10 });
  if (!rate.allowed) {
    return new Response(
      JSON.stringify({ error: rateLimitMessage(rate) }),
      { status: 429, headers: { "Content-Type": "application/json" } }
    );
  }

  const { agentId, messages, context } = await request.json();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendChunk = (text: string) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "chunk", content: text })}\n\n`));
      };
      const sendData = (data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "data", data })}\n\n`));
      };

      try {
        if (agentId === "outline") {
          const llm = createLLMProvider();
          const systemPrompt = renderPrompt("outline-system.md", {});
          const lastUserMsg = messages.filter((m: any) => m.role === "user").pop();
          
          const fullPrompt = `以下是与大纲 Agent 的对话。请根据人类的反馈修改大纲。

## 上下文
- 续写起点：${context.continueFromLabel || "未知"}

## 对话历史
${messages.map((m: any) => `[${m.role === "user" ? "人类" : "大纲Agent"}]: ${m.content}`).join("\n\n")}

请根据对话历史的最后一条人类反馈，生成修改后的大纲。如果是第一次对话（没有人类反馈），请根据上下文生成初始大纲。`;

          await llm.chatStream(
            [
              { role: "system", content: systemPrompt },
              { role: "user", content: fullPrompt },
            ],
            (accumulated) => {
              sendChunk(accumulated);
            },
            { temperature: 0.4, maxTokens: 2048 }
          );
        } else if (agentId === "writer") {
          // Writer agent — rewrite prose based on feedback
          const llm = createLLMProvider();
          const fullPrompt = `以下是与 Writer Agent 的对话。请根据人类的反馈修改 prose。

## 上下文
原文：${(context.novelText || "").slice(-10000)}

## 对话历史
${messages.map((m: any) => `[${m.role === "user" ? "人类" : "Writer"}]: ${m.content}`).join("\n\n")}

请根据对话历史的最后一条人类反馈修改 prose。直接输出修改后的正文。`;

          await llm.chatStream(
            [{ role: "user", content: fullPrompt }],
            (accumulated) => sendChunk(accumulated),
            { temperature: 0.6, maxTokens: 16384 }
          );
        }

        controller.close();
      } catch (e) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message: (e as Error).message })}\n\n`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 2: Verify build and commit**

```bash
npx tsc --noEmit
git add src/app/api/agent/chat/route.ts
git commit -m "feat: add agent chat API with streaming"
```

---

### Task 3: Comparison view as modal

**Files:**
- Modify: `src/components/writing-workspace.tsx`

- [ ] **Step 1: Add comparison modal state**

```typescript
const [showComparison, setShowComparison] = useState(false);
```

- [ ] **Step 2: Replace inline comparison with single-panel + button**

Remove the inline `status === "completed" && activeTask?.continueFromOffset != null ? (dual-panel) : (single-panel)` ternary. Return to always showing the single-panel reader, but when prose is generated and has a continueFromOffset, show a button:

```jsx
{status === "completed" && activeTask?.continueFromOffset != null && (
  <button onClick={() => setShowComparison(true)}
    className="flex items-center gap-1 text-[10px] text-neutral-500 hover:text-green-400 font-mono mt-2">
    <Shield className="w-3 h-3" /> 对比原文
  </button>
)}
```

- [ ] **Step 3: Add comparison modal**

When `showComparison` is true, render:

```jsx
{showComparison && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
    onClick={() => setShowComparison(false)}>
    <div className="w-[90vw] max-w-6xl max-h-[90vh] bg-[#0e0e0e] border border-neutral-800 rounded-lg shadow-2xl flex flex-col overflow-hidden"
      onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-800/40">
        <h3 className="text-sm font-semibold text-neutral-300 font-mono">原文对比</h3>
        <button onClick={() => setShowComparison(false)} className="text-neutral-500 hover:text-neutral-300">✕</button>
      </div>
      <div className="flex flex-1 overflow-y-auto">
        {/* Left: original context */}
        <div className="w-1/2 border-r border-neutral-700/50">
          <div className="p-4">
            <div className="text-[10px] text-neutral-500 font-mono uppercase mb-3">原文</div>
            <div className="text-sm text-neutral-400 leading-relaxed whitespace-pre-wrap font-serif">
              {initialFullNovel?.slice(0, activeTask.continueFromOffset)}
              <span className="inline-block w-full h-0.5 my-3 bg-orange-500/60" />
              <span className="text-[10px] text-orange-500 font-mono">— 续写点 —</span>
              {"\n"}
              {initialFullNovel?.slice(activeTask.continueFromOffset)}
            </div>
          </div>
        </div>
        {/* Right: generated prose */}
        <div className="w-1/2">
          <div className="p-4">
            <div className="text-[10px] text-green-500/70 font-mono uppercase mb-3">续写版本</div>
            <div className="text-sm text-neutral-200 leading-relaxed whitespace-pre-wrap font-serif">
              {initialFullNovel?.slice(0, activeTask.continueFromOffset)}
              <span className="inline-block w-full h-0.5 my-3 bg-green-500/60" />
              <span className="text-[10px] text-green-500 font-mono">— 续写 —</span>
              {"\n"}
              {outputText}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 4: Verify build and commit**

```bash
npx tsc --noEmit
git add src/components/writing-workspace.tsx
git commit -m "feat: move comparison view to modal, center shows prose only"
```

---

### Task 4: Wire into page.tsx right panel

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Add "助手" tab to right panel**

In the right panel tab switcher (around lines 771-784), add:

```jsx
<button
  onClick={() => setRightPanelView("assistant")}
  className={`px-2.5 py-1 text-[10px] font-mono transition-colors ${rightPanelView === "assistant" ? "bg-neutral-700 text-neutral-200" : "bg-transparent text-neutral-500 hover:text-neutral-300"}`}
>
  助手
</button>
```

Add `"assistant"` to the type of `rightPanelView`:

```typescript
const [rightPanelView, setRightPanelView] = useState<"codex" | "review" | "assistant">("codex");
```

- [ ] **Step 2: Render AgentPanel when tab is active**

In the right panel content section (where CODEX and REVIEW are rendered), add:

```jsx
{rightPanelView === "assistant" && (
  <AgentPanel
    novelTitle={novelTitle}
    characters={characters}
    novelText={novelText}
  />
)}
```

Import AgentPanel:

```typescript
import AgentPanel from "@/components/agent-panel";
```

- [ ] **Step 3: Verify build and commit**

```bash
npx tsc --noEmit
git add src/app/page.tsx
git commit -m "feat: add assistant tab to right panel"
```

---

### Post-Implementation Verification

- [ ] `npx tsc --noEmit` passes
- [ ] Right panel has CODEX | REVIEW | 助手 tabs
- [ ] 助手 tab shows 大纲/Writer/审查 thread list
- [ ] Sending a message to 大纲 agent streams back a response
- [ ] Comparison button appears after prose generation, opens modal
