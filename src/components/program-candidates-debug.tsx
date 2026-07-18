"use client";

import { useState } from "react";
import { Loader2, ScanSearch, X } from "lucide-react";
import { isClientDebugMode } from "@/lib/debug-mode";

interface CandidateRow {
  name: string;
  score: number;
  count: number;
  speechHits: number;
  spanBuckets: number;
  sources: string[];
  evidence: string[];
}

/**
 * Debug-only: full-text program scan for character name candidates (no LLM).
 */
export default function ProgramCandidatesDebug({ novelId }: { novelId: string }) {
  const debugMode = isClientDebugMode();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ms, setMs] = useState(0);
  const [textLength, setTextLength] = useState(0);
  const [rows, setRows] = useState<CandidateRow[]>([]);

  if (!debugMode || !novelId) return null;

  const run = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/characters/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ novelId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "扫描失败");
      setRows(Array.isArray(data.candidates) ? data.candidates : []);
      setMs(Number(data.ms) || 0);
      setTextLength(Number(data.textLength) || 0);
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "扫描失败");
      setOpen(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        disabled={loading}
        onClick={run}
        className="inline-flex items-center gap-1.5 text-xs text-amber-500/90 hover:underline disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <ScanSearch className="w-3.5 h-3.5" />
        )}
        [debug·已废弃] 程序规则扫人名
      </button>
      {error && !open && <p className="text-xs text-red-400 mt-1">{error}</p>}

      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl border border-border bg-panel shadow-xl">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/60">
              <div>
                <p className="text-sm font-semibold text-foreground">程序人名候选</p>
                <p className="text-[11px] text-fog mt-0.5">
                  全书规则扫描 · 无 LLM · {rows.length} 个 · 文本{" "}
                  {(textLength / 1000).toFixed(0)}k 字 · {ms}ms
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg hover:bg-secondary text-fog"
                aria-label="关闭"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {error ? (
              <p className="p-4 text-sm text-red-400">{error}</p>
            ) : (
              <div className="overflow-y-auto flex-1 p-3 custom-scrollbar">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-panel text-fog">
                    <tr>
                      <th className="py-1.5 px-2 font-medium">#</th>
                      <th className="py-1.5 px-2 font-medium">名</th>
                      <th className="py-1.5 px-2 font-medium">分</th>
                      <th className="py-1.5 px-2 font-medium">次</th>
                      <th className="py-1.5 px-2 font-medium">言说</th>
                      <th className="py-1.5 px-2 font-medium">跨段</th>
                      <th className="py-1.5 px-2 font-medium">证据</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr
                        key={`${r.name}-${i}`}
                        className="border-t border-border/40 align-top"
                      >
                        <td className="py-1.5 px-2 text-fog">{i + 1}</td>
                        <td className="py-1.5 px-2 font-medium text-foreground whitespace-nowrap">
                          {r.name}
                        </td>
                        <td className="py-1.5 px-2 text-fog">{r.score}</td>
                        <td className="py-1.5 px-2 text-fog">{r.count}</td>
                        <td className="py-1.5 px-2 text-fog">{r.speechHits}</td>
                        <td className="py-1.5 px-2 text-fog">{r.spanBuckets}</td>
                        <td className="py-1.5 px-2 text-fog/90 leading-snug max-w-[14rem]">
                          {(r.evidence?.[0] || "").slice(0, 60)}
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-fog">
                          未扫到候选
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            <div className="px-4 py-2.5 border-t border-border/60 text-[11px] text-fog">
              正式角色抽取（Pass1）会把这份名单注入 LLM 裁定。可对比最终角色卡。
            </div>
          </div>
        </div>
      )}
    </>
  );
}
