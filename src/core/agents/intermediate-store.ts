/**
 * 进程内中间数据存储——按 novelId+branchId 隔离，子 agent 之间用它传递
 * 大纲、审查发现等信息。主 agent 不再转达具体内容，只看 hint。
 * 进程重启即丢失，一次续写流程内足够。
 */

type Outline = any;
interface ReviewFindings {
  dimension: string;
  severity: string;
  description: string;
  suggestion: string;
}

interface BranchStore {
  outline?: Outline;
  findings?: ReviewFindings[];
  prose?: string;
}

const store = new Map<string, BranchStore>();

function key(novelId: string, branchId: string): string {
  return `${novelId}::${branchId}`;
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

export function saveProse(novelId: string, branchId: string, prose: string): void {
  const k = key(novelId, branchId);
  const s = store.get(k) || {};
  s.prose = prose;
  store.set(k, s);
}

export function getProse(novelId: string, branchId: string): string | undefined {
  return store.get(key(novelId, branchId))?.prose;
}

/** 测试用清空 */
export function _resetStore(): void {
  store.clear();
}