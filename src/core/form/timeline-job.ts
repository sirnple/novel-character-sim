/**
 * Async full timeline analysis by narrative unit.
 * Progressive save so UI can poll and display a vertical rail mid-run.
 * Job status is durable in SQLite; in-memory holds the active runner.
 */
import { randomUUID } from "node:crypto";
import type {
  ChapterSnapshot,
  ChapterTimeline,
  CharacterChapterState,
  NarrativeUnit,
} from "@/types";
import { createLLMProvider } from "@/core/llm/factory";
import { TimelineExtractor } from "@/core/extractor/timeline-extractor";
import { parseNovel } from "@/core/parser/novel-parser";
import {
  getBranchChapterMeta,
  getBranchProse,
  getChapterStates,
  getCharacters,
  getNovelForm,
  getTimeline,
  getTimelineJobRow,
  listTimelineJobRows,
  saveChapterStates,
  saveTimeline,
  saveTimelineJobRow,
} from "@/lib/db";
import { segmentNarrativeUnits } from "./segment-units";
import { runWithTokenContext } from "@/lib/token-usage-context";

export type TimelineJobStatus = "queued" | "running" | "done" | "error" | "cancelled";

export interface TimelineJobUnit {
  unitId: string;
  label: string;
  startOffset: number;
  endOffset: number;
  status: "pending" | "running" | "done" | "error";
  summary?: string;
  error?: string;
}

export interface TimelineJob {
  id: string;
  userId: string;
  novelId: string;
  branchId: string;
  status: TimelineJobStatus;
  total: number;
  completed: number;
  units: TimelineJobUnit[];
  error?: string;
  createdAt: string;
  updatedAt: string;
}

type GlobalStore = {
  jobs: Map<string, TimelineJob>;
  snapshots: Map<string, ChapterSnapshot[]>;
  prevStates: Map<string, CharacterChapterState[]>;
  seq: Map<string, number>;
};

function store(): GlobalStore {
  const g = globalThis as typeof globalThis & { __ncsTimelineJobs?: GlobalStore };
  if (!g.__ncsTimelineJobs) {
    g.__ncsTimelineJobs = {
      jobs: new Map(),
      snapshots: new Map(),
      prevStates: new Map(),
      seq: new Map(),
    };
  }
  return g.__ncsTimelineJobs;
}

/** After process restart, in-flight jobs cannot continue — mark error. */
export function normalizeJobAfterHydrate(job: TimelineJob): TimelineJob {
  if (job.status === "running" || job.status === "queued") {
    return {
      ...job,
      status: "error",
      error: job.error || "进程已重启，请重新分析时间线",
      updatedAt: new Date().toISOString(),
    };
  }
  return job;
}

function asTimelineJob(raw: unknown): TimelineJob | null {
  if (!raw || typeof raw !== "object") return null;
  const j = raw as TimelineJob;
  if (!j.id || !j.userId || !j.novelId) return null;
  return j;
}

function touch(job: TimelineJob) {
  job.updatedAt = new Date().toISOString();
  try {
    saveTimelineJobRow(job);
  } catch (e) {
    console.warn("[timeline-job] persist failed:", (e as Error).message);
  }
}

export function getTimelineJob(jobId: string): TimelineJob | null {
  const mem = store().jobs.get(jobId);
  if (mem) return mem;

  const row = getTimelineJobRow(jobId);
  const parsed = asTimelineJob(row);
  if (!parsed) return null;

  const normalized = normalizeJobAfterHydrate(parsed);
  if (normalized.status !== parsed.status) {
    try {
      saveTimelineJobRow(normalized);
    } catch {
      /* ignore */
    }
  }
  // Do not put dead jobs into active runner maps
  return normalized;
}

export function listTimelineJobsForNovel(
  userId: string,
  novelId: string,
  branchId = "main",
): TimelineJob[] {
  const byId = new Map<string, TimelineJob>();

  for (const j of Array.from(store().jobs.values())) {
    if (j.userId === userId && j.novelId === novelId && j.branchId === branchId) {
      byId.set(j.id, j);
    }
  }

  for (const row of listTimelineJobRows(userId, novelId, branchId)) {
    const parsed = asTimelineJob(row);
    if (!parsed) continue;
    const existing = byId.get(parsed.id);
    if (!existing) {
      byId.set(parsed.id, normalizeJobAfterHydrate(parsed));
    } else if ((parsed.updatedAt || "") > (existing.updatedAt || "")) {
      // Prefer fresher memory; keep memory if newer
    }
  }

  return Array.from(byId.values()).sort((a, b) =>
    (a.updatedAt || a.createdAt) < (b.updatedAt || b.createdAt) ? 1 : -1,
  );
}

function buildUnits(
  userId: string,
  novelId: string,
  branchId: string,
  text: string,
): NarrativeUnit[] {
  const form = getNovelForm(userId, novelId);
  const meta = getBranchChapterMeta(userId, novelId, branchId);
  if (form?.chaptering?.enabled && meta.chapters.length > 0) {
    return meta.chapters.map((c, i) => ({
      unitId: c.id || `ch_${i}_${c.startOffset}`,
      unitKind: "chapter" as const,
      startOffset: c.startOffset,
      endOffset: c.endOffset ?? text.length,
      label:
        c.number != null
          ? `第${c.number}章 ${c.title}`
          : c.title || `章节 ${i + 1}`,
    }));
  }
  return segmentNarrativeUnits(text);
}

/**
 * Start async timeline job. Returns immediately with job id.
 */
export function startTimelineJob(input: {
  userId: string;
  novelId: string;
  branchId?: string;
}): TimelineJob {
  const branchId = input.branchId || "main";
  const { text } = getBranchProse(input.userId, input.novelId, branchId);
  if (!text?.trim()) {
    throw new Error("分支正文为空，无法分析时间线");
  }

  const units = buildUnits(input.userId, input.novelId, branchId, text);
  const id = `tljob_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const job: TimelineJob = {
    id,
    userId: input.userId,
    novelId: input.novelId,
    branchId,
    status: "queued",
    total: units.length,
    completed: 0,
    units: units.map((u) => ({
      unitId: u.unitId,
      label: u.label,
      startOffset: u.startOffset,
      endOffset: u.endOffset,
      status: "pending",
    })),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const s = store();
  s.jobs.set(id, job);
  s.snapshots.set(id, []);
  s.prevStates.set(id, []);
  s.seq.set(id, 0);
  touch(job);

  // Fire and forget
  void runJob(id, text, units).catch((e) => {
    const j = s.jobs.get(id);
    if (j) {
      j.status = "error";
      j.error = (e as Error).message || String(e);
      touch(j);
    }
  });

  return job;
}

async function runJob(
  jobId: string,
  fullText: string,
  units: NarrativeUnit[],
): Promise<void> {
  const s = store();
  const job = s.jobs.get(jobId);
  if (!job) return;

  job.status = "running";
  touch(job);

  const names = getCharacters(job.userId, job.novelId).map((c) => c.name);
  const parsed = parseNovel(fullText);
  parsed.fullText = fullText;
  const extractor = new TimelineExtractor(parsed, names);
  const llm = createLLMProvider();

  let prevStates = s.prevStates.get(jobId) || [];
  let seq = s.seq.get(jobId) || 0;
  const snapshots = s.snapshots.get(jobId) || [];

  for (let i = 0; i < units.length; i++) {
    const j = s.jobs.get(jobId);
    if (!j || j.status === "cancelled") {
      if (j) touch(j);
      return;
    }

    const u = units[i];
    j.units[i].status = "running";
    touch(j);

    const body = fullText.slice(u.startOffset, u.endOffset);
    try {
      const { snapshot, nextSeq, nextStates } = await runWithTokenContext(
        {
          userId: job.userId,
          novelId: job.novelId,
          branchId: job.branchId,
          agentId: "extract_timeline",
          category: "extract",
        },
        () =>
          extractor.extractOneUnit(
            llm,
            u.label,
            i + 1,
            body || "（空）",
            seq,
            prevStates,
          ),
      );

      seq = nextSeq;
      prevStates = nextStates;
      snapshots.push(snapshot);
      s.snapshots.set(jobId, snapshots);
      s.prevStates.set(jobId, prevStates);
      s.seq.set(jobId, seq);

      j.units[i].status = "done";
      j.units[i].summary =
        snapshot.events
          ?.slice(0, 3)
          .map((e) => e.title || e.description)
          .filter(Boolean)
          .join("；")
          .slice(0, 120) || "（无事件）";
      j.completed = i + 1;
      touch(j);

      // Progressive persist (branch-scoped)
      const timeline: ChapterTimeline = {
        novelId: job.novelId,
        branchId: job.branchId,
        totalChapters: snapshots.length,
        chapters: snapshots.slice(),
      };
      saveTimeline(job.userId, job.novelId, timeline, job.branchId);
      if (nextStates.length) {
        saveChapterStates(job.userId, job.novelId, nextStates, job.branchId);
      }
    } catch (e) {
      j.units[i].status = "error";
      j.units[i].error = (e as Error).message || String(e);
      j.completed = i + 1;
      touch(j);
      // continue other units
    }
  }

  const done = s.jobs.get(jobId);
  if (done && done.status !== "cancelled") {
    done.status = "done";
    touch(done);
  }
}

export function cancelTimelineJob(jobId: string): boolean {
  let j = store().jobs.get(jobId);
  if (!j) {
    const row = asTimelineJob(getTimelineJobRow(jobId));
    if (!row) return false;
    j = row;
    store().jobs.set(jobId, j);
  }
  if (j.status === "done" || j.status === "error" || j.status === "cancelled") {
    return false;
  }
  j.status = "cancelled";
  touch(j);
  return true;
}

/**
 * Re-run a single failed (or any) unit for an existing job.
 * Uses chapter states from DB as prev-state seed (best-effort).
 */
export function retryTimelineUnit(
  jobId: string,
  unitId: string,
): { ok: boolean; error?: string; job?: TimelineJob } {
  let job = store().jobs.get(jobId);
  if (!job) {
    const row = asTimelineJob(getTimelineJobRow(jobId));
    if (!row) return { ok: false, error: "任务不存在" };
    job = row;
    store().jobs.set(jobId, job);
  }

  const idx = job.units.findIndex((u) => u.unitId === unitId);
  if (idx < 0) return { ok: false, error: "单元不存在" };

  const { text } = getBranchProse(job.userId, job.novelId, job.branchId);
  if (!text?.trim()) return { ok: false, error: "分支正文为空" };

  const unit = job.units[idx];
  unit.status = "pending";
  unit.error = undefined;
  unit.summary = undefined;
  if (job.status === "error" || job.status === "done") {
    job.status = "running";
    job.error = undefined;
  }
  touch(job);

  void runSingleUnitRetry(jobId, idx, text).catch((e) => {
    const j = store().jobs.get(jobId);
    if (!j) return;
    j.units[idx].status = "error";
    j.units[idx].error = (e as Error).message || String(e);
    touch(j);
  });

  return { ok: true, job };
}

async function runSingleUnitRetry(
  jobId: string,
  idx: number,
  fullText: string,
): Promise<void> {
  const s = store();
  const job = s.jobs.get(jobId);
  if (!job) return;

  const u = job.units[idx];
  u.status = "running";
  touch(job);

  const names = getCharacters(job.userId, job.novelId).map((c) => c.name);
  const parsed = parseNovel(fullText);
  parsed.fullText = fullText;
  const extractor = new TimelineExtractor(parsed, names);
  const llm = createLLMProvider();

  // Best-effort prev states from last saved chapter states
  const prevStates = getChapterStates(job.userId, job.novelId, job.branchId) || [];
  const existingTl = getTimeline(job.userId, job.novelId, job.branchId);
  const seqBase = existingTl?.chapters?.length || idx;

  const body = fullText.slice(u.startOffset, u.endOffset);
  try {
    const { snapshot, nextStates } = await runWithTokenContext(
      {
        userId: job.userId,
        novelId: job.novelId,
        branchId: job.branchId,
        agentId: "extract_timeline",
        category: "extract",
      },
      () =>
        extractor.extractOneUnit(
          llm,
          u.label,
          idx + 1,
          body || "（空）",
          seqBase,
          prevStates,
        ),
    );

    u.status = "done";
    u.error = undefined;
    u.summary =
      snapshot.events
        ?.slice(0, 3)
        .map((e) => e.title || e.description)
        .filter(Boolean)
        .join("；")
        .slice(0, 120) || "（无事件）";
    touch(job);

    // Merge snapshot into saved timeline by chapterNumber / index
    const chapters = [...(existingTl?.chapters || [])];
    const snap = { ...snapshot, chapterNumber: snapshot.chapterNumber || idx + 1 };
    const replaceAt = chapters.findIndex((c) => c.chapterNumber === snap.chapterNumber);
    if (replaceAt >= 0) chapters[replaceAt] = snap;
    else chapters.push(snap);
    chapters.sort((a, b) => a.chapterNumber - b.chapterNumber);

    const timeline: ChapterTimeline = {
      novelId: job.novelId,
      branchId: job.branchId,
      totalChapters: chapters.length,
      chapters,
    };
    saveTimeline(job.userId, job.novelId, timeline, job.branchId);
    if (nextStates.length) {
      saveChapterStates(job.userId, job.novelId, nextStates, job.branchId);
    }

    // If no more pending/running/error units, mark done
    const stillBad = job.units.some(
      (x) => x.status === "error" || x.status === "pending" || x.status === "running",
    );
    if (!stillBad) {
      job.status = "done";
      touch(job);
    } else if (!job.units.some((x) => x.status === "running" || x.status === "pending")) {
      // only errors remain
      job.status = job.units.some((x) => x.status === "error") ? "error" : "done";
      touch(job);
    }
  } catch (e) {
    u.status = "error";
    u.error = (e as Error).message || String(e);
    job.status = "error";
    job.error = u.error;
    touch(job);
  }
}
