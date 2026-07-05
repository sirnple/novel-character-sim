"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { CharacterProfile, SceneDefinition, WritingStyle, SceneOutline, ChapterTimeline, CharacterChapterState } from "@/types";
import type { ReviewReport } from "@/core/codex/types";
import { Loader2, Play, Sparkles, RefreshCw, BookOpen, Shield, ScrollText, Check, AlertCircle, Copy, Download } from "lucide-react";

interface WritingWorkspaceProps {
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
// Main Component
// ============================================================

export default function WritingWorkspace({
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
  const [fullNovel, setFullNovel] = useState(initialFullNovel || "");
  const [outline, setOutline] = useState<SceneOutline | null>(null);
  const [review, setReview] = useState<ReviewReport | null>(null);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [userPrompt, setUserPrompt] = useState("");
  const [error, setError] = useState("");
  const [recommendLoading, setRecommendLoading] = useState(false);
  const [sceneRecommendations, setSceneRecommendations] = useState<any[] | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // ---- Start Writing ----
  const startWriting = useCallback(async () => {
    if (!scene.location.trim()) return;
    setStatus("generating");
    setError("");
    setFullNovel("");
    setReview(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/simulation/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          novelTitle,
          characters,
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
                  setFullNovel(event.prose);
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
  }, [novelTitle, characters, scene, writingStyle, timeline, lastChapterStates, onComplete]);

  const stopWriting = () => {
    abortRef.current?.abort();
    if (fullNovel) setStatus("completed");
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
    // scroll to scene settings
    document.getElementById("scene-settings")?.scrollIntoView({ behavior: "smooth" });
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(fullNovel);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const needsLocation = !scene.location.trim();

  return (
    <div className="space-y-6">
      {/* ================================================
          SCENE SETTINGS + RECOMMENDATIONS
          ================================================ */}
      <div id="scene-settings" className="bg-[#0c0c0c] border border-neutral-800/60 rounded-lg p-6">
        <h3 className="text-xs font-semibold text-neutral-400 font-mono uppercase tracking-wider mb-5">
          场景设定
        </h3>
        <div className="grid grid-cols-4 gap-4">
          <div>
            <label className="block text-[10px] text-neutral-500 font-mono mb-1 uppercase">地点</label>
            <input
              type="text"
              value={scene.location}
              onChange={e => onSceneChange({ ...scene, location: e.target.value })}
              className="w-full px-3 py-2 bg-[#111110] border border-neutral-800 rounded text-sm text-neutral-300 font-mono focus:outline-none focus:border-orange-600/50 transition-colors"
              placeholder="城东旧茶馆"
            />
          </div>
          <div>
            <label className="block text-[10px] text-neutral-500 font-mono mb-1 uppercase">时间</label>
            <select
              value={scene.timeOfDay}
              onChange={e => onSceneChange({ ...scene, timeOfDay: e.target.value })}
              className="w-full px-3 py-2 bg-[#111110] border border-neutral-800 rounded text-sm text-neutral-300 font-mono"
            >
              {["dawn", "morning", "afternoon", "dusk", "night", "midnight"].map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-neutral-500 font-mono mb-1 uppercase">天气</label>
            <select
              value={scene.weather}
              onChange={e => onSceneChange({ ...scene, weather: e.target.value })}
              className="w-full px-3 py-2 bg-[#111110] border border-neutral-800 rounded text-sm text-neutral-300 font-mono"
            >
              {["clear", "rainy", "stormy", "snowy", "foggy", "windy"].map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-neutral-500 font-mono mb-1 uppercase">氛围</label>
            <select
              value={scene.atmosphere}
              onChange={e => onSceneChange({ ...scene, atmosphere: e.target.value })}
              className="w-full px-3 py-2 bg-[#111110] border border-neutral-800 rounded text-sm text-neutral-300 font-mono"
            >
              {["tense", "peaceful", "romantic", "mysterious", "chaotic", "melancholic", "hopeful"].map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-[10px] text-neutral-500 font-mono mb-1 uppercase">初始情境</label>
            <input
              type="text"
              value={scene.initialSituation}
              onChange={e => onSceneChange({ ...scene, initialSituation: e.target.value })}
              className="w-full px-3 py-2 bg-[#111110] border border-neutral-800 rounded text-sm text-neutral-300 font-mono focus:outline-none focus:border-orange-600/50 transition-colors"
              placeholder="简要描述这个场景要写什么…"
            />
          </div>
          <div>
            <label className="block text-[10px] text-neutral-500 font-mono mb-1 uppercase">节奏</label>
            <select
              value={scene.narrativeStyle.targetLength}
              onChange={e => onSceneChange({ ...scene, narrativeStyle: { ...scene.narrativeStyle, targetLength: e.target.value as any } })}
              className="w-full px-3 py-2 bg-[#111110] border border-neutral-800 rounded text-sm text-neutral-300 font-mono"
            >
              <option value="short">快速</option>
              <option value="medium">中速</option>
              <option value="long">慢速</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-neutral-500 font-mono mb-1 uppercase">故事节点</label>
            <select
              value={scene.plot.storyBeat}
              onChange={e => onSceneChange({ ...scene, plot: { ...scene.plot, storyBeat: e.target.value } })}
              className="w-full px-3 py-2 bg-[#111110] border border-neutral-800 rounded text-sm text-neutral-300 font-mono"
            >
              {["", "铺垫", "转折", "高潮", "收尾"].map(v => (
                <option key={v} value={v}>{v || "未指定"}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-neutral-500 font-mono mb-1 uppercase">冲突类型</label>
            <input
              type="text"
              value={scene.plot.conflictType}
              onChange={e => onSceneChange({ ...scene, plot: { ...scene.plot, conflictType: e.target.value } })}
              className="w-full px-3 py-2 bg-[#111110] border border-neutral-800 rounded text-sm text-neutral-300 font-mono focus:outline-none focus:border-orange-600/50 transition-colors"
              placeholder="内心挣扎 / 对峙…"
            />
          </div>
          <div>
            <label className="block text-[10px] text-neutral-500 font-mono mb-1 uppercase">赌注</label>
            <input
              type="text"
              value={scene.plot.stakes}
              onChange={e => onSceneChange({ ...scene, plot: { ...scene.plot, stakes: e.target.value } })}
              className="w-full px-3 py-2 bg-[#111110] border border-neutral-800 rounded text-sm text-neutral-300 font-mono focus:outline-none focus:border-orange-600/50 transition-colors"
              placeholder="面临什么风险？"
            />
          </div>
        </div>

        {/* Character selection */}
        <div className="mt-4">
          <label className="block text-[10px] text-neutral-500 font-mono mb-1 uppercase">出场角色</label>
          <div className="flex flex-wrap gap-1.5">
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
                  className={`px-2 py-1 rounded text-xs font-mono transition-colors ${
                    active
                      ? "bg-orange-500/20 border border-orange-500/40 text-orange-300"
                      : "bg-neutral-800/40 border border-neutral-700 text-neutral-500 hover:text-neutral-300"
                  }`}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Action buttons */}
        <div className="mt-5 flex gap-3">
          <button
            onClick={handleRecommend}
            disabled={!characters.length || recommendLoading}
            className="flex items-center gap-2 px-4 py-2 bg-neutral-700 hover:bg-neutral-600 disabled:bg-neutral-800 disabled:text-neutral-600 text-white text-sm font-mono rounded-lg transition-colors"
          >
            {recommendLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            {recommendLoading ? "生成中..." : "AI 推荐场景"}
          </button>
          {status === "idle" || status === "completed" || status === "error" ? (
            <button
              onClick={startWriting}
              disabled={needsLocation}
              className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white text-sm font-mono rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Play className="w-3.5 h-3.5" />
              {status === "completed" ? "重新生成" : "开始写作"}
            </button>
          ) : (
            <button
              onClick={stopWriting}
              className="flex-1 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-400 text-sm font-mono rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              停止生成
            </button>
          )}
        </div>

        {/* AI Recommendations */}
        {sceneRecommendations && sceneRecommendations.length > 0 && (
          <div className="mt-5 border-t border-neutral-800/60 pt-5">
            <h4 className="text-xs font-semibold text-neutral-400 font-mono uppercase tracking-wider mb-3">
              AI 推荐场景
            </h4>
            <div className="grid grid-cols-2 gap-3">
              {sceneRecommendations.slice(0, 4).map((rec, i) => (
                <button
                  key={i}
                  onClick={() => applyRecommendation(rec)}
                  className="text-left p-3 rounded border border-neutral-800 hover:border-orange-500/30 bg-neutral-800/20 hover:bg-neutral-800/40 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-neutral-200">{rec.location}</span>
                    <span className="text-[10px] text-neutral-500">{rec.timeOfDay} · {rec.weather}</span>
                  </div>
                  <p className="text-xs text-neutral-400 line-clamp-2">{rec.initialSituation}</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ================================================
          WRITING PROGRESS
          ================================================ */}
      {(status === "generating" || status === "reviewing" || status === "completed" || outline) && (
        <div className="bg-[#0c0c0c] border border-neutral-800/60 rounded-lg p-5">
          {/* Progress bar */}
          <div className="flex items-center gap-2 mb-4">
            <StepBadge done={!!outline} label="大纲" />
            <div className="flex-1 h-px bg-neutral-700" />
            <StepBadge
              done={!!fullNovel}
              active={status === "generating"}
              label="写作"
            />
            <div className="flex-1 h-px bg-neutral-700" />
            <StepBadge
              done={!!review}
              active={status === "reviewing"}
              label="审查"
            />
          </div>

          {/* Outline preview */}
          {outline && (
            <details className="mb-4">
              <summary className="text-xs text-neutral-400 font-mono cursor-pointer hover:text-neutral-300">
                剧本大纲: {outline.sceneTitle} — {outline.beats?.length || 0} 个节拍
              </summary>
              <div className="mt-2 p-3 bg-[#111110] rounded border border-neutral-800/40">
                <p className="text-xs text-neutral-500 mb-2">目标: {outline.sceneGoal} | 弧线: {outline.emotionalArc} | 结局: {outline.sceneEnding}</p>
                {outline.beats?.map(b => (
                  <div key={b.beatNumber} className="flex gap-2 text-xs text-neutral-400 py-0.5">
                    <span className="text-orange-500 font-mono shrink-0">#{b.beatNumber}</span>
                    <span>{b.description}</span>
                    <span className="text-neutral-600">[{b.activeCharacters?.join(", ")}]</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Generated text */}
          {fullNovel && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold text-neutral-400 font-mono uppercase tracking-wider">
                  生成正文
                </h4>
                <div className="flex gap-2">
                  <button onClick={handleCopy} className="flex items-center gap-1 text-[10px] text-neutral-500 hover:text-neutral-300 font-mono">
                    {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                    {copied ? "已复制" : "复制"}
                  </button>
                  <button onClick={() => setShowReview(!showReview)} className="flex items-center gap-1 text-[10px] text-neutral-500 hover:text-neutral-300 font-mono">
                    <Shield className="w-3 h-3" />
                    {showReview ? "隐藏审查" : review ? `查看审查 (${review.findings.length}条)` : ""}
                  </button>
                  <button onClick={() => setShowPrompt(!showPrompt)} className="flex items-center gap-1 text-[10px] text-neutral-500 hover:text-neutral-300 font-mono">
                    <ScrollText className="w-3 h-3" />
                    {showPrompt ? "隐藏 Prompt" : "查看 Prompt"}
                  </button>
                </div>
              </div>
              <div className="bg-[#111110] border border-neutral-800 rounded-lg p-6 max-h-[600px] overflow-y-auto custom-scrollbar">
                <div className="text-sm text-neutral-300 leading-relaxed whitespace-pre-wrap font-serif">
                  {fullNovel}
                </div>
              </div>
            </div>
          )}

          {/* Review panel */}
          {showReview && review && (
            <div className="mt-4 border-t border-neutral-800/60 pt-4">
              <h4 className="text-xs font-semibold text-neutral-400 font-mono uppercase tracking-wider mb-3">
                审查报告
                <span className="ml-2 text-neutral-600">
                  {review.autoFixedCount} 自动修正 · {review.needsHumanReview.length} 待确认
                </span>
              </h4>
              <div className="space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar">
                {review.findings.filter(f => f.severity !== "minor" || review.findings.length <= 10).map((f, i) => (
                  <div key={i} className={`p-3 rounded border text-xs ${
                    f.severity === "critical" ? "border-red-500/30 bg-red-500/5 text-red-300" :
                    f.severity === "major" ? "border-yellow-500/30 bg-yellow-500/5 text-yellow-300" :
                    "border-neutral-700 bg-neutral-800/20 text-neutral-400"
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                        f.severity === "critical" ? "bg-red-500/20 text-red-300" :
                        f.severity === "major" ? "bg-yellow-500/20 text-yellow-300" :
                        "bg-neutral-600/30 text-neutral-400"
                      }`}>{f.severity.toUpperCase()}</span>
                      <span className="text-neutral-500">{f.dimension}</span>
                      {f.autoFixable && <span className="text-green-500/70 text-[10px] ml-auto font-mono">已自动修正</span>}
                    </div>
                    <p className="text-neutral-300">{f.description}</p>
                    {f.suggestion && <p className="text-neutral-500 mt-1">建议: {f.suggestion}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Prompt preview */}
          {showPrompt && systemPrompt && (
            <div className="mt-4 border-t border-neutral-800/60 pt-4 space-y-3">
              <h4 className="text-xs font-semibold text-neutral-400 font-mono uppercase tracking-wider">渲染后的 Prompt</h4>
              <details>
                <summary className="text-xs text-neutral-500 font-mono cursor-pointer hover:text-neutral-300">System Prompt ({(systemPrompt || "").length.toLocaleString()} 字符)</summary>
                <pre className="mt-2 bg-[#111110] border border-neutral-800 rounded-lg p-4 text-xs text-neutral-400 font-mono whitespace-pre-wrap max-h-[400px] overflow-y-auto custom-scrollbar">{systemPrompt}</pre>
              </details>
              {userPrompt && (
                <details>
                  <summary className="text-xs text-neutral-500 font-mono cursor-pointer hover:text-neutral-300">User Prompt</summary>
                  <pre className="mt-2 bg-[#111110] border border-neutral-800 rounded-lg p-4 text-xs text-neutral-400 font-mono whitespace-pre-wrap max-h-[200px] overflow-y-auto custom-scrollbar">{userPrompt}</pre>
                </details>
              )}
            </div>
          )}

          {/* Loading state */}
          {status === "generating" && !fullNovel && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
              <p className="text-sm text-neutral-400 font-mono">Writer 正在创作中...</p>
            </div>
          )}
        </div>
      )}

      {/* ================================================
          ERROR
          ================================================ */}
      {error && (
        <div className="bg-red-500/5 border border-red-500/30 rounded-lg p-4 text-center">
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
  );
}

// ============================================================
// Helpers
// ============================================================

function StepBadge({ done, active, label }: { done: boolean; active?: boolean; label: string }) {
  let cls = "px-3 py-1 rounded-full text-[10px] font-mono border transition-colors ";
  if (done) cls += "bg-green-500/10 border-green-500/30 text-green-400";
  else if (active) cls += "bg-orange-500/10 border-orange-500/30 text-orange-400 animate-pulse";
  else cls += "bg-neutral-800 border-neutral-700 text-neutral-600";
  return <span className={cls}>{label}</span>;
}
