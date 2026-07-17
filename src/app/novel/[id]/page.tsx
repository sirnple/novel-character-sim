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
      <div className="max-w-5xl mx-auto px-4 py-8 sm:px-8 sm:py-10">
        {/* Hero */}
        <header className="mb-10">
          <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card px-5 py-6 sm:px-7 sm:py-7">
            <div
              className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full opacity-30"
              style={{
                background:
                  "radial-gradient(circle, hsl(var(--primary) / 0.35) 0%, transparent 70%)",
              }}
            />
            <div className="relative min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-primary/80 mb-2">
                本书资料
              </p>
              <h1 className="text-2xl sm:text-3xl font-semibold text-foreground tracking-tight truncate leading-tight">
                {novelTitle || "未命名"}
              </h1>
              <p className="mt-2.5 text-sm text-muted-foreground tabular-nums">
                {(novelLength || 0).toLocaleString()} 字
                <span className="mx-2 text-border">·</span>
                {characters.length} 角色
                <span className="mx-2 text-border">·</span>
                资料 {readyCount}/{statusItems.length}
              </p>
              <div className="flex flex-wrap gap-2 mt-5">
                {statusItems.map((c) => (
                  <span
                    key={c.id}
                    className={c.ok ? "ov-chip-ok" : "ov-chip-empty"}
                  >
                    {c.ok ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Minus className="w-3.5 h-3.5 opacity-50" />
                    )}
                    {c.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </header>

        <div className="space-y-8">
          {/* Form + story */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
            <FormSummaryCard
              novelId={novelId}
              branchId="main"
              refreshKey={formRefreshKey}
            />
            {storyInfo ? (
              <StoryInfoPanel storyInfo={storyInfo} />
            ) : (
              <div className="ov-card min-h-[13rem] p-6 flex flex-col justify-center border-dashed">
                <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center mb-3">
                  <Users className="w-5 h-5 text-fog" />
                </div>
                <p className="text-sm font-semibold text-foreground">故事 / 世界</p>
                <p className="text-sm text-fog mt-1.5 leading-relaxed">
                  分析完成后点此查看详情。
                </p>
              </div>
            )}
          </div>

          {/* Characters */}
          <section>
            <div className="ov-section-label mb-3.5">
              <span className="w-8 h-8 rounded-lg bg-ember-soft flex items-center justify-center">
                <Users className="w-4 h-4 text-primary" />
              </span>
              角色
              <span className="text-xs text-fog font-normal">{characters.length}</span>
              {characters.length > 0 && (
                <span className="text-xs text-fog font-normal">· 点击查看</span>
              )}
            </div>
            {characters.length === 0 ? (
              <div className="ov-card border-dashed py-10 text-center text-sm text-fog">
                暂无角色
              </div>
            ) : (
              <div className="flex gap-3.5 overflow-x-auto pb-2 custom-scrollbar">
                {characters.map((c) => (
                  <CharacterPreviewCard key={c.id || c.name} character={c} />
                ))}
              </div>
            )}
          </section>

          {/* Relationship graph */}
          {characters.length > 0 && (
            <section className="ov-card p-4 sm:p-5">
              <RelationshipGraph characters={characters} height={400} />
            </section>
          )}

          {/* Branches */}
          {branches.length > 0 && (
            <section>
              <div className="ov-section-label mb-3.5">
                <span className="w-8 h-8 rounded-lg bg-ember-soft flex items-center justify-center">
                  <GitBranch className="w-4 h-4 text-primary" />
                </span>
                分支
                <span className="text-xs text-fog font-normal">
                  {branches.length} · 点击进入写作
                </span>
              </div>
              <ul className="ov-card divide-y divide-border/40 overflow-hidden !rounded-2xl">
                {branches.map((b) => (
                  <li key={b.id} className="flex items-stretch">
                    <button
                      type="button"
                      className="flex-1 min-w-0 flex items-center gap-3 px-4 sm:px-5 py-4 text-left hover:bg-primary/5 transition-colors group"
                      onClick={() => {
                        setActiveBranchId(b.id);
                        router.push(
                          `/novel/${encodeURIComponent(novelId)}/write?branch=${encodeURIComponent(b.id)}`,
                        );
                      }}
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-xs font-medium text-muted-foreground group-hover:bg-ember-soft group-hover:text-primary transition-colors">
                        {b.id === "main" ? "主" : "支"}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block truncate text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                          {b.id === "main" ? "主线" : b.name || b.id}
                        </span>
                        <span className="block text-xs text-fog tabular-nums mt-0.5">
                          {(typeof b.char_count === "number"
                            ? b.char_count
                            : 0
                          ).toLocaleString()}{" "}
                          字
                        </span>
                      </span>
                      <ChevronRight className="w-4 h-4 text-fog group-hover:text-primary shrink-0" />
                    </button>
                    <div className="flex items-center gap-0.5 pr-3 shrink-0 border-l border-border/30">
                      <button
                        type="button"
                        title="下载 TXT"
                        disabled={downloadingId === b.id}
                        className="p-2.5 text-fog hover:text-foreground disabled:opacity-40 rounded-xl hover:bg-secondary transition-colors"
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
                          className="p-2.5 text-fog hover:text-red-400 rounded-xl hover:bg-secondary transition-colors"
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

        <footer className="mt-14 pt-8 border-t border-border/40">
          <p className="text-xs font-medium uppercase tracking-wider text-fog mb-3">
            维护
          </p>
          <div className="ov-card p-5">
            <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
              {needsAnalysis
                ? "部分资料尚未齐全。分析写入本书；文笔与点子进入侧栏库。"
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
