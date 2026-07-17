/**
 * Cross-page / cross-novel in-flight analysis state.
 * Survives switching books so FAB doesn't reset while a job still runs.
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

const jobs = new Map<string, AnalysisJobState>();
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* ignore */
    }
  }
}

export function subscribeAnalysisJobs(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAnalysisJob(novelId: string): AnalysisJobState | null {
  if (!novelId) return null;
  return jobs.get(novelId) || null;
}

export function isAnalysisRunning(novelId: string): boolean {
  return getAnalysisJob(novelId)?.status === "running";
}

export function markAnalysisRunning(
  novelId: string,
  forceRefresh = false,
): void {
  if (!novelId) return;
  jobs.set(novelId, {
    novelId,
    status: "running",
    forceRefresh,
    startedAt: Date.now(),
    message: undefined,
  });
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
  emit();
  // Clear success banner after a while so FAB returns to idle
  setTimeout(() => {
    const cur = jobs.get(novelId);
    if (cur?.status === "done") {
      jobs.delete(novelId);
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
  emit();
}

export function clearAnalysisJob(novelId: string): void {
  if (!novelId) return;
  if (jobs.delete(novelId)) emit();
}
