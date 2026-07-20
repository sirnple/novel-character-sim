/**
 * Anchors for character mentions — **unit/chapter grain**, not precise char
 * positions. Enough to re-open the scan window via lookup_offset (offset =
 * unit.start) or by unitLabel.
 */

export interface MentionAnchor {
  /**
   * Lookup key into fullText: typically **unit.start** (window start),
   * not the exact surface char index.
   */
  offset: number;
  /** Scan unit index (0-based in name-scan units array) */
  unitIndex?: number;
  /** e.g. 第3回 / 第12章 / 窗5 */
  unitLabel?: string;
  /** Optional surface associated with this unit hit */
  surface?: string;
}

export const ANCHOR_PER_SURFACE_MAX = 6;
export const ANCHOR_PER_ENTITY_MAX = 12;

/**
 * Stable id for tools: prefer unit id `u@3`, else `a@{unitStartOffset}`.
 */
export function formatAnchorId(
  a: Pick<MentionAnchor, "offset" | "unitIndex">,
): string {
  if (a.unitIndex != null && Number.isFinite(Number(a.unitIndex))) {
    return `u@${Math.max(0, Math.floor(Number(a.unitIndex)))}`;
  }
  return `a@${Math.max(0, Math.floor(Number(a.offset) || 0))}`;
}

/** Human-facing: chapter/unit first, then id */
export function formatAnchorShort(a: MentionAnchor): string {
  const where = (a.unitLabel || "").trim();
  const id = formatAnchorId(a);
  const bits: string[] = [];
  if (where) bits.push(where);
  else bits.push(id);
  if (where) bits.push(id);
  return bits.join(" ");
}

export function normalizeAnchors(
  raw: unknown,
  cap = ANCHOR_PER_ENTITY_MAX,
): MentionAnchor[] {
  if (!Array.isArray(raw)) return [];
  const out: MentionAnchor[] = [];
  const seen = new Set<number>();
  for (const item of raw) {
    if (item == null) continue;
    let offset: number | null = null;
    let unitIndex: number | undefined;
    let unitLabel: string | undefined;
    let surface: string | undefined;
    if (typeof item === "number" && Number.isFinite(item)) {
      offset = Math.max(0, Math.floor(item));
    } else if (typeof item === "string") {
      const t = item.trim();
      const mu = t.match(/^u@(\d+)/i);
      const ma = t.match(/^a@(\d+)/i) || t.match(/^(\d+)$/);
      if (mu) {
        unitIndex = Math.max(0, parseInt(mu[1], 10));
        // offset filled by caller when resolving unit; keep 0 placeholder
        offset = 0;
      } else if (ma) {
        offset = Math.max(0, parseInt(ma[1], 10));
      }
    } else if (typeof item === "object") {
      const o = item as Record<string, unknown>;
      if (o.unitIndex != null && Number.isFinite(Number(o.unitIndex))) {
        unitIndex = Math.floor(Number(o.unitIndex));
      }
      if (o.offset != null && Number.isFinite(Number(o.offset))) {
        offset = Math.max(0, Math.floor(Number(o.offset)));
      } else if (typeof o.id === "string") {
        const mu = String(o.id).match(/^u@(\d+)/i);
        const ma = String(o.id).match(/a@(\d+)/i);
        if (mu) unitIndex = Math.max(0, parseInt(mu[1], 10));
        if (ma) offset = Math.max(0, parseInt(ma[1], 10));
      }
      if (o.unitLabel != null) unitLabel = String(o.unitLabel).trim() || undefined;
      if (o.surface != null) surface = String(o.surface).trim() || undefined;
      // unit-only object: use unitIndex as identity; offset may be 0
      if (offset == null && unitIndex != null) offset = 0;
    }
    if (offset == null) continue;
    // Dedupe by unit when known, else by offset
    const dedupeKey =
      unitIndex != null ? unitIndex + 1_000_000_000 : offset;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({ offset, unitIndex, unitLabel, surface });
    if (out.length >= cap) break;
  }
  return out.sort(
    (a, b) =>
      (a.unitIndex ?? a.offset) - (b.unitIndex ?? b.offset) ||
      a.offset - b.offset,
  );
}

/** Union by unit (preferred) or offset; keep first non-empty labels. */
export function mergeAnchors(
  a: MentionAnchor[] | undefined | null,
  b: MentionAnchor[] | undefined | null,
  cap = ANCHOR_PER_ENTITY_MAX,
): MentionAnchor[] {
  const by = new Map<string, MentionAnchor>();
  for (const x of [...(a || []), ...(b || [])]) {
    const off = Math.max(0, Math.floor(Number(x.offset) || 0));
    const ui =
      x.unitIndex != null && Number.isFinite(Number(x.unitIndex))
        ? Math.floor(Number(x.unitIndex))
        : undefined;
    const key = ui != null ? `u:${ui}` : `o:${off}`;
    const prev = by.get(key);
    if (!prev) {
      by.set(key, {
        offset: off,
        unitIndex: ui,
        unitLabel: x.unitLabel,
        surface: x.surface,
      });
      continue;
    }
    by.set(key, {
      offset: prev.offset || off,
      unitIndex: prev.unitIndex ?? ui,
      unitLabel: prev.unitLabel || x.unitLabel,
      surface: prev.surface || x.surface,
    });
  }
  return Array.from(by.values())
    .sort(
      (x, y) =>
        (x.unitIndex ?? x.offset) - (y.unitIndex ?? y.offset) ||
        x.offset - y.offset,
    )
    .slice(0, cap);
}

/**
 * Sparse sample of unit-level anchors: first + evenly spaced + last.
 */
export function sampleAnchors(
  anchors: MentionAnchor[],
  cap = ANCHOR_PER_SURFACE_MAX,
): MentionAnchor[] {
  if (anchors.length <= cap) return anchors;
  if (cap <= 1) return [anchors[0]];
  const out: MentionAnchor[] = [];
  const seen = new Set<string>();
  const push = (a: MentionAnchor) => {
    const key =
      a.unitIndex != null ? `u:${a.unitIndex}` : `o:${a.offset}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(a);
  };
  push(anchors[0]);
  for (let i = 1; i < cap - 1; i++) {
    const idx = Math.round((i / (cap - 1)) * (anchors.length - 1));
    push(anchors[idx]);
  }
  push(anchors[anchors.length - 1]);
  return out.slice(0, cap);
}

/** Build a unit/chapter anchor (offset = unit window start for lookup). */
export function unitAnchor(
  unit: { start: number; label?: string },
  unitIndex: number,
  surface?: string,
): MentionAnchor {
  return {
    offset: Math.max(0, Math.floor(Number(unit.start) || 0)),
    unitIndex,
    unitLabel: (unit.label || "").trim() || `u${unitIndex}`,
    surface,
  };
}
