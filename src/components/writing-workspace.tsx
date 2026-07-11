"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { CharacterProfile, SceneDefinition, WritingStyle, SceneOutline, ChapterTimeline, CharacterChapterState } from "@/types";
import type { ReviewReport } from "@/core/codex/types";
import { Loader2, Play, Sparkles, RefreshCw, Shield, ScrollText, Check, AlertCircle, Copy, Edit3, Bot, Save } from "lucide-react";
import ReactMarkdown from "react-markdown";

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
  onNovelSaved?: (fullText: string) => void;
  timeline?: ChapterTimeline | null;
  lastChapterStates?: CharacterChapterState[];
  storyInfo?: import("@/types").StoryInfo | null;
  branches?: import("@/types").Branch[];
  onBranchesChange?: (branches: import("@/types").Branch[]) => void;
  presetContinueOffset?: number;
  presetContinueLabel?: string;
  onReaderContinueUsed?: () => void;
  onTaskCreated?: () => void;
}

interface WritingTask {
  id: string;
  novelId: string;
  label: string;
  script: string;
  continueFromOffset: number;
  continueFromLabel: string;
  scene: SceneDefinition;
  output?: string;
  outline?: SceneOutline | null;
  outlinePrompt?: { system: string; user: string } | null;
  review?: ReviewReport | null;
  writerPrompt?: { systemPrompt: string; userPrompt: string } | null;
  status: "draft" | "writing" | "completed";
  savedToNovel?: boolean;
  branchId?: string;
  allowAdult?: boolean;
  cleanMode?: boolean;
  createdAt: string;
}

interface AgentState {
  agentId: string;
  name: string;
  status: "running" | "done";
  messages?: import("@/types").LLMMessage[];
}

const TASKS_KEY = "writing_tasks";

// ============================================================
// Main Component
// ============================================================

export default function WritingWorkspace({
  novelId, novelTitle, characters, scene, writingStyle,
  onSceneChange, onBack, onComplete, initialFullNovel,
  onNovelSaved,
  timeline, lastChapterStates, storyInfo,
  branches, onBranchesChange,
  presetContinueOffset, presetContinueLabel,
  onReaderContinueUsed, onTaskCreated,
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
  const [newTaskLabel, setNewTaskLabel] = useState("");

  // --- Continue point (click-to-continue in reader) ---
  const [continuePoint, setContinuePoint] = useState<{
    offset: number;
    label: string;
    contextPreview: string;
  } | null>(null);

  // --- Transient ---
  const [status, setStatus] = useState<"idle" | "generating" | "completed" | "error">("idle");
  const [outputText, setOutputText] = useState("");
  const [scriptText, setScriptText] = useState("");
  const [outline, setOutline] = useState<SceneOutline | null>(null);
  const [outlinePrompt, setOutlinePrompt] = useState<{ system: string; user: string } | null>(null);
  const [writerPrompt, setWriterPrompt] = useState<{ systemPrompt: string; userPrompt: string } | null>(null);
  const [review, setReview] = useState<ReviewReport | null>(null);
  const [annotations, setAnnotations] = useState<import("@/core/codex/types").ProseAnnotation[]>([]);
  const [agents, setAgents] = useState<Map<string, AgentState>>(new Map());
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [markdownMode, setMarkdownMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [showReview, setShowReview] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showOutlinePrompt, setShowOutlinePrompt] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveTarget, setSaveTarget] = useState<"main" | "branch">("main");
  const [saveBranchName, setSaveBranchName] = useState("");
  const [saveBranchId, setSaveBranchId] = useState<string | null>(null);
  const localBranches = branches || [];
  const readerRef = useRef<HTMLDivElement>(null);
  const [showComparison, setShowComparison] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll to continue point when comparison opens
  const continueMarkerRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (status === "completed" && activeTask?.continueFromOffset != null && continueMarkerRef.current) {
      requestAnimationFrame(() => {
        continueMarkerRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
      });
    }
  }, [status, activeTask?.continueFromOffset]);

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
    setSaved(!!activeTask.savedToNovel);
    setSaveError(false);
    setAnnotations([]);
    setStatus(activeTask.output ? "completed" : "idle");
  }, [activeTaskId]);

  // Auto-save script
  useEffect(() => {
    if (!activeTaskId) return;
    updateTask(activeTaskId, { script: scriptText });
  }, [scriptText]);

  // Auto-scroll reader to bottom when novel content or output changes
  useEffect(() => {
    if (readerRef.current) {
      readerRef.current.scrollTop = readerRef.current.scrollHeight;
    }
  }, [initialFullNovel, outputText]);

  // Reset save state when output changes (new content generated)
  useEffect(() => {
    setSaved(false);
    setSaveError(false);
    if (outputText && activeTaskId) {
      updateTask(activeTaskId, { savedToNovel: false });
    }
  }, [outputText]);

  // Auto-set continue point from reader tab preset
  useEffect(() => {
    if (presetContinueOffset != null && initialFullNovel && !activeTaskId && !creatingTask) {
      const contextStart = Math.max(0, presetContinueOffset - 100);
      const contextEnd = Math.min(initialFullNovel.length, presetContinueOffset + 100);
      setContinuePoint({
        offset: presetContinueOffset,
        label: presetContinueLabel || `偏移${presetContinueOffset}字`,
        contextPreview: initialFullNovel.slice(contextStart, contextEnd),
      });
      setCreatingTask(true);
      onReaderContinueUsed?.();
    }
  }, [presetContinueOffset, presetContinueLabel, initialFullNovel, activeTaskId, creatingTask]);

  // --- Build script ---
  const buildScript = useCallback(
    (_chars: CharacterProfile[], ol: SceneOutline | null, _sc: SceneDefinition) => {
      const lines: string[] = [];
      lines.push("# 写作大纲\n");

      if (ol) {
        const title = ol.chapterTitle || ol.sceneTitle;
        const goal = ol.chapterGoal || ol.sceneGoal;
        if (title) lines.push(`### ${title}`);
        if (goal) lines.push(`\n**续写目标**：${goal}`);

        if (ol.estimatedWordCount) lines.push(`**预计字数**：${ol.estimatedWordCount} 字`);
        if (ol.estimatedChapters) lines.push(`**预计章数**：${ol.estimatedChapters} 章`);

        const timeSpan = ol.timeSpan || (ol as any).time_span;
        const seasonAndTime = ol.seasonAndTime || (ol as any).season_and_time;
        const locations = ol.locations || (ol as any).location;
        if (timeSpan || seasonAndTime) {
          lines.push("\n**时间与空间**");
          if (timeSpan) lines.push(`- 时间跨度：${timeSpan}`);
          if (seasonAndTime) lines.push(`- 季节与昼夜：${seasonAndTime}`);
          if (Array.isArray(locations) && locations.length > 0) {
            lines.push(`- 涉及地点：${locations.join("、")}`);
          }
        }

        const focusChars = ol.focusCharacters || (ol as any).focus_characters;
        if (Array.isArray(focusChars) && focusChars.length > 0) {
          lines.push("\n**焦点角色**");
          for (const fc of focusChars) {
            lines.push(`- ${fc.name}：${fc.reason || ""}`);
          }
        }

        const plotPoints = ol.plotPoints || ol.beats;
        if (Array.isArray(plotPoints) && plotPoints.length > 0) {
          lines.push("\n**情节点**");
          for (const p of plotPoints as any[]) {
            const seq = p.sequence || p.beatNumber || 0;
            const desc = p.description || "";
            const involved = p.involvedCharacters || p.activeCharacters || [];
            const mood = p.mood || "";
            lines.push(`${seq}. ${desc}（涉及：${involved.join("、") || "无"}）（氛围：${mood}）`);
          }
        }

        const threads = ol.characterThreads || (ol as any).character_threads;
        if (Array.isArray(threads) && threads.length > 0) {
          lines.push("\n**角色发展**");
          for (const t of threads) {
            lines.push(`- ${t.characterName}：${t.development || ""}`);
          }
        }

        const newFs = ol.newForeshadowing || [];
        const revealFs = ol.foreshadowingToReveal || [];
        if (newFs.length > 0 || revealFs.length > 0) {
          lines.push("\n**伏笔**");
          for (const f of newFs) {
            lines.push(`- 新埋：[${f.type || "?"}] ${f.description}${f.suggestedRevealWindow ? ` (建议回收：${f.suggestedRevealWindow})` : ""}`);
          }
          for (const f of revealFs) {
            lines.push(`- 回收/推进：${f}`);
          }
        }

        if (ol.emotionalArc) lines.push(`\n**情感弧线**：${ol.emotionalArc}`);
        const ending = ol.chapterEnding || ol.sceneEnding;
        if (ending) lines.push(`**章节收尾**：${ending}`);
        if (ol.pacing) lines.push(`**节奏**：${ol.pacing}`);
      }
      return lines.join("\n");
    },
    []
  );

  // --- Reader click handler: compute offset from click position ---
  const handleReaderClick = (e: React.MouseEvent) => {
    if (!initialFullNovel || status === "generating") return;
    const range = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (!range) return;
    const readerEl = readerRef.current;
    if (!readerEl) return;

    let offset = 0;
    const walker = document.createTreeWalker(readerEl, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      if (node === range.startContainer) {
        offset += range.startOffset;
        break;
      }
      offset += node.textContent?.length || 0;
    }

    const contextStart = Math.max(0, offset - 100);
    const contextEnd = Math.min(initialFullNovel.length, offset + 100);
    const contextPreview = initialFullNovel.slice(contextStart, contextEnd);

    // Derive chapter info from timeline
    let chapterNum = 1;
    if (timeline?.chapters) {
      let cumulative = 0;
      for (const ch of timeline.chapters) {
        cumulative += (ch.events?.length || 0) * 200;
        if (cumulative >= offset) break;
        chapterNum++;
      }
    }

    setContinuePoint({
      offset,
      label: `第${chapterNum}章 · 偏移${offset}字`,
      contextPreview,
    });
  };

  // --- Create task from click point ---
  const handleCreateTaskFromPoint = useCallback(() => {
    if (!continuePoint) return;
    const sc: SceneDefinition = {
      ...scene,
      location: scene.location || "",
      characterIds: characters.map(c => c.id),
    };
    const task: WritingTask = {
      id: `task_${Date.now()}`,
      novelId,
      label: newTaskLabel || continuePoint.label + "续写",
      script: `# 写作大纲\n\n## 场景\n承接：${continuePoint.label}\n\n> 请点击"AI 生成大纲"按钮生成场景大纲`,
      continueFromOffset: continuePoint.offset,
      continueFromLabel: continuePoint.label,
      scene: sc,
      status: "draft",
      savedToNovel: false,
      createdAt: new Date().toISOString(),
    };
    const updated = [task, ...tasks];
    persistTasks(updated);
    setActiveTaskId(task.id);
    setScriptText(task.script);
    setOutputText("");
    setWriterPrompt(null);
    setReview(null);
    setAnnotations([]);
    setStatus("idle");
    setCreatingTask(false);
    setContinuePoint(null);
    onTaskCreated?.();
  }, [continuePoint, newTaskLabel, scene, characters, novelId, tasks, persistTasks]);

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
          continueFromOffset: activeTask ? activeTask.continueFromOffset : 0,
          continueFromLabel: activeTask ? activeTask.continueFromLabel : "当前内容",
          allowAdult: activeTask?.allowAdult || false,
          cleanMode: activeTask?.cleanMode || false,
          authorNotes: activeTask?.script || "",
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
    setError(""); setOutputText(""); setReview(null); setAnnotations([]); setAgents(new Map()); setShowReview(false); setShowPrompt(false);

    const controller = new AbortController(); abortRef.current = controller;
    try {
      const res = await fetch("/api/simulation/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          novelTitle, novelId,
          characters: characters.filter(c => taskScene.characterIds.includes(c.id)),
          scene: taskScene, writingStyle,
          outline: activeTask?.outline || undefined,
          timelineEvents: (timeline?.chapters || []).flatMap(ch => (ch.events || [])),
          lastChapterStates,
          continueFromOffset: activeTask?.continueFromOffset ?? 0,
          continueFromLabel: activeTask?.continueFromLabel ?? "",
          allowAdult: activeTask?.allowAdult || false,
          cleanMode: activeTask?.cleanMode || false,
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
                case "prose": setOutputText(event.prose); break;
                case "review": setReview(event.review); setShowReview(true); updateTask(activeTaskId!, { review: event.review }); break;
                case "review_round":
                  setReview({
                    findings: event.findings,
                    needsHumanReview: (event.findings || []).filter((f: any) => f.severity === "critical"),
                  } as any);
                  setShowReview(true);
                  break;
                case "rewriting": setStatus("generating"); break;
                case "final_prose":
                  setOutputText(event.prose);
                  setAnnotations(event.annotations || []);
                  setStatus("completed");
                  updateTask(activeTaskId!, { output: event.prose, status: "completed", savedToNovel: false });
                  break;
                case "scene_end": setStatus("completed"); onComplete?.(event.fullNovel); break;
                case "agent":
                  setAgents(prev => {
                    const next = new Map(prev);
                    next.set(event.agentId, {
                      agentId: event.agentId,
                      name: event.name,
                      status: event.status,
                      messages: event.messages || prev.get(event.agentId)?.messages,
                    });
                    return next;
                  });
                  break;
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

  const handleSaveFromDialog = async () => {
    if (!outputText || !novelId) return;
    setSaving(true);
    setSaveError(false);
    try {
      const body: any = { novelId, content: outputText };
      if (saveTarget === "branch") {
        if (saveBranchId) {
          body.branchId = saveBranchId;
        } else if (saveBranchName) {
          body.branchName = saveBranchName;
          body.parentOffset = activeTask?.continueFromOffset || 0;
        }
      }
      const res = await fetch("/api/writer/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        setSaved(true);
        setSaveError(false);
        setShowSaveDialog(false);
        if (data.fullText && onNovelSaved && saveTarget === "main") {
          onNovelSaved(data.fullText);
        }
        if (data.branch && onBranchesChange) {
          onBranchesChange([data.branch, ...localBranches.filter(b => b.id !== data.branch?.id)]);
        }
        updateTask(activeTaskId!, { savedToNovel: true, status: "completed", branchId: data.branch?.id || undefined });
      } else {
        setSaveError(true);
      }
    } catch {
      setSaveError(true);
    }
    setSaving(false);
  };
  const handleCancelTask = () => setActiveTaskId(null);

  // Writing is allowed as long as we have a scene location or script content

  // ===== RENDER: No active task, not creating =====
  if (!activeTaskId && !creatingTask) {
    return (
      <div className="h-full flex items-center justify-center" style={{ height: "calc(100vh - 130px)" }}>
        <div className="text-center max-w-md">
          <Bot className="w-12 h-12 mx-auto mb-4 text-neutral-700 opacity-50" />
          <p className="text-base text-neutral-400 font-mono mb-2">写作工作区</p>
          <p className="text-sm text-neutral-600 mb-8">选择承接章节，AI 将自动生成写作大纲</p>

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
                    <div className="text-xs text-neutral-600 mt-0.5">承接：{t.continueFromLabel}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <button onClick={() => {
            const endOffset = initialFullNovel?.length || 0;
            const contextStart = Math.max(0, endOffset - 100);
            const contextPreview = (initialFullNovel || "").slice(contextStart, endOffset);
            let chapterNum = timeline?.chapters?.length || 1;
            setContinuePoint({
              offset: endOffset,
              label: `第${chapterNum}章 · 末尾`,
              contextPreview,
            });
            setCreatingTask(true);
          }}
            className="px-6 py-3 bg-orange-600 hover:bg-orange-500 text-white text-sm font-mono rounded-lg transition-colors inline-flex items-center gap-2">
            <Bot className="w-4 h-4" /> 新建写作任务
          </button>
        </div>
      </div>
    );
  }

  // ===== RENDER: Creating task dialog (from click-to-continue) =====
  if (creatingTask && continuePoint) {
    return (
      <div className="h-full flex items-center justify-center" style={{ height: "calc(100vh - 130px)" }}>
        <div className="max-w-md w-full bg-[#0c0c0c] border border-neutral-800/60 rounded-lg p-6">
          <h3 className="text-sm font-semibold text-neutral-300 font-mono mb-5">新建写作任务</h3>
          <div className="space-y-4">
            <div>
              <div className="text-xs text-neutral-500 font-mono mb-0.5">续写点</div>
              <div className="text-sm text-neutral-300 font-mono">{continuePoint.label}</div>
            </div>
            <div>
              <div className="text-xs text-neutral-500 font-mono mb-1">上下文</div>
              <div className="bg-neutral-800/30 rounded p-3 text-xs text-neutral-500 font-mono max-h-24 overflow-y-auto whitespace-pre-wrap">
                ...{continuePoint.contextPreview.slice(0, 100)}...
                <span className="text-orange-500 font-bold mx-0.5">|</span>
                {continuePoint.contextPreview.slice(100)}...
              </div>
            </div>
            <div>
              <label className="block text-xs text-neutral-500 font-mono mb-1">任务名称 <span className="text-neutral-700">（可选）</span></label>
              <input type="text" value={newTaskLabel} onChange={e => setNewTaskLabel(e.target.value)}
                placeholder={continuePoint.label + "续写"}
                className="w-full px-3 py-2 bg-[#111110] border border-neutral-800 rounded text-sm text-neutral-300 font-mono outline-none focus:border-orange-600/50" />
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setCreatingTask(false)}
                className="flex-1 py-2.5 text-sm text-neutral-500 hover:text-neutral-300 font-mono border border-neutral-700 rounded-lg transition-colors">取消</button>
              <button onClick={handleCreateTaskFromPoint}
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

      {/* RIGHT */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        <div className="bg-[#0c0c0c] border border-neutral-800/60 rounded-lg flex flex-col flex-1 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-800/40 bg-[#0e0e0e] shrink-0">
            <div className="flex items-center gap-3">
              <h3 className="text-[10px] font-semibold text-neutral-400 font-mono uppercase tracking-widest">小说正文</h3>
              {status === "completed" && !saved && <span className="text-[9px] text-orange-500/70 font-mono">有未保存内容</span>}
              {status === "completed" && saved && <span className="text-[9px] text-green-500/70 font-mono">已保存</span>}
              {status === "generating" && outputText && <span className="text-[9px] text-orange-500/70 font-mono flex items-center gap-1"><Loader2 className="w-2.5 h-2.5 animate-spin" />修正中...</span>}
              {status === "generating" && !outputText && <span className="text-[9px] text-orange-500/70 font-mono flex items-center gap-1"><Loader2 className="w-2.5 h-2.5 animate-spin" />写作中...</span>}
            </div>
            <div className="flex items-center gap-3">
              {status === "completed" && !saved && (
                <button onClick={() => setShowSaveDialog(true)} disabled={saving}
                  className={`flex items-center gap-1 text-[10px] font-mono transition-colors ${saveError ? "text-red-400 hover:text-red-300" : "text-neutral-500 hover:text-green-400"}`}>
                  {saveError ? (
                    <><AlertCircle className="w-3 h-3 text-red-400" /> 保存失败，点击重试</>
                  ) : (
                    <><Save className="w-3 h-3" /> 保存...</>
                  )}
                </button>
              )}
              {status === "completed" && saved && (
                <span className="flex items-center gap-1 text-[10px] text-green-500 font-mono">
                  <Check className="w-3 h-3" /> 已保存
                </span>
              )}
              {outlinePrompt && <button onClick={() => setShowOutlinePrompt(!showOutlinePrompt)} className={`flex items-center gap-1 text-[10px] font-mono transition-colors ${showOutlinePrompt ? "text-neutral-300" : "text-neutral-500 hover:text-neutral-300"}`}>
                <ScrollText className="w-3 h-3" />大纲Prompt</button>}
              {review && <button onClick={() => setShowReview(!showReview)} className={`flex items-center gap-1 text-[10px] font-mono transition-colors ${showReview ? "text-green-400" : "text-neutral-500 hover:text-green-400"}`}>
                <Shield className="w-3 h-3" />审查详情 ({review.findings.length})</button>}
              {writerPrompt && <button onClick={() => setShowPrompt(!showPrompt)} className={`flex items-center gap-1 text-[10px] font-mono transition-colors ${showPrompt ? "text-neutral-300" : "text-neutral-500 hover:text-neutral-300"}`}>
                <ScrollText className="w-3 h-3" />Writer Prompt</button>}
              <button onClick={handleCopy} className="flex items-center gap-1 text-[10px] text-neutral-500 hover:text-neutral-300 font-mono">{copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}</button>
            </div>
          </div>

          {/* Reader body */}
          <div ref={readerRef} onClick={handleReaderClick} className="flex-1 overflow-y-auto custom-scrollbar">
            <div className="p-6">
              {!initialFullNovel && !outputText && status !== "generating" ? (
                <div className="flex items-center justify-center py-20">
                  <div className="text-center">
                    <Bot className="w-12 h-12 mx-auto mb-4 text-neutral-700 opacity-50" />
                    <p className="text-base text-neutral-500 font-mono">大纲已就绪</p>
                    <p className="text-sm text-neutral-700 mt-2">编辑左侧大纲后点击"开始写作"</p>
                    <p className="text-xs text-neutral-700 mt-1">也可以点击"AI 生成大纲"让大纲 Agent 自动生成大纲</p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Full novel text (read-only, scrollable) */}
                  {initialFullNovel && (
                    <div className="text-base text-neutral-200 leading-relaxed whitespace-pre-wrap font-serif max-w-[800px] mx-auto">
                      {continuePoint && !outputText && status !== "generating" ? (
                        <>
                          {initialFullNovel.slice(0, continuePoint.offset)}
                          <span className="inline-flex items-center gap-1 mx-1 align-middle">
                            <span className="inline-block w-2 h-4 bg-orange-500 animate-pulse rounded-sm" />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setCreatingTask(true);
                              }}
                              className="text-[10px] bg-orange-600 hover:bg-orange-500 text-white px-1.5 py-0.5 rounded font-mono transition-colors"
                            >
                              续写
                            </button>
                          </span>
                          {initialFullNovel.slice(continuePoint.offset)}
                        </>
                      ) : (
                        initialFullNovel
                      )}
                    </div>
                  )}

                  {/* Continue point label + cancel */}
                  {continuePoint && !outputText && status !== "generating" && (
                    <div className="max-w-[800px] mx-auto mt-2 flex items-center gap-2 text-[10px] text-orange-500 font-mono">
                      <span>{continuePoint.label}</span>
                      <button onClick={() => setContinuePoint(null)} className="text-neutral-600 hover:text-neutral-400">取消</button>
                    </div>
                  )}

                  {/* Unsaved generated prose */}
                  {outputText && !saved && (
                    <>
                      <div className="max-w-[800px] mx-auto my-6 flex items-center gap-3">
                        <div className="flex-1 h-px bg-orange-500/30" />
                        <span className="text-xs text-orange-500 font-mono bg-orange-500/10 px-2 py-0.5 rounded shrink-0">待保存</span>
                        <div className="flex-1 h-px bg-orange-500/30" />
                      </div>
                      <div className="text-base text-neutral-200 leading-relaxed whitespace-pre-wrap font-serif max-w-[800px] mx-auto bg-orange-500/[0.03] rounded-lg p-4 border border-orange-500/10">
                        {outputText}
                      </div>
                    </>
                  )}

                  {/* Annotation cards — show before/after for each review finding */}
                  {annotations.length > 0 && !saved && (
                    <div className="max-w-[800px] mx-auto mt-8 space-y-3">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="flex-1 h-px bg-neutral-700/50" />
                        <span className="text-xs text-neutral-500 font-mono shrink-0">审查修正 ({annotations.length} 处)</span>
                        <div className="flex-1 h-px bg-neutral-700/50" />
                      </div>
                      {annotations.map((a) => (
                        <div key={a.id} className={`p-3 rounded border text-xs ${
                          a.finding.severity === "critical" ? "border-red-500/30 bg-red-500/5" :
                          a.finding.severity === "major" ? "border-yellow-500/30 bg-yellow-500/5" :
                          "border-neutral-700 bg-neutral-800/20"
                        }`}>
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono uppercase ${
                              a.finding.severity === "critical" ? "bg-red-500/20 text-red-300" :
                              a.finding.severity === "major" ? "bg-yellow-500/20 text-yellow-300" :
                              "bg-neutral-600/30 text-neutral-400"
                            }`}>{a.finding.severity}</span>
                            <span className="text-neutral-500">{a.finding.dimension}</span>
                          </div>
                          <p className="text-neutral-300 leading-relaxed mb-2">{a.finding.description}</p>
                          {a.originalSnippet && (
                            <div className="space-y-1.5">
                              <div className="flex items-start gap-2">
                                <span className="text-[9px] text-red-400 font-mono shrink-0 mt-0.5">问题</span>
                                <span className="text-neutral-500 italic text-xs leading-relaxed">{a.originalSnippet}</span>
                              </div>
                              {a.fixedSnippet && (
                                <div className="flex items-start gap-2">
                                  <span className="text-[9px] text-green-400 font-mono shrink-0 mt-0.5">修正</span>
                                  <span className="text-neutral-300 text-xs leading-relaxed">{a.fixedSnippet}</span>
                                </div>
                              )}
                            </div>
                          )}
                          {a.finding.suggestion && (
                            <p className="text-neutral-600 mt-2 text-xs leading-relaxed border-t border-neutral-700/50 pt-2">{a.finding.suggestion}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Loading spinner for generation in progress */}
                  {status === "generating" && !outputText && (
                    <div className="flex items-center justify-center py-20">
                      <div className="flex flex-col items-center gap-3">
                        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
                        <p className="text-sm text-neutral-500 font-mono">Writer 创作中...</p>
                      </div>
                    </div>
                  )}

                  {/* Comparison button — shown when prose is done and has a continue offset */}
                  {status === "completed" && activeTask?.continueFromOffset != null && (
                    <button onClick={() => setShowComparison(true)}
                      className="flex items-center gap-1 text-[10px] text-neutral-500 hover:text-green-400 font-mono mt-4">
                      <Shield className="w-3 h-3" /> 对比原文
                    </button>
                  )}
                </>
              )}
            </div>
            {showReview && review && <ReviewSection review={review} />}
            {showPrompt && writerPrompt && <PromptSection label="Writer Prompt" systemPrompt={writerPrompt.systemPrompt} userPrompt={writerPrompt.userPrompt} />}
            {showOutlinePrompt && outlinePrompt && <PromptSection label="大纲 Agent Prompt" systemPrompt={outlinePrompt.system} userPrompt={outlinePrompt.user} />}
          </div>
        </div>
        {error && <ErrorBanner error={error} onRetry={startWriting} />}
        {showSaveDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="w-full max-w-sm bg-[#0e0e0e] border border-neutral-800 rounded-lg p-6 shadow-2xl">
              <h3 className="text-sm font-semibold text-neutral-300 font-mono mb-5">保存到</h3>

              <div className="space-y-3 mb-5">
                <label className="flex items-center gap-3 p-3 rounded border border-neutral-700 hover:border-neutral-600 cursor-pointer">
                  <input type="radio" name="saveTarget" checked={saveTarget === "main"}
                    onChange={() => setSaveTarget("main")} />
                  <span className="text-sm text-neutral-300">正文（原文末尾）</span>
                </label>

                <label className="flex items-center gap-3 p-3 rounded border border-neutral-700 hover:border-neutral-600 cursor-pointer">
                  <input type="radio" name="saveTarget" checked={saveTarget === "branch"}
                    onChange={() => setSaveTarget("branch")} />
                  <span className="text-sm text-neutral-300">分支</span>
                </label>

                {saveTarget === "branch" && (
                  <div className="ml-8 space-y-2">
                    <input type="text" value={saveBranchName}
                      onChange={e => setSaveBranchName(e.target.value)}
                      placeholder="分支名称（可选：选择已有分支则无需输入）"
                      className="w-full px-3 py-2 bg-[#111110] border border-neutral-800 rounded text-sm text-neutral-300 font-mono outline-none focus:border-orange-600/50" />

                    {localBranches.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-[10px] text-neutral-600 font-mono uppercase mb-1 mt-3">已有分支</div>
                        {localBranches.map(b => (
                          <label key={b.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-neutral-800/30 cursor-pointer">
                            <input type="radio" name="existingBranch"
                              checked={saveBranchId === b.id}
                              onChange={() => { setSaveBranchId(b.id); setSaveBranchName(b.name); }} />
                            <span className="text-xs text-neutral-400">{b.name}</span>
                            <span className="text-[10px] text-neutral-600">({(b.text?.length || 0).toLocaleString()}字)</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                <button onClick={() => setShowSaveDialog(false)}
                  className="flex-1 py-2 text-sm text-neutral-500 hover:text-neutral-300 font-mono border border-neutral-700 rounded-lg transition-colors">取消</button>
                <button onClick={handleSaveFromDialog}
                  disabled={saving || (saveTarget === "branch" && !saveBranchName && !saveBranchId)}
                  className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white text-sm font-mono rounded-lg transition-colors">
                  {saving ? "保存中..." : "保存"}
                </button>
              </div>
            </div>
          </div>
        )}
        {agents.size > 0 && (
          <div className="absolute bottom-4 right-4 flex items-center gap-1.5 z-40">
            {Array.from(agents.values()).map(a => (
              <div key={a.agentId}
                onClick={() => setSelectedAgentId(a.agentId)}
                title={a.name + (a.status === "running" ? " (运行中)" : " (完成)")}
                className={`rounded-full cursor-pointer transition-all hover:scale-125 ${
                  a.status === "running"
                    ? "w-4 h-4 bg-orange-500 animate-pulse"
                    : "w-3 h-3 bg-green-500"
                }`}
              />
            ))}
          </div>
        )}
        {selectedAgentId && (() => {
          const agent = agents.get(selectedAgentId);
          if (!agent) return null;
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
              onClick={() => setSelectedAgentId(null)}>
              <div className="w-full max-w-2xl max-h-[80vh] bg-[#0e0e0e] border border-neutral-800 rounded-lg shadow-2xl flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-800/40 shrink-0">
                  <h3 className="text-sm font-semibold text-neutral-300 font-mono">{agent.name}</h3>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${agent.status === "running" ? "bg-orange-500 animate-pulse" : "bg-green-500"}`} />
                    <span className={`text-[10px] font-mono ${agent.status === "running" ? "text-orange-500" : "text-green-500"}`}>
                      {agent.status === "running" ? "运行中" : "完成"}
                    </span>
                    <button
                      onClick={() => setMarkdownMode(!markdownMode)}
                      className={`text-[10px] font-mono px-2 py-0.5 rounded transition-colors ${markdownMode ? "bg-blue-500/20 text-blue-400" : "text-neutral-500 hover:text-neutral-400"}`}
                    >
                      {markdownMode ? "预览" : "原文"}
                    </button>
                    <button onClick={() => setSelectedAgentId(null)} className="text-neutral-500 hover:text-neutral-300 ml-2">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">
                  {agent.messages && agent.messages.length > 0 ? agent.messages.map((msg, i) => (
                    <div key={i} className="space-y-1">
                      <div className="text-[10px] text-neutral-600 font-mono uppercase">
                        {msg.role === "system" ? "System" : msg.role === "user" ? "User" : "Assistant"}
                      </div>
                      {msg.role === "system" ? (
                        <details>
                          <summary className="text-xs text-neutral-500 cursor-pointer hover:text-neutral-400">展开 system prompt ({msg.content.length} 字符)</summary>
                          {markdownMode ? (
                            <div className="mt-2 text-xs text-neutral-400 leading-relaxed bg-[#080808] rounded p-4 border border-neutral-800/30 max-h-[400px] overflow-y-auto prose prose-invert prose-xs max-w-none">
                              <ReactMarkdown>{msg.content}</ReactMarkdown>
                            </div>
                          ) : (
                            <pre className="mt-2 text-xs text-neutral-400 font-mono whitespace-pre-wrap leading-relaxed bg-[#080808] rounded p-4 border border-neutral-800/30 max-h-[400px] overflow-y-auto">{msg.content}</pre>
                          )}
                        </details>
                      ) : markdownMode ? (
                        <div className="text-sm text-neutral-300 leading-relaxed bg-[#080808] rounded-lg p-4 border border-neutral-800/30 max-h-[500px] overflow-y-auto prose prose-invert prose-sm max-w-none">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      ) : (
                        <pre className="text-sm text-neutral-300 font-mono whitespace-pre-wrap leading-relaxed bg-[#080808] rounded-lg p-4 border border-neutral-800/30 max-h-[500px] overflow-y-auto">{msg.content}</pre>
                      )}
                    </div>
                  )) : (
                    <div className="text-center py-12 text-neutral-600 text-sm font-mono">
                      {agent.status === "running" ? "等待完成..." : "无消息数据"}
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-neutral-800/40 shrink-0">
                  <button onClick={() => {
                    const text = agent.messages?.map(m => `[${m.role}]\n${m.content}`).join("\n\n") || "";
                    navigator.clipboard.writeText(text);
                  }}
                    className="px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-200 font-mono border border-neutral-700 rounded transition-colors">
                    复制全部
                  </button>
                  <button onClick={() => setSelectedAgentId(null)}
                    className="px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-200 font-mono border border-neutral-700 rounded transition-colors">
                    关闭
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
        {showComparison && activeTask && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={() => setShowComparison(false)}>
            <div className="w-[90vw] max-w-6xl max-h-[90vh] bg-[#0e0e0e] border border-neutral-800 rounded-lg shadow-2xl flex flex-col overflow-hidden"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-800/40 shrink-0">
                <h3 className="text-sm font-semibold text-neutral-300 font-mono">原文对比</h3>
                <button onClick={() => setShowComparison(false)} className="text-neutral-500 hover:text-neutral-300 text-lg leading-none">&times;</button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <div className="flex" style={{ minHeight: "100%" }}>
                  {/* Left: full original with continue marker */}
                  <div className="w-1/2 border-r border-neutral-700/50">
                    <div className="p-4">
                      <div className="text-[10px] text-neutral-500 font-mono uppercase mb-3">原文</div>
                      <div className="text-sm text-neutral-400 leading-relaxed whitespace-pre-wrap font-serif">
                        {initialFullNovel?.slice(0, activeTask.continueFromOffset)}
                        <span className="inline-block w-full h-0.5 my-3 bg-orange-500/60" />
                        <span className="text-[10px] text-orange-500 font-mono">— 续写点 —</span>
                        {"\n"}
                        {initialFullNovel?.slice(activeTask.continueFromOffset)}
                      </div>
                    </div>
                  </div>
                  {/* Right: branch version */}
                  <div className="w-1/2">
                    <div className="p-4">
                      <div className="text-[10px] text-green-500/70 font-mono uppercase mb-3">续写版本</div>
                      <div className="text-sm text-neutral-200 leading-relaxed whitespace-pre-wrap font-serif">
                        {initialFullNovel?.slice(0, activeTask.continueFromOffset)}
                        <span className="inline-block w-full h-0.5 my-3 bg-green-500/60" />
                        <span className="text-[10px] text-green-500 font-mono">— 续写 —</span>
                        {"\n"}
                        {outputText}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
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
        <span className="text-[10px] text-green-500/80 font-mono">{review.findings.length} 个发现</span>
        <span className="text-[10px] text-orange-500/80 font-mono">{review.needsHumanReview.length} 待确认</span>
      </div>
      <div className="space-y-2 max-w-[800px] mx-auto">
        {review.findings.length === 0 ? <p className="text-sm text-green-500/70 font-mono">全部通过，无问题。</p> : (
          review.findings.filter(f => f.severity !== "minor" || review.findings.length <= 8).map((f, i) => (
            <div key={i} className={`p-3 rounded border text-xs ${f.severity === "critical" ? "border-red-500/30 bg-red-500/5" : f.severity === "major" ? "border-yellow-500/30 bg-yellow-500/5" : "border-neutral-700 bg-neutral-800/20"}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono uppercase ${f.severity === "critical" ? "bg-red-500/20 text-red-300" : f.severity === "major" ? "bg-yellow-500/20 text-yellow-300" : "bg-neutral-600/30 text-neutral-400"}`}>{f.severity}</span>
                <span className="text-neutral-500">{f.dimension}</span>
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
