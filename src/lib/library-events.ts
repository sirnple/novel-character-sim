/** Fired when style/idea/novel libraries should re-fetch (e.g. after modular extract). */
export const LIBRARIES_REFRESH_EVENT = "libraries:refresh";

export function notifyLibrariesRefresh(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LIBRARIES_REFRESH_EVENT));
}

/** Fired when an async timeline job is started (full analysis or force re-run). */
export const TIMELINE_JOB_EVENT = "timeline:job";

export function notifyTimelineJob(detail: {
  novelId: string;
  jobId: string;
  branchId?: string;
}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TIMELINE_JOB_EVENT, { detail }));
}
