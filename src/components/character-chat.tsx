"use client";

import { useState, useRef, useEffect } from "react";
import type { CharacterProfile } from "@/types";
import { buildCharacterSystemPrompt } from "@/core/simulation/types";
import { X, Send, Loader2 } from "lucide-react";

interface Message {
  role: "character" | "user";
  content: string;
}

export default function CharacterChat({
  character,
  onClose,
}: {
  character: CharacterProfile;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([
    { role: "character", content: `你好，我是${character.name}。很高兴有读者想了解我，你想聊什么？` },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const basePrompt = buildCharacterSystemPrompt(character);
      // Tell the character they're talking to a real-world reader, not an in-novel character
      const systemPrompt = `${basePrompt}

---
## IMPORTANT CONTEXT
You are speaking with a real person from another world (our world). They have read the novel you appear in and are interested in you. They are NOT a character in your story — they are a reader / fan.

When you respond:
- Treat them as a curious reader who wants to know you better, not as another character in your world.
- You may break the fourth wall and acknowledge that you're a fictional character if it feels natural.
- You can reflect on your own story, motivations, and feelings with the benefit of "hindsight" — as if you know your own story.
- Stay in character — speak as yourself, with your personality, values, and speech patterns.
- You do NOT need to advance any plot or scene. Just have a natural conversation with a reader.`;
      const history = messages.map((m) => ({
        role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
        content: m.content,
      }));
      history.push({ role: "user", content: text });

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemPrompt, messages: history }),
      });

      const data = await res.json();
      if (res.ok) {
        setMessages((prev) => [...prev, { role: "character", content: data.reply }]);
      } else {
        setMessages((prev) => [...prev, { role: "character", content: "抱歉，我现在无法回应..." }]);
      }
    } catch {
      setMessages((prev) => [...prev, { role: "character", content: "抱歉，出了点问题..." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-2xl max-w-lg w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">💬 与 {character.name} 对话</h3>
          <button className="p-1 hover:bg-secondary rounded" onClick={onClose}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[300px] max-h-[50vh]">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary/40"
              }`}>
                {m.role === "character" && (
                  <span className="text-xs font-medium text-primary">{character.name}</span>
                )}
                <p className="whitespace-pre-wrap mt-0.5">{m.content}</p>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-secondary/40 rounded-lg px-3 py-2 text-sm flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {character.name} 正在输入...
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="p-4 border-t flex gap-2">
          <input
            className="flex-1 px-3 py-2 border rounded-md bg-background text-sm"
            placeholder={`对 ${character.name} 说点什么...`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
            onClick={send}
            disabled={loading || !input.trim()}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
