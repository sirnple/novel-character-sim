"use client";

import { useState, useRef, useEffect } from "react";
import type { CharacterProfile, SceneDefinition, SimulationRound, WritingStyle, SceneOutline, ChapterTimeline, CharacterChapterState } from "@/types";
import type { SimulationEvent } from "@/core/simulation/engine";
import { Loader2, BookOpen, StopCircle, ArrowUp, ArrowDown, ScrollText, Activity, Shield } from "lucide-react";
import NovelOutput from "./novel-output";
import ReviewPanel from "./review-panel";

interface SimulationRunnerProps {
  novelTitle: string;
  novelId?: string;
  characters: CharacterProfile[];
  scene: SceneDefinition;
  writingStyle?: WritingStyle;
  onBack: () => void;
  onComplete?: (fullNovel: string) => void;
  initialFullNovel?: string;
  cachedOutline?: SceneOutline | null;
  onCacheOutline?: (outline: SceneOutline) => void;
  timeline?: ChapterTimeline | null;
  lastChapterStates?: CharacterChapterState[];
}

export default function SimulationRunner({
  novelTitle,
  novelId,
  characters,
  scene,
  writingStyle,
  onBack,
  onComplete,
  initialFullNovel,
  cachedOutline,
  timeline,
  lastChapterStates,
  onCacheOutline,
}: SimulationRunnerProps) {
  const [status, setStatus] = useState<"connecting" | "running" | "completed" | "error">("connecting");
  const [currentEvent, setCurrentEvent] = useState<string>("");
  const [fullNovel, setFullNovel] = useState(initialFullNovel || "");
  const [revisedNovel, setRevisedNovel] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [outline, setOutline] = useState<SceneOutline | null>(null);
  const [activeTab, setActiveTab] = useState<"live" | "novel" | "review" | "prompt">("live");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [userPrompt, setUserPrompt] = useState("");
  const abortRef = useRef<AbortController | null>(null);

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
        body: JSON.stringify({ novelTitle, novelId, characters, scene, writingStyle, outline: cachedOutline, timelineEvents: timeline?.chapters?.flatMap((ch: any) => ch.events) ?? [], lastChapterStates }),
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
      case "outline":
        setOutline(event.outline);
        setCurrentEvent(`📋 剧本大纲已生成：${event.outline.sceneTitle}`);
        if (onCacheOutline) onCacheOutline(event.outline);
        break;
      case "prose":
        setFullNovel(event.prose);
        setCurrentEvent("✅ 场景正文已生成");
        break;
      case "prompt":
        setSystemPrompt(event.systemPrompt);
        setUserPrompt(event.userPrompt);
        break;
        break;
      case "scene_end":
        setStatus("completed");
        onComplete?.(event.fullNovel);
        break;
      case "error":
        setStatus("error");
        setError(event.message);
        break;
    }
  };

  const stopSimulation = () => {
    abortRef.current?.abort();
    setStatus("completed");
  };

  if (error) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-6 text-center">
          <p className="text-lg text-destructive mb-2">❌ 生成失败</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <button
            className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-lg"
            onClick={onBack}
          >
            返回
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            onClick={onBack}
          >
            ← 返回
          </button>
          <h2 className="text-lg font-semibold">{scene.location}</h2>
        </div>
        <div className="flex items-center gap-2">
          {status === "running" && (
            <button
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-destructive/10 text-destructive rounded-lg hover:bg-destructive/20 transition-colors"
              onClick={stopSimulation}
            >
              <StopCircle className="w-4 h-4" /> 停止
            </button>
          )}
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            status === "running" ? "bg-blue-100 text-blue-700" :
            status === "completed" ? "bg-green-100 text-green-700" :
            status === "connecting" ? "bg-yellow-100 text-yellow-700" :
            "bg-muted text-muted-foreground"
          }`}>
            {status === "connecting" ? "连接中..." :
             status === "running" ? "写作中..." :
             status === "completed" ? "已完成" : "就绪"}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "live" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("live")}
        >
          <Activity className="w-4 h-4 inline mr-1" />
          进度
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "novel" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("novel")}
        >
          <BookOpen className="w-4 h-4 inline mr-1" />
          正文
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "review" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => { if (status === "completed") setActiveTab("review"); }}
          disabled={status !== "completed"}
          title={status !== "completed" ? "模拟完成后可审查" : "审查生成的小说"}
        >
          <Shield className="w-4 h-4 inline mr-1" />
          审查
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "prompt" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => { if (systemPrompt) setActiveTab("prompt"); }}
          disabled={!systemPrompt}
          title={!systemPrompt ? "生成后可见" : "查看最终渲染的提示词"}
        >
          <ScrollText className="w-4 h-4 inline mr-1" />
          Prompt
        </button>
      </div>

      {/* Content */}
      {activeTab === "prompt" && systemPrompt ? (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-neutral-400 mb-2 font-mono uppercase tracking-wider">System Prompt</h3>
            <pre className="bg-[#111110] border border-neutral-800 rounded-lg p-4 text-xs text-neutral-400 font-mono whitespace-pre-wrap max-h-[500px] overflow-y-auto custom-scrollbar">{systemPrompt}</pre>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-neutral-400 mb-2 font-mono uppercase tracking-wider">User Prompt</h3>
            <pre className="bg-[#111110] border border-neutral-800 rounded-lg p-4 text-xs text-neutral-400 font-mono whitespace-pre-wrap max-h-[300px] overflow-y-auto custom-scrollbar">{userPrompt}</pre>
          </div>
        </div>
      ) : activeTab === "live" ? (
        <div className="space-y-4">
          {/* Status */}
          <div className="bg-card border rounded-lg p-6 text-center">
            {status === "connecting" && (
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
                <p>正在连接...</p>
              </div>
            )}
            {status === "running" && (
              <div className="flex flex-col items-center gap-3">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                  <p className="text-primary font-medium">Writer 写作中...</p>
                </div>
                {currentEvent && <p className="text-xs text-muted-foreground">{currentEvent}</p>}
              </div>
            )}
            {outline && (
              <div className="mt-4 pt-4 border-t text-left">
                <div className="flex items-center gap-2 mb-2">
                  <ScrollText className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium">剧本大纲：{outline.sceneTitle}</span>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>目标：{outline.sceneGoal}</p>
                  <p>情感弧线：{outline.emotionalArc}</p>
                  <p>结局：{outline.sceneEnding}</p>
                  <div className="mt-2 space-y-0.5">
                    {(outline.beats || outline.plotPoints || []).map((b: any) => (
                      <div key={b.beatNumber} className="flex gap-2">
                        <span className="text-primary font-mono">#{b.beatNumber}</span>
                        <span>{b.description} [{b.mood}]</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {status === "completed" && (
              <div className="flex flex-col items-center gap-2">
                <div className="text-3xl">✅</div>
                <p className="text-green-600 font-medium">场景生成完成！</p>
                <button
                  className="mt-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg"
                  onClick={() => setActiveTab("novel")}
                >
                  <BookOpen className="w-4 h-4 inline mr-1" />
                  查看正文
                </button>
              </div>
            )}
          </div>

          {/* Scene info card */}
          <div className="bg-muted/30 border rounded-lg p-4">
            <h3 className="text-sm font-medium mb-2">场景信息</h3>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div><span className="font-medium">地点：</span>{scene.location}</div>
              <div><span className="font-medium">时间：</span>{scene.timeOfDay}</div>
              <div><span className="font-medium">天气：</span>{scene.weather}</div>
              <div><span className="font-medium">氛围：</span>{scene.atmosphere}</div>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              <span className="font-medium">出场角色：</span>
              {characters.filter(c => scene.characterIds.includes(c.id)).map(c => c.name).join("、")}
            </div>
          </div>
        </div>
      ) : activeTab === "review" ? (
        <ReviewPanel
          draft={fullNovel}
          timelineEvents={JSON.stringify(timeline?.chapters?.flatMap((ch: any) => ch.events) ?? [])}
          characterStates={JSON.stringify(lastChapterStates ?? [])}
          writingStyle={JSON.stringify(writingStyle ?? {})}
          sceneDesc={`地点：${scene.location}，时间：${scene.timeOfDay}，天气：${scene.weather}，氛围：${scene.atmosphere}，情境：${scene.initialSituation}`}
          onRevised={(text) => { setFullNovel(text); setRevisedNovel(text); }}
        />
      ) : (
        <NovelOutput
          title={novelTitle}
          content={revisedNovel || fullNovel}
          isComplete={status === "completed"}
        />
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
