"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { DEFAULT_ANALYSIS_MODULES, EXTRACT_MODULES, type ExtractModule } from "@/types";
import { notifyLibrariesRefresh } from "@/lib/library-events";

interface ExtractModulesPanelProps {
  novelId: string;
  novelText?: string;
  defaultModules?: ExtractModule[];
  onDone?: (data: any) => void;
  compact?: boolean;
}

export default function ExtractModulesPanel({
  novelId,
  novelText,
  defaultModules = DEFAULT_ANALYSIS_MODULES,
  onDone,
  compact,
}: ExtractModulesPanelProps) {
  const [selected, setSelected] = useState<Set<ExtractModule>>(new Set(defaultModules));
  const [forceRefresh, setForceRefresh] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastResult, setLastResult] = useState<string>("");

  const toggle = (id: ExtractModule) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const run = async () => {
    if (selected.size === 0) {
      setError("请至少选择一个模块");
      return;
    }
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
          modules: Array.from(selected),
          forceRefresh,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "分析失败");
      const ran = (data.ran || []).join("、") || "无";
      const skipped = (data.skipped || []).map((s: any) => `${s.module}(${s.reason})`).join("、");
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
      // Refresh global library sidebar (styles / ideas / novels) without full page reload
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
        <h3 className="text-sm font-semibold text-muted-foreground">
          分析
        </h3>
      </div>
      <p className="text-xs text-fog leading-relaxed">
        故事/角色/形态/时间线写入<strong className="text-muted-foreground font-normal">本书</strong>；
        文笔进<strong className="text-muted-foreground font-normal">文笔库</strong>（可跨书嫁接）；
        点子进<strong className="text-muted-foreground font-normal">点子库</strong>。
        时间线较慢，默认不勾。
      </p>
      <div className="space-y-2">
        {EXTRACT_MODULES.map(m => (
          <label
            key={m.id}
            className={`flex items-start gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
              selected.has(m.id) ? "bg-primary/10 border border-primary/20" : "hover:bg-panel-elevated border border-transparent"
            }`}
          >
            <input
              type="checkbox"
              checked={selected.has(m.id)}
              onChange={() => toggle(m.id)}
              className="mt-1 accent-primary"
            />
            <span className="min-w-0">
              <span className="text-sm text-foreground block">{m.label}</span>
              {!compact && (
                <span className="text-xs text-fog leading-relaxed">{m.hint}</span>
              )}
            </span>
          </label>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer px-1">
        <input type="checkbox" checked={forceRefresh} onChange={e => setForceRefresh(e.target.checked)} className="accent-primary" />
        强制重新提取（忽略缓存）
      </label>
      <button
        type="button"
        disabled={loading || selected.size === 0}
        onClick={run}
        className="btn-primary w-full disabled:bg-secondary disabled:text-fog disabled:hover:brightness-100"
      >
        {loading ? <><Loader2 className="w-4 h-4 animate-spin" />分析中…</> : "开始分析"}
      </button>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {lastResult && <p className="text-sm text-green-500/80">{lastResult}</p>}
    </div>
  );
}
