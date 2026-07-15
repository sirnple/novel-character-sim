"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { EXTRACT_MODULES, type ExtractModule } from "@/types";
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
  defaultModules = ["story", "characters"],
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
      if (!res.ok) throw new Error(data.error || "拆解失败");
      const ran = (data.ran || []).join("、") || "无";
      const skipped = (data.skipped || []).map((s: any) => `${s.module}(${s.reason})`).join("、");
      setLastResult(`完成：${ran}${skipped ? `；跳过：${skipped}` : ""}`);
      // Refresh global library sidebar (styles / ideas / novels) without full page reload
      notifyLibrariesRefresh();
      onDone?.(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "拆解失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <div className="flex items-center gap-2">
        <Sparkles className="w-3.5 h-3.5 text-orange-500" />
        <h3 className="text-[10px] font-semibold text-neutral-400 font-mono uppercase tracking-widest">
          拆解模块
        </h3>
      </div>
      <div className="space-y-1.5">
        {EXTRACT_MODULES.map(m => (
          <label
            key={m.id}
            className={`flex items-start gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
              selected.has(m.id) ? "bg-orange-500/10 border border-orange-500/20" : "hover:bg-neutral-800/40 border border-transparent"
            }`}
          >
            <input
              type="checkbox"
              checked={selected.has(m.id)}
              onChange={() => toggle(m.id)}
              className="mt-0.5 accent-orange-500"
            />
            <span className="min-w-0">
              <span className="text-xs text-neutral-300 font-mono block">{m.label}</span>
              {!compact && (
                <span className="text-[10px] text-neutral-600 font-mono">{m.hint}</span>
              )}
            </span>
          </label>
        ))}
      </div>
      <label className="flex items-center gap-2 text-[10px] text-neutral-500 font-mono cursor-pointer px-1">
        <input type="checkbox" checked={forceRefresh} onChange={e => setForceRefresh(e.target.checked)} className="accent-orange-500" />
        强制重新提取（忽略缓存）
      </label>
      <button
        type="button"
        disabled={loading || selected.size === 0}
        onClick={run}
        className="w-full py-1.5 rounded text-xs font-mono bg-orange-600 hover:bg-orange-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white transition-colors flex items-center justify-center gap-1"
      >
        {loading ? <><Loader2 className="w-3 h-3 animate-spin" />拆解中…</> : "开始拆解"}
      </button>
      {error && <p className="text-[10px] text-red-400 font-mono">{error}</p>}
      {lastResult && <p className="text-[10px] text-green-500/80 font-mono">{lastResult}</p>}
    </div>
  );
}
