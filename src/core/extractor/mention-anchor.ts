/**
 * Position anchors for character mentions — disambiguate same surface
 * at different book locations (coref + detail focus).
 */

export interface MentionAnchor {
  /** Absolute char offset in fullText (start of surface) */
  offset: number;
  /** Unit index when known */
  unitIndex?: number;
  /** e.g. 第3章 / 窗12 */
  unitLabel?: string;
  /** Surface string observed at this offset */
  surface?: string;
}

export const ANCHOR_PER_SURFACE_MAX = 6;
export const ANCHOR_PER_ENTITY_MAX = 12;

/** Stable id shown to agents: a@12345 */
export function formatAnchorId(a: Pick<MentionAnchor, "offset">): string {
  return `a@${Math.max(0, Math.floor(Number(a.offset) || 0))}`;
}

export function formatAnchorShort(a: MentionAnchor): string {
  const id = formatAnchorId(a);
  const where = (a.unitLabel || "").trim();
  const surf = (a.surface || "").trim();
  const bits = [id];
  if (where) bits.push(where);
  if (surf) bits.push(`「${surf}」`);
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
      const m = item.trim().match(/^a@(\d+)/i) || item.trim().match(/^(\d+)$/);
      if (m) offset = Math.max(0, parseInt(m[1], 10));
    } else if (typeof item === "object") {
      const o = item as Record<string, unknown>;
      if (o.offset != null && Number.isFinite(Number(o.offset))) {
        offset = Math.max(0, Math.floor(Number(o.offset)));
      } else if (typeof o.id === "string") {
        const m = String(o.id).match(/a@(\d+)/i);
        if (m) offset = Math.max(0, parseInt(m[1], 10));
      }
      if (o.unitIndex != null && Number.isFinite(Number(o.unitIndex))) {
        unitIndex = Math.floor(Number(o.unitIndex));
      }
      if (o.unitLabel != null) unitLabel = String(o.unitLabel).trim() || undefined;
      if (o.surface != null) surface = String(o.surface).trim() || undefined;
    }
    if (offset == null || seen.has(offset)) continue;
    seen.add(offset);
    out.push({ offset, unitIndex, unitLabel, surface });
    if (out.length >= cap) break;
  }
  return out.sort((a, b) => a.offset - b.offset);
}

/** Union by offset; keep first non-empty labels. */
export function mergeAnchors(
  a: MentionAnchor[] | undefined | null,
  b: MentionAnchor[] | undefined | null,
  cap = ANCHOR_PER_ENTITY_MAX,
): MentionAnchor[] {
  const by = new Map<number, MentionAnchor>();
  for (const x of [...(a || []), ...(b || [])]) {
    const off = Math.max(0, Math.floor(Number(x.offset) || 0));
    const prev = by.get(off);
    if (!prev) {
      by.set(off, {
        offset: off,
        unitIndex: x.unitIndex,
        unitLabel: x.unitLabel,
        surface: x.surface,
      });
      continue;
    }
    by.set(off, {
      offset: off,
      unitIndex: prev.unitIndex ?? x.unitIndex,
      unitLabel: prev.unitLabel || x.unitLabel,
      surface: prev.surface || x.surface,
    });
  }
  return Array.from(by.values())
    .sort((x, y) => x.offset - y.offset)
    .slice(0, cap);
}

/**
 * Prefer sparse sampling: first + evenly spaced + last when over cap.
 * Helps same-name-at-start-and-end books keep both clusters.
 */
export function sampleAnchors(
  anchors: MentionAnchor[],
  cap = ANCHOR_PER_SURFACE_MAX,
): MentionAnchor[] {
  if (anchors.length <= cap) return anchors;
  if (cap <= 1) return [anchors[0]];
  const out: MentionAnchor[] = [];
  const seen = new Set<number>();
  const push = (a: MentionAnchor) => {
    if (seen.has(a.offset)) return;
    seen.add(a.offset);
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
