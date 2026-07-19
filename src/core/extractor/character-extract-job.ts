/**
 * Async character extraction job — pipeline A:
 *   unit surface scan (parallel map)
 *   → real coref agent (tools + Admin/md prompt)
 *   → entity frequency → detail → relationships
 */
import { randomUUID } from "node:crypto";
import { createLLMProvider } from "@/core/llm/factory";
import { parseNovel } from "@/core/parser/novel-parser";
import { CharacterExtractor } from "@/core/extractor/character-extractor";
import { buildNameScanUnits, type TextUnit } from "@/core/extractor/character-name-units";
import type { UnitNameHit } from "@/core/extractor/character-name-aggregate";
import { countResolvedEntities } from "@/core/extractor/character-entity-frequency";
import { gateRosterWithLlm } from "@/core/extractor/character-roster-gate";
import { buildSurfaceCatalog } from "@/core/extractor/character-surface-catalog";
import {
  beginCharacterExtractWorkspace,
  clearCharacterExtractWorkspace,
  getCharacterExtractWorkspace,
} from "@/core/extractor/character-extract-workspace";
import {
  consolidateRawCharacters,
  sanitizeAliasesAgainstRoster,
} from "@/core/extractor/character-name-consolidate";

import { extractJSON, isChinese, novelFingerprint } from "@/lib/utils";
import { resolveAgentSystem } from "@/core/prompts/resolve-agent-prompt";
import { runWithTokenContext } from "@/lib/token-usage-context";

import { initRegistry } from "@/core/agents/init";
import { getAgent } from "@/core/agents/agent-registry";
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

let agentsReady = false;
function ensureAgents(): void {
  if (!agentsReady) {
    initRegistry();
    agentsReady = true;
  }
}

export type CharJobPhase =
  | "queued"
  | "scanning"
  | "resolving"
  | "counting"
  /** LLM decides keep/drop from character info cards */
  | "gating"
  /** @deprecated kept for old job rows in DB */
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
  "resolving",
  "counting",
  "gating",
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

/** Mentions = names + epithets + stable kinship/role (not pronouns / 他爸). */
const UNIT_SCHEMA = {
  name: "unit_character_mentions",
  description:
    "Specific character mentions: proper names, nicknames, stable third-person " +
    "kinship/role/epithets. Exclude bare pronouns (他/她/它) and deictic kinship (他爸).",
  parameters: {
    type: "object",
    properties: {
      characters: {
        type: "array",
        description: "Exclude 他/她/它/他爸/我爸/有人 as surfaces.",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                "Proper name OR stable referent (周屿的母亲). Never bare 他/它/他爸.",
            },
            aliases: { type: "array", items: { type: "string" } },
          },
          required: ["name"],
        },
      },
    },
    required: ["characters"],
  },
};

// Bump when unit prompt/schema changes so name-unit cache invalidates
const PROMPT_VERSION = "char-mentions-unit-v4-no-pronoun";

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
      // Reasoning models share max_tokens with CoT; keep high for quality.
      maxTokens: 8192,
    });
    return (result.characters || [])
      .map((c) => ({
        name: (c.name || "").trim(),
        aliases: (c.aliases || []).map(String).filter(Boolean),
        count: 1,
      }))
      .filter((c) => c.name.length >= 1 && c.name.length <= 24);
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
        { temperature: 0.2, maxTokens: 8192 },
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
        .filter((c) => c.name.length >= 1 && c.name.length <= 24);
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

  // Mention scan: default concurrency 4 (override CHARACTER_MENTION_CONCURRENCY)
  const envC = Number(process.env.CHARACTER_MENTION_CONCURRENCY || "");
  const scanConcurrency =
    Number.isFinite(envC) && envC >= 1 ? Math.floor(envC) : 4;
  console.log(
    `[char-job] ${jobId} mention-scan units=${units.length} concurrency=${scanConcurrency}`,
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

  // --- Pipeline A: catalog → real coref agent → entity frequency ---
  job.phase = "resolving";
  job.status = "resolving";
  job.message = "构建称呼索引…";
  touch(job);

  const catalog = buildSurfaceCatalog(unitHits, units, fullText);
  console.log(
    `[char-job] ${jobId} surfaces=${catalog.stats.length} → coref agent`,
  );

  if (stop()) {
    job.status = "cancelled";
    job.phase = "cancelled";
    touch(job);
    return;
  }

  ensureAgents();
  beginCharacterExtractWorkspace(job.userId, job.novelId, job.branchId, {
    fullText,
    catalog,
    unitCount: units.length,
  });

  job.message = `指代消解 Agent（${catalog.stats.length} 个候选）…`;
  touch(job);

  const resolveAgent = getAgent("character_entity_resolve");
  if (!resolveAgent) {
    throw new Error("character_entity_resolve agent 未注册");
  }

  const agentResult = await resolveAgent.execute(
    {
      prompt: `将 ${catalog.stats.length} 个扫名候选归并为角色实体（name=真实姓名，aliases=封号外号）。高召回，次要角色也保留。`,
      novelId: job.novelId,
      branchId: job.branchId,
      userId: job.userId,
    },
    llm,
  );

  if (stop()) {
    clearCharacterExtractWorkspace(job.userId, job.novelId, job.branchId);
    job.status = "cancelled";
    job.phase = "cancelled";
    touch(job);
    return;
  }

  const entities =
    getCharacterExtractWorkspace(job.userId, job.novelId, job.branchId)
      ?.entities || [];

  if (!entities.length) {
    const hint = agentResult.content || "无详情";
    clearCharacterExtractWorkspace(job.userId, job.novelId, job.branchId);
    throw new Error(`指代消解 Agent 未提交实体：${hint.slice(0, 200)}`);
  }

  console.log(
    `[char-job] ${jobId} coref agent done entities=${entities.length} trail=${agentResult.messages?.length || 0}`,
  );

  job.phase = "counting";
  job.status = "counting";
  job.message = `按实体计次（${entities.length} 人）…`;
  touch(job);

  const counted = countResolvedEntities(entities, catalog);

  job.phase = "gating";
  job.status = "gating";
  job.message = `模型筛选名单（${entities.length} 候选人）…`;
  touch(job);

  // Model decides keep/drop from info cards; mentions/role/brief are hints only
  const gated = await gateRosterWithLlm(llm, entities, counted, {
    textLength: fullText.length,
    unitCount: units.length,
  });

  // Prefer entity with role/brief from resolve; match by name or surface
  const findEntity = (aggName: string) => {
    const key = aggName.replace(/\s+/g, "").trim();
    for (const e of entities) {
      if (e.name.replace(/\s+/g, "").trim() === key) return e;
      if ((e.surfaces || []).some((s) => s.replace(/\s+/g, "").trim() === key))
        return e;
      if ((e.aliases || []).some((s) => s.replace(/\s+/g, "").trim() === key))
        return e;
    }
    return undefined;
  };
  let rawList = gated.kept.map((agg) => {
    const ent = findEntity(agg.name);
    // Entity from list agent already third-person aliases only
    const aliases =
      ent?.aliases?.length
        ? ent.aliases
        : agg.aliases.length
          ? agg.aliases
          : [];
    return {
      name: agg.name,
      aliases,
      role: ent?.role || "supporting",
      briefDescription: ent?.briefDescription || "",
    };
  });

  rawList = sanitizeAliasesAgainstRoster(consolidateRawCharacters(rawList));

  if (!rawList.length) {
    throw new Error("名单 LLM gate 后为空");
  }

  const reasonSample = Object.entries(gated.reasons)
    .slice(0, 8)
    .map(([n, r]) => `${n}:${r}`)
    .join("；");
  console.log(
    `[char-job] ${jobId} entities=${entities.length} gated=${rawList.length}` +
      (gated.fallbackAll ? " (fallback keep all)" : "") +
      (reasonSample ? ` sample=[${reasonSample}]` : ""),
  );

  job.phase = "detail";
  job.status = "detail";
  job.message = `深挖人设（锚点章节）/ ${rawList.length}…`;
  touch(job);

  const parsed = parseNovel(fullText);
  parsed.fullText = fullText;
  const extractor = new CharacterExtractor(parsed);

  // Anchors = entity aggregates with unitIndices (post-coref counts)
  const scanClusters = gated.kept;

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
      label: "角色提取（扫名→消解→计次）",
      inputSummary: fullText.slice(0, 200),
      outputPreview: profiles.map((c) => c.name).join(", "),
      fullOutput: JSON.stringify({
        jobId,
        surfaces: catalog.stats.length,
        entities: entities.length,
        kept: rawList.length,
        failedUnits: job.failedUnitIds,
        names: profiles.map((c) => c.name),
      }),
    });
  } catch {
    /* ignore */
  }

  clearCharacterExtractWorkspace(job.userId, job.novelId, job.branchId);

  job.characterCount = profiles.length;
  job.phase = "done";
  job.status = "done";
  job.message =
    `完成 ${profiles.length} 角色` +
    (job.failedUnitIds.length ? ` · ${job.failedUnitIds.length} 段扫名失败已跳过` : "") +
    (gated.fallbackAll ? " · gate回退全保留" : " · LLM名单筛选");
  touch(job);
  console.log(`[char-job] ${jobId} done chars=${profiles.length}`);
}

/** Whether a novel already has characters (for skip logic). */
export function hasCachedCharacters(userId: string, novelId: string): boolean {
  return getCharacters(userId, novelId).length > 0;
}
