"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { CharacterProfile, SceneDefinition, WritingStyle, SceneOutline, ChapterTimeline, CharacterChapterState } from "@/types";
import type { ReviewReport } from "@/core/codex/types";
import { Loader2, Play, Sparkles, RefreshCw, Shield, ScrollText, Check, AlertCircle, Copy, Edit3, Save } from "lucide-react";

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

// Persisted writing task
interface WritingTask {
  id: string;
  novelId: string;
  label: string;
  script: string;             // editable writing script
  continueFrom: string;       // e.g. "Chapter 15" or "End of Chapter 15"
  scene: SceneDefinition;
  output?: string;
  outline?: SceneOutline | null;
  outlinePrompt?: { system: string; user: string } | null;
  review?: ReviewReport | null;
  writerPrompt?: { systemPrompt: string; userPrompt: string } | null;
  status: "draft" | "completed";
  createdAt: string;
}

const TASKS_KEY = "writing_tasks";

function loadTasks(): WritingTask[] {
  try { return JSON.parse(localStorage.getItem(TASKS_KEY) || "[]"); } catch { return []; }
}
function saveTasks(tasks: WritingTask[]) {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
}

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
  // ---- Persisted tasks ---
  const [tasks, setTasks] = useState<WritingTask[]>(loadTasks);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  const activeTask = activeTaskId ? tasks.find(t => t.id === activeTaskId) : null;

  // ---- Transient state ---
  const [status, setStatus] = useState<"idle" | "generating" | "completed" | "error">(
    activeTask?.output ? "completed" : "idle"
  );
  const [outputText, setOutputText] = useState(activeTask?.output || "");
  const [scriptText, setScriptText] = useState(activeTask?.script || "");
  const [continueFrom, setContinueFrom] = useState(activeTask?.continueFrom || "");
  const [label, setLabel] = useState(activeTask?.label || "");
  const [outline, setOutline] = useState<SceneOutline | null>(activeTask?.outline || null);
  const [outlinePrompt, setOutlinePrompt] = useState<{ system: string; user: string } | null>(activeTask?.outlinePrompt || null);
  const [writerPrompt, setWriterPrompt] = useState<{ systemPrompt: string; userPrompt: string } | null>(activeTask?.writerPrompt || null);
  const [review, setReview] = useState<ReviewReport | null>(activeTask?.review || null);
  const [error, setError] = useState("");
  const [recommendLoading, setRecommendLoading] = useState(false);
  const [sceneRecommendations, setSceneRecommendations] = useState<any[] | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showOutlinePrompt, setShowOutlinePrompt] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Sync activeTask to state when it changes
  useEffect(() => {
    if (activeTask) {
      setScriptText(activeTask.script);
      setContinueFrom(activeTask.continueFrom);
      setLabel(activeTask.label);
      setOutputText(activeTask.output || "");
      setOutline(activeTask.outline || null);
      setOutlinePrompt(activeTask.outlinePrompt || null);
      setWriterPrompt(activeTask.writerPrompt || null);
      setReview(activeTask.review || null);
      setStatus(activeTask.output ? "completed" : "idle");
    }
  }, [activeTaskId]);

  // ---- Build initial script from scene + characters ---
  const buildSceneScript = useCallback(() => {
    const selectedChars = characters.filter(c => scene.characterIds.includes(c.id));
    const lines: string[] = [];

    lines.push("# 写作剧本");
    lines.push("");
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
        if (speaking) lines.push(`说话风格：${speaking}${catchphrases ? `（口头禅：${catchphrases}）` : ""}`);
        if (rels) lines.push(`在场关系：${rels}`);
        lines.push("");
      }
    }

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

  // Init script if empty
  if (!scriptText && !activeTask) {
    // trigger build on next render
    setTimeout(() => setScriptText(buildSceneScript()), 0);
  }

  // ---- Persist task ---
  const persistTask = useCallback(() => {
    if (!activeTaskId) return;
    const updated = tasks.map(t => t.id === activeTaskId ? {
      ...t,
      script: scriptText,
      continueFrom,
      label,
      output: outputText,
      outline,
      outlinePrompt,
      writerPrompt,
      review,
      status: outputText ? "completed" as const : "draft" as const,
    } : t);
    setTasks(updated);
    saveTasks(updated);
  }, [activeTaskId, tasks, scriptText, continueFrom, label, outputText, outline, outlinePrompt, writerPrompt, review]);

  // Auto-save on key changes
  useEffect(() => { if (activeTaskId) persistTask(); }, [scriptText, continueFrom, label, outputText]);

  // ---- Create new task ---
  const createTask = useCallback(() => {
    const task: WritingTask = {
      id: `task_${Date.now()}`,
      novelId,
      label: scene.initialSituation ? scene.initialSituation.slice(0, 40) : "新写作任务",
      script: buildSceneScript(),
      continueFrom: "",
      scene: { ...scene },
      status: "draft",
      createdAt: new Date().toISOString(),
    };
    const updated = [task, ...tasks];
    setTasks(updated);
    saveTasks(updated);
    setActiveTaskId(task.id);
  }, [novelId, scene, tasks, buildSceneScript]);

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
                  if (event.prompt) setOutlinePrompt(event.prompt);
                  break;
                case "prompt":
                  setWriterPrompt({ systemPrompt: event.systemPrompt, userPrompt: event.userPrompt });
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
  const needsLocation = !scene.location.trim();

  return (
    <div className="flex gap-4" style={{ height: "calc(100vh - 130px)" }}>
      {/* ============================================================
          LEFT COLUMN (420px): Task Info + Script + Controls
          ============================================================ */}
      <div className="w-[420px] shrink-0 flex flex-col gap-3">
        {/* Task metadata bar */}
        <div className="bg-[#0c0c0c] border border-neutral-800/60 rounded-lg p-3 flex items-center gap-3">
          <input
            type="text"
            value={label}
            onChange={e => setLabel(e.target.value)}
            className="flex-1 bg-transparent border-0 text-sm text-neutral-200 font-mono outline-none placeholder-neutral-600"
            placeholder="任务名称…"
          />
          <div className="flex items-center gap-2 text-[10px] text-neutral-500 font-mono">
            <span>承接：</span>
            <input
              type="text"
              value={continueFrom}
              onChange={e => setContinueFrom(e.target.value)}
              className="w-[120px] bg-[#111] border border-neutral-700 rounded px-2 py-1 text-neutral-400 outline-none focus:border-orange-600/50"
              placeholder="第X章末…"
            />
          </div>
        </div>

        {/* Script card */}
        <div className="bg-[#0c0c0c] border border-neutral-800/60 rounded-lg overflow-hidden flex flex-col flex-1">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-800/40 bg-[#0e0e0e] shrink-0">
            <div className="flex items-center gap-2">
              <Edit3 className="w-3.5 h-3.5 text-orange-500" />
              <h3 className="text-[10px] font-semibold text-neutral-400 font-mono uppercase tracking-widest">写作剧本</h3>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { if (activeTaskId) createTask(); else createTask(); }}
                disabled={!activeTaskId}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-neutral-700 hover:bg-neutral-600 disabled:bg-neutral-800 disabled:text-neutral-600 text-white transition-colors"
                title="保存当前任务"
              >
                <Save className="w-3 h-3" /> 保存
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

          <textarea
            value={scriptText}
            onChange={e => setScriptText(e.target.value)}
            className="flex-1 w-full bg-transparent border-0 outline-none resize-none p-4 text-sm text-neutral-300 font-mono leading-relaxed custom-scrollbar placeholder-neutral-700"
            placeholder="# 写作剧本..."
            spellCheck={false}
          />

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

          <div className="px-4 py-3 border-t border-neutral-800/40 bg-[#0e0e0e] shrink-0">
            {status === "idle" || status === "completed" || status === "error" ? (
              <button
                onClick={startWriting}
                disabled={needsLocation}
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
                <Loader2 className="w-4 h-4 animate-spin" /> 停止
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ============================================================
          RIGHT COLUMN (flex-1): Output + Review + Prompts
          ============================================================ */}
      <div className="flex-1 flex flex-col min-w-0">
        {hasContent || status === "generating" ? (
          <div className="bg-[#0c0c0c] border border-neutral-800/60 rounded-lg flex flex-col flex-1 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-800/40 bg-[#0e0e0e] shrink-0">
              <div className="flex items-center gap-3">
                <h3 className="text-[10px] font-semibold text-neutral-400 font-mono uppercase tracking-widest">生成正文</h3>
                {status === "completed" && <span className="text-[9px] text-green-500/70 font-mono">已完成</span>}
                {status === "generating" && <span className="text-[9px] text-orange-500/70 font-mono flex items-center gap-1"><Loader2 className="w-2.5 h-2.5 animate-spin" /> 写作中…</span>}
              </div>
              <div className="flex items-center gap-3">
                {outlinePrompt && (
                  <button onClick={() => setShowOutlinePrompt(!showOutlinePrompt)} className="flex items-center gap-1 text-[10px] text-neutral-500 hover:text-neutral-300 font-mono transition-colors">
                    <ScrollText className="w-3 h-3" /> 大纲Prompt
                  </button>
                )}
                {review && (
                  <button onClick={() => setShowReview(!showReview)} className={`flex items-center gap-1 text-[10px] font-mono transition-colors ${showReview ? "text-green-400" : "text-neutral-500 hover:text-green-400"}`}>
                    <Shield className="w-3 h-3" />
                    审查 ({review.findings.length})
                  </button>
                )}
                {writerPrompt && (
                  <button onClick={() => setShowPrompt(!showPrompt)} className={`flex items-center gap-1 text-[10px] font-mono transition-colors ${showPrompt ? "text-neutral-300" : "text-neutral-500 hover:text-neutral-300"}`}>
                    <ScrollText className="w-3 h-3" />
                    Writer Prompt
                  </button>
                )}
                <button onClick={handleCopy} className="flex items-center gap-1 text-[10px] text-neutral-500 hover:text-neutral-300 font-mono transition-colors">
                  {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                  {copied ? "已复制" : "复制"}
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {/* Output text */}
              <div className="p-6">
                {status === "generating" && !outputText ? (
                  <div className="flex items-center justify-center py-20">
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
                      <p className="text-sm text-neutral-500 font-mono">Writer 创作中...</p>
                    </div>
                  </div>
                ) : (
                  <div className="text-base text-neutral-200 leading-relaxed whitespace-pre-wrap font-serif max-w-[800px] mx-auto">
                    {outputText}
                  </div>
                )}
              </div>

              {/* Review — collapsible below text */}
              {showReview && review && (
                <div className="border-t border-neutral-800/60 p-6">
                  <div className="flex items-center gap-2 mb-4 max-w-[800px] mx-auto">
                    <Shield className="w-4 h-4 text-green-500" />
                    <h4 className="text-xs font-semibold text-neutral-400 font-mono uppercase tracking-widest">审查报告</h4>
                    <span className="text-[10px] text-green-500/80 font-mono">{review.autoFixedCount} 自动修正</span>
                    <span className="text-[10px] text-orange-500/80 font-mono">{review.needsHumanReview.length} 待确认</span>
                  </div>
                  <div className="space-y-2 max-w-[800px] mx-auto">
                    {review.findings.length === 0 ? (
                      <p className="text-sm text-green-500/70 font-mono">全部通过，无问题。</p>
                    ) : (
                      review.findings.filter(f => f.severity !== "minor" || review.findings.length <= 8).map((f, i) => (
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
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Writer Prompt */}
              {showPrompt && writerPrompt && (
                <div className="border-t border-neutral-800/60 p-6">
                  <h4 className="text-xs font-semibold text-neutral-400 font-mono uppercase tracking-widest mb-3 max-w-[800px] mx-auto">
                    Writer Prompt <span className="text-neutral-600 font-normal">({(writerPrompt.systemPrompt.length + (writerPrompt.userPrompt?.length || 0)).toLocaleString()} chars)</span>
                  </h4>
                  <div className="max-w-[800px] mx-auto space-y-3">
                    <details open>
                      <summary className="text-xs text-neutral-500 font-mono cursor-pointer hover:text-neutral-300">System Prompt</summary>
                      <pre className="mt-2 text-xs text-neutral-500 font-mono whitespace-pre-wrap leading-relaxed bg-[#080808] rounded p-4 border border-neutral-800/30 max-h-[400px] overflow-y-auto custom-scrollbar">{writerPrompt.systemPrompt}</pre>
                    </details>
                    {writerPrompt.userPrompt && (
                      <details>
                        <summary className="text-xs text-neutral-500 font-mono cursor-pointer hover:text-neutral-300">User Prompt</summary>
                        <pre className="mt-2 text-xs text-neutral-500 font-mono whitespace-pre-wrap leading-relaxed bg-[#080808] rounded p-4 border border-neutral-800/30 max-h-[200px] overflow-y-auto custom-scrollbar">{writerPrompt.userPrompt}</pre>
                      </details>
                    )}
                  </div>
                </div>
              )}

              {/* Outline Prompt */}
              {showOutlinePrompt && outlinePrompt && (
                <div className="border-t border-neutral-800/60 p-6">
                  <h4 className="text-xs font-semibold text-neutral-400 font-mono uppercase tracking-widest mb-3 max-w-[800px] mx-auto">
                    大纲 Agent Prompt
                  </h4>
                  <div className="max-w-[800px] mx-auto space-y-3">
                    <details open>
                      <summary className="text-xs text-neutral-500 font-mono cursor-pointer hover:text-neutral-300">System Prompt</summary>
                      <pre className="mt-2 text-xs text-neutral-500 font-mono whitespace-pre-wrap leading-relaxed bg-[#080808] rounded p-4 border border-neutral-800/30 max-h-[300px] overflow-y-auto custom-scrollbar">{outlinePrompt.system}</pre>
                    </details>
                    <details>
                      <summary className="text-xs text-neutral-500 font-mono cursor-pointer hover:text-neutral-300">User Prompt</summary>
                      <pre className="mt-2 text-xs text-neutral-500 font-mono whitespace-pre-wrap leading-relaxed bg-[#080808] rounded p-4 border border-neutral-800/30 max-h-[200px] overflow-y-auto custom-scrollbar">{outlinePrompt.user}</pre>
                    </details>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Edit3 className="w-12 h-12 mx-auto mb-4 text-neutral-700 opacity-50" />
              <p className="text-base text-neutral-500 font-mono">设置写作剧本后，点击"开始写作"</p>
              <p className="text-sm text-neutral-700 mt-2 mb-6">剧本可以自由编辑——调整场景描述、角色细节、大纲节拍</p>
              {!activeTaskId && (
                <button
                  onClick={createTask}
                  className="px-5 py-2.5 bg-orange-600 hover:bg-orange-500 text-white text-sm font-mono rounded-lg transition-colors inline-flex items-center gap-2"
                >
                  <Edit3 className="w-4 h-4" /> 创建写作任务
                </button>
              )}
            </div>
          </div>
        )}

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
