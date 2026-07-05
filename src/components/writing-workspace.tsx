"use client";

import { useState, useRef, useCallback } from "react";
import type { CharacterProfile, SceneDefinition, WritingStyle, SceneOutline, ChapterTimeline, CharacterChapterState } from "@/types";
import type { ReviewReport } from "@/core/codex/types";
import { Loader2, Play, Sparkles, RefreshCw, Shield, ScrollText, Check, AlertCircle, Copy, Edit3, ChevronDown, ChevronUp } from "lucide-react";

interface WritingWorkspaceProps {
  novelId: string;
  novelTitle: string;
  characters: CharacterProfile[];
  scene: SceneDefinition;
  writingStyle?: WritingStyle;
  onSceneChange: (scene: SceneDefinition) => void;
  onBack: () => void;
  onComplete?: (fullNovel: string) => void;
  initialFullNovel?: string;
  timeline?: ChapterTimeline | null;
  lastChapterStates?: CharacterChapterState[];
  storyInfo?: import("@/types").StoryInfo | null;
}

// ============================================================
// 2-Column Writing Studio (left sidebar hidden while writing)
//
// ┌── Left (360px) ──────┬── Right (flex-1) ──────────────────┐
// │  Writing Script       │  Writer Output                     │
// │  (editable narrative) │                                    │
// │                       │  (shown during/after generation)    │
// │  + AI Recommend       │                                    │
// │                       │  + Review (collapsible)            │
// │  [Write]              │  + Prompt (collapsible)            │
// └───────────────────────┴────────────────────────────────────┘
// ============================================================

export default function WritingWorkspace({
  novelId,
  novelTitle,
  characters,
  scene,
  writingStyle,
  onSceneChange,
  onBack,
  onComplete,
  initialFullNovel,
  timeline,
  lastChapterStates,
  storyInfo,
}: WritingWorkspaceProps) {
  const [status, setStatus] = useState<"idle" | "generating" | "reviewing" | "completed" | "error">(
    initialFullNovel ? "completed" : "idle"
  );
  const [outputText, setOutputText] = useState(initialFullNovel || "");
  const [scriptText, setScriptText] = useState("");
  const [outline, setOutline] = useState<SceneOutline | null>(null);
  const [review, setReview] = useState<ReviewReport | null>(null);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [userPrompt, setUserPrompt] = useState("");
  const [error, setError] = useState("");
  const [recommendLoading, setRecommendLoading] = useState(false);
  const [sceneRecommendations, setSceneRecommendations] = useState<any[] | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // ---- Build script from scene + characters ----
  const buildSceneScript = useCallback(() => {
    const selectedChars = characters.filter(c => scene.characterIds.includes(c.id));
    const lines: string[] = [];

    lines.push("# 写作剧本");
    lines.push("");

    // Scene
    lines.push("## 场景");
    lines.push(`地点：${scene.location || "未指定"}`);
    lines.push(`时间：${scene.timeOfDay}　天气：${scene.weather}　氛围：${scene.atmosphere}`);
    if (scene.initialSituation) {
      lines.push("");
      lines.push(scene.initialSituation);
    }
    if (scene.plot?.conflictType) lines.push(`\n冲突类型：${scene.plot.conflictType}`);
    if (scene.plot?.storyBeat) lines.push(`故事节点：${scene.plot.storyBeat}`);
    if (scene.plot?.stakes) lines.push(`赌注：${scene.plot.stakes}`);
    const pacing = scene.narrativeStyle?.targetLength === "short" ? "快速" : scene.narrativeStyle?.targetLength === "long" ? "慢速" : "中速";
    lines.push(`节奏：${pacing}`);

    // Characters
    if (selectedChars.length > 0) {
      lines.push("");
      lines.push("## 出场角色");
      for (const c of selectedChars) {
        const traits = c.personality?.traits?.join("、") || "";
        const goal = c.drive?.goal || "";
        const speaking = c.speakingStyle?.description || "";
        const catchphrases = (c.speakingStyle?.catchphrases || []).join("、");
        const rels = c.relationships
          ?.filter(r => selectedChars.some(sc => sc.name === r.characterName))
          .map(r => `${r.characterName}（${r.type}：${r.dynamics}）`)
          .join("；") || "";
        lines.push(`### ${c.name}`);
        lines.push(`性格：${traits}。${c.personality?.description || ""}`);
        if (goal) lines.push(`核心目标：${goal}`);
        if (speaking) {
          lines.push(`说话风格：${speaking}${catchphrases ? `（口头禅：${catchphrases}）` : ""}`);
        }
        if (rels) lines.push(`在场关系：${rels}`);
        lines.push("");
      }
    }

    // Outline
    if (outline) {
      lines.push("## 剧本大纲");
      lines.push(`标题：${outline.sceneTitle}`);
      lines.push(`目标：${outline.sceneGoal}`);
      lines.push(`情感弧线：${outline.emotionalArc} → 结局：${outline.sceneEnding}`);
      outline.beats?.forEach(b => {
        lines.push(`- 节拍${b.beatNumber}：${b.description}（出场：${b.activeCharacters?.join("、")}）（氛围：${b.mood}）`);
      });
    }

    return lines.join("\n");
  }, [scene, characters, outline]);

  // Initialize script from scene
  if (!scriptText) {
    setScriptText(buildSceneScript());
  }

  // Sync script with scene changes
  const syncScript = useCallback(() => {
    // Only update if it hasn't been manually edited or init
    if (!scriptText || !scriptText.startsWith("# 写作剧本")) {
      setScriptText(buildSceneScript());
    }
  }, [buildSceneScript]);

  // ---- Writing ----
  const startWriting = useCallback(async () => {
    if (!scene.location.trim()) return;
    setStatus("generating");
    setError("");
    setOutputText("");
    setReview(null);
    setShowReview(false);
    setShowPrompt(false);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/simulation/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          novelTitle,
          novelId,
          characters: characters.filter(c => scene.characterIds.includes(c.id)),
          scene,
          writingStyle,
          timelineEvents: timeline?.chapters?.flatMap((ch: any) => ch.events) ?? [],
          lastChapterStates,
        }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`Server error: ${res.status}`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");

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
              const event = JSON.parse(line.slice(6));
              switch (event.type) {
                case "outline":
                  setOutline(event.outline);
                  break;
                case "prompt":
                  setSystemPrompt(event.systemPrompt);
                  setUserPrompt(event.userPrompt);
                  break;
                case "prose":
                  setOutputText(event.prose);
                  break;
                case "review":
                  setReview(event.review);
                  setShowReview(true);
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
            } catch {}
          }
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setStatus("error");
      setError(e instanceof Error ? e.message : "Failed");
    }
  }, [novelId, novelTitle, characters, scene, writingStyle, timeline, lastChapterStates, onComplete]);

  const stopWriting = () => {
    abortRef.current?.abort();
    if (outputText) setStatus("completed");
  };

  const handleRecommend = async () => {
    setRecommendLoading(true);
    try {
      const res = await fetch("/api/scene/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characters, storyInfo }),
      });
      const data = await res.json();
      if (data.recommendations) setSceneRecommendations(data.recommendations);
    } catch {}
    setRecommendLoading(false);
  };

  const applyRecommendation = (rec: any) => {
    const ids = rec.suggestedCharacters
      .map((name: string) => characters.find(c => c.name === name)?.id || "")
      .filter(Boolean);
    onSceneChange({
      ...scene,
      location: rec.location,
      timeOfDay: rec.timeOfDay,
      weather: rec.weather,
      atmosphere: rec.atmosphere,
      initialSituation: rec.initialSituation,
      characterIds: ids,
    });
    setSceneRecommendations(null);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(outputText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const hasContent = !!outputText;

  return (
    <div className="flex gap-4" style={{ height: "calc(100vh - 130px)" }}>
      {/* ============================================================
          LEFT COLUMN (400px): Script + Controls
          ============================================================ */}
      <div className="w-[400px] shrink-0 flex flex-col gap-3">
        {/* Script */}
        <div className="bg-[#0c0c0c] border border-neutral-800/60 rounded-lg overflow-hidden flex flex-col flex-1">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-800/40 bg-[#0e0e0e] shrink-0">
            <div className="flex items-center gap-2">
              <Edit3 className="w-3.5 h-3.5 text-orange-500" />
              <h3 className="text-[10px] font-semibold text-neutral-400 font-mono uppercase tracking-widest">写作剧本</h3>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setScriptText(buildSceneScript())}
                className="text-[10px] text-neutral-500 hover:text-neutral-300 font-mono transition-colors"
                title="从场景数据重新生成剧本"
              >
                <RefreshCw className="w-3 h-3" /> 刷新
              </button>
              <button
                onClick={handleRecommend}
                disabled={!characters.length || recommendLoading}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-neutral-700 hover:bg-neutral-600 disabled:bg-neutral-800 disabled:text-neutral-600 text-white transition-colors"
              >
                {recommendLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                AI 推荐
              </button>
            </div>
          </div>

          {/* Editable script area */}
          <textarea
            value={scriptText}
            onChange={e => setScriptText(e.target.value)}
            className="flex-1 w-full bg-transparent border-0 outline-none resize-none p-4 text-sm text-neutral-300 font-mono leading-relaxed custom-scrollbar placeholder-neutral-700"
            placeholder="# 写作剧本&#10;&#10;## 场景&#10;地点：...&#10;时间：...&#10;&#10;## 出场角色&#10;### 角色名&#10;性格：...&#10;&#10;## 剧本大纲&#10;..."
            spellCheck={false}
          />

          {/* AI Recommendations */}
          {sceneRecommendations && sceneRecommendations.length > 0 && (
            <div className="border-t border-neutral-800/60 p-3 max-h-[200px] overflow-y-auto custom-scrollbar">
              <div className="text-[10px] text-neutral-600 font-mono uppercase mb-2">AI 推荐场景</div>
              <div className="space-y-1.5">
                {sceneRecommendations.slice(0, 4).map((rec, i) => (
                  <button
                    key={i}
                    onClick={() => applyRecommendation(rec)}
                    className="w-full text-left p-2 rounded border border-neutral-800 hover:border-orange-500/30 bg-neutral-800/20 hover:bg-neutral-800/40 transition-colors"
                  >
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className="text-neutral-200 font-mono font-semibold">{rec.location}</span>
                      <span className="text-neutral-600">{rec.timeOfDay} · {rec.atmosphere}</span>
                    </div>
                    <p className="text-[10px] text-neutral-500 mt-0.5 line-clamp-2">{rec.initialSituation}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Action */}
          <div className="px-4 py-3 border-t border-neutral-800/40 bg-[#0e0e0e] shrink-0">
            {status === "idle" || status === "completed" || status === "error" ? (
              <button
                onClick={startWriting}
                disabled={!scene.location.trim()}
                className="w-full py-2.5 bg-orange-600 hover:bg-orange-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white text-sm font-mono rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <Play className="w-4 h-4" />
                {status === "completed" ? "重新生成" : "开始写作"}
              </button>
            ) : (
              <button
                onClick={stopWriting}
                className="w-full py-2.5 bg-red-600/10 hover:bg-red-600/20 border border-red-500/30 text-red-400 text-sm font-mono rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <Loader2 className="w-4 h-4 animate-spin" />
                停止
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ============================================================
          RIGHT COLUMN (flex-1): Output + Review + Prompt
          ============================================================ */}
      <div className="flex-1 flex flex-col min-w-0">
        {hasContent ? (
          <div className="bg-[#0c0c0c] border border-neutral-800/60 rounded-lg flex flex-col flex-1 overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-800/40 bg-[#0e0e0e] shrink-0">
              <div className="flex items-center gap-3">
                <h3 className="text-[10px] font-semibold text-neutral-400 font-mono uppercase tracking-widest">生成正文</h3>
                {status === "completed" && <span className="text-[9px] text-green-500/70 font-mono">已完成</span>}
                {status === "generating" && <span className="text-[9px] text-orange-500/70 font-mono flex items-center gap-1"><Loader2 className="w-2.5 h-2.5 animate-spin" /> 写作中…</span>}
              </div>
              <div className="flex items-center gap-3">
                {review && (
                  <button onClick={() => setShowReview(!showReview)} className="flex items-center gap-1 text-[10px] text-neutral-500 hover:text-green-400 font-mono transition-colors">
                    <Shield className="w-3 h-3" />
                    审查 ({review.findings.length})
                  </button>
                )}
                {systemPrompt && (
                  <button onClick={() => setShowPrompt(!showPrompt)} className="flex items-center gap-1 text-[10px] text-neutral-500 hover:text-neutral-300 font-mono transition-colors">
                    <ScrollText className="w-3 h-3" />
                    Prompt
                  </button>
                )}
                <button onClick={handleCopy} className="flex items-center gap-1 text-[10px] text-neutral-500 hover:text-neutral-300 font-mono transition-colors">
                  {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                  {copied ? "已复制" : "复制"}
                </button>
              </div>
            </div>

            {/* Main output area — scrollable */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {/* Text */}
              <div className="p-6">
                {status === "generating" && !outputText ? (
                  <div className="flex items-center justify-center py-20">
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
                      <p className="text-sm text-neutral-500 font-mono">Writer 创作中...</p>
                    </div>
                  </div>
                ) : (
                  <div className="text-base text-neutral-200 leading-relaxed whitespace-pre-wrap font-serif max-w-[800px]">
                    {outputText}
                  </div>
                )}
              </div>

              {/* Review panel — collapsible below text */}
              {showReview && review && (
                <div className="border-t border-neutral-800/60 p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Shield className="w-4 h-4 text-green-500" />
                    <h4 className="text-xs font-semibold text-neutral-400 font-mono uppercase tracking-widest">审查报告</h4>
                    <span className="text-[10px] text-green-500/80 font-mono ml-2">{review.autoFixedCount} 自动修正</span>
                    <span className="text-[10px] text-orange-500/80 font-mono">{review.needsHumanReview.length} 待确认</span>
                  </div>
                  <div className="space-y-2 max-w-[800px]">
                    {review.findings.filter(f => f.severity !== "minor" || review.findings.length <= 8).map((f, i) => (
                      <div key={i} className={`p-3 rounded border text-xs ${
                        f.severity === "critical" ? "border-red-500/30 bg-red-500/5" :
                        f.severity === "major" ? "border-yellow-500/30 bg-yellow-500/5" :
                        "border-neutral-700 bg-neutral-800/20"
                      }`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono uppercase ${
                            f.severity === "critical" ? "bg-red-500/20 text-red-300" :
                            f.severity === "major" ? "bg-yellow-500/20 text-yellow-300" :
                            "bg-neutral-600/30 text-neutral-400"
                          }`}>{f.severity}</span>
                          <span className="text-neutral-500">{f.dimension}</span>
                          {f.autoFixable && <span className="text-green-500/70 ml-auto text-[9px] font-mono">AUTO-FIXED</span>}
                        </div>
                        <p className="text-neutral-300 leading-relaxed">{f.description}</p>
                        {f.suggestion && <p className="text-neutral-500 mt-1 leading-relaxed">{f.suggestion}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Prompt — collapsible below text */}
              {showPrompt && systemPrompt && (
                <div className="border-t border-neutral-800/60 p-6">
                  <h4 className="text-xs font-semibold text-neutral-400 font-mono uppercase tracking-widest mb-3">
                    Prompt <span className="text-neutral-600 font-normal">({(systemPrompt.length + (userPrompt?.length || 0)).toLocaleString()} chars)</span>
                  </h4>
                  <details className="mb-3" open>
                    <summary className="text-xs text-neutral-500 font-mono cursor-pointer hover:text-neutral-300">System Prompt</summary>
                    <pre className="mt-2 text-xs text-neutral-500 font-mono whitespace-pre-wrap leading-relaxed bg-[#080808] rounded p-4 border border-neutral-800/30 max-h-[400px] overflow-y-auto custom-scrollbar">{systemPrompt}</pre>
                  </details>
                  {userPrompt && (
                    <details>
                      <summary className="text-xs text-neutral-500 font-mono cursor-pointer hover:text-neutral-300">User Prompt</summary>
                      <pre className="mt-2 text-xs text-neutral-500 font-mono whitespace-pre-wrap leading-relaxed bg-[#080808] rounded p-4 border border-neutral-800/30 max-h-[200px] overflow-y-auto custom-scrollbar">{userPrompt}</pre>
                    </details>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Edit3 className="w-12 h-12 mx-auto mb-4 text-neutral-700 opacity-50" />
              <p className="text-base text-neutral-500 font-mono">设置写作剧本后，点击"开始写作"</p>
              <p className="text-sm text-neutral-700 mt-2">剧本可以自由编辑——调整场景描述、角色细节、大纲节拍</p>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-3 bg-red-500/5 border border-red-500/30 rounded-lg p-4 text-center">
            <AlertCircle className="w-5 h-5 text-red-400 mx-auto mb-2" />
            <p className="text-sm text-red-400 font-mono">{error}</p>
            <button onClick={startWriting} className="mt-3 px-4 py-1.5 bg-red-500/10 border border-red-500/30 text-red-400 rounded text-xs font-mono hover:bg-red-500/20 transition-colors">
              <RefreshCw className="w-3 h-3 inline mr-1" /> 重试
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
