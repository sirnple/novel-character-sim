"use client";

import { useState } from "react";
import type { CharacterProfile } from "@/types";
import { Users, Loader2, ChevronDown, ChevronUp, Edit3, Download, MessageCircle } from "lucide-react";
import CharacterEditor from "./character-editor";
import CharacterChat from "./character-chat";

interface CharacterCardsProps {
  characters: CharacterProfile[];
  loading: boolean;
  error: string;
  onExtract: (text: string) => void;
  onCancelExtraction: () => void;
  onUpdate: (characters: CharacterProfile[]) => void;
  novelText: string;
}

export default function CharacterCards({
  characters,
  loading,
  error,
  onCancelExtraction,
  onExtract,
  onUpdate,
  novelText,
}: CharacterCardsProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [chattingId, setChattingId] = useState<string | null>(null);

  // Persist chat histories across dialog open/close
  const [chatHistories, setChatHistories] = useState<
    Record<string, { role: "character" | "user"; content: string }[]>
  >({});

  const handleDelete = (id: string) => {
    onUpdate(characters.filter((c) => c.id !== id));
  };

  const exportAgentCard = (char: CharacterProfile) => {
    const safeName = char.name.replace(/[^a-zA-Z0-9一-鿿]/g, "-").toLowerCase();
    const traits = char.personality.traits.join("、");
    const yaml = `---
name: ${safeName}
description: 小说角色 "${char.name}"（${traits}）。用于角色扮演和对话模拟。
tools: Read, Write, Edit, Glob, Grep
model: inherit
color: orange
---

# ${char.name}

## 身份
${char.aliases.length > 0 ? `别名：${char.aliases.join("、")}\n` : ""}
背景：${char.background}

## 性格特征
${char.personality.traits.map((t) => `- ${t}`).join("\n")}

${char.personality.description}

## 行为模式
${char.behavior.patterns.map((p) => `- ${p}`).join("\n")}

## 习惯与癖好
${char.behavior.habits.map((h) => `- ${h}`).join("\n")}

## 世界观
${char.worldview}

## 核心价值观
${char.values.map((v) => `- ${v}`).join("\n")}

## 说话风格
${char.speakingStyle}

## 人际关系
${char.relationships.map((r) => `- ${r.characterName}：${r.type} — ${r.description}`).join("\n")}

## 指令
你是${char.name}，你必须以${char.name}的身份说话和行动。
- 保持上述性格特征，用上述说话风格表达
- 基于你的世界观和价值观做出决定和回应
- 时刻考虑你与他人的关系
- 回应时包含对话、动作和内心想法
- 不要打破角色，始终保持在角色内
`;

    const blob = new Blob([yaml], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${char.name}_subagent.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-foreground">
          第二步：角色
        </h2>
        {characters.length > 0 && (
          <span className="text-sm text-muted-foreground">
            找到 {characters.length} 个角色
          </span>
        )}
      </div>

      {!characters.length && !loading && (
        <div className="text-center py-12 border-2 border-dashed rounded-lg">
          <Users className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground mb-4">
            从上传的小说中提取角色
          </p>
          <button
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
            disabled={loading || !novelText}
            onClick={() => onExtract(novelText)}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                正在提取...
              </span>
            ) : (
              "提取角色"
            )}
          </button>
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            正在分析小说并提取角色...
          </div>
          <button
            className="px-4 py-1.5 border border-destructive/50 text-destructive rounded-md text-sm hover:bg-destructive/10 transition-colors"
            onClick={onCancelExtraction}
          >
            取消提取
          </button>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      {editingId && (
        <CharacterEditor
          profile={characters.find((c) => c.id === editingId)!}
          allCharacters={characters}
          onSave={(updated) => {
            onUpdate(
              characters.map((c) => (c.id === updated.id ? updated : c))
            );
            setEditingId(null);
          }}
          onCancel={() => setEditingId(null)}
        />
      )}

      {chattingId && (
        <CharacterChat
          character={characters.find((c) => c.id === chattingId)!}
          allCharacters={characters}
          savedMessages={chatHistories[chattingId] || null}
          onMessagesChange={(msgs) =>
            setChatHistories((prev) => ({ ...prev, [chattingId]: msgs }))
          }
          onClose={() => setChattingId(null)}
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {characters.map((char) => (
          <div
            key={char.id}
            className="border rounded-lg bg-card text-card-foreground shadow-sm"
          >
            <div
              className="p-4 cursor-pointer"
              onClick={() =>
                setExpandedId(expandedId === char.id ? null : char.id)
              }
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-lg">{char.name}</h3>
                  {char.aliases.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      别名：{char.aliases.join("、")}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="p-1 hover:bg-secondary rounded"
                    onClick={(e) => {
                      e.stopPropagation();
                      setChattingId(char.id);
                    }}
                    title="对话"
                  >
                    <MessageCircle className="w-4 h-4 text-muted-foreground" />
                  </button>
                  <button
                    className="p-1 hover:bg-secondary rounded"
                    onClick={(e) => {
                      e.stopPropagation();
                      exportAgentCard(char);
                    }}
                    title="导出人物卡"
                  >
                    <Download className="w-4 h-4 text-muted-foreground" />
                  </button>
                  <button
                    className="p-1 hover:bg-secondary rounded"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingId(char.id);
                    }}
                  >
                    <Edit3 className="w-4 h-4 text-muted-foreground" />
                  </button>
                  {expandedId === char.id ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-1 mt-2">
                {char.personality.traits.slice(0, 5).map((trait) => (
                  <span
                    key={trait}
                    className="px-2 py-0.5 text-xs rounded-full bg-primary/10 text-primary"
                  >
                    {trait}
                  </span>
                ))}
              </div>
            </div>

            {expandedId === char.id && (
              <div className="px-4 pb-4 border-t pt-3 space-y-3 text-sm">
                <div>
                  <h4 className="font-medium text-foreground/80">Personality</h4>
                  <p className="text-muted-foreground mt-1">
                    {char.personality.description}
                  </p>
                </div>

                <div>
                  <h4 className="font-medium text-foreground/80">Behavior</h4>
                  <ul className="list-disc list-inside text-muted-foreground mt-1">
                    {char.behavior.patterns.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                    {char.behavior.habits.map((h, i) => (
                      <li key={`h-${i}`}>{h}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h4 className="font-medium text-foreground/80">Worldview</h4>
                  <p className="text-muted-foreground mt-1">{char.worldview}</p>
                </div>

                <div>
                  <h4 className="font-medium text-foreground/80">Values</h4>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {char.values.map((v) => (
                      <span
                        key={v}
                        className="px-2 py-0.5 text-xs rounded-full bg-secondary text-secondary-foreground"
                      >
                        {v}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="font-medium text-foreground/80">
                    Speaking Style
                  </h4>
                  <p className="text-muted-foreground mt-1">
                    {char.speakingStyle}
                  </p>
                </div>

                {char.relationships.length > 0 && (
                  <div>
                    <h4 className="font-medium text-foreground/80">
                      Relationships
                    </h4>
                    <ul className="space-y-1 mt-1">
                      {char.relationships.map((r, i) => (
                        <li key={i} className="text-muted-foreground">
                          <span className="font-medium">{r.characterName}</span>{" "}
                          <span className="text-xs bg-secondary px-1.5 py-0.5 rounded">
                            {r.type}
                          </span>{" "}
                          — {r.description}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <button
                  className="text-xs text-destructive hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(char.id);
                  }}
                >
                  删除角色
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
