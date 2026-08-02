/**
 * Server-owned agent run (OpenCode-style).
 *
 * The master tool loop lives on the process tied to an AgentRun id.
 * HTTP/SSE is only for start + subscribe to events — client disconnect
 * does not cancel the run (analysis mode). Explicit cancel does.
 */
import { randomUUID } from "node:crypto";

export type AgentRunStatus =
  | "running"
  | "awaiting_user"
  | "done"
  | "error"
  | "cancelled";

export type AgentRunMode = "analysis" | "write";

export interface AgentRunEvent {
  seq: number;
  ts: string;
  /** Same payload as SSE `data: {...}` objects */
  data: Record<string, unknown>;
}

export interface AgentRun {
  id: string;
  userId: string;
  novelId: string;
  branchId: string;
  mode: AgentRunMode;
  status: AgentRunStatus;
  events: AgentRunEvent[];
  error?: string;
  message?: string;
  createdAt: string;
  updatedAt: string;
  /** In-process cancel for this run (not request.signal) */
  abort: AbortController;
}

const EVENT_RING = 2000;

type GlobalStore = {
  runs: Map<string, AgentRun>;
};

function store(): GlobalStore {
  const g = globalThis as typeof globalThis & { __ncsAgentRuns?: GlobalStore };
  if (!g.__ncsAgentRuns) g.__ncsAgentRuns = { runs: new Map() };
  return g.__ncsAgentRuns;
}

export function createAgentRun(input: {
  userId: string;
  novelId: string;
  branchId: string;
  mode: AgentRunMode;
}): AgentRun {
  const id = `arun_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const now = new Date().toISOString();
  const run: AgentRun = {
    id,
    userId: input.userId || "guest",
    novelId: input.novelId,
    branchId: input.branchId || "main",
    mode: input.mode,
    status: "running",
    events: [],
    createdAt: now,
    updatedAt: now,
    abort: new AbortController(),
  };
  store().runs.set(id, run);
  console.log(
    `[agent-run] create ${id} mode=${run.mode} novel=${run.novelId}`,
  );
  return run;
}

export function getAgentRun(runId: string): AgentRun | null {
  return store().runs.get(runId) || null;
}

export function appendAgentRunEvent(
  runId: string,
  data: Record<string, unknown>,
): AgentRunEvent | null {
  const run = store().runs.get(runId);
  if (!run) return null;
  const last = run.events.length ? run.events[run.events.length - 1]!.seq : 0;
  const ev: AgentRunEvent = {
    seq: last + 1,
    ts: new Date().toISOString(),
    data: { ...data, runId },
  };
  run.events.push(ev);
  if (run.events.length > EVENT_RING) {
    run.events = run.events.slice(-EVENT_RING);
  }
  run.updatedAt = ev.ts;

  // Infer status from event types
  if (data.type === "ask_question") {
    run.status = "awaiting_user";
  } else if (data.type === "done" || data.type === "stopped") {
    if (run.status === "running") run.status = "done";
  } else if (data.type === "error") {
    run.status = "error";
    run.error = String(data.message || data.error || "error");
  }

  return ev;
}

export function getAgentRunEventsAfter(
  runId: string,
  afterSeq = 0,
): AgentRunEvent[] {
  const run = store().runs.get(runId);
  if (!run) return [];
  return run.events.filter((e) => e.seq > afterSeq);
}

export function setAgentRunStatus(
  runId: string,
  status: AgentRunStatus,
  extra?: { error?: string; message?: string },
): void {
  const run = store().runs.get(runId);
  if (!run) return;
  run.status = status;
  if (extra?.error !== undefined) run.error = extra.error;
  if (extra?.message !== undefined) run.message = extra.message;
  run.updatedAt = new Date().toISOString();
}

/** User/API cancel — aborts in-flight LLM tools that honor the signal */
export function cancelAgentRun(runId: string): boolean {
  const run = store().runs.get(runId);
  if (!run) return false;
  if (
    run.status === "done" ||
    run.status === "error" ||
    run.status === "cancelled"
  ) {
    return false;
  }
  try {
    run.abort.abort();
  } catch {
    /* ignore */
  }
  run.status = "cancelled";
  run.message = "已取消";
  run.updatedAt = new Date().toISOString();
  appendAgentRunEvent(runId, { type: "stopped", reason: "cancelled" });
  console.log(`[agent-run] cancel ${runId}`);
  return true;
}

export function isAgentRunActive(status: AgentRunStatus | undefined): boolean {
  return status === "running" || status === "awaiting_user";
}

/** Public DTO (no AbortController) */
export function agentRunToDto(run: AgentRun, afterSeq = 0) {
  return {
    id: run.id,
    userId: run.userId,
    novelId: run.novelId,
    branchId: run.branchId,
    mode: run.mode,
    status: run.status,
    error: run.error,
    message: run.message,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    events: getAgentRunEventsAfter(run.id, afterSeq).map((e) => ({
      seq: e.seq,
      ts: e.ts,
      ...e.data,
    })),
  };
}

export function listAgentRunsForNovel(
  userId: string,
  novelId: string,
  branchId = "main",
): AgentRun[] {
  return Array.from(store().runs.values())
    .filter(
      (r) =>
        r.userId === userId &&
        r.novelId === novelId &&
        (r.branchId || "main") === (branchId || "main"),
    )
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}
