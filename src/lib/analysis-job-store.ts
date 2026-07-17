/**
 * Cross-page / cross-novel in-flight analysis state.
 * Survives book switches (module Map) and soft reloads (sessionStorage).
 */

export type AnalysisJobStatus = "running" | "done" | "error";

export interface AnalysisJobState {
  novelId: string;
  status: AnalysisJobStatus;
  forceRefresh: boolean;
  message?: string;
  startedAt: number;
  finishedAt?: number;
}

type Listener = () => void;

const STORAGE_KEY = "ncs:analysis-jobs:v1";

const jobs = new Map<string, AnalysisJobState>();
const listeners = new Set<Listener>();
let hydrated = false;

function emit() {
  Array.from(listeners).forEach((l) => {
    try {
      l();
    } catch {
      /* ignore */
    }
  });
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    const obj: Record<string, AnalysisJobState> = {};
    jobs.forEach((v, k) => {
      obj[k] = v;
    });
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    /* quota / private mode */
  }
}

/**
 * Load once on client.
 * "running" is in-memory only (fetch dies on full reload) — never restore it from storage,
 * or a remount would incorrectly show 分析中 with no live request.
 * done/error banners may restore briefly after soft navigation.
 */
export function hydrateAnalysisJobs(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, AnalysisJobState>;
    for (const id of Object.keys(obj)) {
      const job = obj[id];
      if (!job?.novelId) continue;
      if (job.status === "running") {
        // Drop stale running from previous page life; live Map is source of truth mid-SPA.
        continue;
      }
      if (!jobs.has(id)) {
        jobs.set(id, job);
      }
    }
  } catch {
    /* ignore */
  }
}

export function subscribeAnalysisJobs(listener: Listener): () => void {
  if (typeof window !== "undefined") hydrateAnalysisJobs();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAnalysisJob(novelId: string): AnalysisJobState | null {
  if (typeof window !== "undefined") hydrateAnalysisJobs();
  if (!novelId) return null;
  return jobs.get(novelId) || null;
}

export function isAnalysisRunning(novelId: string): boolean {
  return getAnalysisJob(novelId)?.status === "running";
}

/** Other novels currently analyzing (not including the given id). */
export function listOtherRunningJobs(exceptNovelId?: string): AnalysisJobState[] {
  if (typeof window !== "undefined") hydrateAnalysisJobs();
  const out: AnalysisJobState[] = [];
  jobs.forEach((job) => {
    if (job.status === "running" && job.novelId !== exceptNovelId) {
      out.push(job);
    }
  });
  return out;
}

export function markAnalysisRunning(
  novelId: string,
  forceRefresh = false,
): void {
  if (!novelId) return;
  if (typeof window !== "undefined") hydrateAnalysisJobs();
  jobs.set(novelId, {
    novelId,
    status: "running",
    forceRefresh,
    startedAt: Date.now(),
    message: undefined,
  });
  persist();
  emit();
}

export function markAnalysisDone(novelId: string, message: string): void {
  if (!novelId) return;
  const prev = jobs.get(novelId);
  jobs.set(novelId, {
    novelId,
    status: "done",
    forceRefresh: prev?.forceRefresh ?? false,
    message,
    startedAt: prev?.startedAt ?? Date.now(),
    finishedAt: Date.now(),
  });
  persist();
  emit();
  // Clear success banner after a while so FAB returns to idle
  setTimeout(() => {
    const cur = jobs.get(novelId);
    if (cur?.status === "done") {
      jobs.delete(novelId);
      persist();
      emit();
    }
  }, 12_000);
}

export function markAnalysisError(novelId: string, message: string): void {
  if (!novelId) return;
  const prev = jobs.get(novelId);
  jobs.set(novelId, {
    novelId,
    status: "error",
    forceRefresh: prev?.forceRefresh ?? false,
    message,
    startedAt: prev?.startedAt ?? Date.now(),
    finishedAt: Date.now(),
  });
  persist();
  emit();
}

export function clearAnalysisJob(novelId: string): void {
  if (!novelId) return;
  if (jobs.delete(novelId)) {
    persist();
    emit();
  }
}
