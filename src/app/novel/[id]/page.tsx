"use client";
import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useNovel } from "@/lib/novel-context";
import {
  BookOpen,
  PenLine,
  GitBranch,
  Trash2,
  Download,
  Users,
  Check,
  Minus,
  ChevronRight,
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

/**
 * Overview = browse book materials (原著资料).
 * Navigation (read/write) is quiet text links; analysis is a footer maintenance action.
 */
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
      <div className="max-w-5xl mx-auto px-4 py-5 sm:px-6 sm:py-6">
        {/* ── 1. Identity + quiet navigation (not a CTA bar) ── */}
        <header className="pb-4 border-b border-border/60">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1 border-l-2 border-primary/70 pl-3">
              <h1 className="text-xl sm:text-2xl font-semibold text-foreground tracking-tight truncate leading-snug">
                {novelTitle || "未命名"}
              </h1>
              <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
                {(novelLength || 0).toLocaleString()} 字
                <span className="mx-1.5 text-border">·</span>
                {characters.length} 角色
                <span className="mx-1.5 text-border">·</span>
                资料 {readyCount}/{statusItems.length}
              </p>
            </div>
            {/* Text links — browse destinations, not competing primary buttons */}
            <nav className="flex items-center gap-1 sm:gap-2 shrink-0 text-sm pt-0.5">
              <Link
                href={`/novel/${novelId}/read`}
                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span className="hidden xs:inline sm:inline">阅读</span>
              </Link>
              <span className="text-border text-xs">|</span>
              <Link
                href={`/novel/${novelId}/write`}
                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
              >
                <PenLine className="w-3.5 h-3.5" />
                <span className="hidden xs:inline sm:inline">写作</span>
              </Link>
            </nav>
          </div>
        </header>

        {/* ── 2. Information browse (main body) ── */}
        <div className="mt-5 space-y-5">
          {/* Status legend — read-only, not buttons */}
          <div>
            <p className="text-[10px] uppercase tracking-wider text-fog mb-2">
              本书资料
            </p>
            <div className="flex flex-wrap gap-2">
              {statusItems.map((c) => (
                <span
                  key={c.id}
                  className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md ${
                    c.ok
                      ? "bg-secondary/80 text-muted-foreground"
                      : "bg-transparent border border-dashed border-border/70 text-fog"
                  }`}
                >
                  {c.ok ? (
                    <Check className="w-3 h-3 text-primary" />
                  ) : (
                    <Minus className="w-3 h-3 opacity-40" />
                  )}
                  {c.label}
                </span>
              ))}
            </div>
          </div>

          {/* Content grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
            <FormSummaryCard
              novelId={novelId}
              branchId="main"
              refreshKey={formRefreshKey}
            />
            {storyInfo ? (
              <StoryInfoPanel storyInfo={storyInfo} />
            ) : (
              <div className="rounded-xl border border-dashed border-border/60 bg-card/30 p-4 min-h-[8rem] flex flex-col justify-center">
                <p className="text-xs font-medium text-muted-foreground">故事 / 世界</p>
                <p className="text-xs text-fog mt-1 leading-relaxed">
                  分析完成后在此浏览情节与世界观。
                </p>
              </div>
            )}
          </div>

          {/* Characters */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-3.5 h-3.5 text-fog" />
              <h2 className="text-xs font-medium text-muted-foreground">
                角色
              </h2>
              <span className="text-[10px] text-fog">{characters.length}</span>
            </div>
            {characters.length === 0 ? (
              <p className="text-xs text-fog py-3 px-1 border border-dashed border-border/50 rounded-lg text-center">
                暂无角色资料
              </p>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar -mx-0.5 px-0.5">
                {characters.slice(0, 20).map((c) => (
                  <div
                    key={c.id || c.name}
                    className="shrink-0 w-28 rounded-lg border border-border/50 bg-card px-2.5 py-2"
                  >
                    <p className="text-xs font-medium text-foreground truncate">
                      {c.name}
                    </p>
                    <p className="text-[10px] text-fog truncate mt-0.5">
                      {c.aliases?.[0] ||
                        c.drive?.goal?.slice(0, 18) ||
                        "—"}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Branches */}
          {branches.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <GitBranch className="w-3.5 h-3.5 text-fog" />
                <h2 className="text-xs font-medium text-muted-foreground">分支</h2>
                <span className="text-[10px] text-fog">{branches.length}</span>
              </div>
              <ul className="rounded-xl border border-border/60 bg-card divide-y divide-border/40 overflow-hidden">
                {branches.map((b) => (
                  <li
                    key={b.id}
                    className="flex items-center gap-2 px-3 py-2.5 text-sm"
                  >
                    <span className="flex-1 min-w-0 truncate text-foreground text-xs sm:text-sm">
                      {b.id === "main" ? "主线" : b.name || b.id}
                    </span>
                    <span className="text-[10px] text-fog tabular-nums shrink-0">
                      {(typeof b.char_count === "number"
                        ? b.char_count
                        : 0
                      ).toLocaleString()}{" "}
                      字
                    </span>
                    <button
                      type="button"
                      title="下载 TXT"
                      disabled={downloadingId === b.id}
                      className="p-1.5 text-fog hover:text-foreground disabled:opacity-40"
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
                        title="删除"
                        className="p-1.5 text-fog hover:text-red-400"
                        onClick={async () => {
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
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* ── 3. Analysis = maintenance, separated at bottom ── */}
        <footer className="mt-8 pt-5 border-t border-border/50">
          <p className="text-[10px] uppercase tracking-wider text-fog mb-2">
            维护
          </p>
          <div className="rounded-xl border border-border/50 bg-card/50 px-3 py-3 sm:px-4">
            <p className="text-xs text-muted-foreground mb-2.5 leading-relaxed">
              {needsAnalysis
                ? "部分资料尚未齐全。分析会写入本书形态/故事/角色等，文笔与点子进入侧栏库。"
                : "资料已齐。需要更新时再重新分析（可勾选强制重跑）。"}
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
          <p className="mt-3 text-[11px] text-fog flex items-center gap-1">
            写作用侧栏文笔库 / 点子库
            <ChevronRight className="w-3 h-3" />
            形态与角色以本书为准
          </p>
        </footer>
      </div>
    </div>
  );
}
