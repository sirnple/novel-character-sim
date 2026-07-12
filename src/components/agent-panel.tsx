"use client";
import { useState, useRef, useEffect } from "react";
import { Bot, Send, Loader2, Wrench } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useNovel } from "@/lib/novel-context";

interface AgentMessage {
  id: string;
  role: "user" | "agent" | "tool";
  content: string;
  metadata?: { tool?: string; status?: "running" | "done"; toolCallId?: string; subMessages?: { role: string; content: string }[] };
  timestamp: string;
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
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [status, setStatus] = useState<"idle" | "generating">("idle");
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { setNovel } = useNovel();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || status === "generating") return;
    const userMsg: AgentMessage = {
      id: Math.random().toString(36).slice(2),
      role: "user", content: input.trim(),
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setStatus("generating");

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMsg],
          context: { novelTitle, characters, novelText, continueFromOffset, continueFromLabel },
        }),
        signal: abort.signal,
      });
      if (!res.ok) throw new Error("Failed");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");
      const decoder = new TextDecoder();
      let buffer = "";
      let agentContent = "";
      let currentTextMsgId: string | null = Math.random().toString(36).slice(2);

      // First agent message — will be replaced if not used
      const firstId = currentTextMsgId;
      setMessages(prev => [...prev, {
        id: firstId, role: "agent", content: "",
        timestamp: new Date().toISOString(),
      }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));

            if (event.type === "chunk") {
              agentContent = event.content;
              if (!currentTextMsgId) {
                currentTextMsgId = Math.random().toString(36).slice(2);
                const id = currentTextMsgId;
                setMessages(prev => [...prev, {
                  id, role: "agent", content: "",
                  timestamp: new Date().toISOString(),
                }]);
              }
              setMessages(prev => prev.map(m =>
                m.id === currentTextMsgId ? { ...m, content: agentContent } : m
              ));
            } else if (event.type === "tool_chunk") {
              setMessages(prev => prev.map(m =>
                m.metadata?.toolCallId === event.toolCallId
                  ? { ...m, content: event.content }
                  : m
              ));
              if (event.tool === "write_prose") {
                setNovel({ generatedProse: event.content });
              }
            } else if (event.type === "tool_call") {
              if (event.status === "running") {
                currentTextMsgId = null;
                setMessages(prev => [...prev, {
                  id: Math.random().toString(36).slice(2), role: "tool", content: "",
                  metadata: { tool: event.tool, status: "running", toolCallId: event.toolCallId },
                  timestamp: new Date().toISOString(),
                }]);
              } else if (event.status === "done") {
                currentTextMsgId = null;
                setMessages(prev => {
                  const existing = prev.find(m => m.metadata?.toolCallId === event.toolCallId);
                  const data = { content: event.result || "", metadata: { tool: event.tool, status: "done" as const, toolCallId: event.toolCallId, subMessages: event.messages || [] } };
                  if (existing) {
                    return prev.map(m => m.id === existing.id ? { ...m, ...data } : m);
                  }
                  return [...prev, { id: Math.random().toString(36).slice(2), role: "tool", ...data, timestamp: new Date().toISOString() }];
                });
              }
            } else if (event.type === "error") {
              if (currentTextMsgId) {
                setMessages(prev => prev.map(m =>
                  m.id === currentTextMsgId ? { ...m, content: "**出错了**: " + event.message } : m
                ));
              } else {
                setMessages(prev => [...prev, {
                  id: Math.random().toString(36).slice(2),
                  role: "agent", content: "**出错了**: " + event.message,
                  timestamp: new Date().toISOString(),
                }]);
              }
            } else if (event.type === "stopped") {
              if (currentTextMsgId) {
                setMessages(prev => prev.map(m =>
                  m.id === currentTextMsgId && !m.content ? { ...m, content: "**已停止**" } : m
                ));
              } else {
                setMessages(prev => [...prev, {
                  id: Math.random().toString(36).slice(2),
                  role: "agent", content: "**已停止**",
                  timestamp: new Date().toISOString(),
                }]);
              }
            }
          } catch {}
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setMessages(prev => [...prev, {
          id: Math.random().toString(36).slice(2),
          role: "agent", content: "**连接失败**: " + (e as Error).message,
          timestamp: new Date().toISOString(),
        }]);
      }
    }
    abortRef.current = null;
    setStatus("idle");
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const toolNames: Record<string, string> = {
    generate_outline: "大纲 Agent", write_prose: "Writer Agent",
    review_character: "角色审查", review_continuity: "连贯性审查",
    review_foreshadowing: "伏笔审查", review_style: "风格审查",
    review_world: "世界观审查", review_pacing: "节奏审查",
    get_novel_context: "获取原文", get_characters: "获取角色",
    get_timeline: "获取时间线", get_codex: "获取创作法典",
    get_world_bible: "获取世界观",
  };

  return (
    <div className="flex flex-col h-full bg-[#0c0c0c]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-800/40 shrink-0">
        <div className="flex items-center gap-2">
          <Bot className="w-3.5 h-3.5 text-orange-500" />
          <h3 className="text-[10px] font-semibold text-neutral-400 font-mono uppercase tracking-widest">主编 Agent</h3>
        </div>
        {status === "generating" && (
          <span className="text-[9px] text-orange-500 font-mono flex items-center gap-1">
            <Loader2 className="w-2.5 h-2.5 animate-spin" />工作中
          </span>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-8 text-neutral-600 text-xs font-mono">
            <Bot className="w-6 h-6 mx-auto mb-2 opacity-30" />
            我是你的创作助手。告诉我你想做什么——续写、修改大纲、检查 prose。
          </div>
        )}

        {messages.map(msg => {
          // Tool card
          if (msg.role === "tool") {
            const isRunning = msg.metadata?.status === "running";
            const isDone = msg.metadata?.status === "done";
            const isReview = msg.metadata?.tool?.startsWith("review_");
            const hasFindings = msg.content && !msg.content.includes('"findings":[]') && !msg.content.includes('"converged":true');
            return (
              <div key={msg.id} className={`${isDone && isReview && !hasFindings ? "py-1" : "bg-neutral-800/20 border border-neutral-700/50 rounded-lg p-2"}`}>
                <div className="flex items-center gap-2">
                  {isDone && isReview && !hasFindings ? (
                    <span className="text-[10px] text-green-600 font-mono">✓ {toolNames[msg.metadata?.tool || ""] || msg.metadata?.tool}</span>
                  ) : (
                    <>
                      <Wrench className="w-3 h-3 text-neutral-500" />
                      <span className="text-[10px] text-neutral-400 font-mono">
                        {toolNames[msg.metadata?.tool || ""] || msg.metadata?.tool}
                      </span>
                      <span className={`w-2 h-2 rounded-full ml-auto ${isRunning ? "bg-orange-500 animate-pulse" : "bg-green-500"}`} />
                      <span className="text-[9px] text-neutral-600 font-mono">
                        {isRunning ? "执行中" : "完成"}
                      </span>
                    </>
                  )}
                </div>
                {/* Streamed content while running */}
                {isRunning && msg.content && (
                  <pre className="mt-2 text-[11px] text-neutral-400 font-mono leading-relaxed whitespace-pre-wrap max-h-[300px] overflow-y-auto bg-[#080808] rounded p-2">{msg.content}</pre>
                )}
                {/* Final result when done — only show expandable for non-trivial results */}
                {isDone && msg.content && !(isReview && !hasFindings) && (
                  <details className="mt-1">
                    <summary className="text-[10px] text-neutral-500 cursor-pointer hover:text-neutral-400">查看结果 ({msg.content.length} 字符)</summary>
                    <pre className="mt-1 text-[11px] text-neutral-400 font-mono leading-relaxed whitespace-pre-wrap max-h-[200px] overflow-y-auto bg-[#080808] rounded p-2">{msg.content.slice(0, 5000)}</pre>
                  </details>
                )}
              </div>
            );
          }

          // Chat bubble
          return (
            <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[90%] rounded-lg px-3 py-2 text-xs ${
                msg.role === "user"
                  ? "bg-orange-600/20 text-orange-300 border border-orange-600/20"
                  : "bg-neutral-800/50 text-neutral-300 border border-neutral-700/50"
              }`}>
                {msg.content ? (
                  <div className="prose prose-invert prose-xs max-w-none">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                ) : (
                  <span className="text-neutral-500 italic">思考中...</span>
                )}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-neutral-800/40 shrink-0">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSend()}
            placeholder="告诉主编你想做什么..."
            disabled={status === "generating"}
            className="flex-1 bg-[#111110] border border-neutral-800 rounded px-3 py-1.5 text-xs text-neutral-300 font-mono outline-none focus:border-orange-600/50 disabled:opacity-50"
          />
          <button onClick={handleSend}
            disabled={status === "generating" || !input.trim()}
            className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white rounded text-xs font-mono transition-colors">
            <Send className="w-3 h-3" />
          </button>
          {status === "generating" && (
            <button onClick={handleStop}
              className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded text-xs font-mono transition-colors">
              停止
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
