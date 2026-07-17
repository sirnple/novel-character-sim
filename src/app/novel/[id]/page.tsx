"use client";
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useNovel } from "@/lib/novel-context";
import {
  GitBranch,
  Trash2,
  Download,
  Users,
  Check,
  Minus,
  ChevronRight,
} from "lucide-react";
import StoryInfoPanel, {
  CharacterPreviewCard,
} from "@/components/story-info-panel";
import ExtractModulesPanel from "@/components/extract-modules-panel";
import FormSummaryCard from "@/components/form-summary-card";
import RelationshipGraph from "@/components/relationship-graph";
import { downloadBranchAsTxt } from "@/lib/download-branch-txt";

interface BranchInfo {
  id: string;
  name: string;
  created_at?: string;
  char_count?: number;
}

/**
 * Overview = browse book materials.
 * Large preview cards; details open in floating sheets (no accordion clutter).
 * Analysis is footer maintenance only.
 */
export default function NovelPage() {
  const router = useRouter();
  const {
    novelId,
    novelTitle,
    novelLength,
    characters,
    storyInfo,
    timeline,
    setNovel,
    setActiveBranchId,
  } = useNovel();
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [formRefreshKey, setFormRefreshKey] = useState(0);
  const [hasForm, setHasForm] = useState(false);

  useEffect(() => {
    if (!novelId) return;
    fetch(`/api/branches?novelId=${novelId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.branches) setBranches(d.branches);
      })
      .catch(() => {});
  }, [novelId]);

  useEffect(() => {
    if (!novelId) return;
    fetch(
      `/api/chapter-meta?novelId=${encodeURIComponent(novelId)}&branchId=main`,
    )
      .then((r) => r.json())
      .then((d) => setHasForm(!!d.form))
      .catch(() => setHasForm(false));
  }, [novelId, formRefreshKey]);

  const handleDownloadBranch = async (branchId: string, name: string) => {
    if (!novelId || downloadingId) return;
    setDownloadingId(branchId);
    try {
      const err = await downloadBranchAsTxt(novelId, branchId, name || branchId);
      if (err) alert(err);
    } finally {
      setDownloadingId(null);
    }
  };

  const statusItems = useMemo(
    () => [
      { id: "story", label: "故事", ok: !!storyInfo?.plotSummary },
      { id: "chars", label: "角色", ok: characters.length > 0 },
      { id: "form", label: "形态", ok: hasForm },
      {
        id: "tl",
        label: "时间线",
        ok: (timeline?.totalChapters || timeline?.chapters?.length || 0) > 0,
      },
    ],
    [storyInfo, characters.length, hasForm, timeline],
  );
  const readyCount = statusItems.filter((c) => c.ok).length;
  const needsAnalysis = readyCount < statusItems.length;

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar bg-background">
      <div className="max-w-5xl mx-auto px-4 py-6 sm:px-8 sm:py-8">
        {/* Identity */}
        <header className="mb-8">
          <div className="min-w-0 border-l-[3px] border-primary pl-4">
            <h1 className="text-2xl sm:text-[1.75rem] font-semibold text-foreground tracking-tight truncate leading-snug">
              {novelTitle || "未命名"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground tabular-nums">
              {(novelLength || 0).toLocaleString()} 字
              <span className="mx-2 text-border">·</span>
              {characters.length} 角色
              <span className="mx-2 text-border">·</span>
              资料 {readyCount}/{statusItems.length}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 mt-4 pl-4">
            {statusItems.map((c) => (
              <span
                key={c.id}
                className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full ${
                  c.ok
                    ? "bg-secondary text-muted-foreground"
                    : "border border-dashed border-border/80 text-fog"
                }`}
              >
                {c.ok ? (
                  <Check className="w-3.5 h-3.5 text-primary" />
                ) : (
                  <Minus className="w-3.5 h-3.5 opacity-40" />
                )}
                {c.label}
              </span>
            ))}
          </div>
        </header>

        {/* Browse: large cards */}
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
            <FormSummaryCard
              novelId={novelId}
              branchId="main"
              refreshKey={formRefreshKey}
            />
            {storyInfo ? (
              <StoryInfoPanel storyInfo={storyInfo} />
            ) : (
              <div className="min-h-[11rem] sm:min-h-[12.5rem] rounded-2xl border border-dashed border-border/70 bg-card/20 p-5 flex flex-col justify-center">
                <p className="text-sm font-medium text-muted-foreground">故事 / 世界</p>
                <p className="text-sm text-fog mt-2 leading-relaxed">
                  分析完成后点此区域可查看详情。
                </p>
              </div>
            )}
          </div>

          <section>
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-fog" />
              <h2 className="text-sm font-medium text-muted-foreground">角色</h2>
              <span className="text-xs text-fog">{characters.length}</span>
              {characters.length > 0 && (
                <span className="text-xs text-fog">· 点击查看详情</span>
              )}
            </div>
            {characters.length === 0 ? (
              <p className="text-sm text-fog py-8 text-center border border-dashed border-border/50 rounded-2xl">
                暂无角色
              </p>
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-2 custom-scrollbar">
                {characters.map((c) => (
                  <CharacterPreviewCard key={c.id || c.name} character={c} />
                ))}
              </div>
            )}
          </section>

          {characters.length > 0 && (
            <section className="rounded-2xl border border-border/70 bg-card p-4 sm:p-5">
              <RelationshipGraph characters={characters} height={380} />
            </section>
          )}

          {branches.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <GitBranch className="w-4 h-4 text-fog" />
                <h2 className="text-sm font-medium text-muted-foreground">分支</h2>
                <span className="text-xs text-fog">{branches.length}</span>
                <span className="text-xs text-fog">· 点击进入写作</span>
              </div>
              <ul className="rounded-2xl border border-border/70 bg-card divide-y divide-border/40 overflow-hidden">
                {branches.map((b) => (
                  <li key={b.id} className="flex items-stretch">
                    <button
                      type="button"
                      className="flex-1 min-w-0 flex items-center gap-3 px-4 py-3.5 text-left hover:bg-panel-elevated/40 transition-colors group"
                      onClick={() => {
                        setActiveBranchId(b.id);
                        router.push(
                          `/novel/${encodeURIComponent(novelId)}/write?branch=${encodeURIComponent(b.id)}`,
                        );
                      }}
                    >
                      <span className="flex-1 min-w-0 truncate text-sm text-foreground group-hover:text-primary transition-colors">
                        {b.id === "main" ? "主线" : b.name || b.id}
                      </span>
                      <span className="text-xs text-fog tabular-nums shrink-0">
                        {(typeof b.char_count === "number"
                          ? b.char_count
                          : 0
                        ).toLocaleString()}{" "}
                        字
                      </span>
                      <ChevronRight className="w-4 h-4 text-fog group-hover:text-primary shrink-0" />
                    </button>
                    <div className="flex items-center gap-0.5 pr-2 shrink-0">
                      <button
                        type="button"
                        title="下载 TXT"
                        disabled={downloadingId === b.id}
                        className="p-2 text-fog hover:text-foreground disabled:opacity-40 rounded-lg hover:bg-secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownloadBranch(
                            b.id,
                            b.id === "main"
                              ? `${novelTitle || "主线"}_主线`
                              : b.name || b.id,
                          );
                        }}
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      {b.id !== "main" && (
                        <button
                          type="button"
                          title="删除"
                          className="p-2 text-fog hover:text-red-400 rounded-lg hover:bg-secondary"
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!confirm(`确定删除分支「${b.name || b.id}」？`))
                              return;
                            const res = await fetch(
                              `/api/branches?novelId=${encodeURIComponent(novelId)}&branchId=${encodeURIComponent(b.id)}`,
                              { method: "DELETE" },
                            );
                            const data = await res.json().catch(() => ({}));
                            if (!res.ok) {
                              alert(data.error || "删除失败");
                              return;
                            }
                            setBranches((prev) =>
                              prev.filter((x) => x.id !== b.id),
                            );
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* Maintenance */}
        <footer className="mt-12 pt-6 border-t border-border/40">
          <p className="text-xs text-fog mb-3">维护 · 资料不全时运行分析</p>
          <div className="rounded-2xl border border-border/50 bg-card/40 px-4 py-4">
            <p className="text-sm text-muted-foreground mb-3 leading-relaxed">
              {needsAnalysis
                ? "部分资料尚未齐全。分析写入本书资料；文笔与点子进入侧栏库。"
                : "资料已齐。需要更新时再运行分析。"}
            </p>
            <ExtractModulesPanel
              novelId={novelId}
              compact
              onDone={(data) => {
                setNovel({
                  characters: data.characters ?? characters,
                  storyInfo:
                    data.storyInfo !== undefined ? data.storyInfo : storyInfo,
                  timeline:
                    data.timeline !== undefined ? data.timeline : timeline,
                  lastChapterStates: data.lastChapterStates ?? undefined,
                });
                setFormRefreshKey((k) => k + 1);
                setHasForm(!!data.form || hasForm);
              }}
            />
          </div>
        </footer>
      </div>
    </div>
  );
}
