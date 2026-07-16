/**
 * 进程内中间数据存储——按 novelId+branchId 隔离，子 agent 之间用它传递
 * 大纲、审查发现等信息。主 agent 不再转达具体内容，只看 hint。
 * 进程重启即丢失，一次续写流程内足够。
 */
import type { ForeshadowingPlan, ForeshadowingRealization } from "@/core/foreshadowing/types";

type Outline = any;
export interface ReviewFindings {
  dimension: string;
  severity: string;
  description: string;
  suggestion: string;
}

const DIM_LABELS: Record<string, string> = {
  outline: "大纲审核",
  character: "角色一致性",
  continuity: "连贯与逻辑",
  foreshadowing: "伏笔",
  style: "风格",
  world: "世界观",
  pacing: "节奏",
};

const SEV_LABELS: Record<string, string> = {
  critical: "致命",
  major: "重要",
  minor: "次要",
};

/** Human-readable findings list for tools / UI (not raw JSON). */
export function formatFindingsReadable(findings: ReviewFindings[]): string {
  if (!findings.length) {
    return "暂无审查发现问题（findings 为空）。";
  }

  const byDim = new Map<string, ReviewFindings[]>();
  for (const f of findings) {
    const dim = f.dimension || "other";
    const list = byDim.get(dim) || [];
    list.push(f);
    byDim.set(dim, list);
  }

  const lines: string[] = [`共 ${findings.length} 个问题\n`];
  for (const [dim, items] of Array.from(byDim.entries())) {
    const title = DIM_LABELS[dim] || dim;
    lines.push(`## ${title}（${items.length}）`);
    items.forEach((f, i) => {
      const sev = SEV_LABELS[f.severity] || f.severity || "次要";
      lines.push(`${i + 1}. 【${sev}】${f.description || "（无描述）"}`);
      if (f.suggestion) lines.push(`   → 建议：${f.suggestion}`);
    });
    lines.push("");
  }
  return lines.join("\n").trim();
}

interface BranchStore {
  outline?: Outline;
  findings?: ReviewFindings[];
  prose?: string;
  foreshadowPlan?: ForeshadowingPlan;
  foreshadowRealization?: ForeshadowingRealization;
}

/**
 * MUST live on globalThis — Next/webpack HMR and split chunks can load this
 * module twice; a module-level Map then means save_outline writes Map A and
 * get_outline reads Map B ("大纲未生成").
 */
type GlobalAgentStore = {
  store: Map<string, BranchStore>;
  writeTails: Map<string, Promise<unknown>>;
};

function globalAgentStore(): GlobalAgentStore {
  const g = globalThis as typeof globalThis & { __ncsAgentSessionStore?: GlobalAgentStore };
  if (!g.__ncsAgentSessionStore) {
    g.__ncsAgentSessionStore = {
      store: new Map(),
      writeTails: new Map(),
    };
  }
  return g.__ncsAgentSessionStore;
}

function storeMap() {
  return globalAgentStore().store;
}

function writeTailsMap() {
  return globalAgentStore().writeTails;
}

/** Normalize ids so save/get always hit the same key. */
export function resolveStoreIds(
  args?: { novelId?: string; branchId?: string } | null,
  ctx?: { novelId?: string; branchId?: string } | null,
): { novelId: string; branchId: string } {
  const novelId = String(args?.novelId || ctx?.novelId || "").trim();
  let branchId = String(args?.branchId || ctx?.branchId || "main").trim();
  if (!branchId || branchId === "undefined" || branchId === "null") branchId = "main";
  return { novelId, branchId };
}

function key(novelId: string, branchId: string): string {
  const ids = resolveStoreIds({ novelId, branchId });
  return `${ids.novelId}::${ids.branchId}`;
}

export function debugStoreKeys(): string[] {
  return Array.from(storeMap().keys());
}

/** Run fn exclusively for this branch (queued). */
export async function withBranchLock<T>(
  novelId: string,
  branchId: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  const k = key(novelId, branchId);
  const writeTails = writeTailsMap();
  const prev = writeTails.get(k) || Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  writeTails.set(
    k,
    prev.then(() => held).catch(() => held),
  );
  await prev.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
  }
}

/** Start a new outline round: wipe session drafts (prose/findings/plan/realization). */
export function beginOutlineRound(novelId: string, branchId: string): void {
  const k = key(novelId, branchId);
  storeMap().set(k, {});
  console.log(`[Store] beginOutlineRound ${k}`);
}

export function saveOutline(novelId: string, branchId: string, outline: Outline): void {
  const k = key(novelId, branchId);
  const store = storeMap();
  const prev = store.get(k) || {};
  store.set(k, {
    outline,
    foreshadowPlan: prev.foreshadowPlan,
  });
  console.log(`[Store] saveOutline ${k} len=${String(outline || "").length} keys=${debugStoreKeys().length}`);
}

export function saveForeshadowPlan(
  novelId: string,
  branchId: string,
  plan: ForeshadowingPlan,
): void {
  const k = key(novelId, branchId);
  const store = storeMap();
  const s = store.get(k) || {};
  s.foreshadowPlan = plan;
  store.set(k, s);
  console.log(
    `[Store] saveForeshadowPlan ${k} plant=${plan.plant?.length || 0} reveal=${plan.reveal?.length || 0}`,
  );
}

export function getForeshadowPlan(
  novelId: string,
  branchId: string,
): ForeshadowingPlan | undefined {
  return storeMap().get(key(novelId, branchId))?.foreshadowPlan;
}

export function saveForeshadowRealization(
  novelId: string,
  branchId: string,
  realization: ForeshadowingRealization,
): void {
  const k = key(novelId, branchId);
  const store = storeMap();
  const s = store.get(k) || {};
  s.foreshadowRealization = realization;
  store.set(k, s);
  console.log(`[Store] saveForeshadowRealization ${k} pass=${realization.pass}`);
}

export function getForeshadowRealization(
  novelId: string,
  branchId: string,
): ForeshadowingRealization | undefined {
  return storeMap().get(key(novelId, branchId))?.foreshadowRealization;
}

export function getOutline(novelId: string, branchId: string): Outline | undefined {
  const k = key(novelId, branchId);
  const o = storeMap().get(k)?.outline;
  if (!o) {
    console.warn(`[Store] getOutline miss ${k}; have=[${debugStoreKeys().join(", ")}]`);
  }
  return o;
}

/**
 * Merge findings by dimension (same dim replaces).
 * Safe under parallel reviews: each call is sync RMW; withBranchLock used by callers
 * that do get→await→save. Direct saveFindings is still atomic vs other saveFindings
 * in the same tick; parallel agents should use saveFindingsLocked.
 */
export function saveFindings(novelId: string, branchId: string, findings: ReviewFindings[]): void {
  const k = key(novelId, branchId);
  const store = storeMap();
  const s = store.get(k) || {};
  const existing = s.findings || [];
  const dims = Array.from(new Set(findings.map((f) => f.dimension)));
  const kept = existing.filter((f) => !dims.includes(f.dimension));
  s.findings = kept.concat(findings);
  store.set(k, s);
  console.log(
    `[Store] saveFindings ${k} dims=[${dims.join(",")}] -> ${s.findings.length} total (${kept.length} kept)`,
  );
}

/** Parallel-safe: serialize saveFindings for this branch. */
export async function saveFindingsLocked(
  novelId: string,
  branchId: string,
  findings: ReviewFindings[],
): Promise<void> {
  await withBranchLock(novelId, branchId, () => {
    saveFindings(novelId, branchId, findings);
  });
}

export function getFindings(novelId: string, branchId: string): ReviewFindings[] {
  return storeMap().get(key(novelId, branchId))?.findings || [];
}

export function clearFindings(novelId: string, branchId: string): void {
  const k = key(novelId, branchId);
  const store = storeMap();
  const s = store.get(k);
  if (s) {
    s.findings = [];
    store.set(k, s);
  }
}

export async function clearFindingsLocked(novelId: string, branchId: string): Promise<void> {
  await withBranchLock(novelId, branchId, () => {
    clearFindings(novelId, branchId);
  });
}

export function saveProse(novelId: string, branchId: string, prose: string): void {
  const k = key(novelId, branchId);
  const store = storeMap();
  const s = store.get(k) || {};
  s.prose = prose;
  store.set(k, s);
  console.log(`[Store] saveProse ${k} len=${prose.length}`);
}

export async function saveProseLocked(
  novelId: string,
  branchId: string,
  prose: string,
): Promise<void> {
  await withBranchLock(novelId, branchId, () => {
    saveProse(novelId, branchId, prose);
  });
}

export function getProse(novelId: string, branchId: string): string | undefined {
  return storeMap().get(key(novelId, branchId))?.prose;
}

/** 测试用清空 */
export function _resetStore(): void {
  storeMap().clear();
}