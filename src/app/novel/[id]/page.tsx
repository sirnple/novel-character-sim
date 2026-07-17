"use client";
import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useNovel } from "@/lib/novel-context";
import {
  BookOpen,
  Play,
  GitBranch,
  Trash2,
  Download,
  Users,
  Sparkles,
  Check,
  Minus,
} from "lucide-react";
import StoryInfoPanel from "@/components/story-info-panel";
import ExtractModulesPanel from "@/components/extract-modules-panel";
import FormSummaryCard from "@/components/form-summary-card";
import { downloadBranchAsTxt } from "@/lib/download-branch-txt";

interface BranchInfo {
  id: string;
  name: string;
  created_at?: string;
  char_count?: number;
}

export default function NovelPage() {
  const {
    novelId,
    novelTitle,
    novelLength,
    characters,
    storyInfo,
    timeline,
    setNovel,
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

  const covenant = useMemo(
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
  const readyCount = covenant.filter((c) => c.ok).length;

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar bg-background">
      <div className="max-w-6xl mx-auto p-3 sm:p-5 space-y-3 sm:space-y-4">
        {/* Hero header */}
        <header className="rounded-xl border border-border/80 bg-card/80 px-3 py-3 sm:px-4 sm:py-3.5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-fog mb-0.5">
                概览 · 原著契约
              </p>
              <h2 className="text-lg sm:text-xl font-semibold text-foreground truncate leading-tight">
                {novelTitle || "未命名"}
              </h2>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-[11px] text-muted-foreground">
                <span>{(novelLength || 0).toLocaleString()} 字</span>
                <span className="text-border">·</span>
                <span>{characters.length} 角色</span>
                <span className="text-border">·</span>
                <span>{timeline?.totalChapters || timeline?.chapters?.length || 0} 时间线单元</span>
                <span className="text-border">·</span>
                <span>
                  契约 {readyCount}/{covenant.length}
                </span>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <Link
                href={`/novel/${novelId}/read`}
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium border border-border bg-secondary/80 hover:bg-panel-elevated text-foreground transition-colors"
              >
                <BookOpen className="w-3.5 h-3.5" /> 阅读
              </Link>
              <Link
                href={`/novel/${novelId}/write`}
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:brightness-110 transition-all"
              >
                <Play className="w-3.5 h-3.5" /> 写作
              </Link>
            </div>
          </div>

          {/* Covenant readiness chips */}
          <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-border/50">
            {covenant.map((c) => (
              <span
                key={c.id}
                className={`inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border ${
                  c.ok
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-border/60 bg-secondary/40 text-fog"
                }`}
              >
                {c.ok ? (
                  <Check className="w-3 h-3" />
                ) : (
                  <Minus className="w-3 h-3 opacity-50" />
                )}
                {c.label}
              </span>
            ))}
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-border/40 text-fog">
              <Sparkles className="w-3 h-3" />
              文笔/点子见侧栏库
            </span>
          </div>
        </header>

        {/* Analyze toolbar */}
        <section className="rounded-xl border border-border/80 bg-card px-3 py-2.5 sm:px-4 sm:py-3">
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
        </section>

        {/* Main grid: form + story */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <FormSummaryCard
            novelId={novelId}
            branchId="main"
            refreshKey={formRefreshKey}
          />
          {storyInfo ? (
            <StoryInfoPanel storyInfo={storyInfo} />
          ) : (
            <div className="rounded-xl border border-dashed border-border/70 bg-card/40 p-3 flex flex-col justify-center min-h-[7rem]">
              <p className="text-xs font-medium text-muted-foreground mb-1">
                故事 / 世界
              </p>
              <p className="text-xs text-fog leading-relaxed">
                分析后显示情节摘要与世界观。
              </p>
            </div>
          )}
        </section>

        {/* Characters strip */}
        <section className="rounded-xl border border-border/80 bg-card px-3 py-2.5 sm:px-3.5">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-primary" />
              角色
              <span className="text-fog font-normal">({characters.length})</span>
            </h3>
          </div>
          {characters.length === 0 ? (
            <p className="text-xs text-fog py-1">分析后展示角色名片</p>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-0.5 custom-scrollbar">
              {characters.slice(0, 24).map((c) => (
                <div
                  key={c.id || c.name}
                  className="shrink-0 w-[7.5rem] rounded-lg border border-border/50 bg-secondary/40 px-2.5 py-2"
                >
                  <p className="text-xs font-medium text-foreground truncate">
                    {c.name}
                  </p>
                  <p className="text-[10px] text-fog truncate mt-0.5">
                    {c.aliases?.[0] ||
                      c.drive?.goal?.slice(0, 20) ||
                      c.personality?.description?.slice(0, 20) ||
                      "—"}
                  </p>
                </div>
              ))}
              {characters.length > 24 && (
                <div className="shrink-0 flex items-center text-[10px] text-fog px-2">
                  +{characters.length - 24}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Branches */}
        {branches.length > 0 && (
          <section className="rounded-xl border border-border/80 bg-card overflow-hidden">
            <div className="px-3 py-2 sm:px-3.5 border-b border-border/50 flex items-center gap-1.5">
              <GitBranch className="w-3.5 h-3.5 text-primary" />
              <h3 className="text-xs font-medium text-muted-foreground">
                分支
              </h3>
              <span className="text-[10px] text-fog">({branches.length})</span>
            </div>
            <ul className="divide-y divide-border/40">
              {branches.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center gap-2 px-3 sm:px-3.5 py-2 text-sm hover:bg-panel-elevated/30"
                >
                  <span className="flex-1 min-w-0 truncate text-foreground text-xs sm:text-sm">
                    {b.id === "main" ? "主线" : b.name || b.id}
                  </span>
                  <span className="text-[10px] text-fog tabular-nums shrink-0">
                    {(typeof b.char_count === "number" ? b.char_count : 0).toLocaleString()}{" "}
                    字
                  </span>
                  <button
                    type="button"
                    title="下载 TXT（含目录）"
                    disabled={downloadingId === b.id}
                    className="p-1.5 text-fog hover:text-primary disabled:opacity-40 rounded-md hover:bg-secondary"
                    onClick={() =>
                      handleDownloadBranch(
                        b.id,
                        b.id === "main"
                          ? `${novelTitle || "主线"}_主线`
                          : b.name || b.id,
                      )
                    }
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  {b.id !== "main" && (
                    <button
                      type="button"
                      title="删除分支"
                      className="p-1.5 text-fog hover:text-red-400 rounded-md hover:bg-secondary"
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
                        setBranches((prev) => prev.filter((x) => x.id !== b.id));
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
