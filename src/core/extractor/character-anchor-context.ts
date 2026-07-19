/**
 * Build per-character novel context from unit-scan anchors.
 * Used by Pass2 detail + multi-round relationship extract.
 */

import type { TextUnit } from "./character-name-units";
import type { NameAggregate } from "./character-name-aggregate";

export interface CharacterAnchor {
  /** Preferred roster / profile name */
  canonical: string;
  /** All surfaces that map here (including canonical) */
  surfaces: string[];
  aliases: string[];
  mentions: number;
  unitHits: number;
  /** Unit indices where this character (any surface) appeared */
  unitIndices: number[];
}

function norm(s: string): string {
  return (s || "").replace(/\s+/g, "").trim();
}

/** Build lookup: any surface / alias → anchor (shared object). */
export function buildAnchorIndex(aggregates: NameAggregate[]): {
  bySurface: Map<string, CharacterAnchor>;
  anchors: CharacterAnchor[];
} {
  const bySurface = new Map<string, CharacterAnchor>();
  const anchors: CharacterAnchor[] = [];

  for (const c of aggregates) {
    const canonical = c.name;
    const surfaces = [canonical, ...(c.aliases || [])];
    const aliases = c.aliases || [];
    let unitIndices = c.unitIndices || [];
    if (!unitIndices.length) {
      if (typeof c.firstUnit === "number" && typeof c.lastUnit === "number") {
        unitIndices =
          c.firstUnit === c.lastUnit
            ? [c.firstUnit]
            : [c.firstUnit, c.lastUnit];
      }
    }

    const surfaceList = Array.from(
      new Set(surfaces.map(norm).filter(Boolean)),
    );
    const unitList = Array.from(new Set(unitIndices)).sort((a, b) => a - b);

    const anchor: CharacterAnchor = {
      canonical: norm(canonical) || canonical,
      surfaces: surfaceList,
      aliases: aliases.map(norm).filter(Boolean),
      mentions: c.mentions || 0,
      unitHits: c.unitHits || unitList.length,
      unitIndices: unitList,
    };
    anchors.push(anchor);
    for (const s of [anchor.canonical, ...anchor.surfaces, ...anchor.aliases]) {
      const k = norm(s);
      if (!k) continue;
      const prev = bySurface.get(k);
      if (!prev || prev.mentions < anchor.mentions) {
        bySurface.set(k, anchor);
      }
    }
  }

  return { bySurface, anchors };
}

export function resolveAnchor(
  name: string,
  bySurface: Map<string, CharacterAnchor>,
): CharacterAnchor | undefined {
  const k = norm(name);
  if (!k) return undefined;
  if (bySurface.has(k)) return bySurface.get(k);
  // soft: suffix containment
  const entries = Array.from(bySurface.entries());
  for (let i = 0; i < entries.length; i++) {
    const surf = entries[i][0];
    const a = entries[i][1];
    if (surf.length >= 2 && k.length >= 2) {
      if (surf.endsWith(k) || k.endsWith(surf)) return a;
    }
  }
  return undefined;
}

/**
 * Pick unit indices for context: first/last anchors + evenly spaced middle,
 * capped by maxUnits.
 */
export function pickUnitIndicesForContext(
  unitIndices: number[],
  maxUnits: number = 8,
): number[] {
  const sorted = Array.from(new Set(unitIndices)).sort((a, b) => a - b);
  if (sorted.length <= maxUnits) return sorted;
  if (maxUnits <= 1) return [sorted[0]];
  if (maxUnits === 2) return [sorted[0], sorted[sorted.length - 1]];

  const out: number[] = [];
  const used = new Set<number>();
  const add = (u: number) => {
    if (used.has(u)) return;
    used.add(u);
    out.push(u);
  };
  add(sorted[0]);
  add(sorted[sorted.length - 1]);
  const middleSlots = maxUnits - 2;
  for (let i = 1; i <= middleSlots; i++) {
    const t = i / (middleSlots + 1);
    const idx = Math.floor(t * (sorted.length - 1));
    add(sorted[idx]);
  }
  for (let i = 0; i < sorted.length && out.length < maxUnits; i++) {
    add(sorted[i]);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Concatenate selected unit texts with labels, under maxChars budget.
 * When `preferIndices` is set, those units are taken first (e.g. co-occurrence).
 */
export function buildContextFromUnits(
  units: TextUnit[],
  unitIndices: number[],
  opts?: {
    maxChars?: number;
    maxUnits?: number;
    /** Prioritize these unit indices before sampling the rest */
    preferIndices?: number[];
  },
): string {
  const maxChars = opts?.maxChars ?? 18_000;
  const maxUnits = opts?.maxUnits ?? 8;
  const prefer = new Set(opts?.preferIndices || []);
  const pool = Array.from(new Set(unitIndices)).sort((a, b) => a - b);
  const preferred = pool.filter((u) => prefer.has(u));
  const rest = pool.filter((u) => !prefer.has(u));
  // Prefer co-occur / high-value units, then fill with spaced sample of the rest
  const ordered = [
    ...preferred,
    ...pickUnitIndicesForContext(rest, Math.max(0, maxUnits - preferred.length)),
  ];
  const picked = pickUnitIndicesForContext(ordered, maxUnits);
  const parts: string[] = [];
  let used = 0;

  for (const ui of picked) {
    const u = units[ui];
    if (!u?.text) continue;
    const header = `【${u.label || `段${ui + 1}`}】\n`;
    let body = u.text;
    const room = maxChars - used - header.length - 20;
    if (room < 400) break;
    if (body.length > room) {
      body = body.slice(0, room) + "\n…";
    }
    const block = header + body;
    parts.push(block);
    used += block.length + 8;
    if (used >= maxChars) break;
  }

  return parts.join("\n\n---\n\n");
}

/** Unit indices where both anchors appear (co-occurrence). */
export function sharedUnitIndices(
  a: CharacterAnchor,
  b: CharacterAnchor,
): number[] {
  const setB = new Set(b.unitIndices || []);
  return (a.unitIndices || []).filter((u) => setB.has(u)).sort((x, y) => x - y);
}

/**
 * Context for relationship extract: prioritize units where focus co-occurs
 * with any candidate, then fill with focus-only anchors.
 */
export function buildRelationshipContext(
  focus: CharacterAnchor,
  candidates: CharacterAnchor[],
  units: TextUnit[],
  opts?: { maxChars?: number; maxUnits?: number },
): string {
  const maxChars = opts?.maxChars ?? 28_000;
  const maxUnits = opts?.maxUnits ?? 14;
  const co: number[] = [];
  const seen = new Set<number>();
  for (const c of candidates) {
    for (const u of sharedUnitIndices(focus, c)) {
      if (!seen.has(u)) {
        seen.add(u);
        co.push(u);
      }
    }
  }
  co.sort((a, b) => a - b);
  return buildContextFromUnits(units, focus.unitIndices, {
    maxChars,
    maxUnits,
    preferIndices: co,
  });
}

/** Names that co-occur in at least one unit with focus (excluding self surfaces). */
export function cooccurringNames(
  focus: CharacterAnchor,
  rosterNames: string[],
  bySurface: Map<string, CharacterAnchor>,
  opts?: { maxCandidates?: number },
): string[] {
  const maxCandidates = opts?.maxCandidates ?? 30;
  const focusUnits = new Set(focus.unitIndices);
  const focusSurfaces = new Set(
    [focus.canonical, ...focus.surfaces, ...focus.aliases].map(norm),
  );

  const scored: { name: string; score: number; mentions: number }[] = [];
  const seen = new Set<string>();

  for (const raw of rosterNames) {
    const n = norm(raw);
    if (!n || focusSurfaces.has(n)) continue;
    const a = resolveAnchor(raw, bySurface);
    const key = a?.canonical || n;
    if (seen.has(key) || focusSurfaces.has(key)) continue;
    seen.add(key);

    let overlap = 0;
    const units = a?.unitIndices || [];
    for (const u of units) {
      if (focusUnits.has(u)) overlap++;
    }
    if (overlap === 0 && !a) continue;
    if (overlap === 0) continue;

    scored.push({
      name: raw,
      score: overlap * 10 + (a?.mentions || 0),
      mentions: a?.mentions || 0,
    });
  }

  scored.sort((x, y) => y.score - x.score || y.mentions - x.mentions);
  return scored.slice(0, maxCandidates).map((s) => s.name);
}

export interface NamedWithRole {
  name: string;
  role?: string;
  briefDescription?: string;
  aliases?: string[];
}

export interface ImportanceRanked<T> {
  item: T;
  /** Scan mention count (primary importance signal) */
  mentions: number;
  unitHits: number;
  /**
   * Importance score from appearance only:
   * mentions dominate; multi-unit presence is a secondary boost.
   */
  importance: number;
}

/**
 * Rank roster by appearance frequency (not LLM role labels).
 * importance = mentions * 10 + unitHits
 */
export function rankByAppearanceImportance<T extends NamedWithRole>(
  roster: T[],
  bySurface: Map<string, CharacterAnchor>,
): ImportanceRanked<T>[] {
  const ranked: ImportanceRanked<T>[] = roster.map((c) => {
    const a = resolveAnchor(c.name, bySurface);
    const mentions = a?.mentions ?? 0;
    const unitHits = a?.unitHits ?? a?.unitIndices?.length ?? 0;
    return {
      item: c,
      mentions,
      unitHits,
      importance: mentions * 10 + unitHits,
    };
  });
  ranked.sort(
    (a, b) =>
      b.importance - a.importance ||
      b.mentions - a.mentions ||
      b.unitHits - a.unitHits,
  );
  return ranked;
}

export interface ImportanceSelectOpts {
  /**
   * Keep if importance >= maxImportance * relativeOfMax.
   * Detail default ~0.18; relationship default ~0.10 (wider net).
   */
  relativeOfMax: number;
  /**
   * Absolute mention floor (also scaled slightly for long books via caller).
   * Default 2.
   */
  minMentions?: number;
  /**
   * Safety cost cap only (not a fixed "top 12" product rule).
   * Default: no cap beyond roster size.
   */
  hardCap?: number;
}

/**
 * Dynamic cut by importance relative to the most frequent character.
 * Always keeps at least the #1 by appearance when roster is non-empty.
 */
export function selectByImportance<T extends NamedWithRole>(
  roster: T[],
  bySurface: Map<string, CharacterAnchor>,
  opts: ImportanceSelectOpts,
): T[] {
  if (!roster.length) return [];
  const ranked = rankByAppearanceImportance(roster, bySurface);
  const maxImp = ranked[0]?.importance || 0;
  const maxMentions = ranked[0]?.mentions || 0;
  const minMentions = opts.minMentions ?? 2;
  const rel = Math.max(0, Math.min(1, opts.relativeOfMax));

  // Threshold: relative to top character, but never below minMentions on the mention axis
  const impThreshold =
    maxImp <= 0 ? 0 : Math.max(1, Math.ceil(maxImp * rel));
  // Mention floor: at least minMentions, and not absurdly below top (e.g. top=100 → floor max(2, 10))
  const mentionFloor = Math.max(
    minMentions,
    maxMentions > 0 ? Math.ceil(maxMentions * rel) : minMentions,
  );

  let kept = ranked.filter((r) => {
    if (maxImp <= 0) return true; // no scan data: keep all (caller may soft-cap)
    return r.importance >= impThreshold || r.mentions >= mentionFloor;
  });

  // Always include the top-appearing character
  if (kept.length === 0 && ranked.length) {
    kept = [ranked[0]];
  }

  // If almost everyone passes (flat distribution), keep upper half by importance
  if (kept.length > roster.length * 0.85 && roster.length > 6) {
    const half = Math.max(3, Math.ceil(roster.length * 0.5));
    kept = ranked.slice(0, half);
  }

  if (opts.hardCap != null && opts.hardCap > 0 && kept.length > opts.hardCap) {
    kept = kept.slice(0, opts.hardCap);
  }

  return kept.map((k) => k.item);
}

/**
 * Deep detail: higher importance bar (major / frequent characters).
 */
export function selectDetailTargets<T extends NamedWithRole>(
  roster: T[],
  bySurface: Map<string, CharacterAnchor>,
  opts?: Partial<ImportanceSelectOpts>,
): T[] {
  return selectByImportance(roster, bySurface, {
    relativeOfMax: opts?.relativeOfMax ?? 0.18,
    minMentions: opts?.minMentions ?? 2,
    hardCap: opts?.hardCap, // undefined = no fixed top-N
  });
}

/**
 * Relationship multi-round focus: wider net than detail so the graph is denser
 * (still frequency-driven; not a fixed top-N).
 */
export function selectRelationshipFocus<T extends NamedWithRole>(
  roster: T[],
  bySurface: Map<string, CharacterAnchor>,
  opts?: Partial<ImportanceSelectOpts>,
): T[] {
  return selectByImportance(roster, bySurface, {
    relativeOfMax: opts?.relativeOfMax ?? 0.06,
    minMentions: opts?.minMentions ?? 2,
    hardCap: opts?.hardCap,
  });
}
