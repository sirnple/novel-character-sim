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
                agentContent = event.content;
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
