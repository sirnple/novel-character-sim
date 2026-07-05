"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { CharacterProfile, SceneDefinition, WritingStyle, SceneOutline, ChapterTimeline, CharacterChapterState } from "@/types";
import type { ReviewReport } from "@/core/codex/types";
import { Loader2, Play, Sparkles, RefreshCw, BookOpen, Shield, ScrollText, Check, AlertCircle, Copy, Download, Edit3, ChevronDown, ChevronUp, PanelLeft } from "lucide-react";

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
// 3-Column Writing Studio
//
// ┌─  Left (320px) ──┬── Center (flex-1) ──┬── Right (320px) ──┐
// │  Scene Script    │  Writer Output      │  Review Report     │
// │  + Characters    │                     │  + Prompt          │
// │  + AI Recommend  │                     │                    │
// │                  │                     │                    │
// │  [Start Writing] │                     │                    │
// └──────────────────┴─────────────────────┴────────────────────┘
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
  // ---- State ----
  const [status, setStatus] = useState<"idle" | "generating" | "reviewing" | "completed" | "error">(
    initialFullNovel ? "completed" : "idle"
  );
  const [outputText, setOutputText] = useState(initialFullNovel || "");
  const [outline, setOutline] = useState<SceneOutline | null>(null);
  const [review, setReview] = useState<ReviewReport | null>(null);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [userPrompt, setUserPrompt] = useState("");
  const [error, setError] = useState("");
  const [recommendLoading, setRecommendLoading] = useState(false);
  const [sceneRecommendations, setSceneRecommendations] = useState<any[] | null>(null);
  const [showScript, setShowScript] = useState(true);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // ---- Build script from scene + characters ----
  const buildScript = useCallback(() => {
    const selectedChars = characters.filter(c => scene.characterIds.includes(c.id));
    const lines: string[] = [];

    lines.push(`## 场景设定`);
    lines.push(`- 地点: ${scene.location || "未指定"}`);
    lines.push(`- 时间: ${scene.timeOfDay}  ·  天气: ${scene.weather}  ·  氛围: ${scene.atmosphere}`);
    if (scene.initialSituation) lines.push(`- 初始情境: ${scene.initialSituation}`);
    if (scene.plot?.conflictType) lines.push(`- 冲突类型: ${scene.plot.conflictType}`);
    if (scene.plot?.storyBeat) lines.push(`- 故事节点: ${scene.plot.storyBeat}`);
    if (scene.plot?.stakes) lines.push(`- 赌注: ${scene.plot.stakes}`);
    const pacing = scene.narrativeStyle?.targetLength === "short" ? "快速" : scene.narrativeStyle?.targetLength === "long" ? "慢速" : "中速";
    lines.push(`- 节奏: ${pacing}`);

    if (selectedChars.length > 0) {
      lines.push("");
      lines.push("## 出场角色");
      for (const c of selectedChars) {
        const traits = c.personality?.traits?.slice(0, 3).join("、") || "";
        const rels = c.relationships
          ?.filter(r => selectedChars.some(sc => sc.name === r.characterName))
          .map(r => `${r.characterName}(${r.type})`)
          .join(", ") || "";
        lines.push(`- **${c.name}**: ${traits}${rels ? ` | 与在场者: ${rels}` : ""}`);
      }
    }

    if (outline) {
      lines.push("");
      lines.push("## 剧本大纲");
      lines.push(`- 标题: ${outline.sceneTitle}`);
      lines.push(`- 目标: ${outline.sceneGoal}`);
      lines.push(`- 弧线: ${outline.emotionalArc}  →  结局: ${outline.sceneEnding}`);
      outline.beats?.forEach(b => {
        lines.push(`- 节拍${b.beatNumber}: ${b.description} [${b.activeCharacters?.join(", ")}] (${b.mood})`);
      });
    }

    return lines.join("\n");
  }, [scene, characters, outline]);

  const script = buildScript();

  // ---- Writing ----
  const startWriting = useCallback(async () => {
    if (!scene.location.trim()) return;
    setStatus("generating");
    setError("");
    setOutputText("");
    setReview(null);

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
      let finalProse = "";

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
                  finalProse = event.prose;
                  setOutputText(event.prose);
                  break;
                case "review":
                  setReview(event.review);
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
  }, [novelTitle, characters, scene, writingStyle, timeline, lastChapterStates, onComplete]);

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

  const needsLocation = !scene.location.trim();
  const hasContent = !!outputText;

  return (
    <div className="h-full flex gap-3" style={{ height: "calc(100vh - 130px)" }}>
      {/* ============================================================
          LEFT COLUMN (320px): Script + Actions
          ============================================================ */}
      <div className="w-[320px] shrink-0 flex flex-col gap-3">
        {/* Script Card */}
        <div className="bg-[#0c0c0c] border border-neutral-800/60 rounded-lg overflow-hidden flex flex-col flex-1">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-800/40 bg-[#0e0e0e]">
            <div className="flex items-center gap-2">
              <Edit3 className="w-3.5 h-3.5 text-orange-500" />
              <h3 className="text-[10px] font-semibold text-neutral-400 font-mono uppercase tracking-widest">写作剧本</h3>
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={handleRecommend}
                disabled={!characters.length || recommendLoading}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-neutral-700 hover:bg-neutral-600 disabled:bg-neutral-800 disabled:text-neutral-600 text-white transition-colors"
                title="AI 基于角色和故事推荐场景"
              >
                {recommendLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                AI 推荐
              </button>
            </div>
          </div>

          {/* Script content - editable */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
            {/* Location + basics — inline editable */}
            <div className="space-y-2 mb-4">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={scene.location}
                  onChange={e => onSceneChange({ ...scene, location: e.target.value })}
                  className="flex-1 bg-transparent border-0 border-b border-transparent hover:border-neutral-700 focus:border-orange-600/50 text-sm text-neutral-200 font-semibold font-mono outline-none px-0 py-1 placeholder-neutral-600 transition-colors"
                  placeholder="场景地点…"
                />
                <span className="text-[10px] text-neutral-600 font-mono shrink-0">{scene.timeOfDay}</span>
              </div>
              <textarea
                value={scene.initialSituation}
                onChange={e => onSceneChange({ ...scene, initialSituation: e.target.value })}
                rows={2}
                className="w-full bg-transparent border-0 border-b border-transparent hover:border-neutral-700 focus:border-orange-600/50 text-xs text-neutral-400 font-mono outline-none px-0 py-1 placeholder-neutral-600 resize-none transition-colors"
                placeholder="初始情境描述…"
              />
              <div className="flex gap-3 mt-2">
                <select
                  value={scene.atmosphere}
                  onChange={e => onSceneChange({ ...scene, atmosphere: e.target.value })}
                  className="text-[10px] bg-[#111110] border border-neutral-800 rounded px-2 py-1 text-neutral-400 font-mono"
                >
                  {["tense", "peaceful", "romantic", "mysterious", "chaotic", "melancholic", "hopeful"].map(v => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
                <select
                  value={scene.narrativeStyle.targetLength}
                  onChange={e => onSceneChange({ ...scene, narrativeStyle: { ...scene.narrativeStyle, targetLength: e.target.value as any } })}
                  className="text-[10px] bg-[#111110] border border-neutral-800 rounded px-2 py-1 text-neutral-400 font-mono"
                >
                  <option value="short">快速</option>
                  <option value="medium">中速</option>
                  <option value="long">慢速</option>
                </select>
                <select
                  value={scene.plot.storyBeat}
                  onChange={e => onSceneChange({ ...scene, plot: { ...scene.plot, storyBeat: e.target.value } })}
                  className="text-[10px] bg-[#111110] border border-neutral-800 rounded px-2 py-1 text-neutral-400 font-mono"
                >
                  {["", "铺垫", "转折", "高潮", "收尾"].map(v => <option key={v} value={v}>{v || "节点"}</option>)}
                </select>
              </div>
            </div>

            {/* Characters as compact tag cloud */}
            <div className="mb-4">
              <div className="text-[10px] text-neutral-600 font-mono uppercase mb-1">出场角色</div>
              <div className="flex flex-wrap gap-1">
                {characters.map(c => {
                  const active = scene.characterIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => {
                        onSceneChange({
                          ...scene,
                          characterIds: active
                            ? scene.characterIds.filter(id => id !== c.id)
                            : [...scene.characterIds, c.id],
                        });
                      }}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
                        active
                          ? "bg-orange-500/20 border border-orange-500/30 text-orange-300"
                          : "bg-neutral-800/30 border border-transparent text-neutral-600 hover:text-neutral-300 hover:border-neutral-700"
                      }`}
                    >
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Generated outline */}
            {outline && (
              <div className="mb-4">
                <div className="text-[10px] text-neutral-600 font-mono uppercase mb-1">剧本大纲</div>
                <div className="text-[10px] text-neutral-500 leading-relaxed">
                  <p className="text-neutral-400 font-medium">{outline.sceneTitle}</p>
                  <p>目标: {outline.sceneGoal}</p>
                  <p>弧线: {outline.emotionalArc}</p>
                  {outline.beats?.map(b => (
                    <p key={b.beatNumber} className="mt-0.5">
                      <span className="text-orange-500/70">#{b.beatNumber}</span>{" "}
                      {b.description}
                      <span className="text-neutral-600 ml-1">({b.mood})</span>
                    </p>
                  ))}
                </div>
              </div>
            )}

            {/* AI Recommendations */}
            {sceneRecommendations && sceneRecommendations.length > 0 && (
              <div className="border-t border-neutral-800/60 pt-3 mt-3">
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
          </div>

          {/* Action button */}
          <div className="px-4 py-3 border-t border-neutral-800/40 bg-[#0e0e0e]">
            {status === "idle" || status === "completed" || status === "error" ? (
              <button
                onClick={startWriting}
                disabled={needsLocation}
                className="w-full py-2 bg-orange-600 hover:bg-orange-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white text-xs font-mono rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <Play className="w-3.5 h-3.5" />
                {status === "completed" ? "重新生成" : "开始写作"}
              </button>
            ) : (
              <button
                onClick={stopWriting}
                className="w-full py-2 bg-red-600/10 hover:bg-red-600/20 border border-red-500/30 text-red-400 text-xs font-mono rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                停止
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ============================================================
          CENTER COLUMN: Output
          ============================================================ */}
      <div className="flex-1 flex flex-col min-w-0">
        {hasContent ? (
          <div className="bg-[#0c0c0c] border border-neutral-800/60 rounded-lg flex flex-col flex-1 overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-800/40 bg-[#0e0e0e] shrink-0">
              <div className="flex items-center gap-3">
                <h3 className="text-[10px] font-semibold text-neutral-400 font-mono uppercase tracking-widest">
                  生成正文
                </h3>
                {status === "completed" && (
                  <span className="text-[9px] text-green-500/70 font-mono">已完成</span>
                )}
                {status === "generating" && (
                  <span className="text-[9px] text-orange-500/70 font-mono flex items-center gap-1">
                    <Loader2 className="w-2.5 h-2.5 animate-spin" /> 写作中...
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleCopy} className="flex items-center gap-1 text-[10px] text-neutral-500 hover:text-neutral-300 font-mono transition-colors">
                  {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                  {copied ? "已复制" : "复制"}
                </button>
              </div>
            </div>

            {/* Text */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
              {status === "generating" && !outputText ? (
                <div className="h-full flex items-center justify-center">
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
                    <p className="text-sm text-neutral-500 font-mono">Writer 创作中...</p>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-neutral-200 leading-relaxed whitespace-pre-wrap font-serif">
                  {outputText}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Edit3 className="w-10 h-10 mx-auto mb-3 text-neutral-700 opacity-50" />
              <p className="text-sm text-neutral-600 font-mono">设置写作剧本后，点击"开始写作"</p>
              <p className="text-xs text-neutral-700 mt-1">左侧编辑剧本 → 开始写作 → 输出在此处展示 → 审查在右侧显示</p>
            </div>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="mt-3 bg-red-500/5 border border-red-500/30 rounded-lg p-4 text-center">
            <AlertCircle className="w-5 h-5 text-red-400 mx-auto mb-2" />
            <p className="text-sm text-red-400 font-mono">{error}</p>
            <button
              onClick={startWriting}
              className="mt-3 px-4 py-1.5 bg-red-500/10 border border-red-500/30 text-red-400 rounded text-xs font-mono hover:bg-red-500/20 transition-colors"
            >
              <RefreshCw className="w-3 h-3 inline mr-1" /> 重试
            </button>
          </div>
        )}
      </div>

      {/* ============================================================
          RIGHT COLUMN (320px): Review + Prompt
          ============================================================ */}
      <div className="w-[320px] shrink-0 flex flex-col gap-3">
        {/* Review Panel */}
        {review && (
          <div className="bg-[#0c0c0c] border border-neutral-800/60 rounded-lg overflow-hidden flex flex-col" style={{ maxHeight: "60%" }}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-800/40 bg-[#0e0e0e]">
              <div className="flex items-center gap-2">
                <Shield className="w-3.5 h-3.5 text-green-500" />
                <h3 className="text-[10px] font-semibold text-neutral-400 font-mono uppercase tracking-widest">审查报告</h3>
              </div>
              <div className="flex items-center gap-2 text-[9px] font-mono">
                <span className="text-green-500/80">{review.autoFixedCount} 自动修正</span>
                <span className="text-orange-500/80">{review.needsHumanReview.length} 待确认</span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
              {review.findings.filter(f => f.severity !== "minor" || review.findings.length <= 8).map((f, i) => (
                <div key={i} className={`p-2 rounded border text-[10px] ${
                  f.severity === "critical" ? "border-red-500/30 bg-red-500/5" :
                  f.severity === "major" ? "border-yellow-500/30 bg-yellow-500/5" :
                  "border-neutral-700 bg-neutral-800/20"
                }`}>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={`px-1 py-0.5 rounded text-[8px] font-mono uppercase ${
                      f.severity === "critical" ? "bg-red-500/20 text-red-300" :
                      f.severity === "major" ? "bg-yellow-500/20 text-yellow-300" :
                      "bg-neutral-600/30 text-neutral-400"
                    }`}>{f.severity}</span>
                    <span className="text-neutral-500">{f.dimension}</span>
                    {f.autoFixable && <span className="text-green-500/70 ml-auto text-[8px] font-mono">AUTO-FIXED</span>}
                  </div>
                  <p className="text-neutral-300 leading-relaxed">{f.description}</p>
                  {f.suggestion && <p className="text-neutral-500 mt-0.5 leading-relaxed">{f.suggestion}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Prompt Preview */}
        {systemPrompt && (
          <div className="bg-[#0c0c0c] border border-neutral-800/60 rounded-lg overflow-hidden flex flex-col flex-1">
            <div className="flex items-center px-4 py-2.5 border-b border-neutral-800/40 bg-[#0e0e0e]">
              <div className="flex items-center gap-2">
                <ScrollText className="w-3.5 h-3.5 text-neutral-500" />
                <h3 className="text-[10px] font-semibold text-neutral-400 font-mono uppercase tracking-widest">Prompt</h3>
              </div>
              <span className="ml-auto text-[9px] text-neutral-600 font-mono">
                {(systemPrompt.length + (userPrompt?.length || 0)).toLocaleString()} chars
              </span>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-3">
              <details className="mb-2" open>
                <summary className="text-[10px] text-neutral-500 font-mono cursor-pointer hover:text-neutral-300">System Prompt</summary>
                <pre className="mt-2 text-[10px] text-neutral-500 font-mono whitespace-pre-wrap leading-relaxed bg-[#080808] rounded p-3 border border-neutral-800/30 max-h-[250px] overflow-y-auto custom-scrollbar">{systemPrompt}</pre>
              </details>
              {userPrompt && (
                <details>
                  <summary className="text-[10px] text-neutral-500 font-mono cursor-pointer hover:text-neutral-300">User Prompt</summary>
                  <pre className="mt-2 text-[10px] text-neutral-500 font-mono whitespace-pre-wrap leading-relaxed bg-[#080808] rounded p-3 border border-neutral-800/30 max-h-[150px] overflow-y-auto custom-scrollbar">{userPrompt}</pre>
                </details>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
