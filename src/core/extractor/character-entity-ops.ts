/**
 * Global roster ops: merge / split by surface and/or anchor (LLM-directed).
 */

import {
  mergeAnchors,
  normalizeAnchors,
  type MentionAnchor,
} from "./mention-anchor";
import {
  nameKeyEntity,
  type ResolvedEntity,
} from "./character-entity-types";

export type EntityOp =
  | { op: "merge"; keep: string; absorb: string[] }
  | {
      op: "split";
      from: string;
      move_surfaces?: string[];
      move_anchors?: Array<string | number | { offset: number }>;
      new_name?: string;
    };

function norm(s: string): string {
  return nameKeyEntity(s);
}

function findByName(
  list: ResolvedEntity[],
  name: string,
): { idx: number; ent: ResolvedEntity } | null {
  const k = norm(name);
  if (!k) return null;
  for (let i = 0; i < list.length; i++) {
    if (norm(list[i].name) === k) return { idx: i, ent: list[i] };
    // also match if name is an alias of ent
    if ((list[i].aliases || []).some((a) => norm(a) === k)) {
      return { idx: i, ent: list[i] };
    }
    if ((list[i].surfaces || []).some((a) => norm(a) === k)) {
      return { idx: i, ent: list[i] };
    }
  }
  return null;
}

function allSurfaces(e: ResolvedEntity): string[] {
  return Array.from(
    new Set(
      [e.name, ...(e.aliases || []), ...(e.surfaces || [])]
        .map((s) => String(s).trim())
        .filter(Boolean),
    ),
  );
}

function rebuildLabels(
  nameHint: string,
  surfaces: string[],
  anchors: MentionAnchor[] | undefined,
  role?: string,
  brief?: string,
): ResolvedEntity {
  const uniq = Array.from(new Set(surfaces.map((s) => s.trim()).filter(Boolean)));
  const hint = (nameHint || "").trim();
  // Honor explicit keep/new_name when present in the surface set
  let name =
    (hint && uniq.some((s) => norm(s) === norm(hint)) ? hint : "") ||
    uniq[0] ||
    hint ||
    "未命名";
  const TITLEISH = /小姐|少爷|大嫂|嫂子|夫人|太太|总$/;
  for (const s of uniq) {
    if (norm(s) === norm(name)) continue;
    // Prefer longer non-title form over short title-only keep only when hint empty
    if (
      !TITLEISH.test(s) &&
      TITLEISH.test(name) &&
      s.length >= 2 &&
      s.length <= 8
    ) {
      name = s;
    }
  }
  const nk = norm(name);
  const aliases = uniq.filter((s) => norm(s) !== nk);
  return {
    name,
    aliases,
    surfaces: uniq,
    anchors: anchors?.length ? anchors : undefined,
    role: role || "supporting",
    briefDescription: brief,
  };
}

function parseMoveOffsets(
  move?: Array<string | number | { offset: number }>,
): number[] {
  if (!move?.length) return [];
  const out: number[] = [];
  for (const item of move) {
    if (typeof item === "number" && Number.isFinite(item)) {
      out.push(Math.max(0, Math.floor(item)));
    } else if (typeof item === "string") {
      const m = item.trim().match(/^a@(\d+)/i) || item.trim().match(/^(\d+)$/);
      if (m) out.push(Math.max(0, parseInt(m[1], 10)));
    } else if (item && typeof item === "object" && "offset" in item) {
      out.push(Math.max(0, Math.floor(Number((item as any).offset) || 0)));
    }
  }
  return out;
}

export function applyEntityOps(
  roster: ResolvedEntity[],
  ops: EntityOp[] | undefined | null,
): { entities: ResolvedEntity[]; log: string[] } {
  let list = roster.map((e) => ({ ...e }));
  const log: string[] = [];
  if (!ops?.length) return { entities: list, log };

  for (const raw of ops) {
    if (!raw || typeof raw !== "object") continue;
    const op = (raw as EntityOp).op;

    if (op === "merge") {
      const keepName = String((raw as any).keep || "").trim();
      const absorb = Array.isArray((raw as any).absorb)
        ? (raw as any).absorb.map((x: unknown) => String(x).trim()).filter(Boolean)
        : [];
      const keepHit = findByName(list, keepName);
      if (!keepHit) {
        log.push(`merge 跳过：找不到 keep「${keepName}」`);
        continue;
      }
      let keep = keepHit.ent;
      const removeIdx = new Set<number>();
      for (const ab of absorb) {
        const hit = findByName(list, ab);
        if (!hit || hit.idx === keepHit.idx) continue;
        keep = rebuildLabels(
          keep.name,
          [...allSurfaces(keep), ...allSurfaces(hit.ent)],
          mergeAnchors(keep.anchors, hit.ent.anchors),
          keep.role || hit.ent.role,
          (keep.briefDescription || "").length >=
            (hit.ent.briefDescription || "").length
            ? keep.briefDescription
            : hit.ent.briefDescription,
        );
        removeIdx.add(hit.idx);
        log.push(`merge 「${hit.ent.name}」→「${keep.name}」`);
      }
      list = list
        .map((e, i) => (i === keepHit.idx ? keep : e))
        .filter((_, i) => !removeIdx.has(i));
      continue;
    }

    if (op === "split") {
      const fromName = String((raw as any).from || "").trim();
      const fromHit = findByName(list, fromName);
      if (!fromHit) {
        log.push(`split 跳过：找不到 from「${fromName}」`);
        continue;
      }
      const moveSurfaces = Array.isArray((raw as any).move_surfaces)
        ? (raw as any).move_surfaces
            .map((x: unknown) => String(x).trim())
            .filter(Boolean)
        : [];
      const moveOff = parseMoveOffsets((raw as any).move_anchors);
      const moveSurfKeys = new Set(moveSurfaces.map(norm));
      const moveOffSet = new Set(moveOff);

      if (!moveSurfKeys.size && !moveOffSet.size) {
        log.push(`split 跳过：未指定 move_surfaces / move_anchors`);
        continue;
      }

      const from = fromHit.ent;
      const fromAnchors = from.anchors || [];
      const stayAnchors: MentionAnchor[] = [];
      const moveAnchors: MentionAnchor[] = [];
      for (const a of fromAnchors) {
        const byOff = moveOffSet.has(a.offset);
        const bySurf = a.surface && moveSurfKeys.has(norm(a.surface));
        if (byOff || bySurf) moveAnchors.push(a);
        else stayAnchors.push(a);
      }
      // Also move by surface label even without anchors
      const staySurfaces = allSurfaces(from).filter((s) => !moveSurfKeys.has(norm(s)));
      let goneSurfaces = allSurfaces(from).filter((s) => moveSurfKeys.has(norm(s)));
      for (const a of moveAnchors) {
        if (a.surface) goneSurfaces.push(a.surface);
      }
      goneSurfaces = Array.from(new Set(goneSurfaces.map((s) => s.trim()).filter(Boolean)));

      if (!goneSurfaces.length && !moveAnchors.length) {
        log.push(`split 跳过：没有可挪走的 surface/锚点`);
        continue;
      }
      if (!staySurfaces.length) {
        // keep at least one label on from
        staySurfaces.push(from.name);
        goneSurfaces = goneSurfaces.filter((s) => norm(s) !== norm(from.name));
      }

      const newName =
        String((raw as any).new_name || "").trim() ||
        goneSurfaces.sort((a, b) => b.length - a.length)[0] ||
        "未命名";

      const left = rebuildLabels(
        from.name,
        staySurfaces,
        stayAnchors,
        from.role,
        from.briefDescription,
      );
      const right = rebuildLabels(newName, goneSurfaces, moveAnchors);

      list[fromHit.idx] = left;
      list.push(right);
      log.push(
        `split 「${from.name}」→ 保留「${left.name}」+ 新「${right.name}」(挪 ${goneSurfaces.join("、") || moveAnchors.length + "锚点"})`,
      );
    }
  }

  return { entities: list, log };
}

export function parseEntityOps(raw: unknown): EntityOp[] {
  if (!raw) return [];
  let arr: unknown[] = [];
  if (typeof raw === "string" && raw.trim()) {
    try {
      const p = JSON.parse(raw);
      arr = Array.isArray(p) ? p : p?.ops || [];
    } catch {
      return [];
    }
  } else if (Array.isArray(raw)) {
    arr = raw;
  }
  const out: EntityOp[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const op = String(o.op || "").toLowerCase();
    if (op === "merge") {
      out.push({
        op: "merge",
        keep: String(o.keep || "").trim(),
        absorb: Array.isArray(o.absorb)
          ? o.absorb.map((x) => String(x).trim()).filter(Boolean)
          : [],
      });
    } else if (op === "split") {
      out.push({
        op: "split",
        from: String(o.from || "").trim(),
        move_surfaces: Array.isArray(o.move_surfaces)
          ? o.move_surfaces.map((x) => String(x).trim()).filter(Boolean)
          : undefined,
        move_anchors: Array.isArray(o.move_anchors)
          ? (o.move_anchors as Array<string | number | { offset: number }>)
          : undefined,
        new_name: o.new_name != null ? String(o.new_name).trim() : undefined,
      });
    }
  }
  return out;
}
