/**
 * Async full timeline analysis by narrative unit.
 * Progressive save so UI can poll and display a vertical rail mid-run.
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
  getCharacters,
  getNovelForm,
  saveChapterStates,
  saveTimeline,
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

function touch(job: TimelineJob) {
  job.updatedAt = new Date().toISOString();
}

export function getTimelineJob(jobId: string): TimelineJob | null {
  return store().jobs.get(jobId) || null;
}

export function listTimelineJobsForNovel(
  userId: string,
  novelId: string,
  branchId = "main",
): TimelineJob[] {
  return Array.from(store().jobs.values())
    .filter((j) => j.userId === userId && j.novelId === novelId && j.branchId === branchId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
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
    if (!j || j.status === "cancelled") return;

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

      // Progressive persist
      const timeline: ChapterTimeline = {
        novelId: job.novelId,
        totalChapters: snapshots.length,
        chapters: snapshots.slice(),
      };
      saveTimeline(job.userId, job.novelId, timeline);
      if (nextStates.length) {
        saveChapterStates(job.userId, job.novelId, nextStates);
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
  const j = store().jobs.get(jobId);
  if (!j) return false;
  if (j.status === "done" || j.status === "error") return false;
  j.status = "cancelled";
  touch(j);
  return true;
}
