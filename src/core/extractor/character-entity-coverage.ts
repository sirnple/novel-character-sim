/**
 * Catalog coverage for global coref agent feedback (no auto-merge).
 */

import type { ResolvedEntity } from "./character-entity-types";
import type { SurfaceCatalog } from "./character-surface-catalog";
import {
  isUnanchoredRelationLabel,
  nameKeyEntity,
} from "./character-entity-types";
import { formatAnchorId } from "./mention-anchor";

function norm(s: string): string {
  return nameKeyEntity(s);
}

export function claimedSurfaceSet(
  entities: ResolvedEntity[] | null | undefined,
): Set<string> {
  const set = new Set<string>();
  for (const e of entities || []) {
    for (const s of [e.name, ...(e.aliases || []), ...(e.surfaces || [])]) {
      const k = norm(s);
      if (k) set.add(k);
    }
  }
  return set;
}

export interface UncoveredSurface {
  surface: string;
  unitHits: number;
  textHits: number;
}

export function listUncoveredSurfaces(
  catalog: SurfaceCatalog | null | undefined,
  entities: ResolvedEntity[] | null | undefined,
  opts?: { minUnitHits?: number; limit?: number },
): UncoveredSurface[] {
  if (!catalog?.stats?.length) return [];
  const claimed = claimedSurfaceSet(entities);
  const minU = Math.max(0, opts?.minUnitHits ?? 1);
  const limit = Math.max(1, opts?.limit ?? 80);
  const out: UncoveredSurface[] = [];
  for (const st of catalog.stats) {
    const k = norm(st.surface);
    if (!k || claimed.has(k)) continue;
    if (st.unitHits < minU && st.textHits < minU) continue;
    out.push({
      surface: st.surface,
      unitHits: st.unitHits,
      textHits: st.textHits,
    });
  }
  out.sort(
    (a, b) =>
      b.unitHits - a.unitHits ||
      b.textHits - a.textHits ||
      a.surface.localeCompare(b.surface, "zh"),
  );
  return out.slice(0, limit);
}

export function formatUncoveredForPrompt(
  items: UncoveredSurface[],
  catalogTotal: number,
  claimedCount: number,
): string {
  if (!items.length) {
    return (
      `【catalog 覆盖】候选 ${catalogTotal} · 已挂名 ${claimedCount} · 高频未覆盖 0。可结束或再补漏。`
    );
  }
  const lines = items.slice(0, 40).map((u, i) => {
    return (
      `${i + 1}. 「${u.surface}」（扫名 ${u.unitHits} 段` +
      (u.textHits ? `，正文约 ${u.textHits}+ 处` : "") +
      `）`
    );
  });
  const more =
    items.length > 40 ? `\n…另有 ${items.length - 40} 个未列出` : "";
  return (
    `【catalog 未覆盖 · 请继续】候选 ${catalogTotal} · 已挂名约 ${claimedCount} · ` +
    `未覆盖 ${items.length}（lookup 后 merge 进已有实体或 upsert；称谓勿与真名拆两人）：\n` +
    lines.join("\n") +
    more
  );
}

/** Entities whose primary name is still an unanchored relation/role label. */
export function listRelationPrimaryNames(
  entities: ResolvedEntity[] | null | undefined,
): ResolvedEntity[] {
  return (entities || []).filter((e) =>
    isUnanchoredRelationLabel(String(e?.name || "").trim()),
  );
}

/**
 * Feedback for global agent: relation labels as name must be resolved via
 * lookup anchors → merge into existing real-name rows (not auto-merged here).
 */
export function formatRelationPrimariesForPrompt(
  entities: ResolvedEntity[] | null | undefined,
): string {
  const bad = listRelationPrimaryNames(entities);
  if (!bad.length) return "";
  const lines = bad.slice(0, 30).map((e, i) => {
    const anchors = (e.anchors || [])
      .slice(0, 6)
      .map((a) => formatAnchorId(a))
      .join(",");
    const al = (e.aliases || []).slice(0, 6).join("、");
    return (
      `${i + 1}. name=「${e.name}」` +
      (al ? ` aliases=[${al}]` : "") +
      (anchors ? ` anchors=[${anchors}]` : "（无锚点）") +
      ` → 请 lookup 锚点，对比已有角色，merge keep=真名/稳定名 absorb=["${e.name}"]`
    );
  });
  const more =
    bad.length > 30 ? `\n…另有 ${bad.length - 30} 个关系主名` : "";
  return (
    `【仍有悬空指代作 name】共 ${bad.length} 个：\n` +
    lines.join("\n") +
    more +
    `\n请 lookup 锚点，merge keep=真实实体 absorb=悬空词后再 submit。`
  );
}
