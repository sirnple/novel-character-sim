"use client";

import { useState, useRef, useEffect } from "react";
import type { CharacterProfile, SceneDefinition, SimulationRound, WritingStyle, SceneOutline } from "@/types";
import type { SimulationEvent } from "@/core/simulation/engine";
import { Loader2, MessageCircle, BookOpen, StopCircle, ArrowUp, ArrowDown, Eye, X, ScrollText, Target, Activity } from "lucide-react";
import NovelOutput from "./novel-output";
import type { ChannelMessage } from "@/types";

interface SimulationRunnerProps {
  novelTitle: string;
  characters: CharacterProfile[];
  scene: SceneDefinition;
  writingStyle?: WritingStyle;
  onBack: () => void;
  onComplete?: (fullNovel: string) => void;
  initialFullNovel?: string;
  cachedOutline?: SceneOutline | null;
  onCacheOutline?: (outline: SceneOutline) => void;
}

export default function SimulationRunner({
  novelTitle,
  characters,
  scene,
  writingStyle,
  onBack,
  onComplete,
  initialFullNovel,
  cachedOutline,
  onCacheOutline,
}: SimulationRunnerProps) {
  const [status, setStatus] = useState<"connecting" | "running" | "completed" | "error">("connecting");
  const [rounds, setRounds] = useState<SimulationRound[]>([]);
  const [currentEvent, setCurrentEvent] = useState<string>("");
  const [fullNovel, setFullNovel] = useState(initialFullNovel || "");
  const [error, setError] = useState("");
  const [outline, setOutline] = useState<SceneOutline | null>(null);
  const [activeTab, setActiveTab] = useState<"live" | "novel">("live");
  const [charDetail, setCharDetail] = useState<string | null>(null); // character name for detail view
  const abortRef = useRef<AbortController | null>(null);

  // Collect all channel messages for character detail view
  const allMessages = rounds.flatMap((r) => r.channelMessages || []);

  useEffect(() => {
    startSimulation();
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const startSimulation = async () => {
    setStatus("connecting");
    setError("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/simulation/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ novelTitle, characters, scene, writingStyle, outline: cachedOutline }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Server error: ${res.status}`);
      }

      setStatus("running");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const event: SimulationEvent = JSON.parse(line.slice(6));
              handleEvent(event);
            } catch {
              // skip malformed JSON
            }
          }
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setStatus("error");
      setError(e instanceof Error ? e.message : "Simulation failed");
    }
  };

  const handleEvent = (event: SimulationEvent) => {
    switch (event.type) {
      case "round_start":
        setCurrentEvent(`第 ${event.round} 轮开始`);
        break;
      case "outline":
        setOutline(event.outline);
        setCurrentEvent(`📋 剧本大纲已生成：${event.outline.sceneTitle}`);
        if (onCacheOutline) onCacheOutline(event.outline);
        break;
      case "director":
        setCurrentEvent(`导演：${event.decision.sceneDevelopment}`);
        break;
      case "character_responding":
        setCurrentEvent(`${event.characterName} 正在思考...`);
        break;
      case "character_response":
        const chLabel = (event as any).channelId !== "public" ? "🔒" : "📢";
        setCurrentEvent(`${chLabel} ${event.characterName} 发言`);
        setRounds((prev) => {
          const last = prev[prev.length - 1];
          if (last && !last.characterResponses?.some((cr: any) => cr.characterName === event.characterName)) {
            const newResp = {
              characterId: "",
              characterName: event.characterName,
              dialogue: event.dialogue,
              actions: event.actions,
              innerThoughts: event.innerThoughts,
              channelId: (event as any).channelId,
            };
            const newMsg: ChannelMessage = {
              id: Math.random().toString(36).slice(2),
              fromCharacterId: "",
              fromCharacterName: event.characterName,
              channelId: (event as any).channelId || "public",
              dialogue: event.dialogue,
              actions: event.actions,
              innerThoughts: event.innerThoughts,
              timestamp: Date.now(),
            };
            return [
              ...prev.slice(0, -1),
              {
                ...last,
                characterResponses: [...(last.characterResponses || []), newResp],
                channelMessages: [...(last.channelMessages || []), newMsg],
              },
            ];
          }
          return prev;
        });
        break;
      case "recording":
        setCurrentEvent("记录者正在写作...");
        break;
      case "prose":
        setCurrentEvent("");
        setRounds((prev) => {
          const last = prev[prev.length - 1];
          if (last) {
            return [...prev.slice(0, -1), { ...last, proseOutput: event.prose }];
          }
          return [
            {
              roundNumber: 1,
              directorAction: "",
              channelMessages: [],
              characterResponses: [],
              proseOutput: event.prose,
            },
          ];
        });
        setFullNovel((prev) => prev + (prev ? "\n\n" : "") + event.prose);
        break;
      case "round_end":
        // Ensure the round has a prose output
        setRounds((prev) => {
          const last = prev[prev.length - 1];
          if (last && !last.proseOutput) {
            return prev;
          }
          // Add a placeholder for the next round
          return [
            ...prev,
            {
              roundNumber: event.round + 1,
              directorAction: "",
              channelMessages: [],
              characterResponses: [],
              proseOutput: "",
            },
          ];
        });
        break;
      case "scene_end":
        setStatus("completed");
        setFullNovel(event.fullNovel);
        setCurrentEvent("");
        if (onComplete) onComplete(event.fullNovel);
        // Remove the placeholder last round if empty
        setRounds((prev) => {
          const last = prev[prev.length - 1];
          if (last && !last.proseOutput && !last.directorAction) {
            return prev.slice(0, -1);
          }
          return prev;
        });
        break;
      case "error":
        setStatus("error");
        setError(event.message);
        break;
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setStatus("completed");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">
            {scene.location}
          </h2>
          <p className="text-sm text-muted-foreground">
            {scene.atmosphere} · {scene.timeOfDay} · {characters.map((c) => c.name).join("、")}
          </p>
          <span className={`inline-block mt-1 px-2 py-0.5 rounded text-xs font-medium ${scene.mode === "free" ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"}`}>
            {scene.mode === "free" ? "🗣 自由对话" : "🎬 导演模式"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="px-3 py-1.5 border rounded-md text-sm flex items-center gap-1 hover:bg-secondary transition-colors"
            onClick={onBack}
          >
            ← 返回
          </button>
          {status === "running" && (
            <button
              className="px-3 py-1.5 border border-destructive text-destructive rounded-md text-sm flex items-center gap-1 hover:bg-destructive/10 transition-colors"
              onClick={handleStop}
            >
              <StopCircle className="w-4 h-4" />
              停止
            </button>
          )}
          <span
            className={`px-2 py-1 rounded-full text-xs font-medium ${
              status === "running"
                ? "bg-green-100 text-green-700"
                : status === "completed"
                ? "bg-blue-100 text-blue-700"
                : status === "error"
                ? "bg-red-100 text-red-700"
                : "bg-yellow-100 text-yellow-700"
            }`}
          >
            {status === "connecting"
              ? "连接中..."
              : status === "running"
              ? "运行中"
              : status === "completed"
              ? "已完成"
              : "错误"}
          </span>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      {/* Scene Outline */}
      {outline && scene.mode === "director" && (
        <div className="border rounded-lg overflow-hidden bg-gradient-to-r from-orange-50/50 to-amber-50/50">
          <div className="bg-orange-100/60 px-4 py-3 border-b flex items-center gap-2">
            <ScrollText className="w-5 h-5 text-orange-600" />
            <span className="font-semibold text-orange-800">📋 {outline.sceneTitle}</span>
          </div>
          <div className="p-4 space-y-3">
            {/* Goal */}
            <div className="flex items-start gap-2">
              <Target className="w-4 h-4 text-orange-500 mt-0.5 shrink-0" />
              <p className="text-sm text-foreground/80"><span className="font-medium">场景目标：</span>{outline.sceneGoal}</p>
            </div>

            {/* Beats */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                <Activity className="w-3.5 h-3.5" /> 情节节拍
              </p>
              <div className="space-y-2">
                {outline.beats.map((beat, i) => {
                  const currentBeat = outline.beats.findIndex(
                    (b) => rounds.length > 0 && b.beatNumber === outline.beats[Math.min(rounds.length, outline.beats.length - 1)]?.beatNumber
                  );
                  const isDone = i < (rounds.length > 0 ? Math.min(rounds.length, outline.beats.length) : 0);
                  const isCurrent = !isDone && i === (rounds.length > 0 ? Math.min(rounds.length, outline.beats.length) : 0);
                  return (
                    <div
                      key={beat.beatNumber}
                      className={`flex items-start gap-3 p-2.5 rounded-md text-sm transition-colors ${
                        isCurrent
                          ? "bg-orange-100/80 border border-orange-300"
                          : isDone
                          ? "bg-green-50/50 opacity-60"
                          : "bg-white/60"
                      }`}
                    >
                      <span className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        isCurrent
                          ? "bg-orange-500 text-white"
                          : isDone
                          ? "bg-green-500 text-white"
                          : "bg-muted text-muted-foreground"
                      }`}>
                        {isDone ? "✓" : beat.beatNumber}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className={`${isCurrent ? "font-medium text-foreground" : "text-foreground/70"}`}>
                          {beat.description}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          <span className="text-xs bg-secondary px-1.5 py-0.5 rounded text-muted-foreground">
                            {beat.mood}
                          </span>
                          {beat.activeCharacters.map((name) => (
                            <span key={name} className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                              {name}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Emotional Arc + Ending */}
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
              <span>🎭 情感弧线：{outline.emotionalArc}</span>
              <span>🏁 结局：{outline.sceneEnding}</span>
              <span className="text-orange-600 font-medium">预计 {outline.estimatedRounds} 轮</span>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "live"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("live")}
        >
          <MessageCircle className="w-4 h-4 inline mr-1" />
          实时
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "novel"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("novel")}
        >
          <BookOpen className="w-4 h-4 inline mr-1" />
          小说
        </button>
      </div>

      {activeTab === "live" ? (
        <div className="space-y-4">
          {status === "connecting" && (
            <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
              Connecting to simulation...
            </div>
          )}

          {currentEvent && status === "running" && (
            <div className="flex items-center gap-2 p-3 bg-accent/5 rounded-md">
              <Loader2 className="w-4 h-4 animate-spin text-primary flex-shrink-0" />
              <span className="text-sm">{currentEvent}</span>
            </div>
          )}

          {rounds
            .filter((r) => r.proseOutput || r.characterResponses.length > 0)
            .map((round) => (
              <div key={round.roundNumber} className="border rounded-lg overflow-hidden">
                <div className="bg-secondary/50 px-4 py-2 border-b">
                  <span className="text-sm font-semibold">第 {round.roundNumber} 轮</span>
                  {round.directorAction && scene.mode === "director" && (
                    <p className="text-xs text-muted-foreground mt-0.5">🎬 {round.directorAction}</p>
                  )}
                </div>

                {round.characterResponses.length > 0 && (
                  <div className="p-4 space-y-3">
                    {round.characterResponses.map((cr: any, i: number) => {
                      const isPrivate = cr.channelId && cr.channelId !== "public";
                      return (
                      <div key={i} className={`text-sm ${scene.mode === "free" ? "flex gap-3 items-start" : ""}`}>
                        {scene.mode === "free" ? (
                          <>
                            <span className="font-semibold text-primary shrink-0 min-w-[3rem] cursor-pointer hover:underline"
                              onClick={(e) => { e.stopPropagation(); setCharDetail(cr.characterName); }}>{cr.characterName}</span>
                            <div className={`flex-1 rounded-lg px-3 py-2 ${isPrivate ? "bg-purple-50 border border-purple-200" : "bg-secondary/40"}`}>
                              {isPrivate && <span className="text-xs text-purple-500 font-medium">🔒 私信</span>}
                              <p className="italic">&ldquo;{cr.dialogue}&rdquo;</p>
                              {cr.actions && <p className="text-xs text-muted-foreground mt-1">{cr.actions}</p>}
                              {cr.innerThoughts && <p className="text-xs text-muted-foreground/50 mt-0.5">💭 {cr.innerThoughts}</p>}
                            </div>
                          </>
                        ) : (
                          <>
                            <span className="font-semibold cursor-pointer hover:underline"
                              onClick={() => setCharDetail(cr.characterName)}>{cr.characterName}{isPrivate ? " 🔒" : ""}：</span>
                            <span className="italic">&ldquo;{cr.dialogue}&rdquo;</span>
                            {cr.actions && <p className="text-muted-foreground mt-0.5">{cr.actions}</p>}
                            {cr.innerThoughts && <p className="text-xs text-muted-foreground/60 mt-0.5">💭 {cr.innerThoughts}</p>}
                          </>
                        )}
                      </div>
                    )})}
                  </div>
                )}
              </div>
            ))}
        </div>
      ) : (
        <NovelOutput
          title={novelTitle}
          content={fullNovel}
          isComplete={status === "completed"}
        />
      )}

      {/* Character Detail Modal */}
      {charDetail && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setCharDetail(null)}>
          <div className="bg-card rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-card p-4 border-b flex items-center justify-between">
              <h3 className="text-lg font-semibold">👤 {charDetail} 的视角</h3>
              <button className="p-1 hover:bg-secondary rounded" onClick={() => setCharDetail(null)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              {allMessages
                .filter((m) => m.fromCharacterName === charDetail ||
                  (m.channelId !== "public" && allMessages.some(
                    (x) => x.channelId === m.channelId && x.fromCharacterName === charDetail
                  )))
                .map((m, i) => {
                const isSelf = m.fromCharacterName === charDetail;
                const isPrivate = m.channelId !== "public";
                const otherParty = isPrivate
                  ? m.channelId.replace("priv-", "").split("-").find((n: string) => n !== charDetail) || ""
                  : "";
                return (
                  <div key={i} className={`flex ${isSelf ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                      isPrivate
                        ? "bg-purple-50 border border-purple-200"
                        : isSelf
                        ? "bg-primary/10 border border-primary/20"
                        : "bg-secondary/40"
                    }`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium">{isSelf ? charDetail : m.fromCharacterName}</span>
                        {isPrivate && <span className="text-xs text-purple-500">🔒 → {otherParty}</span>}
                        {!isPrivate && <span className="text-xs text-muted-foreground">📢 公共</span>}
                      </div>
                      <p className="italic">&ldquo;{m.dialogue}&rdquo;</p>
                      {m.actions && <p className="text-xs text-muted-foreground mt-1">{m.actions}</p>}
                      {m.innerThoughts && <p className="text-xs text-muted-foreground/50 mt-0.5">💭 {m.innerThoughts}</p>}
                    </div>
                  </div>
                );
              })}
              {allMessages.filter((m) => m.fromCharacterName === charDetail ||
                (m.channelId !== "public" && m.channelId.includes(charDetail))).length === 0 && (
                <p className="text-center text-muted-foreground text-sm">暂无消息</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Floating scroll buttons */}
      <div className="fixed right-6 bottom-24 flex flex-col gap-2 z-50">
        <button
          className="p-2 bg-card border rounded-full shadow-md hover:bg-secondary transition-colors"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          title="回到顶部"
        >
          <ArrowUp className="w-4 h-4" />
        </button>
        <button
          className="p-2 bg-card border rounded-full shadow-md hover:bg-secondary transition-colors"
          onClick={() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })}
          title="回到底部"
        >
          <ArrowDown className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
