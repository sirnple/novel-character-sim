"use client";

/**
 * Floating analyze action — non-blocking; per-novel running state survives book switches.
 * Prefer mounting in novel layout with URL param id (not context) so switch-back restores UI.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Sparkles, RotateCcw, X } from "lucide-react";
import { ALL_ANALYSIS_MODULES } from "@/types";
import {
  notifyLibrariesRefresh,
  notifyTimelineJob,
} from "@/lib/library-events";
import {
  clearAnalysisJob,
  getAnalysisJob,
  listOtherRunningJobs,
  markAnalysisDone,
  markAnalysisError,
  markAnalysisRunning,
  subscribeAnalysisJobs,
  type AnalysisJobState,
} from "@/lib/analysis-job-store";

export interface AnalyzeFabProps {
  novelId: string;
  novelText?: string;
  /** Highlight when analysis incomplete */
  urgent?: boolean;
  /** Called only when still viewing the same novel when job finishes */
  onDone?: (data: any) => void;
  onError?: (message: string) => void;
}

export default function AnalyzeFab({
  novelId,
  novelText,
  urgent = false,
  onDone,
  onError,
}: AnalyzeFabProps) {
  const [open, setOpen] = useState(false);
  const [forceRefresh, setForceRefresh] = useState(false);
  const [job, setJob] = useState<AnalysisJobState | null>(null);
  const [otherRunning, setOtherRunning] = useState(0);

  const novelIdRef = useRef(novelId);
  const onDoneRef = useRef(onDone);
  const onErrorRef = useRef(onError);
  novelIdRef.current = novelId;
  onDoneRef.current = onDone;
  onErrorRef.current = onError;

  // Sync with global store when novel changes or jobs update
  useEffect(() => {
    if (!novelId) {
      setJob(null);
      setOtherRunning(0);
      return;
    }
    const sync = () => {
      setJob(getAnalysisJob(novelId));
      setOtherRunning(listOtherRunningJobs(novelId).length);
    };
    sync();
    setOpen(false);
    return subscribeAnalysisJobs(sync);
  }, [novelId]);

  const loading = job?.status === "running";
  const error = job?.status === "error" ? job.message || "分析失败" : "";
  const lastResult = job?.status === "done" ? job.message || "" : "";

  const run = useCallback(async () => {
    if (!novelId || loading) return;
    const targetNovelId = novelId;
    const fr = forceRefresh;
    // Capture text at start; layout may pass empty (API loads from DB by novelId)
    const textSnapshot = novelText;
    markAnalysisRunning(targetNovelId, fr);
    setOpen(false);

    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          novelId: targetNovelId,
          sessionId: targetNovelId,
          text: textSnapshot || undefined,
          modules: [...ALL_ANALYSIS_MODULES],
          forceRefresh: fr,
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
          ? ` · 目录 ${data.chapterCatalogCount ?? "?"} 条`
          : data.ran?.includes("form")
            ? " · 未提取到目录"
            : "";
      const tlNote = data.timelineJobId ? " · 时间线后台进行中" : "";
      const charNote = data.characterJobId
        ? " · 角色分段扫描后台进行中"
        : "";
      const msg = `${ran}${skipped ? `；跳过 ${skipped}` : ""}${formNote}${tlNote}${charNote}`;

      markAnalysisDone(targetNovelId, msg);
      notifyLibrariesRefresh();
      if (data.timelineJobId) {
        notifyTimelineJob({
          novelId: targetNovelId,
          jobId: String(data.timelineJobId),
          branchId: "main",
        });
      }
      // Poll character job until done so overview can refresh cards
      if (data.characterJobId) {
        const cj = String(data.characterJobId);
        void (async () => {
          for (let i = 0; i < 600; i++) {
            await new Promise((r) => setTimeout(r, 2000));
            try {
              const r = await fetch(
                `/api/characters/job?jobId=${encodeURIComponent(cj)}`,
              );
              const d = await r.json();
              const st = d.job?.status;
              if (st === "done" || st === "error" || st === "cancelled") {
                notifyLibrariesRefresh();
                if (novelIdRef.current === targetNovelId && d.characters) {
                  onDoneRef.current?.({
                    ...data,
                    characters: d.characters,
                    characterJobId: cj,
                    characterJob: d.job,
                  });
                }
                break;
              }
            } catch {
              /* ignore poll errors */
            }
          }
        })();
      }
      // Only refresh page state if still on this novel (avoid hijacking other book)
      if (novelIdRef.current === targetNovelId) {
        onDoneRef.current?.(data);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "分析失败";
      markAnalysisError(targetNovelId, msg);
      if (novelIdRef.current === targetNovelId) {
        onErrorRef.current?.(msg);
      }
    }
  }, [novelId, novelText, forceRefresh, loading]);

  if (!novelId) return null;

  return (
    <>
      <div className="fixed bottom-6 right-4 sm:bottom-8 sm:right-8 z-40 flex flex-col items-end gap-2 pointer-events-none">
        {loading && (
          <span className="pointer-events-none text-[11px] px-2.5 py-1 rounded-full bg-card border border-border text-muted-foreground shadow-lg">
            本书分析中 · 可切换其他书
          </span>
        )}
        {!loading && otherRunning > 0 && (
          <span className="pointer-events-none text-[11px] px-2.5 py-1 rounded-full bg-card border border-border text-muted-foreground shadow-lg">
            另有 {otherRunning} 本书分析中
          </span>
        )}
        {urgent && !loading && (
          <span className="pointer-events-none text-[11px] px-2.5 py-1 rounded-full bg-card border border-primary/30 text-primary shadow-lg">
            续写前请先分析
          </span>
        )}
        {lastResult && !loading && !error && !open && (
          <span className="pointer-events-none text-[11px] px-2.5 py-1 rounded-full bg-card border border-primary/20 text-primary/90 shadow-lg max-w-[14rem] line-clamp-2">
            已完成：{lastResult}
          </span>
        )}
        {error && !loading && !open && (
          <span className="pointer-events-none text-[11px] px-2.5 py-1 rounded-full bg-card border border-red-500/40 text-red-400 shadow-lg max-w-[14rem] line-clamp-2">
            失败：{error}
          </span>
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`pointer-events-auto inline-flex items-center gap-2 rounded-full px-5 py-3.5 text-sm font-semibold shadow-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            loading
              ? "bg-primary/90 text-primary-foreground"
              : urgent
                ? "bg-primary text-primary-foreground hover:brightness-110 shadow-primary/30"
                : "bg-primary text-primary-foreground hover:brightness-110 shadow-primary/25"
          }`}
          aria-label={loading ? "分析进行中，点击查看" : "分析原著"}
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

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
          <button
            type="button"
            className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"
            aria-label="关闭"
            onClick={() => setOpen(false)}
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
                  开始后可关闭面板、切换书籍；每本书的进度独立保存，回到本书仍显示「分析中」。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-2 rounded-xl text-fog hover:text-foreground hover:bg-secondary"
                aria-label="关闭"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              {loading ? (
                <div className="rounded-xl bg-secondary/50 border border-border/50 px-4 py-5 text-center space-y-2">
                  <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
                  <p className="text-sm text-foreground font-medium">本书分析进行中</p>
                  <p className="text-xs text-fog">
                    可关闭并打开其他已分析的书。回到本书时仍会显示「分析中」。
                  </p>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="mt-2 text-sm text-primary hover:underline"
                  >
                    关闭并继续其他操作
                  </button>
                </div>
              ) : (
                <>
                  <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={forceRefresh}
                      onChange={(e) => setForceRefresh(e.target.checked)}
                      className="accent-primary"
                    />
                    <RotateCcw className="w-3.5 h-3.5" />
                    忽略缓存，强制重跑
                  </label>
                  <button
                    type="button"
                    onClick={run}
                    className="btn-primary w-full py-3 text-base"
                  >
                    <Sparkles className="w-5 h-5" />
                    {error ? "重试分析" : "开始分析"}
                  </button>
                </>
              )}
              {error && (
                <div className="space-y-1">
                  <p className="text-sm text-red-400">{error}</p>
                  <button
                    type="button"
                    className="text-xs text-fog hover:text-foreground underline"
                    onClick={() => clearAnalysisJob(novelId)}
                  >
                    清除错误提示
                  </button>
                </div>
              )}
              {lastResult && !error && (
                <p className="text-xs text-primary/90 leading-relaxed">{lastResult}</p>
              )}
              {!loading && otherRunning > 0 && (
                <p className="text-xs text-fog">
                  另有 {otherRunning} 本书仍在后台分析；切回该书可查看进度。
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
