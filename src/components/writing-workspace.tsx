"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { CharacterProfile, SceneDefinition, WritingStyle, SceneOutline, ChapterTimeline, CharacterChapterState } from "@/types";
import type { ReviewReport } from "@/core/codex/types";
import { Loader2, Play, Sparkles, RefreshCw, Shield, ScrollText, Check, AlertCircle, Copy, Edit3, Bot } from "lucide-react";

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

interface WritingTask {
  id: string;
  novelId: string;
  label: string;
  script: string;
  continueFrom: string;
  continueFromChapter: number;
  scene: SceneDefinition;
  output?: string;
  outline?: SceneOutline | null;
  outlinePrompt?: { system: string; user: string } | null;
  review?: ReviewReport | null;
  writerPrompt?: { systemPrompt: string; userPrompt: string } | null;
  status: "draft" | "writing" | "completed";
  createdAt: string;
}

const TASKS_KEY = "writing_tasks";

// ============================================================
// Main Component
// ============================================================

export default function WritingWorkspace({
  novelId, novelTitle, characters, scene, writingStyle,
  onSceneChange, onBack, onComplete, initialFullNovel,
  timeline, lastChapterStates, storyInfo,
}: WritingWorkspaceProps) {
  // --- Persisted tasks ---
  const [tasks, setTasks] = useState<WritingTask[]>(() => {
    try { return JSON.parse(localStorage.getItem(TASKS_KEY) || "[]"); } catch { return []; }
  });
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [creatingTask, setCreatingTask] = useState(false);
  const [generatingOutline, setGeneratingOutline] = useState(false);
  const activeTask = activeTaskId ? tasks.find(t => t.id === activeTaskId) : null;

  // --- Task creation ---
  const [newTaskChapter, setNewTaskChapter] = useState<number>(() => Math.max(1, timeline?.chapters?.length || 1));
  const [newTaskLabel, setNewTaskLabel] = useState("");

  // --- Transient ---
  const [status, setStatus] = useState<"idle" | "generating" | "completed" | "error">("idle");
  const [outputText, setOutputText] = useState("");
  const [scriptText, setScriptText] = useState("");
  const [outline, setOutline] = useState<SceneOutline | null>(null);
  const [outlinePrompt, setOutlinePrompt] = useState<{ system: string; user: string } | null>(null);
  const [writerPrompt, setWriterPrompt] = useState<{ systemPrompt: string; userPrompt: string } | null>(null);
  const [review, setReview] = useState<ReviewReport | null>(null);
  const [error, setError] = useState("");
  const [showReview, setShowReview] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showOutlinePrompt, setShowOutlinePrompt] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const persistTasks = useCallback((updated: WritingTask[]) => {
    setTasks(updated);
    localStorage.setItem(TASKS_KEY, JSON.stringify(updated));
  }, []);

  const updateTask = useCallback((id: string, patch: Partial<WritingTask>) => {
    setTasks(prev => {
      const next = prev.map(t => t.id === id ? { ...t, ...patch } : t);
      localStorage.setItem(TASKS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // Load active task into state
  useEffect(() => {
    if (!activeTask) return;
    setScriptText(activeTask.script || "");
    setOutputText(activeTask.output || "");
    setOutline(activeTask.outline || null);
    setOutlinePrompt(activeTask.outlinePrompt || null);
    setWriterPrompt(activeTask.writerPrompt || null);
    setReview(activeTask.review || null);
    setStatus(activeTask.output ? "completed" : "idle");
  }, [activeTaskId]);

  // Auto-save script
  useEffect(() => {
    if (!activeTaskId) return;
    updateTask(activeTaskId, { script: scriptText });
  }, [scriptText]);

  // --- Build script ---
  const buildScript = useCallback(
    (chars: CharacterProfile[], ol: SceneOutline | null, sc: SceneDefinition) => {
      const selectedChars = chars.filter(c => sc.characterIds.includes(c.id));
      const lines: string[] = [];
      lines.push("# 写作剧本\n");
      lines.push("## 场景");
      lines.push(`地点：${sc.location || "（未指定）"}`);
      lines.push(`时间：${sc.timeOfDay}  天气：${sc.weather}  氛围：${sc.atmosphere}`);
      if (sc.initialSituation) lines.push(`\n${sc.initialSituation}`);

      if (selectedChars.length > 0) {
        lines.push("\n## 出场角色");
        for (const c of selectedChars) {
          const traits = Array.isArray(c.personality?.traits) ? c.personality.traits.join("、") : String(c.personality?.traits || "");
          const goal = c.drive?.goal || "";
          const speaking = c.speakingStyle?.description || "";
          const cp = c.speakingStyle?.catchphrases;
          const catchphrases = Array.isArray(cp) ? cp.join("、") : "";
          const relList = Array.isArray(c.relationships) ? c.relationships : [];
          const rels = relList
            .filter(r => selectedChars.some(sc2 => sc2.name === r.characterName))
            .map(r => `${r.characterName}（${r.type}：${r.dynamics}）`)
            .join("；");
          lines.push(`### ${c.name}`);
          lines.push(`性格：${traits}。${c.personality?.description || ""}`);
          if (goal) lines.push(`核心目标：${goal}`);
          if (speaking) lines.push(`说话风格：${speaking}${catchphrases ? `（口头禅：${catchphrases}）` : ""}`);
          if (rels) lines.push(`在场关系：${rels}`);
          lines.push("");
        }
      }

      if (ol) {
        lines.push("## 剧本大纲");
        lines.push(`标题：${ol.sceneTitle}`);
        lines.push(`目标：${ol.sceneGoal}`);
        lines.push(`情感弧线：${ol.emotionalArc} → 结局：${ol.sceneEnding}`);
        (ol.beats || []).forEach(b => {
          const chars2 = b.activeCharacters || [];
          lines.push(`- 节拍${b.beatNumber}：${b.description}（出场：${chars2.join("、")}）（氛围：${b.mood}）`);
        });
      }
      return lines.join("\n");
    },
    []
  );

  // --- Create task (step 1: pick chapter, step 2: jump to workspace) ---
  const handleCreateTaskBasic = useCallback(() => {
    const chapterTitle = timeline?.chapters?.[newTaskChapter - 1]?.title || `第${newTaskChapter}章`;
    const sc: SceneDefinition = {
      ...scene,
      location: scene.location || "",
      characterIds: characters.map(c => c.id),
    };
    const label = newTaskLabel || `${chapterTitle}续写`;
    // Empty script — user clicks 'AI 生成剧本' to fill it
    const script = `# 写作剧本\n\n## 场景\n承接：${chapterTitle}末\n\n> 请点击"AI 生成剧本"按钮生成场景大纲，或手动编辑此剧本`;

    const task: WritingTask = {
      id: `task_${Date.now()}`,
      novelId,
      label,
      script,
      continueFrom: `${chapterTitle}末`,
      continueFromChapter: newTaskChapter,
      scene: sc,
      status: "draft",
      createdAt: new Date().toISOString(),
    };

    const updated = [task, ...tasks];
    persistTasks(updated);
    setActiveTaskId(task.id);
    setScriptText(script);
    setOutputText("");
    setWriterPrompt(null);
    setReview(null);
    setStatus("idle");
    setCreatingTask(false);
  }, [timeline, newTaskChapter, newTaskLabel, scene, characters, buildScript, novelId, tasks, persistTasks]);

  // --- AI generate outline for existing task ---
  const handleGenerateOutline = useCallback(async () => {
    if (!activeTaskId) return;
    setGeneratingOutline(true);
    const sc = activeTask?.scene || scene;

    try {
      const res = await fetch("/api/simulation/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          novelTitle, novelId,
          characters, // pass ALL characters so outline agent can select 2-3
          scene: sc, writingStyle, outlineOnly: true,
          timelineEvents: (timeline?.chapters || []).flatMap(ch => (ch?.events || [])),
          lastChapterStates,
        }),
        signal: new AbortController().signal,
      });

      if (res.ok) {
        const reader = res.body?.getReader();
        if (reader) {
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
                  if (event.type === "outline") {
                    const ol = event.outline;
                    const olp = event.prompt || null;
                    setOutline(ol);
                    setOutlinePrompt(olp);
                    const newScript = buildScript(characters, ol, sc);
                    setScriptText(newScript);
                    updateTask(activeTaskId, {
                      outline: ol, outlinePrompt: olp, script: newScript,
                    });
                    break;
                  }
                  if (event.type === "error") break;
                } catch {}
              }
            }
            if (outline) break;
          }
          reader.cancel();
        }
      }
    } catch {}
    setGeneratingOutline(false);
  }, [activeTaskId, activeTask, scene, characters, lastChapterStates, novelId, novelTitle, outline, timeline, updateTask, buildScript, writingStyle]);

  // --- Writing ---
  const startWriting = useCallback(async () => {
    const taskScene = activeTask?.scene || scene;
    // Script-based writing: extract location from script if scene has none
    const location = taskScene.location?.trim() || "";
    if (!location && !scriptText.trim()) return;

    // Build a scene from the script text if no location set
    let effectiveScene = taskScene;
    if (!location) {
      // Parse location from script: "地点：xxx"
      const locMatch = scriptText.match(/地点：(.+)/);
      const sitMatch = scriptText.match(/初始情境[：:]\s*(.+)/);
      effectiveScene = {
        ...taskScene,
        location: locMatch?.[1] || "续写",
        initialSituation: sitMatch?.[1] || taskScene.initialSituation || "",
      };
    }
    updateTask(activeTaskId!, { status: "writing" });
    setStatus("generating");
    setError(""); setOutputText(""); setReview(null); setShowReview(false); setShowPrompt(false);

    const controller = new AbortController(); abortRef.current = controller;
    try {
      const res = await fetch("/api/simulation/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          novelTitle, novelId,
          characters: characters.filter(c => taskScene.characterIds.includes(c.id)),
          scene: taskScene, writingStyle,
          timelineEvents: (timeline?.chapters || []).flatMap(ch => (ch.events || [])),
          lastChapterStates,
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const reader = res.body?.getReader(); if (!reader) throw new Error("No stream");
      const decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const event = JSON.parse(line.slice(6));
              switch (event.type) {
                case "outline": setOutline(event.outline); if (event.prompt) setOutlinePrompt(event.prompt); updateTask(activeTaskId!, { outline: event.outline, outlinePrompt: event.prompt }); break;
                case "prompt": setWriterPrompt({ systemPrompt: event.systemPrompt, userPrompt: event.userPrompt }); updateTask(activeTaskId!, { writerPrompt: { systemPrompt: event.systemPrompt, userPrompt: event.userPrompt } }); break;
                case "prose": setOutputText(event.prose); updateTask(activeTaskId!, { output: event.prose, status: "completed" }); break;
                case "review": setReview(event.review); setShowReview(true); updateTask(activeTaskId!, { review: event.review }); break;
                case "scene_end": setStatus("completed"); onComplete?.(event.fullNovel); break;
                case "error": setStatus("error"); setError(event.message); break;
              }
            } catch {}
          }
        }
      }
    } catch (e) { if ((e as Error).name === "AbortError") return; setStatus("error"); setError(e instanceof Error ? e.message : "Failed"); }
  }, [activeTaskId, activeTask, scene, characters, lastChapterStates, novelId, novelTitle, onComplete, timeline, updateTask, writingStyle]);

  const stopWriting = () => { abortRef.current?.abort(); if (outputText) setStatus("completed"); };
  const handleCopy = () => { navigator.clipboard.writeText(outputText); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const handleCancelTask = () => setActiveTaskId(null);

  // Writing is allowed as long as we have a scene location or script content
  const canWrite = !!(activeTask?.scene?.location?.trim() || scriptText.trim());
  const hasContent = !!outputText;

  // ===== RENDER: No active task, not creating =====
  if (!activeTaskId && !creatingTask) {
    return (
      <div className="h-full flex items-center justify-center" style={{ height: "calc(100vh - 130px)" }}>
        <div className="text-center max-w-md">
          <Bot className="w-12 h-12 mx-auto mb-4 text-neutral-700 opacity-50" />
          <p className="text-base text-neutral-400 font-mono mb-2">写作工作区</p>
          <p className="text-sm text-neutral-600 mb-8">选择承接章节，AI 将自动生成写作剧本</p>

          {tasks.filter(t => t.novelId === novelId).length > 0 && (
            <div className="mb-6">
              <div className="text-xs text-neutral-500 font-mono uppercase tracking-wider mb-3">已有任务</div>
              <div className="space-y-2">
                {tasks.filter(t => t.novelId === novelId).map(t => (
                  <button key={t.id} onClick={() => setActiveTaskId(t.id)}
                    className="w-full text-left px-4 py-3 rounded-lg border border-neutral-800 hover:border-orange-500/30 bg-[#0c0c0c] hover:bg-neutral-800/40 transition-colors">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-neutral-300 font-mono">{t.label}</span>
                      <span className={`text-[10px] font-mono ${t.status === "completed" ? "text-green-500" : "text-neutral-600"}`}>
                        {t.status === "completed" ? "已完成" : "草稿"}
                      </span>
                    </div>
                    <div className="text-xs text-neutral-600 mt-0.5">承接：{t.continueFrom}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <button onClick={() => setCreatingTask(true)}
            className="px-6 py-3 bg-orange-600 hover:bg-orange-500 text-white text-sm font-mono rounded-lg transition-colors inline-flex items-center gap-2">
            <Bot className="w-4 h-4" /> 新建写作任务
          </button>
        </div>
      </div>
    );
  }

  // ===== RENDER: Creating task dialog =====
  if (creatingTask) {
    const numChapters = timeline?.chapters?.length || 1;
    return (
      <div className="h-full flex items-center justify-center" style={{ height: "calc(100vh - 130px)" }}>
        <div className="max-w-md w-full bg-[#0c0c0c] border border-neutral-800/60 rounded-lg p-6">
          <h3 className="text-sm font-semibold text-neutral-300 font-mono mb-5">新建写作任务</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-neutral-500 font-mono mb-1">承接章节</label>
              <select value={newTaskChapter} onChange={e => setNewTaskChapter(Number(e.target.value))}
                className="w-full px-3 py-2 bg-[#111110] border border-neutral-800 rounded text-sm text-neutral-300 font-mono">
                {Array.from({ length: numChapters }, (_, i) => {
                  const ch = timeline?.chapters?.[i];
                  return <option key={i + 1} value={i + 1}>
                    第{i + 1}章{ch?.title ? ` ${ch.title}` : ""} {i + 1 === numChapters ? "（最新）" : ""}
                  </option>;
                })}
              </select>
            </div>
            <div>
              <label className="block text-xs text-neutral-500 font-mono mb-1">任务名称 <span className="text-neutral-700">（可选）</span></label>
              <input type="text" value={newTaskLabel} onChange={e => setNewTaskLabel(e.target.value)}
                placeholder={timeline?.chapters?.[newTaskChapter - 1]?.title ? `${timeline.chapters[newTaskChapter - 1].title}续写` : "新续写场景"}
                className="w-full px-3 py-2 bg-[#111110] border border-neutral-800 rounded text-sm text-neutral-300 font-mono outline-none focus:border-orange-600/50" />
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setCreatingTask(false)}
                className="flex-1 py-2.5 text-sm text-neutral-500 hover:text-neutral-300 font-mono border border-neutral-700 rounded-lg transition-colors">取消</button>
              <button onClick={handleCreateTaskBasic}
                className="flex-1 py-2.5 bg-orange-600 hover:bg-orange-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white text-sm font-mono rounded-lg transition-colors flex items-center justify-center gap-2">
                创建任务
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ===== RENDER: Active workspace =====
  return (
    <div className="flex gap-4" style={{ height: "calc(100vh - 130px)" }}>
      {/* LEFT */}
      <div className="w-[420px] shrink-0 flex flex-col gap-3">
        <div className="bg-[#0c0c0c] border border-neutral-800/60 rounded-lg p-3 flex items-center gap-3">
          <button onClick={handleCancelTask} className="text-neutral-500 hover:text-neutral-300 font-mono text-xs shrink-0">←</button>
          <div className="flex-1">
            <input type="text" value={activeTask?.label || ""} onChange={e => updateTask(activeTaskId!, { label: e.target.value })}
              className="w-full bg-transparent border-0 text-sm text-neutral-200 font-mono outline-none placeholder-neutral-600" />
            <div className="text-[10px] text-neutral-600 font-mono mt-0.5">承接：{activeTask?.continueFrom}  ·  第{activeTask?.continueFromChapter}章</div>
          </div>
        </div>

        <div className="bg-[#0c0c0c] border border-neutral-800/60 rounded-lg overflow-hidden flex flex-col flex-1">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-800/40 bg-[#0e0e0e] shrink-0">
            <div className="flex items-center gap-2">
              <Edit3 className="w-3.5 h-3.5 text-orange-500" />
              <h3 className="text-[10px] font-semibold text-neutral-400 font-mono uppercase tracking-widest">写作剧本</h3>
            </div>
            <div className="flex gap-2">
              <button onClick={handleGenerateOutline} disabled={generatingOutline}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-neutral-700 hover:bg-neutral-600 disabled:bg-neutral-800 disabled:text-neutral-600 text-white transition-colors">
                {generatingOutline ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bot className="w-3 h-3" />}
                {generatingOutline ? "生成中..." : "AI 生成剧本"}
              </button>
              <button onClick={() => setScriptText(buildScript(characters, outline, activeTask?.scene || scene))}
                className="text-[10px] text-neutral-500 hover:text-neutral-300 font-mono">刷新</button>
            </div>
          </div>

          <textarea value={scriptText} onChange={e => setScriptText(e.target.value)}
            className="flex-1 w-full bg-transparent border-0 outline-none resize-none p-4 text-sm text-neutral-300 font-mono leading-relaxed custom-scrollbar placeholder-neutral-700"
            placeholder="# 写作剧本..." spellCheck={false} />

          <div className="px-4 py-3 border-t border-neutral-800/40 bg-[#0e0e0e] shrink-0">
            {status === "idle" || status === "completed" || status === "error" ? (
              <button onClick={startWriting} disabled={!canWrite}
                className="w-full py-2.5 bg-orange-600 hover:bg-orange-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white text-sm font-mono rounded-lg transition-colors flex items-center justify-center gap-2">
                <Play className="w-4 h-4" /> {status === "completed" ? "重新生成" : "开始写作"}
              </button>
            ) : (
              <button onClick={stopWriting} className="w-full py-2.5 bg-red-600/10 hover:bg-red-600/20 border border-red-500/30 text-red-400 text-sm font-mono rounded-lg transition-colors flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> 停止
              </button>
            )}
          </div>
        </div>
      </div>

      {/* RIGHT */}
      <div className="flex-1 flex flex-col min-w-0">
        {hasContent || status === "generating" ? (
          <div className="bg-[#0c0c0c] border border-neutral-800/60 rounded-lg flex flex-col flex-1 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-800/40 bg-[#0e0e0e] shrink-0">
              <div className="flex items-center gap-3">
                <h3 className="text-[10px] font-semibold text-neutral-400 font-mono uppercase tracking-widest">生成正文</h3>
                {status === "completed" && <span className="text-[9px] text-green-500/70 font-mono">已完成</span>}
                {status === "generating" && <span className="text-[9px] text-orange-500/70 font-mono flex items-center gap-1"><Loader2 className="w-2.5 h-2.5 animate-spin" />写作中...</span>}
              </div>
              <div className="flex items-center gap-3">
                {outlinePrompt && <button onClick={() => setShowOutlinePrompt(!showOutlinePrompt)} className={`flex items-center gap-1 text-[10px] font-mono transition-colors ${showOutlinePrompt ? "text-neutral-300" : "text-neutral-500 hover:text-neutral-300"}`}>
                  <ScrollText className="w-3 h-3" />大纲Prompt</button>}
                {review && <button onClick={() => setShowReview(!showReview)} className={`flex items-center gap-1 text-[10px] font-mono transition-colors ${showReview ? "text-green-400" : "text-neutral-500 hover:text-green-400"}`}>
                  <Shield className="w-3 h-3" />审查 ({review.findings.length})</button>}
                {writerPrompt && <button onClick={() => setShowPrompt(!showPrompt)} className={`flex items-center gap-1 text-[10px] font-mono transition-colors ${showPrompt ? "text-neutral-300" : "text-neutral-500 hover:text-neutral-300"}`}>
                  <ScrollText className="w-3 h-3" />Writer Prompt</button>}
                <button onClick={handleCopy} className="flex items-center gap-1 text-[10px] text-neutral-500 hover:text-neutral-300 font-mono">{copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              <div className="p-6">
                {status === "generating" && !outputText ? (
                  <div className="flex items-center justify-center py-20"><div className="flex flex-col items-center gap-3"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /><p className="text-sm text-neutral-500 font-mono">Writer 创作中...</p></div></div>
                ) : (
                  <div className="text-base text-neutral-200 leading-relaxed whitespace-pre-wrap font-serif max-w-[800px] mx-auto">{outputText}</div>
                )}
              </div>
              {showReview && review && <ReviewSection review={review} />}
              {showPrompt && writerPrompt && <PromptSection label="Writer Prompt" systemPrompt={writerPrompt.systemPrompt} userPrompt={writerPrompt.userPrompt} />}
              {showOutlinePrompt && outlinePrompt && <PromptSection label="大纲 Agent Prompt" systemPrompt={outlinePrompt.system} userPrompt={outlinePrompt.user} />}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Bot className="w-12 h-12 mx-auto mb-4 text-neutral-700 opacity-50" />
              <p className="text-base text-neutral-500 font-mono">剧本已就绪</p>
              <p className="text-sm text-neutral-700 mt-2">编辑左侧剧本后点击"开始写作"</p>
              <p className="text-xs text-neutral-700 mt-1">也可以点击"AI 生成剧本"让大纲 Agent 自动生成大纲</p>
            </div>
          </div>
        )}
        {error && <ErrorBanner error={error} onRetry={startWriting} />}
      </div>
    </div>
  );
}

function ReviewSection({ review }: { review: ReviewReport }) {
  return (
    <div className="border-t border-neutral-800/60 p-6">
      <div className="flex items-center gap-2 mb-4 max-w-[800px] mx-auto">
        <Shield className="w-4 h-4 text-green-500" />
        <h4 className="text-xs font-semibold text-neutral-400 font-mono uppercase tracking-widest">审查报告</h4>
        <span className="text-[10px] text-green-500/80 font-mono">{review.autoFixedCount} 自动修正</span>
        <span className="text-[10px] text-orange-500/80 font-mono">{review.needsHumanReview.length} 待确认</span>
      </div>
      <div className="space-y-2 max-w-[800px] mx-auto">
        {review.findings.length === 0 ? <p className="text-sm text-green-500/70 font-mono">全部通过，无问题。</p> : (
          review.findings.filter(f => f.severity !== "minor" || review.findings.length <= 8).map((f, i) => (
            <div key={i} className={`p-3 rounded border text-xs ${f.severity === "critical" ? "border-red-500/30 bg-red-500/5" : f.severity === "major" ? "border-yellow-500/30 bg-yellow-500/5" : "border-neutral-700 bg-neutral-800/20"}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono uppercase ${f.severity === "critical" ? "bg-red-500/20 text-red-300" : f.severity === "major" ? "bg-yellow-500/20 text-yellow-300" : "bg-neutral-600/30 text-neutral-400"}`}>{f.severity}</span>
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
  );
}

function PromptSection({ label, systemPrompt, userPrompt }: { label: string; systemPrompt: string; userPrompt: string }) {
  return (
    <div className="border-t border-neutral-800/60 p-6">
      <h4 className="text-xs font-semibold text-neutral-400 font-mono uppercase tracking-widest mb-3 max-w-[800px] mx-auto">
        {label} <span className="text-neutral-600 font-normal">({(systemPrompt.length + userPrompt.length).toLocaleString()} chars)</span>
      </h4>
      <div className="max-w-[800px] mx-auto space-y-3">
        <details open><summary className="text-xs text-neutral-500 font-mono cursor-pointer hover:text-neutral-300">System Prompt</summary><pre className="mt-2 text-xs text-neutral-500 font-mono whitespace-pre-wrap leading-relaxed bg-[#080808] rounded p-4 border border-neutral-800/30 max-h-[400px] overflow-y-auto custom-scrollbar">{systemPrompt}</pre></details>
        {userPrompt && <details><summary className="text-xs text-neutral-500 font-mono cursor-pointer hover:text-neutral-300">User Prompt</summary><pre className="mt-2 text-xs text-neutral-500 font-mono whitespace-pre-wrap leading-relaxed bg-[#080808] rounded p-4 border border-neutral-800/30 max-h-[200px] overflow-y-auto custom-scrollbar">{userPrompt}</pre></details>}
      </div>
    </div>
  );
}

function ErrorBanner({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="mt-3 bg-red-500/5 border border-red-500/30 rounded-lg p-4 text-center">
      <AlertCircle className="w-5 h-5 text-red-400 mx-auto mb-2" />
      <p className="text-sm text-red-400 font-mono">{error}</p>
      <button onClick={onRetry} className="mt-3 px-4 py-1.5 bg-red-500/10 border border-red-500/30 text-red-400 rounded text-xs font-mono hover:bg-red-500/20 transition-colors">
        <RefreshCw className="w-3 h-3 inline mr-1" /> 重试
      </button>
    </div>
  );
}
