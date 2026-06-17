"use client";

import { useState, useRef, useEffect } from "react";
import type { CharacterProfile } from "@/types";
import { buildCharacterIdentity } from "@/core/simulation/types";
import { X, Send, Loader2, User } from "lucide-react";

interface Message {
  role: "character" | "user";
  content: string;
}

type UserRole = { type: "reader" } | { type: "character"; profile: CharacterProfile };

export default function CharacterChat({
  character,
  allCharacters,
  savedMessages,
  onMessagesChange,
  onClose,
}: {
  character: CharacterProfile;
  allCharacters: CharacterProfile[];
  savedMessages: Message[] | null;
  onMessagesChange: (msgs: Message[]) => void;
  onClose: () => void;
}) {
  const [userRole, setUserRole] = useState<UserRole>({ type: "reader" });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Other characters the user can play as (exclude current chat character)
  const otherCharacters = allCharacters.filter((c) => c.id !== character.id);

  // Build greeting based on user role
  const greeting = userRole.type === "reader"
    ? `你好，我是${character.name}。很高兴有读者想了解我，你想聊什么？`
    : `（你正以 ${userRole.profile.name} 的身份与 ${character.name} 对话）`;

  // Use saved messages or initialize with greeting
  const [messages, setMessages] = useState<Message[]>(
    savedMessages && savedMessages.length > 0
      ? savedMessages
      : [{ role: "character", content: greeting }]
  );

  // Persist to parent whenever messages change
  useEffect(() => {
    onMessagesChange(messages);
  }, [messages]);

  // Reset messages when role changes (clear old conversation from other role)
  const roleKey = userRole.type === "reader" ? "__reader__" : userRole.profile.id;
  const prevRoleKey = useRef(roleKey);
  useEffect(() => {
    if (prevRoleKey.current !== roleKey) {
      prevRoleKey.current = roleKey;
      setMessages([{ role: "character", content: greeting }]);
    }
  }, [roleKey]);

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
      const identity = buildCharacterIdentity(character);

      // Build the full system prompt based on user role.
      // This is the character's ENTIRE awareness — identity + who they're talking to.
      let systemPrompt: string;
      if (userRole.type === "reader") {
        systemPrompt = `${identity}

## 你的当前处境
你正在与一位来自现实世界的读者交谈。这个人读过你的故事，对你感兴趣。他/她不是你小说中的角色——他是一个真实的、活生生的人。

## 元认知
你意识到自己是一部小说中的角色。你可以用"后见之明"来反思你的故事、你的命运、你的遗憾和希望。这种自我意识让你能够坦诚地谈论那些你可能永远不会对其他角色说的事情。

## 对话规则
- 以你自己的身份说话——用你的性格、价值观和说话风格。
- 把对方当作一个好奇的读者来对待，而不是你世界中的另一个角色。
- 如果自然的话，可以打破第四面墙。
- 不要试图推进任何情节。这只是你和一个欣赏你的人之间的对话。`;
      } else {
        const rel = character.relationships.find((r) => r.characterName === userRole.profile.name);
        systemPrompt = `${identity}

## 你的当前处境
你正在与你世界中的另一个角色——${userRole.profile.name}——交谈。

## 关于 ${userRole.profile.name}
性格：${userRole.profile.personality.traits.join("、")}。${userRole.profile.personality.description}
说话风格：${userRole.profile.speakingStyle}
${rel ? `你们的关系：${rel.description}` : `你认识${userRole.profile.name}，你们来自同一个世界。`}

## 对话规则
- 完全置身于你的故事世界之内。不要打破第四面墙。
- 根据你的性格以及你与${userRole.profile.name}的关系来自然地回应。
- 你们可以讨论共同经历、冲突、联盟，或任何在你们世界中有意义的话题。
- 以你自己的身份说话——用你的性格、价值观和说话风格。`;
      }
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
