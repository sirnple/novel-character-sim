"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useNovel } from "@/lib/novel-context";
import { BookOpen, Play, GitBranch, Trash2 } from "lucide-react";
import StoryInfoPanel from "@/components/story-info-panel";
import ExtractModulesPanel from "@/components/extract-modules-panel";

interface BranchInfo { id: string; name: string; text: string; created_at: string; }

export default function NovelPage() {
  const { novelId, novelTitle, novelText, characters, storyInfo, timeline, setNovel } = useNovel();
  const [branches, setBranches] = useState<BranchInfo[]>([]);

  useEffect(() => {
    fetch(`/api/branches?novelId=${novelId}`).then(r => r.json()).then(d => {
      if (d.branches) setBranches(d.branches);
    }).catch(() => {});
  }, [novelId]);

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-6 bg-background">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-foreground truncate">{novelTitle}</h2>
            <p className="text-sm text-muted-foreground mt-1.5">
              {novelText.length.toLocaleString()} 字 · {characters.length} 个角色 · {timeline?.totalChapters || 0} 章
            </p>
          </div>
          <div className="flex gap-2 sm:gap-3 shrink-0">
            <Link href={`/novel/${novelId}/read`}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-secondary hover:bg-panel-elevated text-foreground text-sm font-medium rounded-lg border border-border transition-colors">
              <BookOpen className="w-4 h-4" /> 阅读
            </Link>
            <Link href={`/novel/${novelId}/write`}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-primary hover:brightness-110 text-primary-foreground text-sm font-medium rounded-lg transition-colors">
              <Play className="w-4 h-4" /> 写作
            </Link>
          </div>
        </div>

        {/* Modular extract — main entry after selecting a novel */}
        <div className="bg-card border border-border rounded-xl p-5 sm:p-6">
          <ExtractModulesPanel
            novelId={novelId}
            novelText={novelText}
            defaultModules={storyInfo ? ["style", "ideas"] : ["story", "characters", "style", "ideas"]}
            onDone={(data) => {
              setNovel({
                characters: data.characters ?? characters,
                storyInfo: data.storyInfo !== undefined ? data.storyInfo : storyInfo,
                timeline: data.timeline !== undefined ? data.timeline : timeline,
                lastChapterStates: data.lastChapterStates ?? undefined,
              });
            }}
          />
        </div>

        {storyInfo && <StoryInfoPanel storyInfo={storyInfo} />}

        {branches.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-5 sm:p-6">
            <h3 className="text-sm font-semibold text-muted-foreground mb-4 flex items-center gap-2">
              <GitBranch className="w-4 h-4" /> 分支故事线
            </h3>
            <div className="space-y-2">
              <div className="flex items-center gap-3 px-3 py-2.5 bg-secondary/60 rounded-lg text-sm text-foreground">
                <span className="text-muted-foreground">主线</span>
                <span className="text-fog text-xs">{novelText.length.toLocaleString()} 字</span>
              </div>
              {branches.map(b => (
                <div key={b.id} className="flex items-center gap-3 px-3 py-2.5 bg-secondary/60 rounded-lg text-sm text-foreground">
                  <span className="flex-1 truncate">{b.name || b.id}</span>
                  <span className="text-fog text-xs">{(b.text || "").length.toLocaleString()} 字</span>
                  {b.id !== "main" && (
                    <button
                      type="button"
                      title="删除分支"
                      className="p-1 text-fog hover:text-red-400"
                      onClick={async () => {
                        if (!confirm(`确定删除分支「${b.name || b.id}」？`)) return;
                        const res = await fetch(
                          `/api/branches?novelId=${encodeURIComponent(novelId)}&branchId=${encodeURIComponent(b.id)}`,
                          { method: "DELETE" },
                        );
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok) {
                          alert(data.error || "删除失败");
                          return;
                        }
                        setBranches(prev => prev.filter(x => x.id !== b.id));
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
