"use client";
import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useNovel } from "@/lib/novel-context";
import { BookOpen, Play, Sparkles, RefreshCw, GitBranch } from "lucide-react";
import StoryInfoPanel from "@/components/story-info-panel";

interface BranchInfo { id: string; name: string; text: string; created_at: string; }

export default function NovelPage() {
  const { novelId, novelTitle, novelText, characters, storyInfo, timeline, setNovel } = useNovel();
  const [extractLoading, setExtractLoading] = useState(false);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch(`/api/branches?novelId=${novelId}`).then(r => r.json()).then(d => {
      if (d.branches) setBranches(d.branches);
    }).catch(() => {});
  }, [novelId]);

  const handleExtract = async () => {
    setExtractLoading(true);
    const ctrl = new AbortController(); abortRef.current = ctrl;
    try {
      const res = await fetch("/api/characters/extract", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: novelId, text: novelText, forceRefresh: false }),
        signal: ctrl.signal,
      });
      if (res.ok) {
        const data = await res.json();
        setNovel({
          characters: data.characters || [],
          storyInfo: data.storyInfo || null,
          timeline: data.timeline || null,
          lastChapterStates: data.lastChapterStates || [],
        });
      }
    } catch (e: any) { if (e.name === "AbortError") return; }
    setExtractLoading(false); abortRef.current = null;
  };

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-neutral-200 font-mono">{novelTitle}</h2>
            <p className="text-xs text-neutral-500 mt-1">{novelText.length.toLocaleString()} 字 · {characters.length} 个角色 · {timeline?.totalChapters || 0} 章</p>
          </div>
          <div className="flex gap-3">
            <Link href={`/novel/${novelId}/read`}
              className="flex items-center gap-2 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-sm font-mono rounded-lg transition-colors">
              <BookOpen className="w-4 h-4" /> 阅读
            </Link>
            <Link href={`/novel/${novelId}/write`}
              className="flex items-center gap-2 px-4 py-2.5 bg-orange-600 hover:bg-orange-500 text-white text-sm font-mono rounded-lg transition-colors">
              <Play className="w-4 h-4" /> 写作
            </Link>
          </div>
        </div>

        {/* World Setting */}
        {storyInfo ? (
          <StoryInfoPanel storyInfo={storyInfo} />
        ) : (
          <div className="bg-[#0c0c0c] border border-neutral-800/60 rounded-lg p-6 text-center">
            <Sparkles className="w-8 h-8 mx-auto mb-3 text-neutral-600" />
            <p className="text-sm text-neutral-500 font-mono mb-4">尚未提取世界观和角色</p>
            <button onClick={handleExtract} disabled={extractLoading}
              className={`px-4 py-2 rounded text-xs font-mono ${extractLoading ? "bg-neutral-800 text-neutral-600" : "bg-orange-600 hover:bg-orange-500 text-white"}`}>
              {extractLoading ? "提取中..." : "提取角色与世界观"}
            </button>
          </div>
        )}

        {/* Branches */}
        {branches.length > 0 && (
          <div className="bg-[#0c0c0c] border border-neutral-800/60 rounded-lg p-5">
            <h3 className="text-xs font-semibold text-neutral-400 font-mono uppercase tracking-wider mb-4 flex items-center gap-2">
              <GitBranch className="w-3.5 h-3.5" /> 分支故事线
            </h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3 px-3 py-2 bg-neutral-800/30 rounded text-sm text-neutral-300 font-mono">
                <span className="text-neutral-500">主线</span>
                <span className="text-neutral-600 text-xs">{novelText.length.toLocaleString()} 字</span>
              </div>
              {branches.map(b => (
                <div key={b.id} className="flex items-center gap-3 px-3 py-2 bg-neutral-800/30 rounded text-sm text-neutral-300 font-mono">
                  <span>{b.name}</span>
                  <span className="text-neutral-600 text-xs">{(b.text || "").length.toLocaleString()} 字</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
