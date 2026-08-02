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

/**
 * Start a new outline round.
 * - Default: wipe session drafts (prose/findings/plan/realization/outline).
 * - keepOutline: rewrite mode — preserve previous outline + foreshadow plan so
 *   get_outline still returns the last draft for revision.
 */
export function beginOutlineRound(
  novelId: string,
  branchId: string,
  opts?: { keepOutline?: boolean },
): void {
  const k = key(novelId, branchId);
  const prev = storeMap().get(k) || {};
  if (opts?.keepOutline && prev.outline && String(prev.outline).trim().length >= 50) {
    storeMap().set(k, {
      outline: prev.outline,
      foreshadowPlan: prev.foreshadowPlan,
    });
    console.log(
      `[Store] beginOutlineRound ${k} keepOutline len=${String(prev.outline).length}`,
    );
  } else {
    storeMap().set(k, {});
    console.log(`[Store] beginOutlineRound ${k}`);
  }
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
 * Map tool/agent ids → store dimension codes.
 * Accepts review_continuity / continuity_reviewer / continuity → "continuity".
 */
export function normalizeFindingDimension(raw: string | undefined | null): string {
  const s = String(raw || "").trim();
  if (!s) return "other";
  const lower = s.toLowerCase().replace(/-/g, "_");
  const aliases: Record<string, string> = {
    outline: "outline",
    outline_reviewer: "outline",
    review_outline: "outline",
    character: "character",
    char: "character",
    character_consistency: "character",
    character_reviewer: "character",
    review_character: "character",
    continuity: "continuity",
    cont: "continuity",
    continuity_reviewer: "continuity",
    review_continuity: "continuity",
    foreshadowing: "foreshadowing",
    foreshadow: "foreshadowing",
    foreshadow_reviewer: "foreshadowing",
    review_foreshadowing: "foreshadowing",
    style: "style",
    style_reviewer: "style",
    review_style: "style",
    world: "world",
    world_reviewer: "world",
    review_world: "world",
    pacing: "pacing",
    pacing_reviewer: "pacing",
    review_pacing: "pacing",
  };
  if (aliases[lower]) return aliases[lower];
  // strip common prefixes/suffixes
  const stripped = lower
    .replace(/^review_/, "")
    .replace(/_review$/, "")
    .replace(/_consistency$/, "");
  return aliases[stripped] || stripped || "other";
}

export interface SaveFindingsOptions {
  /**
   * Dimension / review agent type (e.g. continuity, review_continuity).
   * Required when findings is empty and overwrite=true (to clear that dim only).
   */
  dimension?: string;
  /**
   * true (default): replace findings for the target dimension(s).
   * false: append without removing existing items for that dimension.
   */
  overwrite?: boolean;
}

/**
 * Save findings for one or more dimensions.
 * - overwrite=true (default): replace only the named dimension(s); other dims kept.
 * - overwrite=false: append; never wipes other agents' findings.
 * Empty findings + dimension + overwrite clears that dimension only (not global).
 */
export function saveFindings(
  novelId: string,
  branchId: string,
  findings: ReviewFindings[],
  opts?: SaveFindingsOptions,
): void {
  const k = key(novelId, branchId);
  const store = storeMap();
  const s = store.get(k) || {};
  const existing = s.findings || [];
  const overwrite = opts?.overwrite !== false;

  const forcedDim = opts?.dimension
    ? normalizeFindingDimension(opts.dimension)
    : undefined;

  const normalized = (findings || []).map((f) => ({
    dimension: forcedDim || normalizeFindingDimension(f.dimension),
    severity: String(f.severity || "minor"),
    description: String(f.description || "").trim(),
    suggestion: String(f.suggestion || "").trim(),
  })).filter((f) => f.description.length > 0 || overwrite);

  // Drop empty-description rows when not a pure "clear this dim" save
  const rows = normalized.filter((f) => f.description.length > 0);

  if (overwrite) {
    const dims = forcedDim
      ? [forcedDim]
      : Array.from(new Set(rows.map((f) => f.dimension)));
    if (dims.length === 0) {
      // empty [] without dimension → no-op (do not global wipe)
      store.set(k, s);
      console.log(`[Store] saveFindings ${k} overwrite no-op (empty, no dimension)`);
      return;
    }
    const kept = existing.filter((f) => !dims.includes(f.dimension));
    // Tag rows with forced dim when provided
    const toWrite = forcedDim
      ? rows.map((f) => ({ ...f, dimension: forcedDim }))
      : rows;
    s.findings = kept.concat(toWrite);
    store.set(k, s);
    console.log(
      `[Store] saveFindings ${k} overwrite dims=[${dims.join(",")}] ` +
        `+${toWrite.length} kept=${kept.length} total=${s.findings.length}`,
    );
    return;
  }

  // append
  const toWrite = forcedDim
    ? rows.map((f) => ({ ...f, dimension: forcedDim }))
    : rows;
  s.findings = existing.concat(toWrite);
  store.set(k, s);
  console.log(
    `[Store] saveFindings ${k} append +${toWrite.length} total=${s.findings.length}`,
  );
}

/** Parallel-safe: serialize saveFindings for this branch. */
export async function saveFindingsLocked(
  novelId: string,
  branchId: string,
  findings: ReviewFindings[],
  opts?: SaveFindingsOptions,
): Promise<void> {
  await withBranchLock(novelId, branchId, () => {
    saveFindings(novelId, branchId, findings, opts);
  });
}

export function getFindings(novelId: string, branchId: string): ReviewFindings[] {
  return storeMap().get(key(novelId, branchId))?.findings || [];
}

/**
 * Clear findings. If dimension provided, only that review dimension is cleared.
 * Full clear only when dimension omitted — prefer per-dim overwrite via save_findings.
 */
export function clearFindings(
  novelId: string,
  branchId: string,
  dimension?: string,
): void {
  const k = key(novelId, branchId);
  const store = storeMap();
  const s = store.get(k);
  if (!s) return;
  if (dimension) {
    const dim = normalizeFindingDimension(dimension);
    s.findings = (s.findings || []).filter((f) => f.dimension !== dim);
  } else {
    s.findings = [];
  }
  store.set(k, s);
}

export async function clearFindingsLocked(
  novelId: string,
  branchId: string,
  dimension?: string,
): Promise<void> {
  await withBranchLock(novelId, branchId, () => {
    clearFindings(novelId, branchId, dimension);
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