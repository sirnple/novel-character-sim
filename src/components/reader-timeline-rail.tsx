"use client";

/**
 * Vertical timeline / chapter rail for the reader.
 * Click → jump to offset; scroll-sync highlights current unit.
 */
import { useEffect, useMemo, useState } from "react";
import type { ChapterCatalogEntry } from "@/types";

export interface RailUnit {
  id: string;
  label: string;
  startOffset: number;
  endOffset?: number;
  summary?: string;
  status?: "ready" | "pending" | "error";
}

interface ReaderTimelineRailProps {
  units: RailUnit[];
  /** Current scroll char offset in full body */
  scrollOffset: number;
  onJump: (startOffset: number) => void;
  className?: string;
  title?: string;
}

export function catalogToRailUnits(chapters: ChapterCatalogEntry[]): RailUnit[] {
  return (chapters || []).map((c) => ({
    id: c.id,
    label: c.number != null ? `第${c.number}章 ${c.title}` : c.title,
    startOffset: c.startOffset,
    endOffset: c.endOffset,
    status: "ready" as const,
  }));
}

export default function ReaderTimelineRail({
  units,
  scrollOffset,
  onJump,
  className = "",
  title = "时间线",
}: ReaderTimelineRailProps) {
  const activeId = useMemo(() => {
    if (!units.length) return null;
    let cur = units[0].id;
    for (const u of units) {
      if (scrollOffset >= u.startOffset) cur = u.id;
      else break;
    }
    return cur;
  }, [units, scrollOffset]);

  if (!units.length) {
    return (
      <aside
        className={`w-[140px] shrink-0 border-r border-border/60 bg-card/50 p-2 text-xs text-fog ${className}`}
      >
        <div className="font-medium text-muted-foreground mb-2">{title}</div>
        <p className="leading-relaxed">暂无单元。完成「形态/章法」或「时间线」分析后显示。</p>
      </aside>
    );
  }

  return (
    <aside
      className={`w-[160px] sm:w-[180px] shrink-0 border-r border-border/60 bg-card/40 overflow-y-auto custom-scrollbar ${className}`}
    >
      <div className="sticky top-0 z-10 px-2 py-2 text-xs font-semibold text-muted-foreground bg-card/90 border-b border-border/40">
        {title}
      </div>
      <div className="relative px-2 py-3">
        <div className="absolute left-[18px] top-3 bottom-3 w-px bg-border/80" />
        <ul className="space-y-0">
          {units.map((u) => {
            const active = u.id === activeId;
            const pending = u.status === "pending";
            const err = u.status === "error";
            return (
              <li key={u.id} className="relative pl-6 py-1.5">
                <span
                  className={`absolute left-[13px] top-2.5 w-2.5 h-2.5 rounded-full border ${
                    active
                      ? "bg-primary border-primary"
                      : pending
                        ? "bg-transparent border-primary/50 animate-pulse"
                        : err
                          ? "bg-red-500/80 border-red-500"
                          : "bg-panel-elevated border-border"
                  }`}
                />
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onJump(u.startOffset)}
                  className={`w-full text-left text-xs leading-snug rounded px-1 py-0.5 transition-colors ${
                    active
                      ? "text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  } disabled:opacity-50`}
                  title={u.summary || u.label}
                >
                  <span className="line-clamp-2">{u.label}</span>
                  {u.summary && (
                    <span className="block text-[10px] text-fog line-clamp-2 mt-0.5">
                      {u.summary}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}

/** Rough: map scrollTop ratio to char offset when heights are estimated. */
export function useApproxScrollOffset(
  scroller: React.RefObject<HTMLElement | null>,
  totalChars: number,
): number {
  const [off, setOff] = useState(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el || totalChars <= 0) return;
    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight;
      const ratio = max > 0 ? el.scrollTop / max : 0;
      setOff(Math.floor(ratio * totalChars));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [scroller, totalChars]);
  return off;
}
