"use client";

import { useState, useRef, useEffect } from "react";
import type { CharacterProfile } from "@/types";
import { buildCharacterSystemPrompt } from "@/core/simulation/types";
import { X, Send, Loader2, User } from "lucide-react";

interface Message {
  role: "character" | "user";
  content: string;
}

type UserRole = { type: "reader" } | { type: "character"; profile: CharacterProfile };

export default function CharacterChat({
  character,
  allCharacters,
  onClose,
}: {
  character: CharacterProfile;
  allCharacters: CharacterProfile[];
  onClose: () => void;
}) {
  const [userRole, setUserRole] = useState<UserRole>({ type: "reader" });
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Other characters the user can play as (exclude current chat character)
  const otherCharacters = allCharacters.filter((c) => c.id !== character.id);

  // Build greeting and system prompt based on user role
  const roleLabel = userRole.type === "reader" ? "读者" : userRole.profile.name;
  const greeting = userRole.type === "reader"
    ? `你好，我是${character.name}。很高兴有读者想了解我，你想聊什么？`
    : `（你正以 ${userRole.profile.name} 的身份与 ${character.name} 对话）`;

  // Initialize messages when role changes
  useEffect(() => {
    setMessages([{ role: "character", content: greeting }]);
  }, [userRole.type, userRole.type === "character" ? userRole.profile.id : null]);

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

      // Build meta-cognitive context about who the user is.
      // This is woven as part of the character's self-awareness, not a separate block.
      const roleMeta: string = userRole.type === "reader"
        ? [
            `## Your Current Situation`,
            `You are now speaking with a reader from the real world — a person who has read your story and wants to know you. They are NOT a character in your novel.`,
            `You are self-aware: you know you exist in a story, and you can reflect on your own narrative, relationships, and fate with the perspective of someone who has lived through it.`,
            `Break the fourth wall if it feels natural. Speak candidly about your feelings, regrets, hopes — things you might never say to another character.`,
            `Do not try to advance any plot. This is just a conversation between you and someone who admires you.`,
          ].join("\n")
        : [
            `## Your Current Situation`,
            `You are now speaking with ${userRole.profile.name}, a fellow character from your world.`,
            userRole.profile.personality
              ? `About them: ${userRole.profile.personality.traits.join("、")}。${userRole.profile.personality.description}`
              : "",
            userRole.profile.speakingStyle
              ? `They speak in this style: ${userRole.profile.speakingStyle}`
              : "",
            character.relationships.find((r) => r.characterName === userRole.profile.name)
              ? `Your relationship with them: ${character.relationships.find((r) => r.characterName === userRole.profile.name)!.description}`
              : `You know them from your world.`,
            `Stay fully in character within your story world. Do NOT break the fourth wall. React based on your personality and your relationship with ${userRole.profile.name}.`,
          ].filter(Boolean).join("\n");

      const systemPrompt = `${basePrompt}\n\n${roleMeta}`;
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
        <div className="p-4 border-b flex items-center justify-between gap-2">
          <h3 className="text-lg font-semibold shrink-0">💬 与 {character.name} 对话</h3>
          <div className="flex items-center gap-2">
            {/* Role selector */}
            {otherCharacters.length > 0 && (
              <select
                className="text-xs border rounded px-2 py-1 bg-background"
                value={userRole.type === "reader" ? "__reader__" : userRole.profile.id}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "__reader__") {
                    setUserRole({ type: "reader" });
                  } else {
                    const prof = allCharacters.find((c) => c.id === val);
                    if (prof) setUserRole({ type: "character", profile: prof });
                  }
                }}
              >
                <option value="__reader__">👤 我是读者</option>
                {otherCharacters.map((c) => (
                  <option key={c.id} value={c.id}>🎭 扮演 {c.name}</option>
                ))}
              </select>
            )}
            <button className="p-1 hover:bg-secondary rounded" onClick={onClose}>
              <X className="w-5 h-5" />
            </button>
          </div>
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
            placeholder={
              userRole.type === "reader"
                ? `以读者身份对 ${character.name} 说点什么...`
                : `以 ${userRole.profile.name} 的身份对 ${character.name} 说...`
            }
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
