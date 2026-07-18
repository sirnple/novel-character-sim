"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Users } from "lucide-react";
import { isClientDebugMode } from "@/lib/debug-mode";
import { notifyLibrariesRefresh } from "@/lib/library-events";
import type { CharacterProfile } from "@/types";

interface JobState {
  id: string;
  status: string;
  phase?: string;
  total?: number;
  completed?: number;
  message?: string;
  error?: string;
  characterCount?: number;
}

const RUNNING = new Set([
  "queued",
  "scanning",
  "clustering",
  "merging",
  "detail",
  "relationships",
]);

/**
 * Character unit-scan job progress + debug-only standalone re-extract.
 */
export default function CharacterJobStatus({
  novelId,
  onCharactersReady,
}: {
  novelId: string;
  onCharactersReady?: (characters?: CharacterProfile[]) => void;
}) {
  const debugMode = isClientDebugMode();
  const [job, setJob] = useState<JobState | null>(null);
  const [polling, setPolling] = useState(false);
  const [starting, setStarting] = useState(false);
  const [scanMsg, setScanMsg] = useState("");

  const refresh = useCallback(async (preferJobId?: string | null) => {
    if (!novelId) return null;
    try {
      // Prefer polling the specific job we started — avoids "latest" flipping
      // to an old interrupted row after server restart.
      if (preferJobId) {
        const res = await fetch(
          `/api/characters/job?jobId=${encodeURIComponent(preferJobId)}`,
        );
        if (res.ok) {
          const data = await res.json();
          const j = (data.job || null) as JobState | null;
          if (j) {
            setJob(j);
            return j;
          }
        }
      }
      const res = await fetch(
        `/api/characters/job?novelId=${encodeURIComponent(novelId)}`,
      );
      const data = await res.json();
      const latest = (data.latest || data.jobs?.[0] || null) as JobState | null;
      setJob(latest);
      return latest;
    } catch {
      return null;
    }
  }, [novelId]);

  const loadCharactersFromNovel = useCallback(async () => {
    if (!novelId) return;
    try {
      const res = await fetch(
        `/api/novels?id=${encodeURIComponent(novelId)}&meta=1`,
      );
      const data = await res.json();
      if (Array.isArray(data.characters)) {
        onCharactersReady?.(data.characters);
      } else {
        onCharactersReady?.();
      }
    } catch {
      onCharactersReady?.();
    }
  }, [novelId, onCharactersReady]);

  useEffect(() => {
    if (!novelId) return;
    void refresh();
  }, [novelId, refresh]);

  // Poll while running (by job id when available)
  useEffect(() => {
    if (!novelId || !job) return;
    if (!RUNNING.has(job.status)) return;

    const jobId = job.id;
    setPolling(true);
    const t = setInterval(async () => {
      const latest = await refresh(jobId);
      if (
        latest &&
        (latest.status === "done" ||
          latest.status === "error" ||
          latest.status === "cancelled")
      ) {
        setPolling(false);
        notifyLibrariesRefresh();
        if (latest.status === "done") {
          await loadCharactersFromNovel();
          setScanMsg(
            `完成 ${latest.characterCount ?? "?"} 人` +
              (latest.message ? ` · ${latest.message}` : ""),
          );
        } else if (latest.status === "error") {
          setScanMsg(latest.error || latest.message || "角色抽取失败");
        } else if (latest.status === "cancelled") {
          setScanMsg(latest.message || "已取消");
        }
      }
    }, 2000);
    return () => {
      clearInterval(t);
      setPolling(false);
    };
  }, [novelId, job?.status, job?.id, refresh, loadCharactersFromNovel]);

  const startStandalone = async () => {
    if (!novelId || starting || !debugMode) return;
    setStarting(true);
    setScanMsg("");
    try {
      const res = await fetch("/api/characters/job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          novelId,
          forceRefresh: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "启动失败");
      setJob(data.job || null);
      setScanMsg(
        data.message ||
          `已启动 · ${data.job?.total ?? "?"} 段（forceRefresh，忽略分段缓存）`,
      );
      // Immediate follow-up by jobId so UI does not latch onto old interrupted rows
      if (data.job?.id) {
        void refresh(data.job.id);
      }
    } catch (e) {
      setScanMsg(e instanceof Error ? e.message : "启动失败");
    } finally {
      setStarting(false);
    }
  };

  if (!novelId) return null;

  const running = !!(job && RUNNING.has(job.status)) || polling || starting;

  // Non-debug: only show when there is an active/finished job
  if (!debugMode && !job) return null;

  return (
    <div className="flex flex-col items-end gap-1 min-w-0">
      <div className="flex flex-wrap items-center justify-end gap-2 text-[11px]">
        {running ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
        ) : (
          <Users className="w-3.5 h-3.5 text-fog shrink-0" />
        )}
        {job ? (
          <span
            className={
              job.status === "error"
                ? "text-red-400"
                : job.status === "done"
                  ? "text-primary/90"
                  : "text-fog"
            }
          >
            {job.status === "done"
              ? `角色完成${job.characterCount != null ? ` · ${job.characterCount} 人` : ""}`
              : job.status === "error"
                ? `角色失败：${job.error || job.message || "未知错误"}`
                : job.message ||
                  `角色扫描 ${job.completed ?? 0}/${job.total ?? "?"} · ${job.phase || job.status}`}
          </span>
        ) : (
          debugMode && (
            <span className="text-fog">分段扫名 (Flash) · 可单独重抽</span>
          )
        )}
      </div>

      {debugMode && (
        <div className="flex flex-col items-end gap-0.5">
          <button
            type="button"
            disabled={running || !novelId}
            onClick={() => void startStandalone()}
            className="inline-flex items-center gap-1.5 text-xs text-amber-500/90 hover:underline disabled:opacity-50"
          >
            {starting || (job && RUNNING.has(job.status)) ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            [debug] 单独提取角色
          </button>
          {scanMsg && (
            <p className="text-[11px] text-fog text-right max-w-[16rem] leading-snug">
              {scanMsg}
            </p>
          )}
          {job?.id && (
            <span
              className="text-[10px] text-fog/60 font-mono truncate max-w-[12rem]"
              title={job.id}
            >
              {job.id}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
