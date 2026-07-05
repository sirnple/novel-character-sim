"use client";

import { useState } from "react";
import type { CharacterProfile, ChapterTimeline, CharacterChapterState } from "@/types";
import { Users, Loader2, ChevronDown, ChevronUp, Edit3, Download, MessageCircle, Clock, ChevronRight } from "lucide-react";
import { useRateLimitCooldown, useRateLimitTip } from "@/lib/rate-limit-ui";
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
  timeline?: ChapterTimeline | null;
  lastChapterStates?: CharacterChapterState[];
}

export default function CharacterCards({
  characters,
  loading,
  error,
  onCancelExtraction,
  onExtract,
  onUpdate,
  novelText,
  timeline,
  lastChapterStates,
}: CharacterCardsProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [chattingId, setChattingId] = useState<string | null>(null);
  const [expandedChapters, setExpandedChapters] = useState<Set<number>>(new Set());

  const toggleChapter = (chNum: number) => {
    setExpandedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(chNum)) next.delete(chNum);
      else next.add(chNum);
      return next;
    });
  };
  const rateLimitHint = useRateLimitCooldown(error);
  const extractLimitTip = useRateLimitTip("extract");

  // Persist chat histories across dialog open/close
  const [chatHistories, setChatHistories] = useState<
    Record<string, { role: "character" | "user"; content: string }[]>
  >({});

  // Load persisted chat history from server when opening a chat


  const openChat = (charId: string) => {
    fetch(`/api/chat/history?characterId=${charId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.messages) {
          setChatHistories((prev) => ({ ...prev, [charId]: data.messages }));
        }
      })
      .catch(() => {});
    setChattingId(charId);
  };

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

## 外貌
${char.appearance.summary}

## 身份
${char.aliases.length > 0 ? `别名：${char.aliases.join("、")}\n` : ""}
出身：${char.background.origin}
关键事件：${char.background.keyEvents.join("；")}
${char.background.description}

## 性格特征
${char.personality.traits.map((t) => `- ${t}`).join("\n")}
${char.personality.description}
决策风格：${char.personality.decisionStyle}
压力反应：${char.personality.underPressure}

## 驱动力
- 目标：${char.drive.goal}
- 动机：${char.drive.motivation}
- 恐惧：${char.drive.fear}
- 弱点：${char.drive.weakness}
- 底线：${char.drive.bottomLine}
- 秘密：${char.drive.secret}

## 行为模式
${char.behavior.patterns.map((p) => `- ${p}`).join("\n")}
习惯：${char.behavior.habits.join("、")}
对权威：${char.behavior.attitudeToAuthority}

## 世界观
${char.worldview}

## 核心价值观
${char.values.map((v) => `- ${v}`).join("\n")}

## 说话风格
${char.speakingStyle.description}
口头禅：${char.speakingStyle.catchphrases.join("、")}
句式：${char.speakingStyle.sentenceStyle}
词汇：${char.speakingStyle.vocabulary}
情绪表达：${char.speakingStyle.emotionalExpression}

## 人际关系
${char.relationships.map((r) => `- ${r.characterName}：${r.type} — ${r.description}（${r.history}。动态：${r.dynamics}）`).join("\n")}

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
          {extractLimitTip && <p className="text-xs text-muted-foreground mt-1">{extractLimitTip}</p>}
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
        <div className={`p-3 rounded-md text-sm ${rateLimitHint ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-destructive/10 text-destructive"}`}>
          {rateLimitHint || error}
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
                      openChat(char.id);
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
                {char.appearance.summary && (
                  <div>
                    <h4 className="font-medium text-foreground/80">Appearance</h4>
                    <p className="text-muted-foreground mt-1">{char.appearance.summary}</p>
                  </div>
                )}

                <div>
                  <h4 className="font-medium text-foreground/80">Personality</h4>
                  <p className="text-muted-foreground mt-1">{char.personality.description}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-muted-foreground/70">
                    <span>决策：{char.personality.decisionStyle}</span>
                    <span>压力下：{char.personality.underPressure}</span>
                  </div>
                </div>

                {(char.drive?.goal || char.drive?.fear || char.drive?.secret) && (
                  <div>
                    <h4 className="font-medium text-foreground/80">Drive & Motivation</h4>
                    <div className="space-y-0.5 mt-1 text-muted-foreground">
                      {char.drive.goal && <p>🎯 目标：{char.drive.goal}</p>}
                      {char.drive.motivation && <p>💡 动机：{char.drive.motivation}</p>}
                      {char.drive.fear && <p>😨 恐惧：{char.drive.fear}</p>}
                      {char.drive.weakness && <p>⚠️ 弱点：{char.drive.weakness}</p>}
                      {char.drive.bottomLine && <p>🚫 底线：{char.drive.bottomLine}</p>}
                      {char.drive.secret && <p>🔒 秘密：{char.drive.secret}</p>}
                    </div>

                  </div>
                )}

                <div>
                  <h4 className="font-medium text-foreground/80">Behavior</h4>
                  <ul className="list-disc list-inside text-muted-foreground mt-1">
                    {char.behavior.patterns.map((p, i) => (<li key={i}>{p}</li>))}
                    {char.behavior.habits.map((h, i) => (<li key={`h-${i}`}>{h}</li>))}
                  </ul>
                  {char.behavior.attitudeToAuthority && (
                    <p className="text-xs text-muted-foreground/70 mt-1">对权威：{char.behavior.attitudeToAuthority}</p>
                  )}
                </div>

                <div>
                  <h4 className="font-medium text-foreground/80">Worldview</h4>
                  <p className="text-muted-foreground mt-1">{char.worldview}</p>
                </div>

                <div>
                  <h4 className="font-medium text-foreground/80">Values</h4>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {char.values.map((v) => (<span key={v} className="px-2 py-0.5 text-xs rounded-full bg-secondary text-secondary-foreground">{v}</span>))}
                  </div>
                </div>

                <div>
                  <h4 className="font-medium text-foreground/80">Speaking Style</h4>
                  <p className="text-muted-foreground mt-1">{char.speakingStyle.description}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-muted-foreground/70">
                    {char.speakingStyle.catchphrases.length > 0 && <span>口头禅：{char.speakingStyle.catchphrases.join("、")}</span>}
                    {char.speakingStyle.sentenceStyle && <span>句式：{char.speakingStyle.sentenceStyle}</span>}
                    {char.speakingStyle.vocabulary && <span>词汇：{char.speakingStyle.vocabulary}</span>}
                  </div>
                </div>

                <div>
                  <h4 className="font-medium text-foreground/80">Background</h4>
                  {char.background.origin && <p className="text-muted-foreground text-xs mt-0.5">出身：{char.background.origin}</p>}
                  {char.background.keyEvents.length > 0 && <p className="text-muted-foreground text-xs mt-0.5">关键事件：{char.background.keyEvents.join("；")}</p>}
                  <p className="text-muted-foreground mt-1">{char.background.description}</p>
                </div>

                {char.relationships.length > 0 && (
                  <div>
                    <h4 className="font-medium text-foreground/80">Relationships</h4>
                    <ul className="space-y-2 mt-1">
                      {char.relationships.map((r, i) => (
                        <li key={i} className="text-muted-foreground">
                          <span className="font-medium">{r.characterName}</span>{" "}
                          <span className="text-xs bg-secondary px-1.5 py-0.5 rounded">{r.type}</span>
                          <p className="text-xs mt-0.5">{r.description}</p>
                          {(r.history || r.dynamics) && (
                            <p className="text-xs text-muted-foreground/60 mt-0.5">
                              {r.history && `相识：${r.history}`}{r.history && r.dynamics && " · "}{r.dynamics && `动态：${r.dynamics}`}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <button className="text-xs text-destructive hover:underline" onClick={(e) => { e.stopPropagation(); handleDelete(char.id); }}>
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
