"use client";

/**
 * Overview card: show chapter timeline + poll async jobs + debug force re-run.
 * Careful with effect deps — avoid setState loops (Maximum update depth exceeded).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Clock, Loader2, RefreshCw } from "lucide-react";
import type { ChapterTimeline } from "@/types";
import OverviewDetailSheet from "@/components/overview-detail-sheet";
import { isClientDebugMode } from "@/lib/debug-mode";
import {
  LIBRARIES_REFRESH_EVENT,
  TIMELINE_JOB_EVENT,
} from "@/lib/library-events";

interface TimelineSummaryCardProps {
  novelId: string;
  branchId?: string;
  timeline: ChapterTimeline | null | undefined;
  refreshKey?: number | string;
  className?: string;
  onTimelineChange?: (timeline: ChapterTimeline | null) => void;
}

function chapterCountOf(tl: ChapterTimeline | null | undefined): number {
  if (!tl) return 0;
  return tl.chapters?.length || tl.totalChapters || 0;
}

export default function TimelineSummaryCard({
  novelId,
  branchId = "main",
  timeline: timelineProp,
  refreshKey = 0,
  className = "",
  onTimelineChange,
}: TimelineSummaryCardProps) {
  const [open, setOpen] = useState(false);
  const [timeline, setTimeline] = useState<ChapterTimeline | null>(() =>
    timelineProp && chapterCountOf(timelineProp) > 0 ? timelineProp : null,
  );
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState("");
  const [jobError, setJobError] = useState("");
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState("");
  const debugMode = isClientDebugMode();

  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;

  const onChangeRef = useRef(onTimelineChange);
  onChangeRef.current = onTimelineChange;

  const aliveRef = useRef(true);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const followingRef = useRef(false);
  const novelIdRef = useRef(novelId);
  const branchIdRef = useRef(branchId);
  novelIdRef.current = novelId;
  branchIdRef.current = branchId;

  const clearPollTimer = () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  /** Merge remote timeline into local state without clobbering better data. */
  const applyRemote = useCallback(
    (tl: ChapterTimeline | null, opts?: { allowEmpty?: boolean }) => {
      const nextN = chapterCountOf(tl);
      const prevN = chapterCountOf(timelineRef.current);

      if (nextN > 0) {
        // Prefer richer payload
        if (nextN >= prevN || opts?.allowEmpty) {
          timelineRef.current = tl;
          setTimeline(tl);
          onChangeRef.current?.(tl);
        }
        return timelineRef.current;
      }

      if (opts?.allowEmpty) {
        timelineRef.current = null;
        setTimeline(null);
        onChangeRef.current?.(null);
        return null;
      }

      // Keep previous non-empty
      return timelineRef.current;
    },
    [],
  );

  // Adopt parent prop only when it adds data (never wipe with null)
  useEffect(() => {
    const nextN = chapterCountOf(timelineProp);
    if (nextN <= 0) return;
    const prevN = chapterCountOf(timelineRef.current);
    if (nextN < prevN) return;
    // Same count: only update if reference meaningfully differs (avoid loop)
    const prev = timelineRef.current;
    if (
      prev &&
      prev.chapters?.length === timelineProp?.chapters?.length &&
      prev.totalChapters === timelineProp?.totalChapters
    ) {
      // shallow equal-ish — skip setState
      return;
    }
    timelineRef.current = timelineProp || null;
    setTimeline(timelineProp || null);
    // Do NOT call onChange here — parent already owns this prop; calling setTimeline
    // on parent would re-render and re-trigger this effect infinitely.
  }, [timelineProp]);

  const reloadTimeline = useCallback(
    async (opts?: { allowEmpty?: boolean }) => {
      const nid = novelIdRef.current;
      const bid = branchIdRef.current;
      if (!nid) return null;
      try {
        const res = await fetch(
          `/api/novels?id=${encodeURIComponent(nid)}&meta=1&branchId=${encodeURIComponent(bid)}`,
        );
        const data = await res.json();
        const tl = (data.timeline as ChapterTimeline) || null;
        return applyRemote(tl, opts);
      } catch {
        return null;
      }
    },
    [applyRemote],
  );

  const followJobs = useCallback(async () => {
    if (!novelIdRef.current || followingRef.current) return;
    followingRef.current = true;

    const tick = async () => {
      if (!aliveRef.current) {
        followingRef.current = false;
        return;
      }
      const nid = novelIdRef.current;
      const bid = branchIdRef.current;
      try {
        const res = await fetch(
          `/api/timeline/job?novelId=${encodeURIComponent(nid)}&branchId=${encodeURIComponent(bid)}`,
        );
        if (!res.ok) {
          followingRef.current = false;
          setRunning(false);
          return;
        }
        const data = await res.json();
        const job = data.latest;
        if (!job) {
          followingRef.current = false;
          setRunning(false);
          setJobStatus(null);
          setJobProgress("");
          await reloadTimeline();
          return;
        }

        setJobStatus(job.status || null);
        setJobProgress(
          job.total != null ? `${job.completed ?? 0}/${job.total}` : "",
        );
        const unitErr = (job.units || [])
          .filter((u: { status?: string }) => u.status === "error")
          .map((u: { error?: string; label?: string }) => u.error || u.label)
          .filter(Boolean)
          .slice(0, 2)
          .join("；");
        setJobError(job.error || unitErr || "");

        const active =
          job.status === "running" ||
          job.status === "queued" ||
          (Array.isArray(job.units) &&
            job.units.some(
              (u: { status?: string }) =>
                u.status === "running" || u.status === "pending",
            ));

        await reloadTimeline();

        if (active) {
          setRunning(true);
          pollTimerRef.current = setTimeout(tick, 2500);
        } else {
          setRunning(false);
          followingRef.current = false;
          await reloadTimeline();
          if (job.status === "done") {
            setMsg(
              unitErr
                ? `完成，但部分单元失败：${unitErr}`
                : "时间线已更新",
            );
          } else if (job.status === "error") {
            setMsg(job.error || "时间线任务失败");
          }
        }
      } catch {
        if (aliveRef.current) {
          pollTimerRef.current = setTimeout(tick, 3000);
        } else {
          followingRef.current = false;
        }
      }
    };

    await tick();
  }, [reloadTimeline]);

  // Mount / novel change only
  useEffect(() => {
    aliveRef.current = true;
    followingRef.current = false;
    clearPollTimer();
    void (async () => {
      await reloadTimeline();
      await followJobs();
    })();
    return () => {
      aliveRef.current = false;
      followingRef.current = false;
      clearPollTimer();
    };
  }, [novelId, branchId, reloadTimeline, followJobs]);

  // Soft refresh after analysis — delayed pulls, don't restart identity effect
  useEffect(() => {
    if (!novelId) return;
    void reloadTimeline();
    if (!followingRef.current) {
      void followJobs();
    }
    const t1 = window.setTimeout(() => void reloadTimeline(), 4000);
    const t2 = window.setTimeout(() => {
      void reloadTimeline();
      if (!followingRef.current) void followJobs();
    }, 12000);
    const t3 = window.setTimeout(() => void reloadTimeline(), 30000);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [refreshKey, novelId, reloadTimeline, followJobs]);

  useEffect(() => {
    const onLib = () => {
      void reloadTimeline();
      if (!followingRef.current) void followJobs();
    };
    const onJob = (ev: Event) => {
      const d = (ev as CustomEvent).detail as {
        novelId?: string;
        branchId?: string;
      };
      if (d?.novelId && d.novelId !== novelIdRef.current) return;
      if (d?.branchId && d.branchId !== branchIdRef.current) return;
      setRunning(true);
      setMsg("时间线后台分析中…");
      followingRef.current = false;
      clearPollTimer();
      void followJobs();
    };
    window.addEventListener(LIBRARIES_REFRESH_EVENT, onLib);
    window.addEventListener(TIMELINE_JOB_EVENT, onJob);
    return () => {
      window.removeEventListener(LIBRARIES_REFRESH_EVENT, onLib);
      window.removeEventListener(TIMELINE_JOB_EVENT, onJob);
    };
  }, [reloadTimeline, followJobs]);

  const forceRerun = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!novelId || !debugMode || running) return;
    setRunning(true);
    setMsg("");
    setJobError("");
    try {
      const res = await fetch("/api/timeline/job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ novelId, branchId, force: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "启动失败");
      setJobStatus(data.job?.status || "queued");
      setJobProgress(data.job?.total != null ? `0/${data.job.total}` : "");
      setMsg(
        data.message ||
          `已启动（${data.job?.total ?? "?"} 个单元，每单元约 2 次 LLM）`,
      );
      applyRemote(null, { allowEmpty: true });
      followingRef.current = false;
      clearPollTimer();
      void followJobs();
    } catch (err) {
      setRunning(false);
      setMsg(err instanceof Error ? err.message : "启动失败");
    }
  };

  const chapters = timeline?.chapters || [];
  const chapterCount = timeline?.totalChapters || chapters.length;
  const eventCount = chapters.reduce(
    (n, c) => n + (c.events?.length || 0),
    0,
  );

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
              <Clock className="w-5 h-5 text-primary" />
            </span>
            <div className="text-left">
              <p className="text-sm font-semibold text-foreground">时间线</p>
              <p className="text-xs text-fog mt-0.5">
                {running ? "后台分析中" : "主线进度"}
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-0.5 text-xs text-fog group-hover:text-primary">
            详情 <ChevronRight className="w-3.5 h-3.5" />
          </span>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {chapterCount > 0 ? (
            <span className="ov-chip-ok">{chapterCount} 章快照</span>
          ) : (
            <span className="ov-chip-empty">未提取</span>
          )}
          {eventCount > 0 && (
            <span className="ov-chip-muted">{eventCount} 事件</span>
          )}
          {running && (
            <span className="ov-chip-muted inline-flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              {jobProgress || "分析中"}
            </span>
          )}
        </div>

        {chapters.length > 0 ? (
          <div className="mt-auto space-y-1.5 text-left">
            {chapters.slice(0, 3).map((c) => (
              <p
                key={c.chapterNumber}
                className="text-xs text-muted-foreground line-clamp-1"
              >
                <span className="text-fog">第{c.chapterNumber}章</span>{" "}
                {c.title || c.events?.[0]?.title || "—"}
              </p>
            ))}
            {chapters.length > 3 && (
              <p className="text-[11px] text-fog">还有 {chapters.length - 3} 章…</p>
            )}
          </div>
        ) : (
          <p className="mt-auto text-sm text-fog text-left leading-relaxed">
            {running
              ? `按目录切单元，进度 ${jobProgress || "…"}，完成后自动刷新。`
              : jobError
                ? `上次任务有错误：${jobError.slice(0, 60)}`
                : "完整分析会后台跑时间线（较慢）。完成后这里自动更新，无需手动刷新。"}
          </p>
        )}
      </button>

      <OverviewDetailSheet
        open={open}
        onClose={() => setOpen(false)}
        title="时间线"
        subtitle={
          running
            ? `分析中 ${jobProgress || ""}`
            : chapterCount > 0
              ? `${chapterCount} 章 · ${eventCount} 事件`
              : "尚未提取"
        }
        wide
      >
        <div className="rounded-xl border border-border/50 bg-secondary/30 px-3 py-3 mb-4 text-xs text-muted-foreground leading-relaxed space-y-1">
          <p>
            时间线是<strong className="text-foreground/80">异步任务</strong>
            ：点「分析」返回后，故事/角色可能已出，时间线仍在后台按目录逐段调用
            LLM。
          </p>
          <p>跑完后本卡片会自动刷新；若仍为空可等半分钟或硬刷新一次。</p>
          {(jobStatus || jobProgress) && (
            <p className="text-fog">
              最近任务：{jobStatus}
              {jobProgress ? ` · ${jobProgress}` : ""}
              {jobError ? ` · ${jobError}` : ""}
            </p>
          )}
          {msg && <p className="text-primary/90">{msg}</p>}
        </div>

        {debugMode && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-3 mb-4 space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-amber-500/80 font-medium">
              Debug only
            </p>
            <button
              type="button"
              disabled={running || !novelId}
              onClick={forceRerun}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl bg-secondary border border-border/50 text-foreground hover:bg-panel-elevated disabled:opacity-50"
            >
              {running ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              强制重跑时间线
            </button>
          </div>
        )}

        {chapters.length === 0 ? (
          <p className="text-sm text-fog leading-relaxed">
            {running
              ? "单元完成后会逐步写入…"
              : "暂无数据。请使用概览「分析」并稍等后台完成。"}
          </p>
        ) : (
          <ul className="space-y-4">
            {chapters.map((ch) => (
              <li
                key={ch.chapterNumber}
                className="rounded-xl border border-border/50 bg-secondary/30 overflow-hidden"
              >
                <div className="px-3.5 py-2.5 border-b border-border/40">
                  <p className="text-sm font-medium text-foreground">
                    第{ch.chapterNumber}章
                    {ch.title ? (
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        · {ch.title}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-[11px] text-fog mt-0.5">
                    {(ch.events || []).length} 事件
                  </p>
                </div>
                {(ch.events || []).length > 0 ? (
                  <ol className="divide-y divide-border/30">
                    {(ch.events || []).slice(0, 12).map((ev, i) => (
                      <li key={ev.id || i} className="px-3.5 py-2.5">
                        <p className="text-xs font-medium text-foreground/90">
                          {ev.title || `事件 ${ev.sequence || i + 1}`}
                        </p>
                        {ev.description && (
                          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed line-clamp-3">
                            {ev.description}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="px-3.5 py-3 text-xs text-fog">本章暂无事件摘要</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </OverviewDetailSheet>
    </>
  );
}
