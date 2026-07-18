/**
 * Async character extraction job (unit Flash scan → frequency gate → merge → detail → relationships).
 * Mirrors timeline-job patterns: in-memory + SQLite JSON row.
 */
import { randomUUID } from "node:crypto";
import { createLLMProvider } from "@/core/llm/factory";
import { parseNovel } from "@/core/parser/novel-parser";
import { CharacterExtractor } from "@/core/extractor/character-extractor";
import { buildNameScanUnits, type TextUnit } from "@/core/extractor/character-name-units";
import { runNameFrequencyPipeline } from "@/core/extractor/character-name-pipeline";
import type { UnitNameHit } from "@/core/extractor/character-name-aggregate";
import { extractJSON, isChinese, novelFingerprint } from "@/lib/utils";
import { resolveAgentSystem } from "@/core/prompts/resolve-agent-prompt";
import { runWithTokenContext } from "@/lib/token-usage-context";
import { isServerDebugMode } from "@/lib/debug-mode";
import {
  getBranchProse,
  getCharacters,
  saveCharacters,
  saveCharacterExtractJobRow,
  getCharacterExtractJobRow,
  listCharacterExtractJobRows,
  getNameUnitCache,
  saveNameUnitCache,
  saveGenerationLog,
} from "@/lib/db";

export type CharJobPhase =
  | "queued"
  | "scanning"
  | "clustering"
  | "merging"
  | "detail"
  | "relationships"
  | "done"
  | "error"
  | "cancelled";

export interface CharacterExtractJob {
  id: string;
  userId: string;
  novelId: string;
  branchId: string;
  status: CharJobPhase;
  phase: CharJobPhase;
  forceRefresh: boolean;
  total: number;
  completed: number;
  failedUnitIds: string[];
  message?: string;
  error?: string;
  characterCount?: number;
  createdAt: string;
  updatedAt: string;
  /** fingerprint of text for cache */
  contentFp?: string;
}

type GlobalStore = {
  jobs: Map<string, CharacterExtractJob>;
  cancel: Set<string>;
};

function store(): GlobalStore {
  const g = globalThis as typeof globalThis & { __ncsCharJobs?: GlobalStore };
  if (!g.__ncsCharJobs) {
    g.__ncsCharJobs = { jobs: new Map(), cancel: new Set() };
  }
  return g.__ncsCharJobs;
}

function touch(job: CharacterExtractJob) {
  job.updatedAt = new Date().toISOString();
  try {
    saveCharacterExtractJobRow(job);
  } catch (e) {
    console.warn("[char-job] persist failed:", (e as Error).message);
  }
}

const RUNNING_PHASES = new Set<CharJobPhase>([
  "queued",
  "scanning",
  "clustering",
  "merging",
  "detail",
  "relationships",
]);

export function isCharJobRunning(status: string | undefined): boolean {
  return !!status && RUNNING_PHASES.has(status as CharJobPhase);
}

/**
 * After process restart, in-flight jobs cannot continue.
 * Keep original updatedAt so a freshly interrupted row does not sort above a new job.
 */
export function normalizeCharJobAfterHydrate(
  job: CharacterExtractJob,
): CharacterExtractJob {
  if (!isCharJobRunning(job.status)) return job;
  return {
    ...job,
    status: "error",
    phase: "error",
    error: job.error || "进程已重启，请重新分析角色",
    message: job.message || "进程已重启，请重新分析角色",
    // Do NOT bump updatedAt — otherwise every poll rewrites orphans to "latest"
    // and the UI sticks on 进程已重启 forever.
  };
}

function asCharJob(raw: unknown): CharacterExtractJob | null {
  if (!raw || typeof raw !== "object") return null;
  const j = raw as CharacterExtractJob;
  if (!j.id || !j.userId || !j.novelId) return null;
  return j;
}

export function getCharacterExtractJob(jobId: string): CharacterExtractJob | null {
  const mem = store().jobs.get(jobId);
  if (mem) return mem;
  const row = asCharJob(getCharacterExtractJobRow(jobId));
  if (!row) return null;
  const normalized = normalizeCharJobAfterHydrate(row);
  if (normalized.status !== row.status) {
    try {
      saveCharacterExtractJobRow(normalized);
    } catch {
      /* ignore */
    }
  }
  return normalized;
}

function jobSortKey(j: CharacterExtractJob): string {
  // Running (esp. in-memory live work) first, then recency
  const live = isCharJobRunning(j.status) ? "2" : j.status === "done" ? "1" : "0";
  return `${live}:${j.updatedAt || ""}`;
}

export function listCharacterExtractJobs(
  userId: string,
  novelId: string,
): CharacterExtractJob[] {
  const byId = new Map<string, CharacterExtractJob>();
  // Live workers always win over SQLite snapshots
  Array.from(store().jobs.values()).forEach((j) => {
    if (j.userId === userId && j.novelId === novelId) byId.set(j.id, j);
  });
  for (const row of listCharacterExtractJobRows(userId, novelId)) {
    const j = asCharJob(row);
    if (!j) continue;
    if (byId.has(j.id)) continue; // prefer memory
    const normalized = normalizeCharJobAfterHydrate(j);
    if (normalized.status !== j.status) {
      try {
        saveCharacterExtractJobRow(normalized);
      } catch {
        /* ignore */
      }
    }
    byId.set(normalized.id, normalized);
  }
  return Array.from(byId.values()).sort((a, b) =>
    jobSortKey(b).localeCompare(jobSortKey(a)),
  );
}

/** Mark other in-flight jobs for this novel as cancelled (new run supersedes). */
function supersedeOtherJobs(
  userId: string,
  novelId: string,
  keepId: string,
) {
  const s = store();
  Array.from(s.jobs.values()).forEach((j) => {
    if (
      j.userId === userId &&
      j.novelId === novelId &&
      j.id !== keepId &&
      isCharJobRunning(j.status)
    ) {
      s.cancel.add(j.id);
      j.status = "cancelled";
      j.phase = "cancelled";
      j.message = "已被新的角色提取任务取代";
      j.error = undefined;
      touch(j);
    }
  });
  for (const row of listCharacterExtractJobRows(userId, novelId)) {
    const j = asCharJob(row);
    if (!j || j.id === keepId) continue;
    if (!isCharJobRunning(j.status)) continue;
    if (s.jobs.has(j.id)) continue; // already handled
    const dead: CharacterExtractJob = {
      ...j,
      status: "cancelled",
      phase: "cancelled",
      message: "已被新的角色提取任务取代",
      error: undefined,
      // keep original updatedAt so new job stays latest
    };
    try {
      saveCharacterExtractJobRow(dead);
    } catch {
      /* ignore */
    }
  }
}

export function cancelCharacterExtractJob(jobId: string): boolean {
  const j = getCharacterExtractJob(jobId);
  if (!j) return false;
  if (j.status === "done" || j.status === "error" || j.status === "cancelled") {
    return false;
  }
  store().cancel.add(jobId);
  j.status = "cancelled";
  j.phase = "cancelled";
  j.message = "已取消";
  store().jobs.set(jobId, j);
  touch(j);
  return true;
}

const UNIT_SCHEMA = {
  name: "unit_character_names",
  description: "Names in this passage",
  parameters: {
    type: "object",
    properties: {
      characters: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            aliases: { type: "array", items: { type: "string" } },
          },
          required: ["name"],
        },
      },
    },
    required: ["characters"],
  },
};

const PROMPT_VERSION = "char-names-unit-v1";

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  shouldStop: () => boolean,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      if (shouldStop()) return;
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

async function extractUnitNames(
  llm: ReturnType<typeof createLLMProvider>,
  unit: TextUnit,
  zh: boolean,
): Promise<UnitNameHit[]> {
  const prompt = resolveAgentSystem("character_names_unit", zh ? "zh" : "en", {
    unitLabel: unit.label,
    unitText: unit.text.slice(0, 14_000),
  });
  try {
    const result = await llm.chatWithTool<{
      characters: { name: string; aliases?: string[] }[];
    }>([{ role: "user", content: prompt }], UNIT_SCHEMA, {
      temperature: 0.2,
      maxTokens: 2048,
    });
    return (result.characters || [])
      .map((c) => ({
        name: (c.name || "").trim(),
        aliases: (c.aliases || []).map(String).filter(Boolean),
        count: 1,
      }))
      .filter((c) => c.name.length >= 1 && c.name.length <= 12);
  } catch {
    try {
      const raw = await llm.chat(
        [
          {
            role: "user",
            content:
              prompt +
              '\n\n只输出 JSON：{"characters":[{"name":"...","aliases":[]}]}',
          },
        ],
        { temperature: 0.2, maxTokens: 2048 },
      );
      const parsed = extractJSON<{
        characters?: { name: string; aliases?: string[] }[];
      }>(raw);
      return (parsed?.characters || [])
        .map((c) => ({
          name: (c.name || "").trim(),
          aliases: c.aliases || [],
          count: 1,
        }))
        .filter((c) => c.name.length >= 1);
    } catch {
      return [];
    }
  }
}

/**
 * Start async character extract. Returns immediately.
 */
export function startCharacterExtractJob(input: {
  userId: string;
  novelId: string;
  branchId?: string;
  forceRefresh?: boolean;
  text?: string;
}): CharacterExtractJob {
  const branchId = input.branchId || "main";
  let text = (input.text || "").trim();
  if (!text) {
    text = getBranchProse(input.userId, input.novelId, branchId).text || "";
  }
  if (!text.trim()) {
    throw new Error("正文为空，无法提取角色");
  }

  const units = buildNameScanUnits(text);
  if (!units.length) {
    throw new Error("未能切分文本单元");
  }

  const id = `chjob_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const job: CharacterExtractJob = {
    id,
    userId: input.userId,
    novelId: input.novelId,
    branchId,
    status: "queued",
    phase: "queued",
    forceRefresh: !!input.forceRefresh,
    total: units.length,
    completed: 0,
    failedUnitIds: [],
    message: `排队中 · ${units.length} 段`,
    contentFp: novelFingerprint(text),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Drop stale in-flight jobs from prior runs / pre-restart DB rows so UI
  // "latest" is the new job, not "进程已重启".
  supersedeOtherJobs(input.userId, input.novelId, id);

  store().jobs.set(id, job);
  store().cancel.delete(id);
  touch(job);

  void runCharacterJob(id, text, units).catch((e) => {
    const j = store().jobs.get(id);
    if (j && j.status !== "cancelled") {
      j.status = "error";
      j.phase = "error";
      j.error = (e as Error).message || String(e);
      j.message = j.error;
      touch(j);
    }
  });

  return job;
}

async function runCharacterJob(
  jobId: string,
  fullText: string,
  units: TextUnit[],
): Promise<void> {
  const s = store();
  const job = s.jobs.get(jobId);
  if (!job) return;

  const stop = () => s.cancel.has(jobId) || job.status === "cancelled";

  job.status = "scanning";
  job.phase = "scanning";
  job.message = `扫描人名 0/${units.length}`;
  touch(job);

  const llm = createLLMProvider("analysis");
  const zh = isChinese(fullText);
  const fp = job.contentFp || novelFingerprint(fullText);
  const unitHits: UnitNameHit[][] = new Array(units.length);
  const unitIndexBySurface = new Map<string, Set<number>>();

  // Production: cap fan-out. Debug/dev: no concurrency limit (full unit parallelism).
  const scanConcurrency = isServerDebugMode() ? units.length : 4;
  console.log(
    `[char-job] ${jobId} scan units=${units.length} concurrency=${scanConcurrency}` +
      (isServerDebugMode() ? " (debug unlimited)" : ""),
  );

  await mapPool(
    units,
    scanConcurrency,
    async (unit, i) => {
      if (stop()) return [] as UnitNameHit[];

      const cacheKey = `${fp}:${unit.start}:${unit.end}:${PROMPT_VERSION}`;
      if (!job.forceRefresh) {
        const cached = getNameUnitCache(job.userId, job.novelId, cacheKey);
        if (cached) {
          unitHits[i] = cached;
          job.completed = unitHits.filter(Boolean).length;
          job.message = `扫描人名 ${job.completed}/${units.length}（缓存）`;
          touch(job);
          return cached;
        }
      }

      let hits: UnitNameHit[] = [];
      let lastErr: Error | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (stop()) break;
        try {
          hits = await runWithTokenContext(
            {
              userId: job.userId,
              novelId: job.novelId,
              agentId: "character_names_unit",
              category: "extract",
            },
            () => extractUnitNames(llm, unit, zh),
          );
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e as Error;
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }
      }

      if (lastErr && hits.length === 0) {
        job.failedUnitIds.push(`u${i}`);
        hits = [];
      } else {
        try {
          saveNameUnitCache(job.userId, job.novelId, cacheKey, hits);
        } catch {
          /* ignore */
        }
      }

      unitHits[i] = hits;
      for (const h of hits) {
        const surfaces = [
          h.name,
          ...(h.aliases || []),
        ]
          .map((s) => (s || "").replace(/\s+/g, "").trim())
          .filter((s) => s.length >= 1);
        for (const name of surfaces) {
          if (!unitIndexBySurface.has(name)) unitIndexBySurface.set(name, new Set());
          unitIndexBySurface.get(name)!.add(i);
        }
      }

      job.completed = unitHits.filter(Boolean).length;
      job.message = `扫描人名 ${job.completed}/${units.length}`;
      if (job.failedUnitIds.length) {
        job.message += ` · 失败 ${job.failedUnitIds.length}`;
      }
      touch(job);
      return hits;
    },
    stop,
  );

  if (stop()) {
    job.status = "cancelled";
    job.phase = "cancelled";
    touch(job);
    return;
  }

  // Fill holes
  for (let i = 0; i < units.length; i++) {
    if (!unitHits[i]) {
      unitHits[i] = [];
      if (!job.failedUnitIds.includes(`u${i}`)) job.failedUnitIds.push(`u${i}`);
    }
  }

  job.phase = "clustering";
  job.status = "clustering";
  job.message = "频次过滤与别名聚类…";
  touch(job);

  const pipe = runNameFrequencyPipeline(unitHits, {
    textLength: fullText.length,
    unitCount: units.length,
    softMaxClusters: 120,
    unitIndexBySurface,
  });

  job.phase = "merging";
  job.status = "merging";
  job.message = `合并名单（${pipe.kept.length} 个频次合格）…`;
  touch(job);

  const parsed = parseNovel(fullText);
  parsed.fullText = fullText;
  const extractor = new CharacterExtractor(parsed);

  const rawList = await runWithTokenContext(
    {
      userId: job.userId,
      novelId: job.novelId,
      agentId: "character_list",
      category: "extract",
    },
    () => extractor.mergeFrequencyRoster(llm, pipe.rosterPrompt),
  );

  if (!rawList.length) {
    throw new Error("合并后未得到角色名单");
  }

  job.phase = "detail";
  job.status = "detail";
  job.message = `深挖人设（锚点章节）/ ${rawList.length}…`;
  touch(job);

  // Prefer kept aggregates (have unitIndices); fall back to full clusters
  const scanClusters =
    pipe.kept?.length > 0
      ? pipe.kept
      : pipe.clusters?.length
        ? pipe.clusters
        : [];

  const profiles = await runWithTokenContext(
    {
      userId: job.userId,
      novelId: job.novelId,
      agentId: "extract_characters",
      category: "extract",
    },
    () =>
      extractor.completeFromRawList(llm, rawList, {
        units,
        scanClusters,
        // No fixed top-12: focus count follows appearance importance thresholds
        onPhase: (p, msg) => {
          if (p === "detail") {
            job.phase = "detail";
            job.status = "detail";
            job.message = msg;
            touch(job);
          }
          if (p === "relationships") {
            job.phase = "relationships";
            job.status = "relationships";
            job.message = msg;
            touch(job);
          }
        },
      }),
  );

  saveCharacters(job.userId, job.novelId, profiles);
  try {
    saveGenerationLog({
      id: randomUUID(),
      userId: job.userId,
      novelId: job.novelId,
      category: "extract",
      label: "角色提取（分段扫名）",
      inputSummary: fullText.slice(0, 200),
      outputPreview: profiles.map((c) => c.name).join(", "),
      fullOutput: JSON.stringify({
        jobId,
        kept: pipe.kept.length,
        failedUnits: job.failedUnitIds,
        names: profiles.map((c) => c.name),
      }),
    });
  } catch {
    /* ignore */
  }

  job.characterCount = profiles.length;
  job.phase = "done";
  job.status = "done";
  job.message =
    `完成 ${profiles.length} 角色` +
    (job.failedUnitIds.length ? ` · ${job.failedUnitIds.length} 段扫名失败已跳过` : "") +
    (pipe.thresholdRaised ? " · 频次门槛已抬升" : "");
  touch(job);
  console.log(`[char-job] ${jobId} done chars=${profiles.length}`);
}

/** Whether a novel already has characters (for skip logic). */
export function hasCachedCharacters(userId: string, novelId: string): boolean {
  return getCharacters(userId, novelId).length > 0;
}
