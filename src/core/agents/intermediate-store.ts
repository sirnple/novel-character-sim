/**
 * 进程内中间数据存储——按 novelId+branchId 隔离，子 agent 之间用它传递
 * 大纲、审查发现等信息。主 agent 不再转达具体内容，只看 hint。
 * 进程重启即丢失，一次续写流程内足够。
 */

type Outline = any;
export interface ReviewFindings {
  dimension: string;
  severity: string;
  description: string;
  suggestion: string;
}

const DIM_LABELS: Record<string, string> = {
  character: "角色一致性",
  continuity: "连贯性",
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
}

const store = new Map<string, BranchStore>();

/**
 * Per-branch mutex for concurrent review agents (Promise.all).
 * saveFindings is a sync RMW; without a lock, two agents can still race if anything
 * awaits between get and set. Serializing mutations per novelId::branchId is enough.
 */
const writeTails = new Map<string, Promise<unknown>>();

function key(novelId: string, branchId: string): string {
  return `${novelId}::${branchId}`;
}

/** Run fn exclusively for this branch (queued). */
export async function withBranchLock<T>(
  novelId: string,
  branchId: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  const k = key(novelId, branchId);
  const prev = writeTails.get(k) || Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  // Next callers await `held` completing (after we release)
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

export function saveOutline(novelId: string, branchId: string, outline: Outline): void {
  // 新一轮续写以大纲为起点——清空旧 prose + findings
  const s: BranchStore = { outline };
  store.set(key(novelId, branchId), s);
  console.log(`[Store] saveOutline ${novelId}/${branchId} -> cleared findings+prose`);
}

export function getOutline(novelId: string, branchId: string): Outline | undefined {
  return store.get(key(novelId, branchId))?.outline;
}

/**
 * Merge findings by dimension (same dim replaces).
 * Safe under parallel reviews: each call is sync RMW; withBranchLock used by callers
 * that do get→await→save. Direct saveFindings is still atomic vs other saveFindings
 * in the same tick; parallel agents should use saveFindingsLocked.
 */
export function saveFindings(novelId: string, branchId: string, findings: ReviewFindings[]): void {
  const k = key(novelId, branchId);
  const s = store.get(k) || {};
  const existing = s.findings || [];
  // 按 dimension 覆盖：同 dimension 的旧条目移除，新批次追加
  const dims = Array.from(new Set(findings.map(f => f.dimension)));
  const kept = existing.filter(f => !dims.includes(f.dimension));
  s.findings = kept.concat(findings);
  store.set(k, s);
  console.log(`[Store] saveFindings ${novelId}/${branchId} dims=[${dims.join(",")}] -> ${s.findings.length} total (${kept.length} kept)`);
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
  return store.get(key(novelId, branchId))?.findings || [];
}

export function clearFindings(novelId: string, branchId: string): void {
  const k = key(novelId, branchId);
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
  const s = store.get(k) || {};
  s.prose = prose;
  store.set(k, s);
  console.log(`[Store] saveProse ${novelId}/${branchId} len=${prose.length}`);
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
  return store.get(key(novelId, branchId))?.prose;
}

/** 测试用清空 */
export function _resetStore(): void {
  store.clear();
}