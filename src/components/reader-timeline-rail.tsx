"use client";

/**
 * Vertical chapter rail: switchable 目录 (catalog) / 时间线 (analysis units).
 * Click → jump to offset; scroll-sync highlights current unit.
 */
import { useEffect, useMemo, useState } from "react";
import type { ChapterCatalogEntry, ChapterTimeline } from "@/types";
import { charOffsetToScrollTop } from "@/components/virtual-novel-body";

export type RailMode = "catalog" | "timeline";

export interface RailUnit {
  id: string;
  label: string;
  startOffset: number;
  endOffset?: number;
  summary?: string;
  status?: "ready" | "pending" | "error";
  error?: string;
}

interface ReaderTimelineRailProps {
  /** Chapter TOC from form / chapter-meta */
  catalogUnits?: RailUnit[];
  /** Timeline analysis units (job or saved timeline) */
  timelineUnits?: RailUnit[];
  mode?: RailMode;
  defaultMode?: RailMode;
  onModeChange?: (mode: RailMode) => void;
  scrollOffset: number;
  /** Force-highlight this unit after click (until parent clears) */
  pinnedUnitId?: string | null;
  onJump: (startOffset: number, unitId?: string) => void;
  onRetryUnit?: (unitId: string) => void;
  retryingUnitId?: string | null;
  className?: string;
  /** Hide built-in header tabs (parent draws its own) */
  hideTabs?: boolean;
  /** Extra subtitle e.g. job progress */
  timelineHint?: string | null;
}

export function catalogToRailUnits(chapters: ChapterCatalogEntry[]): RailUnit[] {
  return (chapters || []).map((c, i) => ({
    id: c.id || `cat_${i}_${c.startOffset}`,
    label: c.number != null ? `第${c.number}章 ${c.title}` : c.title,
    startOffset: c.startOffset,
    endOffset: c.endOffset,
    status: "ready" as const,
  }));
}

/** Map saved timeline snapshots onto rail units; prefer catalog offsets when numbers match. */
export function timelineToRailUnits(
  timeline: ChapterTimeline | null | undefined,
  catalog?: ChapterCatalogEntry[],
): RailUnit[] {
  const chs = timeline?.chapters || [];
  if (!chs.length) return [];
  const byNum = new Map(
    (catalog || [])
      .filter((c) => c.number != null)
      .map((c) => [c.number as number, c]),
  );
  return chs.map((c, i) => {
    const cat = byNum.get(c.chapterNumber);
    return {
      id: `tl_${c.chapterNumber}_${i}`,
      label: c.title
        ? c.title.startsWith("第")
          ? c.title
          : `第${c.chapterNumber}章 ${c.title}`
        : `第${c.chapterNumber}章`,
      startOffset: cat?.startOffset ?? 0,
      endOffset: cat?.endOffset,
      summary: c.events?.[0]
        ? (c.events[0].title || c.events[0].description || "").slice(0, 80)
        : undefined,
      status: "ready" as const,
    };
  });
}

export default function ReaderTimelineRail({
  catalogUnits = [],
  timelineUnits = [],
  mode: modeProp,
  defaultMode,
  onModeChange,
  scrollOffset,
  pinnedUnitId = null,
  onJump,
  onRetryUnit,
  retryingUnitId = null,
  className = "",
  hideTabs = false,
  timelineHint = null,
}: ReaderTimelineRailProps) {
  const hasCatalog = catalogUnits.length > 0;
  const hasTimeline = timelineUnits.length > 0;

  const initial: RailMode =
    modeProp ||
    defaultMode ||
    (hasCatalog ? "catalog" : "timeline");

  const [internalMode, setInternalMode] = useState<RailMode>(initial);
  const mode = modeProp ?? internalMode;

  // If controlled mode is empty, fall back once data arrives
  useEffect(() => {
    if (modeProp != null) return;
    if (mode === "catalog" && !hasCatalog && hasTimeline) {
      setInternalMode("timeline");
    } else if (mode === "timeline" && !hasTimeline && hasCatalog) {
      setInternalMode("catalog");
    }
  }, [modeProp, mode, hasCatalog, hasTimeline]);

  const setMode = (m: RailMode) => {
    if (modeProp == null) setInternalMode(m);
    onModeChange?.(m);
  };

  const units = mode === "catalog" ? catalogUnits : timelineUnits;

  const activeId = useMemo(() => {
    if (!units.length) return null;
    // Click pin wins immediately
    if (pinnedUnitId && units.some((u) => u.id === pinnedUnitId)) {
      return pinnedUnitId;
    }
    let cur = units[0].id;
    for (const u of units) {
      if (scrollOffset >= u.startOffset) cur = u.id;
      else break;
    }
    return cur;
  }, [units, scrollOffset, pinnedUnitId]);

  const tabs = (
    <div className="sticky top-0 z-10 bg-card/95 border-b border-border/40 backdrop-blur-sm">
      <div className="flex p-1 gap-0.5">
        <button
          type="button"
          onClick={() => setMode("catalog")}
          className={`flex-1 text-[11px] font-medium py-1.5 rounded-md transition-colors ${
            mode === "catalog"
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
          }`}
        >
          目录
          {hasCatalog ? (
            <span className="opacity-60 ml-0.5">{catalogUnits.length}</span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => setMode("timeline")}
          className={`flex-1 text-[11px] font-medium py-1.5 rounded-md transition-colors ${
            mode === "timeline"
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
          }`}
        >
          时间线
          {hasTimeline ? (
            <span className="opacity-60 ml-0.5">{timelineUnits.length}</span>
          ) : null}
        </button>
      </div>
      {mode === "timeline" && timelineHint && (
        <p className="px-2 pb-1.5 text-[10px] text-fog truncate">{timelineHint}</p>
      )}
    </div>
  );

  if (!units.length) {
    return (
      <aside
        className={`w-[160px] sm:w-[180px] shrink-0 border-r border-border/60 bg-card/50 flex flex-col ${className}`}
      >
        {!hideTabs && tabs}
        <div className="p-2 text-xs text-fog leading-relaxed">
          {mode === "catalog"
            ? hasCatalog
              ? null
              : "暂无目录。完成分析提取目录后显示。"
            : hasTimeline
              ? null
              : "暂无时间线。完成时间线分析后显示事件摘要；可先用「目录」跳转。"}
        </div>
      </aside>
    );
  }

  return (
    <aside
      className={`w-[160px] sm:w-[180px] shrink-0 border-r border-border/60 bg-card/40 flex flex-col min-h-0 ${className}`}
    >
      {!hideTabs && tabs}
      <div className="relative flex-1 min-h-0 overflow-y-auto custom-scrollbar px-2 py-3">
        <div className="absolute left-[18px] top-3 bottom-3 w-px bg-border/80" />
        <ul className="space-y-0">
          {units.map((u) => {
            const active = u.id === activeId;
            const pending = u.status === "pending";
            const err = u.status === "error";
            const retrying = retryingUnitId === u.id;
            return (
              <li key={u.id} className="relative pl-6 py-1.5">
                <span
                  className={`absolute left-[13px] top-2.5 w-2.5 h-2.5 rounded-full border ${
                    active
                      ? "bg-primary border-primary"
                      : pending || retrying
                        ? "bg-transparent border-primary/50 animate-pulse"
                        : err
                          ? "bg-red-500/80 border-red-500"
                          : "bg-panel-elevated border-border"
                  }`}
                />
                <button
                  type="button"
                  disabled={pending || retrying}
                  onClick={() => onJump(u.startOffset, u.id)}
                  className={`w-full text-left text-xs leading-snug rounded px-1 py-0.5 transition-colors ${
                    active
                      ? "text-primary font-medium"
                      : err
                        ? "text-red-400/90"
                        : "text-muted-foreground hover:text-foreground"
                  } disabled:opacity-50`}
                  title={u.error || u.summary || u.label}
                >
                  <span className="line-clamp-2">{u.label}</span>
                  {mode === "timeline" && u.summary && !err && (
                    <span className="block text-[10px] text-fog line-clamp-2 mt-0.5">
                      {u.summary}
                    </span>
                  )}
                  {err && (
                    <span className="block text-[10px] text-red-400/80 line-clamp-3 mt-0.5">
                      {u.error || "分析失败"}
                    </span>
                  )}
                </button>
                {err && onRetryUnit && mode === "timeline" && (
                  <button
                    type="button"
                    disabled={!!retryingUnitId}
                    onClick={() => onRetryUnit(u.id)}
                    className="mt-0.5 ml-1 text-[10px] text-primary hover:underline disabled:opacity-40"
                  >
                    {retrying ? "重试中…" : "重试"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}

/**
 * Map scrollTop → approx char offset using VirtualNovelBody height model
 * (keeps catalog active chapter in sync with jump).
 */
export function useApproxScrollOffset(
  scroller: React.RefObject<HTMLElement | null>,
  totalChars: number,
): number {
  const [off, setOff] = useState(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el || totalChars <= 0) return;

    const onScroll = () => {
      const target = el.scrollTop + el.clientHeight * 0.08;
      let lo = 0;
      let hi = totalChars;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (charOffsetToScrollTop(totalChars, mid) <= target) lo = mid;
        else hi = mid - 1;
      }
      setOff(lo);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [scroller, totalChars]);
  return off;
}
