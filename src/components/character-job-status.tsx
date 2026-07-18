"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Users } from "lucide-react";
import { isClientDebugMode } from "@/lib/debug-mode";
import { notifyLibrariesRefresh } from "@/lib/library-events";

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

/**
 * Shows Flash unit-scan character job progress (product path).
 * Not the deprecated program/heuristic name scanner.
 */
export default function CharacterJobStatus({
  novelId,
  onCharactersReady,
}: {
  novelId: string;
  onCharactersReady?: () => void;
}) {
  const debugMode = isClientDebugMode();
  const [job, setJob] = useState<JobState | null>(null);
  const [polling, setPolling] = useState(false);

  const refresh = useCallback(async () => {
    if (!novelId) return;
    try {
      const res = await fetch(
        `/api/characters/job?novelId=${encodeURIComponent(novelId)}`,
      );
      const data = await res.json();
      const latest = data.latest || data.jobs?.[0] || null;
      setJob(latest);
      return latest as JobState | null;
    } catch {
      return null;
    }
  }, [novelId]);

  useEffect(() => {
    if (!novelId) return;
    void refresh();
  }, [novelId, refresh]);

  // Poll while running
  useEffect(() => {
    if (!novelId || !job) return;
    const running = [
      "queued",
      "scanning",
      "clustering",
      "merging",
      "detail",
      "relationships",
    ].includes(job.status);
    if (!running) return;

    setPolling(true);
    const t = setInterval(async () => {
      const latest = await refresh();
      if (
        latest &&
        (latest.status === "done" ||
          latest.status === "error" ||
          latest.status === "cancelled")
      ) {
        setPolling(false);
        notifyLibrariesRefresh();
        onCharactersReady?.();
      }
    }, 2000);
    return () => {
      clearInterval(t);
      setPolling(false);
    };
  }, [novelId, job?.status, job?.id, refresh, onCharactersReady]);

  if (!novelId) return null;

  const running =
    job &&
    ["queued", "scanning", "clustering", "merging", "detail", "relationships"].includes(
      job.status,
    );

  if (!job && !debugMode) return null;

  if (!job) {
    return (
      <p className="text-[11px] text-fog">
        角色：分析时后台「分段扫名」(Flash)，不是程序规则扫人名
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      {running || polling ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
      ) : (
        <Users className="w-3.5 h-3.5 text-fog shrink-0" />
      )}
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
      {debugMode && job.id && (
        <span className="text-fog/70 font-mono truncate max-w-[8rem]" title={job.id}>
          {job.id.slice(0, 14)}
        </span>
      )}
    </div>
  );
}
