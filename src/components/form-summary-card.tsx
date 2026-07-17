"use client";

/**
 * Overview card: user-facing **目录** (TOC), not full 形态/章法 dump.
 * Form architecture stays in DB for agents; UI only shows catalog entries.
 */
import { useEffect, useState, useCallback } from "react";
import { BookMarked, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import type { BranchChapterMeta, NovelFormProfile } from "@/types";
import OverviewDetailSheet from "@/components/overview-detail-sheet";
import { isClientDebugMode } from "@/lib/debug-mode";

interface FormSummaryCardProps {
  novelId: string;
  branchId?: string;
  refreshKey?: number | string;
  className?: string;
  onCatalogChange?: (info: {
    catalogCount: number;
    timelineCleared: boolean;
    suggestTimelineRerun: boolean;
  }) => void;
}

export default function FormSummaryCard({
  novelId,
  branchId = "main",
  refreshKey = 0,
  className = "",
  onCatalogChange,
}: FormSummaryCardProps) {
  const [form, setForm] = useState<NovelFormProfile | null>(null);
  const [meta, setMeta] = useState<BranchChapterMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [scanMsg, setScanMsg] = useState("");
  const [localKey, setLocalKey] = useState(0);
  const debugMode = isClientDebugMode();

  const load = useCallback(() => {
    if (!novelId) return;
    let cancelled = false;
    setLoading(true);
    fetch(
      `/api/chapter-meta?novelId=${encodeURIComponent(novelId)}&branchId=${encodeURIComponent(branchId)}`,
    )
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setForm(d.form || null);
        setMeta(d.meta || null);
      })
      .catch(() => {
        if (!cancelled) {
          setForm(null);
          setMeta(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [novelId, branchId]);

  useEffect(() => {
    const cancel = load();
    return () => {
      cancel?.();
    };
  }, [load, refreshKey, localKey]);

  const reextract = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!novelId || rescanning || !debugMode) return;
    setRescanning(true);
    setScanMsg("");
    try {
      const res = await fetch("/api/chapter-meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reextract",
          novelId,
          branchId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "重扫失败");
      setForm(data.form || null);
      setMeta(data.meta || null);
      const n = data.catalogCount ?? 0;
      const prev = data.previousCatalogCount ?? 0;
      let msg = `已重扫目录：${n} 条`;
      if (prev !== n) msg += `（原 ${prev}）`;
      if (data.timelineCleared) msg += " · 已清空过期时间线";
      if (data.suggestTimelineRerun) msg += " · 建议再跑时间线";
      setScanMsg(msg);
      setLocalKey((k) => k + 1);
      onCatalogChange?.({
        catalogCount: n,
        timelineCleared: !!data.timelineCleared,
        suggestTimelineRerun: !!data.suggestTimelineRerun,
      });
    } catch (err) {
      setScanMsg(err instanceof Error ? err.message : "重扫失败");
    } finally {
      setRescanning(false);
    }
  };

  const chapters = meta?.chapters || [];
  const catalogCount = chapters.length;
  const hasCatalog = catalogCount > 0;

  if (loading && !meta && !form) {
    return (
      <div className={`ov-card min-h-[13rem] p-6 flex items-center ${className}`}>
        <div className="flex items-center gap-3 text-fog text-sm">
          <span className="w-8 h-8 rounded-xl bg-secondary animate-pulse" />
          加载目录…
        </div>
      </div>
    );
  }

  if (!hasCatalog && !form) {
    return (
      <div
        className={`ov-card min-h-[13rem] p-6 flex flex-col justify-center border-dashed ${className}`}
      >
        <div className="w-10 h-10 rounded-xl bg-ember-soft flex items-center justify-center mb-3">
          <BookMarked className="w-5 h-5 text-primary" />
        </div>
        <p className="text-sm font-medium text-foreground">目录</p>
        <p className="text-sm text-fog mt-1.5 leading-relaxed">
          分析后按本书章法提取目录（第N章 / 【书名】一、 等）。无目录则视为分析未完成，不可写作。
        </p>
        {debugMode && (
          <>
            <button
              type="button"
              disabled={rescanning || !novelId}
              onClick={() => reextract()}
              className="mt-4 inline-flex items-center gap-1.5 text-sm text-amber-500/90 hover:underline disabled:opacity-50"
            >
              {rescanning ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              [debug] 单独提取目录
            </button>
            {scanMsg && <p className="text-xs text-fog mt-2">{scanMsg}</p>}
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className={`ov-card-interactive min-h-[13rem] p-6 flex flex-col ${className}`}
        onClick={() => setOpen(true)}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <span className="w-10 h-10 rounded-xl bg-ember-soft flex items-center justify-center shrink-0">
              <BookMarked className="w-5 h-5 text-primary" />
            </span>
            <div className="text-left">
              <p className="text-sm font-semibold text-foreground">目录</p>
              <p className="text-xs text-fog mt-0.5">
                {hasCatalog
                  ? form?.chaptering?.titlePattern || "按本书标题格式"
                  : "未提取"}
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-0.5 text-xs text-fog group-hover:text-primary">
            详情 <ChevronRight className="w-3.5 h-3.5" />
          </span>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {hasCatalog ? (
            <span className="ov-chip-ok">{catalogCount} 条</span>
          ) : (
            <span className="ov-chip-empty">无目录</span>
          )}
        </div>

        {hasCatalog ? (
          <div className="mt-auto space-y-1.5 text-left w-full">
            {chapters.slice(0, 4).map((c) => (
              <p
                key={c.id}
                className="text-xs text-muted-foreground line-clamp-1"
              >
                {c.number != null ? (
                  <span className="text-fog">第{c.number}章 </span>
                ) : null}
                {c.title}
              </p>
            ))}
            {catalogCount > 4 && (
              <p className="text-[11px] text-fog">还有 {catalogCount - 4} 条…</p>
            )}
          </div>
        ) : (
          <p className="mt-auto text-sm text-fog text-left leading-relaxed">
            未能提取目录。请重新分析；无目录不可写作。
          </p>
        )}
      </button>

      <OverviewDetailSheet
        open={open}
        onClose={() => setOpen(false)}
        title="目录"
        subtitle={
          hasCatalog
            ? `${catalogCount} 条${form?.chaptering?.titlePattern ? ` · ${form.chaptering.titlePattern}` : ""}`
            : "未提取"
        }
      >
        {debugMode && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-3 mb-4 space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-amber-500/80 font-medium">
              Debug only
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={rescanning}
                onClick={() => reextract()}
                className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl bg-secondary border border-border/50 text-foreground hover:bg-panel-elevated disabled:opacity-50"
              >
                {rescanning ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                单独提取目录
              </button>
              <span className="text-[11px] text-fog">
                程序扫描 · 适应多种章名格式 · 含 offset
              </span>
            </div>
            {scanMsg && (
              <p className="text-xs text-primary/90 leading-relaxed">{scanMsg}</p>
            )}
          </div>
        )}

        {!hasCatalog ? (
          <p className="text-sm text-fog leading-relaxed">
            暂无目录条目。完整「分析」会扫描本书标题格式并写入目录；提取失败时视为分析未完成。
          </p>
        ) : (
          <dd className="rounded-xl bg-secondary/30 border border-border/40 max-h-[min(60vh,28rem)] overflow-y-auto custom-scrollbar divide-y divide-border/30 list-none m-0 p-0">
            {chapters.map((c) => (
              <div
                key={c.id}
                className="text-xs text-muted-foreground px-3 py-2.5 flex flex-col gap-0.5"
              >
                <span className="text-foreground/90">
                  {c.number != null ? `第${c.number}章 ` : ""}
                  {c.title}
                </span>
                {debugMode && (
                  <span className="text-[10px] text-fog tabular-nums">
                    offset {c.startOffset.toLocaleString()}
                    {c.endOffset != null
                      ? ` – ${c.endOffset.toLocaleString()}`
                      : ""}
                  </span>
                )}
              </div>
            ))}
          </dd>
        )}
      </OverviewDetailSheet>
    </>
  );
}
