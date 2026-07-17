"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { ALL_ANALYSIS_MODULES, EXTRACT_MODULES } from "@/types";
import { notifyLibrariesRefresh } from "@/lib/library-events";

interface ExtractModulesPanelProps {
  novelId: string;
  novelText?: string;
  onDone?: (data: any) => void;
  compact?: boolean;
}

/**
 * One-click full analysis. Module pickers are deferred to ops/admin later.
 * Always runs ALL_ANALYSIS_MODULES (story/characters/form/style/ideas/timeline).
 */
export default function ExtractModulesPanel({
  novelId,
  novelText,
  onDone,
  compact,
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
          ? `；章法：已分章（目录约 ${data.chapterCatalogCount ?? "?"} 条）`
          : data.ran?.includes("form")
            ? "；章法：弱分章/不分章（保守）"
            : "";
      const tlNote = data.timelineJobId
        ? `；时间线已后台启动（任务 ${String(data.timelineJobId).slice(0, 12)}…，可在阅读页查看进度）`
        : "";
      setLastResult(`完成：${ran}${skipped ? `；跳过：${skipped}` : ""}${formNote}${tlNote}`);
      notifyLibrariesRefresh();
      onDone?.(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "分析失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <div className="flex items-center gap-2">
        <Sparkles className="w-3.5 h-3.5 text-primary" />
        <h3 className="text-sm font-semibold text-muted-foreground">分析</h3>
      </div>
      <p className="text-xs text-fog leading-relaxed">
        一键分析全部模块：故事/角色/形态/文笔/点子/时间线。
        本书资料留在书内；文笔进文笔库（可嫁接），点子进点子库。时间线在后台异步跑。
      </p>
      {!compact && (
        <ul className="text-xs text-muted-foreground space-y-1 px-1">
          {EXTRACT_MODULES.map((m) => (
            <li key={m.id} className="leading-relaxed">
              <span className="text-foreground/90">{m.label}</span>
              <span className="text-fog"> — {m.hint}</span>
            </li>
          ))}
        </ul>
      )}
      <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer px-1">
        <input
          type="checkbox"
          checked={forceRefresh}
          onChange={(e) => setForceRefresh(e.target.checked)}
          className="accent-primary"
        />
        强制重新提取（忽略缓存）
      </label>
      <button
        type="button"
        disabled={loading}
        onClick={run}
        className="btn-primary w-full disabled:bg-secondary disabled:text-fog disabled:hover:brightness-100"
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            分析中…
          </>
        ) : (
          "开始分析"
        )}
      </button>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {lastResult && <p className="text-sm text-green-500/80">{lastResult}</p>}
    </div>
  );
}
