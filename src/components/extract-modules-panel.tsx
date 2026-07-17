"use client";

import { useState } from "react";
import { Loader2, Sparkles, RotateCcw } from "lucide-react";
import { ALL_ANALYSIS_MODULES } from "@/types";
import { notifyLibrariesRefresh } from "@/lib/library-events";

interface ExtractModulesPanelProps {
  novelId: string;
  novelText?: string;
  onDone?: (data: any) => void;
  /** Dense toolbar style for overview dashboard */
  compact?: boolean;
  className?: string;
}

/**
 * One-click full analysis. No module checkboxes (ops later).
 */
export default function ExtractModulesPanel({
  novelId,
  novelText,
  onDone,
  compact = true,
  className = "",
}: ExtractModulesPanelProps) {
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "分析失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <Sparkles className="w-4 h-4 text-primary shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground leading-tight">原著分析</p>
            {!compact && (
              <p className="text-[11px] text-fog leading-snug mt-0.5">
                故事·角色·形态·文笔·点子·时间线一次跑完
              </p>
            )}
          </div>
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-fog cursor-pointer shrink-0 select-none">
          <input
            type="checkbox"
            checked={forceRefresh}
            onChange={(e) => setForceRefresh(e.target.checked)}
            className="accent-primary scale-90"
          />
          <RotateCcw className="w-3 h-3" />
          强制重跑
        </label>
        <button
          type="button"
          disabled={loading}
          onClick={run}
          className="btn-primary !px-4 !py-2 text-sm shrink-0 disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              分析中
            </>
          ) : (
            "开始分析"
          )}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {lastResult && !error && (
        <p className="text-[11px] text-primary/80 leading-snug line-clamp-2">{lastResult}</p>
      )}
    </div>
  );
}
