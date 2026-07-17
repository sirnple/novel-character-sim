"use client";

/**
 * Floating analyze action — always visible on overview (no scroll to bottom).
 */
import { useState } from "react";
import { Loader2, Sparkles, RotateCcw, X } from "lucide-react";
import { ALL_ANALYSIS_MODULES } from "@/types";
import { notifyLibrariesRefresh } from "@/lib/library-events";

export interface AnalyzeFabProps {
  novelId: string;
  novelText?: string;
  /** Highlight when analysis incomplete */
  urgent?: boolean;
  onDone?: (data: any) => void;
}

export default function AnalyzeFab({
  novelId,
  novelText,
  urgent = false,
  onDone,
}: AnalyzeFabProps) {
  const [open, setOpen] = useState(false);
  const [forceRefresh, setForceRefresh] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastResult, setLastResult] = useState("");

  const run = async () => {
    setLoading(true);
    setError("");
    setLastResult("");
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          novelId,
          sessionId: novelId,
          text: novelText,
          modules: [...ALL_ANALYSIS_MODULES],
          forceRefresh,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "分析失败");
      const ran = (data.ran || []).join("、") || "无";
      const skipped = (data.skipped || [])
        .map((s: { module: string; reason: string }) => `${s.module}(${s.reason})`)
        .join("、");
      const formNote =
        data.form?.chaptering?.enabled
          ? ` · 已分章（约 ${data.chapterCatalogCount ?? "?"} 章）`
          : data.ran?.includes("form")
            ? " · 弱分章"
            : "";
      const tlNote = data.timelineJobId ? " · 时间线后台进行中" : "";
      setLastResult(`${ran}${skipped ? `；跳过 ${skipped}` : ""}${formNote}${tlNote}`);
      notifyLibrariesRefresh();
      onDone?.(data);
      // Keep sheet open briefly so user sees result; auto-close if ok
      if (!urgent) {
        setTimeout(() => setOpen(false), 1200);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "分析失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* FAB */}
      <div className="fixed bottom-6 right-4 sm:bottom-8 sm:right-8 z-40 flex flex-col items-end gap-2 pointer-events-none">
        {urgent && !loading && (
          <span className="pointer-events-none text-[11px] px-2.5 py-1 rounded-full bg-card border border-primary/30 text-primary shadow-lg">
            续写前请先分析
          </span>
        )}
        <button
          type="button"
          disabled={loading}
          onClick={() => (loading ? undefined : setOpen(true))}
          className={`pointer-events-auto inline-flex items-center gap-2 rounded-full px-5 py-3.5 text-sm font-semibold shadow-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-80 ${
            urgent
              ? "bg-primary text-primary-foreground hover:brightness-110 shadow-primary/30 animate-pulse"
              : "bg-primary text-primary-foreground hover:brightness-110 shadow-primary/25"
          } ${loading ? "animate-none cursor-wait" : ""}`}
          aria-label={loading ? "分析进行中" : "分析原著"}
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              分析中…
            </>
          ) : (
            <>
              <Sparkles className="w-5 h-5" />
              {urgent ? "开始分析" : "分析"}
            </>
          )}
        </button>
      </div>

      {/* Sheet */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
          <button
            type="button"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            aria-label="关闭"
            onClick={() => !loading && setOpen(false)}
          />
          <div className="ov-sheet relative z-10 w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="sm:hidden flex justify-center pt-2.5">
              <span className="w-10 h-1 rounded-full bg-border" />
            </div>
            <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-border/50">
              <div>
                <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  分析原著
                </h2>
                <p className="text-xs text-fog mt-1 leading-relaxed">
                  一键完成故事、角色、形态、文笔、点子、时间线。未分析前不可续写。
                </p>
              </div>
              <button
                type="button"
                disabled={loading}
                onClick={() => setOpen(false)}
                className="p-2 rounded-xl text-fog hover:text-foreground hover:bg-secondary"
                aria-label="关闭"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={forceRefresh}
                  onChange={(e) => setForceRefresh(e.target.checked)}
                  disabled={loading}
                  className="accent-primary"
                />
                <RotateCcw className="w-3.5 h-3.5" />
                忽略缓存，强制重跑
              </label>
              <button
                type="button"
                disabled={loading}
                onClick={run}
                className="btn-primary w-full py-3 text-base"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    分析中，请稍候…
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    开始分析
                  </>
                )}
              </button>
              {error && <p className="text-sm text-red-400">{error}</p>}
              {lastResult && !error && (
                <p className="text-xs text-primary/90 leading-relaxed">{lastResult}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
