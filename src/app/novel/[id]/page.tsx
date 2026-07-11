"use client";
import { useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useNovel } from "@/lib/novel-context";
import { Users, Play, RefreshCw, Sparkles, Clock, ScrollText, FileText, GitBranch, BookOpen } from "lucide-react";
import CharacterCards from "@/components/character-cards";
import StoryTimeline from "@/components/story-timeline";
import StoryInfoPanel from "@/components/story-info-panel";
import WritingWorkspace from "@/components/writing-workspace";
import type { SceneDefinition } from "@/types";

export default function NovelPage() {
  const params = useSearchParams();
  const tab = params.get("tab") || "overview";
  const { novelTitle, novelText, novelId, characters, storyInfo, timeline, lastChapterStates, setNovelText } = useNovel();
  const [extractLoading, setExtractLoading] = useState(false);
  const [extractError, setExtractError] = useState("");
  const [showWrite, setShowWrite] = useState(false);
  const [scene, setScene] = useState<SceneDefinition>({
    location: "", timeOfDay: "afternoon", weather: "clear", atmosphere: "tense", initialSituation: "", characterIds: [],
    narrativeStyle: { pointOfView: "third-person-close", tone: "dramatic", targetLength: "medium", followOriginalStyle: true },
    plot: { conflictType: "", storyBeat: "", emotionalArc: "", keyEvent: "", stakes: "" }, mode: "director",
  });
  const abortRef = useRef<AbortController | null>(null);

  const handleExtractCharacters = async (text: string) => {
    setExtractLoading(true); setExtractError("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/characters/extract", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: novelId, text, forceRefresh: false }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Extraction failed");
      setNovelText?.(data.text || text);
    } catch (e: any) {
      if (e.name === "AbortError") return;
      setExtractError(e.message);
    } finally { setExtractLoading(false); abortRef.current = null; }
  };

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
      {tab === "overview" && (
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="bg-[#0c0c0c] border border-neutral-800/60 rounded-lg p-6">
            <div className="flex items-start justify-between mb-4">
              <div><h2 className="text-lg font-semibold text-neutral-200 font-mono">{novelTitle}</h2><p className="text-xs text-neutral-500 mt-1">{novelText.length.toLocaleString()} 字</p></div>
              <button onClick={() => handleExtractCharacters(novelText)} disabled={extractLoading}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono transition-colors ${extractLoading ? "bg-neutral-800 text-neutral-600 cursor-not-allowed" : "bg-orange-600 hover:bg-orange-500 text-white"}`}>
                {extractLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {extractLoading ? "提取中..." : "提取角色与世界观"}
              </button>
            </div>
            <div className="grid grid-cols-4 gap-4">
              {[
                { label: "角色", value: characters.length.toString(), icon: <Users className="w-4 h-4" /> },
                { label: "章节", value: timeline ? timeline.totalChapters.toString() : "-", icon: <GitBranch className="w-4 h-4" /> },
                { label: "事件", value: timeline ? timeline.chapters.reduce((s, c) => s + c.events.length, 0).toString() : "-", icon: <Clock className="w-4 h-4" /> },
                { label: "状态", value: "就绪", icon: <FileText className="w-4 h-4" /> },
              ].map(s => (
                <div key={s.label} className="bg-neutral-800/20 rounded-lg p-3 text-center">
                  <div className="text-neutral-500 mb-1 flex justify-center">{s.icon}</div>
                  <div className="text-lg font-bold text-neutral-200 font-mono">{s.value}</div>
                  <div className="text-[10px] text-neutral-600 font-mono uppercase mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>
            {extractError && <p className="text-xs text-red-400 mt-3">{extractError}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              { icon: <Sparkles className="w-5 h-5" />, title: "新建写作场景", desc: "基于角色和世界观，AI 推荐场景设定", onClick: () => setShowWrite(true) },
              { icon: <BookOpen className="w-5 h-5" />, title: "阅读小说", desc: "浏览全文，点击任意位置续写", href: `/novel/${novelId}/read` },
              { icon: <Clock className="w-5 h-5" />, title: "故事时间线", desc: "浏览章节事件和角色状态演变", href: `/novel/${novelId}?tab=timeline` },
              { icon: <ScrollText className="w-5 h-5" />, title: "世界观百科", desc: "查看力量体系、社会结构和势力分布", href: `/novel/${novelId}?tab=world` },
            ].map(a => (
              a.href ? (
                <a key={a.title} href={a.href} className="bg-[#0c0c0c] border border-neutral-800/60 rounded-lg p-5 text-left hover:border-orange-500/30 hover:bg-orange-500/[0.02] transition-colors group no-underline">
                  <div className="text-orange-500/60 mb-3 group-hover:text-orange-500 transition-colors">{a.icon}</div>
                  <h3 className="text-sm font-semibold text-neutral-300 font-mono mb-1">{a.title}</h3>
                  <p className="text-xs text-neutral-600">{a.desc}</p>
                </a>
              ) : (
                <button key={a.title} onClick={a.onClick} className="bg-[#0c0c0c] border border-neutral-800/60 rounded-lg p-5 text-left hover:border-orange-500/30 hover:bg-orange-500/[0.02] transition-colors group">
                  <div className="text-orange-500/60 mb-3 group-hover:text-orange-500 transition-colors">{a.icon}</div>
                  <h3 className="text-sm font-semibold text-neutral-300 font-mono mb-1">{a.title}</h3>
                  <p className="text-xs text-neutral-600">{a.desc}</p>
                </button>
              )
            ))}
          </div>
          {showWrite && (
            <div className="h-full">
              <WritingWorkspace
                novelId={novelId} novelTitle={novelTitle} characters={characters}
                scene={scene} onSceneChange={setScene}
                writingStyle={storyInfo?.writingStyle} storyInfo={storyInfo}
                onBack={() => setShowWrite(false)}
                timeline={timeline} lastChapterStates={lastChapterStates}
                initialFullNovel={novelText}
                onNovelSaved={setNovelText}
              />
            </div>
          )}
        </div>
      )}
      {tab === "characters" && (
        <div className="max-w-4xl mx-auto"><CharacterCards characters={characters} loading={extractLoading} error={extractError} onExtract={() => handleExtractCharacters(novelText)} onCancelExtraction={() => { abortRef.current?.abort(); setExtractLoading(false); }} onUpdate={() => {}} novelText={novelText} timeline={timeline} lastChapterStates={lastChapterStates} /></div>
      )}
      {tab === "timeline" && timeline && (
        <div className="max-w-4xl mx-auto"><h2 className="text-sm font-semibold text-neutral-300 font-mono uppercase tracking-wider mb-4">故事时间线</h2><StoryTimeline timeline={timeline} lastChapterStates={lastChapterStates} /></div>
      )}
      {tab === "world" && (
        <div className="max-w-4xl mx-auto"><h2 className="text-sm font-semibold text-neutral-300 font-mono uppercase tracking-wider mb-4">世界观百科</h2>{storyInfo ? <StoryInfoPanel storyInfo={storyInfo} /> : <p className="text-sm text-neutral-600">暂无世界观数据</p>}</div>
      )}
    </div>
  );
}
