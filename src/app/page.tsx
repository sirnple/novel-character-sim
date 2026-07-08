"use client";

import { useState, useRef, useEffect } from "react";
import type { CharacterProfile, SceneDefinition, StoryInfo, ChapterTimeline, CharacterChapterState } from "@/types";
import NovelUpload from "@/components/novel-upload";
import CharacterCards from "@/components/character-cards";
import CharacterEditor from "@/components/character-editor";
import RelationshipGraph from "@/components/relationship-graph";
import StoryTimeline from "@/components/story-timeline";
import StoryInfoPanel from "@/components/story-info-panel";
import SimulationRunner from "@/components/simulation-runner";
import WritingWorkspace from "@/components/writing-workspace";
import { novelFingerprint } from "@/lib/utils";
import { useUserInfo } from "@/lib/rate-limit-ui";
import {
  BookOpen, Users, Play, RefreshCw, X, PanelRight, PanelLeft, ChevronDown, ChevronRight,
  BookMarked, ScrollText, Eye, Wrench, FileText, GitBranch, Sparkles, Clock, Settings,
  MessageSquare, Loader2
} from "lucide-react";

// ============================================================
// Types
// ============================================================

interface SavedNovel {
  id: string;
  title: string;
  total_length: number;
  created_at: string;
}

interface WritingTask {
  id: string;
  novelId: string;
  scene: SceneDefinition;
  label: string;
  createdAt: string;
  status: "pending" | "writing" | "completed";
  output?: string;
  review?: any;
  continueFrom?: string;
  script?: string;
}

type WorkspaceView = "overview" | "characters" | "timeline" | "world" | "read" | "write" | "review";

type SidebarSection = "library" | "tasks" | "codex" | "review";

// ============================================================
// Main Page
// ============================================================

export default function Home() {
  const { userId } = useUserInfo();

  // Core state
  const [novelId, setNovelId] = useState("default");
  const [novelTitle, setNovelTitle] = useState("");
  const [novelText, setNovelText] = useState("");
  const [novelPreview, setNovelPreview] = useState("");
  const [characters, setCharacters] = useState<CharacterProfile[]>([]);
  const [storyInfo, setStoryInfo] = useState<StoryInfo | null>(null);
  const [timeline, setTimeline] = useState<ChapterTimeline | null>(null);
  const [lastChapterStates, setLastChapterStates] = useState<CharacterChapterState[]>([]);
  const [savedNovels, setSavedNovels] = useState<SavedNovel[]>([]);
  const [branches, setBranches] = useState<import("@/types").Branch[]>([]);

  // UI state
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("overview");
  const [showRightPanel, setShowRightPanel] = useState(false);
  const [rightPanelView, setRightPanelView] = useState<"codex" | "review">("codex");
  const [expandedSections, setExpandedSections] = useState<Record<SidebarSection, boolean>>({
    library: true,
    tasks: true,
    codex: false,
    review: false,
  });
  const [showUpload, setShowUpload] = useState(false);
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterProfile | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [recommendLoading, setRecommendLoading] = useState(false);

  // Extraction state
  const [extractLoading, setExtractLoading] = useState(false);
  const [extractError, setExtractError] = useState("");

  // Scene / Task state
  const [scene, setScene] = useState<SceneDefinition>({
    location: "",
    timeOfDay: "afternoon",
    weather: "clear",
    atmosphere: "tense",
    initialSituation: "",
    characterIds: [],
    narrativeStyle: {
      pointOfView: "third-person-close",
      tone: "dramatic",
      targetLength: "medium",
      followOriginalStyle: true,
    },
    plot: { conflictType: "", storyBeat: "", emotionalArc: "", keyEvent: "", stakes: "" },
    mode: "director",
  });
  const [writingTasks, setWritingTasks] = useState<WritingTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  // Scene recommendations cache
  const [sceneRecommendations, setSceneRecommendations] = useState<{
    key: string;
    recommendations: Array<{
      location: string; timeOfDay: string; weather: string; atmosphere: string;
      initialSituation: string; whyGood: string; suggestedCharacters: string[];
    }>;
  } | null>(null);

  // Simulation state
  const [simState, setSimState] = useState<{
    novelTitle: string;
    characters: CharacterProfile[];
    scene: SceneDefinition;
    fullNovel: string;
    status: string;
  } | null>(null);
  const [cachedOutline, setCachedOutline] = useState<{
    key: string;
    outline: import("@/types").SceneOutline;
  } | null>(null);
  const outlineCacheKey = `${novelId}|${scene.location}|${scene.initialSituation}|${scene.characterIds.join(",")}|${scene.plot.conflictType}|${scene.plot.keyEvent}`;

  const abortRef = useRef<AbortController | null>(null);

  // ============================================================
  // Data Loading
  // ============================================================

  useEffect(() => {
    fetch("/api/novels").then(r => r.json()).then(d => setSavedNovels(d.novels || [])).catch(() => {});
  }, []);

  const loadNovel = async (id: string) => {
    const res = await fetch(`/api/novels?id=${id}`);
    const data = await res.json();
    if (res.ok) {
      setNovelId(id);
      setNovelTitle(data.title);
      setNovelText(data.text);
      setNovelPreview(data.text.substring(0, 500));
      if (data.storyInfo) setStoryInfo(data.storyInfo);
      if (data.timeline) setTimeline(data.timeline);
      if (data.lastChapterStates) setLastChapterStates(data.lastChapterStates);
      if (data.characters?.length) setCharacters(data.characters);
      fetch(`/api/branches?novelId=${id}`).then(r => r.json()).then(d => {
        if (d.branches) setBranches(d.branches);
      }).catch(() => {});
      setWorkspaceView("overview");
      setShowUpload(false);
    }
  };

  const handleNovelParsed = (title: string, fullText: string, preview: string) => {
    const id = novelFingerprint(fullText);
    setNovelId(id);
    setNovelTitle(title);
    setNovelText(fullText);
    setNovelPreview(preview);
    setCharacters([]);
    setStoryInfo(null);
    setTimeline(null);
    setLastChapterStates([]);
    setExtractError("");
    setShowUpload(false);
    setWorkspaceView("overview");

    fetch(`/api/novels?id=${id}`).then(r => r.json()).then(data => {
      if (data.storyInfo) setStoryInfo(data.storyInfo);
      if (data.timeline) setTimeline(data.timeline);
      if (data.lastChapterStates) setLastChapterStates(data.lastChapterStates);
      if (data.characters?.length) setCharacters(data.characters);
    }).catch(() => {});
  };

  const handleNovelSaved = (fullText: string) => {
    setNovelText(fullText);
  };

  const handleExtractCharacters = async (text: string, forceRefresh = false) => {
    setExtractLoading(true);
    setExtractError("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/characters/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: novelId, text, forceRefresh }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Extraction failed");
      setCharacters(data.characters);
      if (data.storyInfo) setStoryInfo(data.storyInfo);
      if (data.timeline) setTimeline(data.timeline);
      if (data.lastChapterStates) setLastChapterStates(data.lastChapterStates);
      if (!data.fromCache) {
        fetch("/api/novels").then(r => r.json()).then(d => setSavedNovels(d.novels || [])).catch(() => {});
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setExtractError(e instanceof Error ? e.message : "Failed to extract characters");
    } finally {
      setExtractLoading(false);
      abortRef.current = null;
    }
  };

  const handleCancelExtraction = () => {
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; setExtractLoading(false); }
  };

  // ============================================================
  // Writing Task Management — sync from localStorage
  // ============================================================

  // Load tasks from localStorage on mount, synced with novelId
  useEffect(() => {
    try {
      const raw = localStorage.getItem("writing_tasks");
      if (raw) {
        const allTasks = JSON.parse(raw) as WritingTask[];
        const novelTasks = allTasks.filter(t => t.novelId === novelId);
        setWritingTasks(novelTasks);
      }
    } catch {}
  }, [novelId]);

  // When novel changes, clear active task so user sees the task picker
  useEffect(() => {
    setActiveTaskId(null);
  }, [novelId]);

  const createWritingTask = (sceneDef: SceneDefinition) => {
    const task: WritingTask = {
      id: `task_${Date.now()}`,
      novelId,
      scene: sceneDef,
      label: sceneDef.initialSituation ? sceneDef.initialSituation.slice(0, 30) + "..." : "新写作任务",
      createdAt: new Date().toISOString(),
      status: "pending",
    };
    setWritingTasks(prev => [task, ...prev]);
    setActiveTaskId(task.id);
    setScene(sceneDef);
    setWorkspaceView("write");
    return task;
  };

  const startWritingTask = (taskId: string) => {
    const task = writingTasks.find(t => t.id === taskId);
    if (!task) return;
    setActiveTaskId(taskId);
    setScene(task.scene);
    setWorkspaceView("write");
  };

  const handleSimulationComplete = (fullNovel: string) => {
    setSimState({
      novelTitle,
      characters: characters.filter(c => scene.characterIds.includes(c.id)),
      scene,
      fullNovel,
      status: "completed",
    });
    // Update task
    if (activeTaskId) {
      setWritingTasks(prev => prev.map(t =>
        t.id === activeTaskId ? { ...t, status: "completed" as const, output: fullNovel } : t
      ));
    }
  };

  // ============================================================
  // Helpers
  // ============================================================

  const hasNovel = !!novelText;
  const hasCharacters = characters.length > 0;
  const activeTask = writingTasks.find(t => t.id === activeTaskId);

  const toggleSection = (section: SidebarSection) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // ============================================================
  // Render
  // ============================================================

  const hasContent = hasNovel && novelTitle;

  return (
    <div className="h-screen flex flex-col bg-[#0a0a0a] text-neutral-200 font-sans overflow-hidden">
      {/* ============================================================
          Top Bar
          ============================================================ */}
      <header className="flex items-center justify-between px-5 py-2.5 border-b border-neutral-800/60 bg-[#0c0c0c] shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1 rounded text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 transition-colors"
            title={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
          >
            <PanelLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <BookMarked className="w-4 h-4 text-orange-500" />
            <h1 className="text-sm font-bold tracking-wider text-neutral-300 font-mono">
              NOVEL WORKSPACE
            </h1>
          </div>
          {hasContent && (
            <>
              <span className="w-px h-4 bg-neutral-800" />
              <span className="text-sm text-neutral-400">{novelTitle}</span>
              <span className="text-xs text-neutral-600">{novelText.length.toLocaleString()} 字</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {hasContent && (
            <div className="flex rounded border border-neutral-700 overflow-hidden">
              {[
                { key: "overview" as WorkspaceView, label: "概览", icon: BookOpen },
                { key: "characters" as WorkspaceView, label: "角色", icon: Users },
                { key: "timeline" as WorkspaceView, label: "时间线", icon: Clock },
                { key: "world" as WorkspaceView, label: "世界观", icon: ScrollText },
                { key: "read" as WorkspaceView, label: "阅读", icon: BookOpen },
                { key: "write" as WorkspaceView, label: "写作", icon: Play },
              ].map(v => (
                <button
                  key={v.key}
                  onClick={() => setWorkspaceView(v.key)}
                  className={`flex items-center gap-1 px-3 py-1 text-xs transition-colors ${
                    workspaceView === v.key
                      ? "bg-neutral-700 text-neutral-200"
                      : "bg-transparent text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800"
                  }`}
                >
                  <v.icon className="w-3 h-3" /> {v.label}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => { setShowRightPanel(!showRightPanel); if (!showRightPanel) setRightPanelView("codex"); }}
            className={`p-1 rounded transition-colors ${showRightPanel ? 'text-orange-400 bg-orange-500/10' : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800'}`}
            title="切换右侧面板"
          >
            <PanelRight className="w-4 h-4" />
          </button>
          <a href="/admin" className="flex items-center gap-1 text-xs text-neutral-600 hover:text-neutral-400 transition-colors font-mono">
            <Settings className="w-3 h-3" /> ADMIN
          </a>
        </div>
      </header>

      {/* ============================================================
          Body
          ============================================================ */}
      <div className="flex flex-1 overflow-hidden">
        {/* ============================================================
            Left Sidebar
            ============================================================ */}
        {!sidebarCollapsed && (
          <aside className="w-[260px] shrink-0 border-r border-neutral-800/60 bg-[#0c0c0c] flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto custom-scrollbar">

              {/* Section: Library */}
              <SidebarSectionHeader
                section="library"
                icon={<BookMarked className="w-3 h-3" />}
                label="作品库"
                expanded={expandedSections.library}
                onToggle={() => toggleSection("library")}
              />
              {expandedSections.library && (
                <div className="px-3 pb-2 space-y-1">
                  <button
                    onClick={() => setShowUpload(true)}
                    className="w-full text-left px-3 py-2 rounded text-xs text-orange-400 hover:bg-orange-500/5 border border-dashed border-neutral-700 hover:border-orange-500/30 transition-colors font-mono"
                  >
                    + 导入新小说
                  </button>
                  {savedNovels.map(n => (
                    <button
                      key={n.id}
                      onClick={() => loadNovel(n.id)}
                      className={`w-full text-left px-3 py-2 rounded text-xs transition-colors ${
                        n.id === novelId
                          ? "bg-orange-500/5 border-l-2 border-orange-500 text-neutral-200"
                          : "text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-300"
                      }`}
                    >
                      <div className="font-medium truncate">{n.title}</div>
                      <div className="text-[10px] text-neutral-600 mt-0.5">{n.total_length.toLocaleString()} 字</div>
                    </button>
                  ))}
                </div>
              )}

              {/* Section: Writing Tasks */}
              <SidebarSectionHeader
                section="tasks"
                icon={<Play className="w-3 h-3" />}
                label="写作任务"
                expanded={expandedSections.tasks}
                onToggle={() => toggleSection("tasks")}
              />
              {expandedSections.tasks && (
                <div className="px-3 pb-2 space-y-1">
                  {writingTasks.length === 0 && (
                    <p className="text-xs text-neutral-600 px-3 py-2">
                      暂无任务。在写作视图中创建场景推荐后开始。
                    </p>
                  )}
                  {writingTasks.map(task => (
                    <button
                      key={task.id}
                      onClick={() => startWritingTask(task.id)}
                      className={`w-full text-left px-3 py-2 rounded text-xs transition-colors ${
                        task.id === activeTaskId
                          ? "bg-orange-500/5 border-l-2 border-orange-500 text-neutral-200"
                          : "text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-300"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          task.status === "completed" ? "bg-green-500" : task.status === "writing" ? "bg-orange-500" : "bg-neutral-600"
                        }`} />
                        <span className="truncate">{task.label}</span>
                      </div>
                      <div className="text-[10px] text-neutral-600 mt-0.5">
                        {task.status === "completed" ? "已完成" : task.status === "writing" ? "写作中" : "待开始"}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Section: Codex */}
              <SidebarSectionHeader
                section="codex"
                icon={<BookMarked className="w-3 h-3" />}
                label="创作法典"
                expanded={expandedSections.codex}
                onToggle={() => toggleSection("codex")}
              />
              {expandedSections.codex && (
                <div className="px-3 pb-2 space-y-1">
                  {["角色卷宗", "世界观百科", "前文摘要", "伏笔账本", "灵感库"].map(item => (
                    <button
                      key={item}
                      onClick={() => { setShowRightPanel(true); setRightPanelView("codex"); }}
                      className="w-full text-left px-3 py-1.5 rounded text-xs text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-300 transition-colors"
                    >
                      {item}
                    </button>
                  ))}
                </div>
              )}

              {/* Section: Review */}
              <SidebarSectionHeader
                section="review"
                icon={<Eye className="w-3 h-3" />}
                label="审查"
                expanded={expandedSections.review}
                onToggle={() => toggleSection("review")}
              />
              {expandedSections.review && (
                <div className="px-3 pb-2">
                  {activeTask?.review ? (
                    <div className="space-y-1">
                      <p className="text-xs text-neutral-500 px-3 py-1">上次审查报告</p>
                      <button
                        onClick={() => { setShowRightPanel(true); setRightPanelView("review"); }}
                        className="w-full text-left px-3 py-2 rounded text-xs bg-orange-500/5 border border-orange-500/20 text-orange-400 hover:bg-orange-500/10 transition-colors"
                      >
                        查看详情 →
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs text-neutral-600 px-3 py-2">暂无审查记录</p>
                  )}
                </div>
              )}
            </div>
          </aside>
        )}

        {/* ============================================================
            Main Content Area
            ============================================================ */}
        <main className="flex-1 overflow-hidden flex flex-col bg-[#0a0a0a]">
          {/* Upload modal */}
          {showUpload && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
              <div className="w-full max-w-lg bg-[#0e0e0e] border border-neutral-800 rounded-lg p-6 shadow-2xl">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-neutral-300 font-mono">导入小说</h2>
                  <button onClick={() => setShowUpload(false)} className="text-neutral-500 hover:text-neutral-300">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <NovelUpload onParsed={(title, text, preview) => {
                  handleNovelParsed(title, text, preview);
                }} />
              </div>
            </div>
          )}

          {/* If no novel loaded, show welcome */}
          {!hasContent ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center max-w-md">
                <BookMarked className="w-12 h-12 mx-auto mb-4 text-neutral-700" />
                <h2 className="text-lg font-semibold text-neutral-400 mb-2 font-mono">欢迎使用小说写作工作台</h2>
                <p className="text-sm text-neutral-600 mb-6">
                  导入小说，提取角色和世界观，构建创作法典，开始续写。
                </p>
                <button
                  onClick={() => setShowUpload(true)}
                  className="px-5 py-2.5 bg-orange-600 hover:bg-orange-500 text-white text-sm font-mono rounded-lg transition-colors"
                >
                  导入小说
                </button>
                {savedNovels.length > 0 && (
                  <div className="mt-8">
                    <h3 className="text-xs text-neutral-500 font-mono uppercase tracking-wider mb-3">最近作品</h3>
                    <div className="space-y-2">
                      {savedNovels.slice(0, 5).map(n => (
                        <button
                          key={n.id}
                          onClick={() => loadNovel(n.id)}
                          className="w-full text-left px-4 py-2.5 rounded-lg bg-[#0c0c0c] border border-neutral-800 hover:border-neutral-700 text-neutral-400 hover:text-neutral-200 transition-colors text-sm"
                        >
                          <span className="font-medium">{n.title}</span>
                          <span className="text-neutral-600 ml-2 text-xs">{n.total_length.toLocaleString()} 字</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
              {/* ============================================================
                  OVERVIEW
                  ============================================================ */}
              {workspaceView === "overview" && (
                <div className="max-w-4xl mx-auto space-y-6">
                  {/* Novel Summary Card */}
                  <div className="bg-[#0c0c0c] border border-neutral-800/60 rounded-lg p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h2 className="text-lg font-semibold text-neutral-200 font-mono">{novelTitle}</h2>
                        <p className="text-xs text-neutral-500 mt-1">{novelText.length.toLocaleString()} 字</p>
                      </div>
                      <button
                        onClick={() => { if (!extractLoading) handleExtractCharacters(novelText, false); }}
                        disabled={extractLoading}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono transition-colors ${
                          extractLoading
                            ? "bg-neutral-800 text-neutral-600 cursor-not-allowed"
                            : "bg-orange-600 hover:bg-orange-500 text-white"
                        }`}
                      >
                        {extractLoading ? (
                          <RefreshCw className="w-3 h-3 animate-spin" />
                        ) : (
                          <Sparkles className="w-3 h-3" />
                        )}
                        {extractLoading ? "提取中..." : hasCharacters ? "重新提取" : "提取角色与世界观"}
                      </button>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-4 gap-4">
                      <StatCard label="角色" value={characters.length.toString()} icon={<Users className="w-4 h-4" />} />
                      <StatCard label="章节" value={timeline ? timeline.totalChapters.toString() : "-"} icon={<GitBranch className="w-4 h-4" />} />
                      <StatCard label="事件" value={timeline ? timeline.chapters.reduce((s, c) => s + c.events.length, 0).toString() : "-"} icon={<Clock className="w-4 h-4" />} />
                      <StatCard label="任务" value={writingTasks.length.toString()} icon={<FileText className="w-4 h-4" />} />
                    </div>

                    {extractError && (
                      <p className="text-xs text-red-400 mt-3">{extractError}</p>
                    )}
                  </div>

                  {/* Quick Actions */}
                  <div className="grid grid-cols-2 gap-4">
                    <ActionCard
                      icon={<Sparkles className="w-5 h-5" />}
                      title="新建写作场景"
                      description="基于角色和世界观，AI 推荐场景设定，开始续写"
                      onClick={() => setWorkspaceView("write")}
                    />
                    <ActionCard
                      icon={<Users className="w-5 h-5" />}
                      title="探索角色"
                      description="查看角色档案、语录和关系图谱"
                      onClick={() => setWorkspaceView("characters")}
                    />
                    <ActionCard
                      icon={<Clock className="w-5 h-5" />}
                      title="故事时间线"
                      description="浏览章节事件和角色状态演变"
                      onClick={() => setWorkspaceView("timeline")}
                    />
                    <ActionCard
                      icon={<ScrollText className="w-5 h-5" />}
                      title="世界观百科"
                      description="查看力量体系、社会结构和势力分布"
                      onClick={() => setWorkspaceView("world")}
                    />
                  </div>

                  {/* Recent Tasks */}
                  {writingTasks.length > 0 && (
                    <div className="bg-[#0c0c0c] border border-neutral-800/60 rounded-lg p-5">
                      <h3 className="text-xs font-semibold text-neutral-400 font-mono uppercase tracking-wider mb-3">
                        最近写作任务
                      </h3>
                      <div className="space-y-2">
                        {writingTasks.slice(0, 5).map(task => (
                          <button
                            key={task.id}
                            onClick={() => startWritingTask(task.id)}
                            className="w-full flex items-center justify-between px-3 py-2 rounded bg-neutral-800/30 hover:bg-neutral-800/50 transition-colors text-left"
                          >
                            <div className="flex items-center gap-2">
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${task.status === "completed" ? "bg-green-500" : task.status === "writing" ? "bg-orange-500" : "bg-neutral-600"}`} />
                              <span className="text-sm text-neutral-300 truncate max-w-[400px]">{task.label}</span>
                            </div>
                            <span className="text-[10px] text-neutral-600 font-mono">
                              {task.status === "completed" ? "已完成" : task.status === "writing" ? "写作中" : "待开始"}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ============================================================
                  CHARACTERS
                  ============================================================ */}
              {workspaceView === "characters" && (
                <div className="max-w-4xl mx-auto space-y-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-neutral-300 font-mono uppercase tracking-wider">角色档案</h2>
                    {!hasCharacters && !extractLoading && (
                      <button
                        onClick={() => handleExtractCharacters(novelText, false)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono bg-orange-600 hover:bg-orange-500 text-white transition-colors"
                      >
                        <Sparkles className="w-3 h-3" /> 提取角色
                      </button>
                    )}
                  </div>
                  <CharacterCards
                    characters={characters}
                    loading={extractLoading}
                    error={extractError}
                    onExtract={(t) => handleExtractCharacters(t, false)}
                    onCancelExtraction={handleCancelExtraction}
                    onUpdate={setCharacters}
                    novelText={novelText}
                    timeline={timeline}
                    lastChapterStates={lastChapterStates}
                  />
                  {characters.length > 1 && <RelationshipGraph characters={characters} />}
                  {selectedCharacter && (
                    <CharacterEditor
                      profile={selectedCharacter}
                      allCharacters={characters}
                      onSave={(updated) => {
                        setCharacters(prev => prev.map(c => c.id === updated.id ? updated : c));
                        setSelectedCharacter(null);
                      }}
                      onCancel={() => setSelectedCharacter(null)}
                    />
                  )}
                </div>
              )}

              {/* ============================================================
                  TIMELINE
                  ============================================================ */}
              {workspaceView === "timeline" && (
                <div className="max-w-4xl mx-auto space-y-6">
                  <h2 className="text-sm font-semibold text-neutral-300 font-mono uppercase tracking-wider">故事时间线</h2>
                  {timeline && timeline.chapters.length > 0 ? (
                    <StoryTimeline timeline={timeline} lastChapterStates={lastChapterStates} />
                  ) : (
                    <div className="text-center py-12 text-neutral-600">
                      <Clock className="w-10 h-10 mx-auto mb-3 opacity-30" />
                      <p className="text-sm font-mono">暂无时间线数据。请先提取角色和世界观。</p>
                    </div>
                  )}
                </div>
              )}

              {/* ============================================================
                  WORLD BUILDING
                  ============================================================ */}
              {workspaceView === "world" && (
                <div className="max-w-4xl mx-auto space-y-6">
                  <h2 className="text-sm font-semibold text-neutral-300 font-mono uppercase tracking-wider">世界观百科</h2>
                  {storyInfo ? (
                    <StoryInfoPanel storyInfo={storyInfo} />
                  ) : (
                    <div className="text-center py-12 text-neutral-600">
                      <ScrollText className="w-10 h-10 mx-auto mb-3 opacity-30" />
                      <p className="text-sm font-mono">暂无世界观数据。请先提取角色和世界观。</p>
                    </div>
                  )}
                </div>
              )}

              {/* ============================================================
                  READ
                  ============================================================ */}
              {workspaceView === "read" && (
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                  <div className="max-w-[800px] mx-auto p-6">
                    <h2 className="text-sm font-semibold text-neutral-300 font-mono uppercase tracking-wider mb-4">阅读</h2>
                    <div className="text-base text-neutral-200 leading-relaxed whitespace-pre-wrap font-serif">
                      {novelText}
                    </div>
                  </div>
                </div>
              )}

              {/* ============================================================
                  WRITE
                  ============================================================ */}
              {workspaceView === "write" && (
                <div className="h-full">
                  <WritingWorkspace
                    novelId={novelId}
                    novelTitle={novelTitle}
                    characters={characters}
                    scene={scene}
                    onSceneChange={setScene}
                    writingStyle={storyInfo?.writingStyle}
                    storyInfo={storyInfo}
                    onBack={() => {}}
                    onComplete={handleSimulationComplete}
                    initialFullNovel={novelText}
                    onNovelSaved={handleNovelSaved}
                    timeline={timeline}
                    lastChapterStates={lastChapterStates}
                    branches={branches}
                    onBranchesChange={setBranches}
                  />
                </div>
              )}

              {/* ============================================================
                  REVIEW
                  ============================================================ */}
              {workspaceView === "review" && (
                <div className="max-w-4xl mx-auto space-y-6">
                  <h2 className="text-sm font-semibold text-neutral-300 font-mono uppercase tracking-wider">审查报告</h2>
                  {activeTask?.review ? (
                    <div className="bg-[#0c0c0c] border border-neutral-800/60 rounded-lg p-5">
                      <pre className="text-xs text-neutral-400 font-mono whitespace-pre-wrap">{JSON.stringify(activeTask.review, null, 2)}</pre>
                    </div>
                  ) : (
                    <div className="text-center py-12 text-neutral-600">
                      <Eye className="w-10 h-10 mx-auto mb-3 opacity-30" />
                      <p className="text-sm font-mono">完成写作任务后可在此查看审查报告。</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </main>

        {/* ============================================================
            Right Panel (Codex / Review)
            ============================================================ */}
        {showRightPanel && (
          <aside className="w-[280px] shrink-0 border-l border-neutral-800/60 bg-[#0c0c0c] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-800/40">
              <div className="flex rounded border border-neutral-700 overflow-hidden">
                <button
                  onClick={() => setRightPanelView("codex")}
                  className={`px-2.5 py-1 text-[10px] font-mono transition-colors ${rightPanelView === "codex" ? "bg-neutral-700 text-neutral-200" : "bg-transparent text-neutral-500 hover:text-neutral-300"}`}
                >
                  CODEX
                </button>
                <button
                  onClick={() => setRightPanelView("review")}
                  className={`px-2.5 py-1 text-[10px] font-mono transition-colors ${rightPanelView === "review" ? "bg-neutral-700 text-neutral-200" : "bg-transparent text-neutral-500 hover:text-neutral-300"}`}
                >
                  REVIEW
                </button>
              </div>
              <button
                onClick={() => setShowRightPanel(false)}
                className="text-neutral-500 hover:text-neutral-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
              {rightPanelView === "codex" ? (
                <div className="space-y-4">
                  <h3 className="text-[10px] text-neutral-500 font-mono uppercase tracking-widest">创作法典</h3>
                  <CodexPanelSection title="角色卷宗" count={characters.length} />
                  <CodexPanelSection title="世界观百科" count={storyInfo ? 1 : 0} />
                  <CodexPanelSection title="前文摘要" count={timeline?.chapters?.length || 0} />
                  <CodexPanelSection title="伏笔账本" count={0} detail="（手动添加）" />
                  <CodexPanelSection title="灵感库" count={0} detail="（手动添加）" />
                  <CodexPanelSection title="风格包" count={storyInfo?.writingStyle ? 1 : 0} />
                </div>
              ) : (
                <div className="space-y-4">
                  <h3 className="text-[10px] text-neutral-500 font-mono uppercase tracking-widest">审查报告</h3>
                  <p className="text-xs text-neutral-600">完成写作后自动显示审查结果。</p>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

function SidebarSectionHeader({
  section, icon, label, expanded, onToggle,
}: {
  section: string; icon: React.ReactNode; label: string; expanded: boolean; onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between px-4 py-2 text-[10px] text-neutral-500 font-mono uppercase tracking-widest hover:bg-neutral-800/30 transition-colors"
    >
      <span className="flex items-center gap-1.5">{icon} {label}</span>
      {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
    </button>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="bg-neutral-800/20 rounded-lg p-3 text-center">
      <div className="text-neutral-500 mb-1 flex justify-center">{icon}</div>
      <div className="text-lg font-bold text-neutral-200 font-mono">{value}</div>
      <div className="text-[10px] text-neutral-600 font-mono uppercase mt-0.5">{label}</div>
    </div>
  );
}

function ActionCard({ icon, title, description, onClick }: {
  icon: React.ReactNode; title: string; description: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="bg-[#0c0c0c] border border-neutral-800/60 rounded-lg p-5 text-left hover:border-orange-500/30 hover:bg-orange-500/[0.02] transition-colors group"
    >
      <div className="text-orange-500/60 mb-3 group-hover:text-orange-500 transition-colors">{icon}</div>
      <h3 className="text-sm font-semibold text-neutral-300 font-mono mb-1">{title}</h3>
      <p className="text-xs text-neutral-600">{description}</p>
    </button>
  );
}

function CodexPanelSection({ title, count, detail }: { title: string; count: number; detail?: string }) {
  return (
    <div className="border border-neutral-800/40 rounded p-3">
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-xs font-medium text-neutral-400">{title}</h4>
        <span className="text-[10px] text-neutral-600 font-mono">{count}</span>
      </div>
      <p className="text-[10px] text-neutral-600">{detail || (count > 0 ? "已就绪" : "暂无数据")}</p>
    </div>
  );
}
