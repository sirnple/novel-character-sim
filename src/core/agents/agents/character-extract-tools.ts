/**
 * Tools for character extract agents (coreference etc.).
 * Require an active character-extract workspace (set by extract job).
 */

import type { ToolDefinition } from "../types";
import {
  getCharacterExtractWorkspace,
  saveResolvedEntities,
} from "@/core/extractor/character-extract-workspace";
import {
  anchorsForSurfaces,
  formatLookupResult,
  formatSurfaceCandidatesForPrompt,
} from "@/core/extractor/character-surface-catalog";
import {
  findFirstSecondPersonAliasIssues,
  normalizeResolvedEntities,
  validateSubmitEntities,
  SUBMIT_ENTITIES_OK,
  type ResolvedEntity,
} from "@/core/extractor/character-entity-types";
import {
  mergeAnchors,
  normalizeAnchors,
} from "@/core/extractor/mention-anchor";
import type { SurfaceCatalog } from "@/core/extractor/character-surface-catalog";
import {
  beginNovelAnalysisWorkspace,
  getNovelAnalysisWorkspace,
  patchNovelAnalysisWorkspace,
} from "@/core/extractor/novel-analysis-workspace";
import { rebuildDraftFromRoster } from "../character-draft-utils";
import {
  BATCH_TEXT_BUDGET,
  formatBatchOverflowNotice,
} from "../batch-tool-limits";
import type { CharacterProfile } from "@/types";
import {
  collapseTechnicalFarSameNameKeys,
  formatLocalEntitiesForPrompt,
  formatNearCrossNameCandidatesForPrompt,
  listNearCrossNameAliasCandidates,
  DEFAULT_SAME_NAME_UNIT_DISTANCE,
} from "@/core/extractor/character-local-entities";
import {
  formatUncoveredForPrompt,
  listUncoveredSurfaces,
  claimedSurfaceSet,
} from "@/core/extractor/character-entity-coverage";
import {
  applyEntityOps,
  parseEntityOps,
} from "@/core/extractor/character-entity-ops";
import { mergeResolvedEntities } from "@/core/extractor/character-entity-types";

/**
 * Stage roster entities as profiles in analysis workspace (master commits later).
 * Roster brief is NOT personality/appearance detail — leave those empty so
 * profileHasDetail stays false until extract_character_detail submits full dims.
 */
export function entitiesToProfiles(entities: ResolvedEntity[]): CharacterProfile[] {
  // Web path must match char-job: fold seed `名@uN` before any UI/DB profile.
  // Eval job collapses in character-extract-job; agent/commit used to skip this.
  const cleaned = collapseTechnicalFarSameNameKeys(entities || []);
  return cleaned.map((e, i) => {
    const mentionAnchors = (e.anchors || []).map((a) => ({
      offset: a.offset,
      unitIndex: a.unitIndex,
      unitLabel: a.unitLabel,
      surface: a.surface,
    }));
    return {
      id: `char_${i}_${e.name.replace(/\s+/g, "").slice(0, 24)}`,
      name: e.name,
      aliases: e.aliases || [],
      // brief stays only as optional one-liner on appearance for list UI, short enough
      // that profileHasDetail still fails until multi-dimension detail is submitted
      appearance: {
        summary: e.briefDescription ? `（名单）${e.briefDescription}` : "",
      },
      personality: {
        traits: [],
        description: "",
        decisionStyle: "",
        underPressure: "",
      },
      drive: {
        goal: "",
        motivation: "",
        fear: "",
        weakness: "",
        bottomLine: "",
        secret: "",
      },
      behavior: { patterns: [], habits: [], attitudeToAuthority: "" },
      worldview: "",
      values: [],
      speakingStyle: {
        description: "",
        catchphrases: [],
        sentenceStyle: "",
        vocabulary: "",
        emotionalExpression: "",
      },
      voice: { description: "" },
      background: { origin: "", keyEvents: [], description: "" },
      relationships: [],
      mentionAnchors: mentionAnchors.length ? mentionAnchors : undefined,
    } as CharacterProfile;
  });
}

/** Fill missing entity anchors from catalog surface rows. */
export function enrichEntitiesWithCatalogAnchors(
  entities: ResolvedEntity[],
  catalog: SurfaceCatalog | null | undefined,
): ResolvedEntity[] {
  if (!catalog) return entities;
  return entities.map((e) => {
    const fromCatalog = anchorsForSurfaces(catalog, [
      e.name,
      ...(e.aliases || []),
      ...(e.surfaces || []),
    ]);
    const anchors = mergeAnchors(e.anchors, fromCatalog);
    return anchors.length ? { ...e, anchors } : e;
  });
}

function wsKey(ctx: { userId: string; novelId: string; branchId: string }) {
  return {
    userId: ctx.userId || "guest",
    novelId: ctx.novelId || "",
    branchId: ctx.branchId || "main",
  };
}

/** Max surfaces per lookup_surface call (batch). */
export const LOOKUP_SURFACE_BATCH_MAX = 10;
/** Max offsets per lookup_offset call (batch). */
export const LOOKUP_OFFSET_BATCH_MAX = 10;

/** Parse surface list from surface | surfaces | surfaces_json. */
export function parseSurfaceBatch(args: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (s: unknown) => {
    const t = String(s ?? "").trim();
    if (t) out.push(t);
  };
  if (typeof args.surfaces_json === "string" && args.surfaces_json.trim()) {
    try {
      const p = JSON.parse(args.surfaces_json);
      if (Array.isArray(p)) p.forEach(push);
      else if (Array.isArray(p?.surfaces)) p.surfaces.forEach(push);
    } catch {
      /* ignore */
    }
  }
  if (Array.isArray(args.surfaces)) {
    for (const s of args.surfaces) push(s);
  }
  if (typeof args.surface === "string" && args.surface.trim()) {
    // Allow "甲,乙,丙" only when no surfaces array provided
    const raw = args.surface.trim();
    if (!out.length && raw.includes(",") && !raw.includes("，")) {
      raw.split(",").forEach(push);
    } else if (!out.length && raw.includes("，")) {
      raw.split("，").forEach(push);
    } else {
      push(raw);
    }
  }
  // de-dupe preserve order
  const seen = new Set<string>();
  return out.filter((s) => {
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });
}

export function parseOffsetBatch(
  args: Record<string, unknown>,
): Array<{ offset: number; length?: number }> {
  const out: Array<{ offset: number; length?: number }> = [];
  const add = (o: unknown, len?: unknown) => {
    const offset = Math.max(0, Math.floor(Number(o)));
    if (!Number.isFinite(offset)) return;
    const length =
      len != null && Number.isFinite(Number(len))
        ? Math.floor(Number(len))
        : undefined;
    out.push({ offset, length });
  };
  if (typeof args.offsets_json === "string" && args.offsets_json.trim()) {
    try {
      const p = JSON.parse(args.offsets_json);
      const arr = Array.isArray(p) ? p : p?.offsets;
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (item != null && typeof item === "object") {
            add((item as any).offset ?? (item as any).o, (item as any).length ?? (item as any).len);
          } else {
            add(item);
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
  if (Array.isArray(args.offsets)) {
    for (const item of args.offsets) {
      if (item != null && typeof item === "object") {
        add((item as any).offset ?? (item as any).o, (item as any).length ?? (item as any).len);
      } else {
        add(item);
      }
    }
  }
  if (args.offset != null && args.offset !== "" && !out.length) {
    add(args.offset, args.length);
  } else if (args.offset != null && args.offset !== "" && out.length) {
    // also allow single offset alongside batch? skip to avoid dup
  }
  // de-dupe by offset
  const seen = new Set<number>();
  return out.filter((r) => {
    if (seen.has(r.offset)) return false;
    seen.add(r.offset);
    return true;
  });
}

export const characterExtractTools: ToolDefinition[] = [
  {
    name: "list_local_entities",
    description:
      "列出阶段1局部消解实体（每窗 name+aliases+锚点）。全书消解应以此为输入做 merge/split。" +
      "可分页 offset/limit。",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "默认 80，最大 150" },
        offset: { type: "number", description: "分页跳过，默认 0" },
      },
      required: [],
    },
    execute: async (args, ctx) => {
      const { userId, novelId, branchId } = wsKey(ctx);
      const ws = getCharacterExtractWorkspace(userId, novelId, branchId);
      if (!ws) {
        return { content: "无工作区。请先 scan_character_mentions。", messages: [] };
      }
      const limit = Math.min(150, Math.max(1, Math.floor(Number(args.limit) || 80)));
      const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
      const locals = ws.localEntities || [];
      return {
        content: formatLocalEntitiesForPrompt(locals, { offset, limit }),
        messages: [],
      };
    },
  },
  {
    name: "list_near_alias_candidates",
    description:
      "列出**近距异名**对（不同 name、unit 间距≤D）：最可能是「另一称呼/aliases」的候选。" +
      "含：同窗分列、邻窗异名、关系称谓↔姓名、一方 aliases 含另一方、共享表面。" +
      "对「女朋友/大儿子」等：lookup 锚点，对比已有角色后 merge keep=真名 absorb=关系称谓。" +
      "优先处理本列表。",
    parameters: {
      type: "object",
      properties: {
        maxUnitDistance: {
          type: "number",
          description: `近距阈值，默认 ${DEFAULT_SAME_NAME_UNIT_DISTANCE}`,
        },
        limit: { type: "number", description: "最多返回对数，默认 60，最大 100" },
      },
      required: [],
    },
    execute: async (args, ctx) => {
      const { userId, novelId, branchId } = wsKey(ctx);
      const ws = getCharacterExtractWorkspace(userId, novelId, branchId);
      if (!ws) {
        return { content: "无工作区。请先 scan_character_mentions。", messages: [] };
      }
      const maxUnitDistance = Math.max(
        0,
        Math.floor(
          Number(args.maxUnitDistance) || DEFAULT_SAME_NAME_UNIT_DISTANCE,
        ),
      );
      const limit = Math.min(
        100,
        Math.max(1, Math.floor(Number(args.limit) || 60)),
      );
      const items = listNearCrossNameAliasCandidates(ws.localEntities || [], {
        maxUnitDistance,
        limit,
      });
      return {
        content: formatNearCrossNameCandidatesForPrompt(items, {
          maxUnitDistance,
        }),
        messages: [],
      };
    },
  },
  {
    name: "list_uncovered_surfaces",
    description:
      "列出 catalog 中尚未落入任何全书实体 name/aliases/surfaces 的高频 surface。" +
      "submit 后应用此检查是否还需 merge/upsert。",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "默认 60，最大 120" },
        minUnitHits: { type: "number", description: "最少扫名段数，默认 1" },
      },
      required: [],
    },
    execute: async (args, ctx) => {
      const { userId, novelId, branchId } = wsKey(ctx);
      const ws = getCharacterExtractWorkspace(userId, novelId, branchId);
      if (!ws) {
        return { content: "无工作区。", messages: [] };
      }
      const limit = Math.min(120, Math.max(1, Math.floor(Number(args.limit) || 60)));
      const minUnitHits = Math.max(0, Math.floor(Number(args.minUnitHits) || 1));
      const items = listUncoveredSurfaces(ws.catalog, ws.entities, {
        limit,
        minUnitHits,
      });
      const claimed = claimedSurfaceSet(ws.entities).size;
      return {
        content: formatUncoveredForPrompt(
          items,
          ws.catalog.stats.length,
          claimed,
        ),
        messages: [],
      };
    },
  },
  {
    name: "list_surface_candidates",
    description:
      "列出扫名 catalog 的 surface（频次+锚点）。优先 list_local_entities 做全书消解；" +
      "本工具用于补漏与 lookup。可分页。",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "最多返回前 N 个（按出现段数排序），默认 120，最大 200",
        },
        offset: {
          type: "number",
          description: "跳过前 offset 个，用于分页浏览，默认 0",
        },
      },
      required: [],
    },
    execute: async (args, ctx) => {
      const { userId, novelId, branchId } = wsKey(ctx);
      if (!novelId) {
        return { content: "缺少 novelId", messages: [] };
      }
      const ws = getCharacterExtractWorkspace(userId, novelId, branchId);
      if (!ws) {
        return {
          content: "无角色指称 catalog。请先调用 scan_character_mentions。",
          messages: [],
        };
      }
      const limit = Math.min(200, Math.max(1, Math.floor(Number(args.limit) || 120)));
      const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
      const slice = ws.catalog.stats.slice(offset, offset + limit);
      const body = formatSurfaceCandidatesForPrompt(slice);
      return {
        content:
          `共 ${ws.catalog.stats.length} 个候选；本页 offset=${offset} limit=${limit}（${slice.length} 条）\n` +
          body,
        messages: [],
      };
    },
  },
  {
    name: "lookup_surface",
    description:
      "按称呼查上下文，结果带 **锚点 a@offset**（同名异人按锚点拆）。" +
      "**优先批量** surfaces（最多 " +
      `${LOOKUP_SURFACE_BATCH_MAX}）。` +
      "若返回「输出超限」：缩小批量再查。例：surfaces=[\"齐天大圣\",\"周总\"]。",
    parameters: {
      type: "object",
      properties: {
        surface: {
          type: "string",
          description: "单个称呼；也可用中/英文逗号分隔多个（无 surfaces 时）",
        },
        surfaces: {
          type: "array",
          description: `多个称呼，最多 ${LOOKUP_SURFACE_BATCH_MAX} 个（推荐批查）`,
          items: { type: "string" },
        },
        surfaces_json: {
          type: "string",
          description: 'JSON 数组，如 ["齐天大圣","周总"]',
        },
        maxHits: {
          type: "number",
          description:
            "每个称呼最多几处上下文。单查默认 3 最大 6；批查默认 2 最大 4",
        },
      },
      required: [],
    },
    execute: async (args, ctx) => {
      const { userId, novelId, branchId } = wsKey(ctx);
      const ws = getCharacterExtractWorkspace(userId, novelId, branchId);
      if (!ws) {
        return { content: "无扫名工作区，无法查文。", messages: [] };
      }
      const allSurfaces = parseSurfaceBatch(args as Record<string, unknown>);
      if (!allSurfaces.length) {
        return {
          content:
            "缺少 surface/surfaces。优先批查：surfaces=[\"周总\",\"周伯彦\"]；单查：surface=\"周总\"。",
          messages: [],
        };
      }
      const countOmitted = allSurfaces.slice(LOOKUP_SURFACE_BATCH_MAX);
      let surfaces = allSurfaces.slice(0, LOOKUP_SURFACE_BATCH_MAX);
      const batch = surfaces.length > 1;
      const maxHits = Math.min(
        batch ? 4 : 6,
        Math.max(1, Math.floor(Number(args.maxHits) || (batch ? 2 : 3))),
      );
      const parts: string[] = [];
      if (batch) {
        parts.push(
          `【批量 lookup_surface】请求 ${allSurfaces.length} 个称呼，本批处理 ${surfaces.length} 个` +
            `（每称呼最多 ${maxHits} 处；输出预算 ${BATCH_TEXT_BUDGET} 字）`,
        );
      }
      let used = 0;
      let returned = 0;
      const budgetOmitted: string[] = [];
      for (let i = 0; i < surfaces.length; i++) {
        const surface = surfaces[i];
        if (used >= BATCH_TEXT_BUDGET) {
          budgetOmitted.push(...surfaces.slice(i));
          break;
        }
        const hits = ws.catalog.lookup(surface, maxHits);
        const block = formatLookupResult(surface, hits);
        parts.push(block);
        used += block.length;
        returned++;
      }
      const notices: string[] = [];
      if (countOmitted.length) {
        notices.push(
          formatBatchOverflowNotice({
            itemLabel: "称呼",
            toolHint: 'lookup_surface(surfaces=[...])',
            requested: allSurfaces.length,
            returned: surfaces.length - budgetOmitted.length,
            omitted: countOmitted,
            reason: "count_cap",
            countCap: LOOKUP_SURFACE_BATCH_MAX,
          }),
        );
      }
      if (budgetOmitted.length) {
        notices.push(
          formatBatchOverflowNotice({
            itemLabel: "称呼",
            toolHint: 'lookup_surface(surfaces=[...])',
            requested: surfaces.length,
            returned,
            omitted: budgetOmitted,
            reason: "output_budget",
            budget: BATCH_TEXT_BUDGET,
          }),
        );
      }
      const body = parts.join("\n\n");
      return {
        content: notices.length ? `${body}\n\n${notices.join("\n\n")}` : body,
        messages: [],
      };
    },
  },
  {
    name: "lookup_offset",
    description:
      "按 **unit/章节锚点** 读原文。锚点优先 `u@3`（扫名窗）或 unit 起始 a@offset。" +
      "批量 anchors（最多 " +
      `${LOOKUP_OFFSET_BATCH_MAX}）。` +
      '例：anchors=["u@0","u@12"] 或 ["第1回"] 用 list 里的 u@。',
    parameters: {
      type: "object",
      properties: {
        offset: {
          type: "number",
          description: "单次：正文起始 offset（unit.start）",
        },
        length: {
          type: "number",
          description: "单次读取长度；默认读满 unit 窗（上限 2000）",
        },
        offsets: {
          type: "array",
          description: `多个 offset 或 {offset,length}，最多 ${LOOKUP_OFFSET_BATCH_MAX}`,
          items: { type: "string" },
        },
        offsets_json: {
          type: "string",
          description: 'JSON：数字数组或 [{"offset":0,"length":400},...]',
        },
        anchors: {
          type: "array",
          description: '锚点 id，如 ["u@3","u@12"] 或 a@{unitStart}',
          items: { type: "string" },
        },
        anchors_json: {
          type: "string",
          description: '锚点 JSON，如 ["u@0","u@5"]',
        },
      },
      required: [],
    },
    execute: async (args, ctx) => {
      const { userId, novelId, branchId } = wsKey(ctx);
      const ws = getCharacterExtractWorkspace(userId, novelId, branchId);
      // Fall back to analysis fullText if extract workspace missing (detail agent)
      let fullText = ws?.fullText || "";
      const aws = getNovelAnalysisWorkspace(userId, novelId, branchId);
      if (!fullText) {
        fullText = aws?.fullText || "";
      }
      if (!fullText) {
        return { content: "无正文可读（请先 scan 或加载小说）", messages: [] };
      }
      const units =
        (ws?.units && ws.units.length ? ws.units : null) ||
        aws?.units ||
        [];
      const resolveUnitRange = (
        a: { offset: number; unitIndex?: number; unitLabel?: string },
      ): { offset: number; length?: number; label: string } => {
        if (a.unitIndex != null && units[a.unitIndex]) {
          const u = units[a.unitIndex] as {
            start: number;
            end: number;
            label?: string;
            text?: string;
          };
          const len = Math.min(
            2000,
            Math.max(200, (u.end ?? u.start + 800) - u.start),
          );
          return {
            offset: u.start,
            length: len,
            label: u.label || `u@${a.unitIndex}`,
          };
        }
        // Match unit by start offset
        const hit = (units as { start: number; end: number; label?: string }[]).find(
          (u) => Math.abs(u.start - a.offset) < 8,
        );
        if (hit) {
          return {
            offset: hit.start,
            length: Math.min(2000, Math.max(200, hit.end - hit.start)),
            label: hit.label || `a@${hit.start}`,
          };
        }
        return {
          offset: a.offset,
          length: undefined,
          label: a.unitLabel || `a@${a.offset}`,
        };
      };

      const rawAnchors = normalizeAnchors(
        typeof args.anchors_json === "string" && args.anchors_json.trim()
          ? (() => {
              try {
                return JSON.parse(args.anchors_json as string);
              } catch {
                return [];
              }
            })()
          : args.anchors,
      );
      // Resolve u@N: normalizeAnchors may leave offset=0 — fix from unitIndex
      const fromAnchors: Array<{ offset: number; length?: number; label: string }> =
        rawAnchors.map((a) => {
          if (
            a.unitIndex != null &&
            (!a.offset || a.offset === 0) &&
            units[a.unitIndex]
          ) {
            return resolveUnitRange({
              ...a,
              offset: (units[a.unitIndex] as { start: number }).start,
            });
          }
          return resolveUnitRange(a);
        });
      const mergedRanges: Array<{ offset: number; length?: number; label?: string }> = [
        ...parseOffsetBatch(args as Record<string, unknown>).map((r) => ({
          ...r,
          label: `a@${r.offset}`,
        })),
        ...fromAnchors,
      ];
      const seenOff = new Set<number>();
      const allRanges = mergedRanges.filter((r) => {
        if (seenOff.has(r.offset)) return false;
        seenOff.add(r.offset);
        return true;
      });
      if (!allRanges.length) {
        return {
          content:
            "缺少 offset/offsets/anchors。优先用名单 unit 锚点：anchors=[\"u@0\",\"u@12\"]。",
          messages: [],
        };
      }
      const countOmitted = allRanges.slice(LOOKUP_OFFSET_BATCH_MAX);
      let ranges = allRanges.slice(0, LOOKUP_OFFSET_BATCH_MAX);
      const batch = ranges.length > 1;
      // Unit windows are larger than char snippets
      const defaultLen = batch ? 1200 : 1600;
      const maxLen = 2000;
      const globalLen =
        args.length != null
          ? Math.min(maxLen, Math.max(50, Math.floor(Number(args.length) || defaultLen)))
          : null;
      const parts: string[] = [];
      if (batch) {
        parts.push(
          `【批量 lookup 扫名窗】请求 ${allRanges.length} 处，本批 ${ranges.length} 处` +
            `（每窗上限 ${maxLen} 字；输出预算 ${BATCH_TEXT_BUDGET} 字）`,
        );
      }
      let used = 0;
      let returned = 0;
      const budgetOmitted: Array<{ offset: number }> = [];
      for (let i = 0; i < ranges.length; i++) {
        const r = ranges[i] as {
          offset: number;
          length?: number;
          label?: string;
        };
        if (used >= BATCH_TEXT_BUDGET) {
          budgetOmitted.push(...ranges.slice(i));
          break;
        }
        const length = Math.min(
          maxLen,
          Math.max(
            50,
            r.length != null
              ? Math.floor(r.length)
              : globalLen != null
                ? globalLen
                : defaultLen,
          ),
        );
        const offset = r.offset;
        const end = Math.min(fullText.length, offset + length);
        const slice = fullText.slice(offset, end).replace(/\s+/g, " ").trim();
        const label = r.label || `a@${offset}`;
        const block =
          `--- ${label} · offset=${offset}..${end} / total=${fullText.length} ---\n${slice}`;
        parts.push(block);
        used += block.length;
        returned++;
      }
      const notices: string[] = [];
      if (countOmitted.length) {
        notices.push(
          formatBatchOverflowNotice({
            itemLabel: "锚点",
            toolHint: 'lookup_offset(anchors=["a@…"])',
            requested: allRanges.length,
            returned: ranges.length - budgetOmitted.length,
            omitted: countOmitted.map((r) => `a@${r.offset}`),
            reason: "count_cap",
            countCap: LOOKUP_OFFSET_BATCH_MAX,
          }),
        );
      }
      if (budgetOmitted.length) {
        notices.push(
          formatBatchOverflowNotice({
            itemLabel: "锚点",
            toolHint: 'lookup_offset(anchors=["a@…"])',
            requested: ranges.length,
            returned,
            omitted: budgetOmitted.map((r) => `a@${r.offset}`),
            reason: "output_budget",
            budget: BATCH_TEXT_BUDGET,
          }),
        );
      }
      const body = parts.join("\n\n");
      return {
        content: notices.length ? `${body}\n\n${notices.join("\n\n")}` : body,
        messages: [],
      };
    },
  },
  {
    name: "submit_character_entities",
    description:
      "提交全书实体（**可分批、多次** merge/upsert；单次成功≠名单域已全部完成）。" +
      "顺序：先执行 ops（merge/split），再 upsert entities。" +
      "merge: {op:\"merge\",keep,absorb:[]}；split: {op:\"split\",from,move_surfaces?,move_anchors?,new_name?}。" +
      "aliases 仅第三人称。成功含「角色实体已存」+ 未覆盖 surface 提示；有未覆盖应继续 lookup/submit。",
    parameters: {
      type: "object",
      properties: {
        entities: {
          type: "array",
          description: "角色实体列表（upsert）",
          items: { type: "string" },
        },
        entities_json: {
          type: "string",
          description:
            "实体 JSON。anchors=扫名 unit（unitIndex/unitLabel）。例：" +
            '[{"name":"孙悟空","aliases":["齐天大圣"],"surfaces":["孙悟空","齐天大圣"],' +
            '"anchors":[{"unitIndex":0,"unitLabel":"第1回","offset":0},{"unitIndex":12,"unitLabel":"第13回","offset":50000}]}]',
        },
        ops: {
          type: "array",
          description: "merge/split 操作数组",
          items: { type: "string" },
        },
        ops_json: {
          type: "string",
          description:
            'ops JSON。例：[{"op":"merge","keep":"孙悟空","absorb":["齐天大圣"]},' +
            '{"op":"split","from":"孙悟空","move_anchors":["u@12"],"new_name":"某路人"}]',
        },
      },
      required: [],
    },
    execute: async (args, ctx) => {
      const { userId, novelId, branchId } = wsKey(ctx);
      if (!novelId) {
        return { content: "缺少 novelId", messages: [] };
      }

      let raw: ResolvedEntity[] = [];
      if (typeof args.entities_json === "string" && args.entities_json.trim()) {
        try {
          const parsed = JSON.parse(args.entities_json);
          raw = Array.isArray(parsed) ? parsed : parsed?.entities || [];
        } catch {
          return {
            content: "entities_json 不是合法 JSON，请重试。",
            messages: [],
          };
        }
      } else if (Array.isArray(args.entities)) {
        raw = args.entities as unknown as ResolvedEntity[];
        if (raw.length && typeof raw[0] === "string") {
          try {
            raw = (raw as unknown as string[]).map((s) => JSON.parse(s));
          } catch {
            return {
              content: "entities 数组解析失败；请改用 entities_json 提交完整 JSON。",
              messages: [],
            };
          }
        }
      }

      const ops = parseEntityOps(
        typeof args.ops_json === "string" && args.ops_json.trim()
          ? args.ops_json
          : args.ops,
      );

      let entities = normalizeResolvedEntities(raw);
      if (!entities.length && !ops.length) {
        return {
          content:
            "实体列表与 ops 皆空。请 upsert entities 和/或提供 merge/split ops。",
          messages: [],
        };
      }

      // Program validates only — does not re-pick names or merge people.
      // Agent must fix empty/duplicate/suspended primary names.
      const deicticIssues = findFirstSecondPersonAliasIssues(entities);
      const structIssues = validateSubmitEntities(entities);
      const issues = Array.from(new Set([...deicticIssues, ...structIssues]));
      if (issues.length) {
        return {
          content:
            `未写入：请修正后重交 submit_character_entities。\n` +
            `问题：${issues.slice(0, 24).join("；")}` +
            (issues.length > 24 ? `…共${issues.length}处` : "") +
            `\n要求：主名非空且不重复；主名不能是女朋友/弟弟/他爸等悬空指代；` +
            `aliases 禁止我爸/你妈；悬空指代须 merge 到真实实体。`,
          messages: [],
        };
      }

      const cws = getCharacterExtractWorkspace(userId, novelId, branchId);
      entities = enrichEntitiesWithCatalogAnchors(entities, cws?.catalog);
      const withAnchors = entities.filter((e) => (e.anchors?.length || 0) > 0).length;

      // Preview full roster after ops+upsert; validate again before write
      const base = cws?.entities || [];
      let preview = base;
      if (ops.length) {
        preview = applyEntityOps(preview, ops).entities;
      }
      if (entities.length) {
        preview = mergeResolvedEntities(preview, entities);
      }
      const fullIssues = validateSubmitEntities(preview);
      const fullDeictic = findFirstSecondPersonAliasIssues(preview);
      const fullAll = Array.from(new Set([...fullIssues, ...fullDeictic]));
      if (fullAll.length) {
        return {
          content:
            `未写入：合并后名单仍有问题。\n` +
            `问题：${fullAll.slice(0, 24).join("；")}` +
            (fullAll.length > 24 ? `…共${fullAll.length}处` : "") +
            `\n请 lookup 锚点，merge 悬空指代到真实实体，消除重复主名后再 submit。`,
          messages: [],
        };
      }

      const result = saveResolvedEntities(userId, novelId, branchId, entities, {
        ops,
      });
      if (!result.ok) {
        return { content: result.message, messages: [] };
      }
      try {
        let aws = getNovelAnalysisWorkspace(userId, novelId, branchId);
        if (!aws) {
          const text = cws?.fullText || "";
          aws = beginNovelAnalysisWorkspace(userId, novelId, branchId, {
            fullText: text,
          });
        }
        const staged = entitiesToProfiles(result.entities);
        const nextDraft = rebuildDraftFromRoster(staged, aws.charactersDraft);
        patchNovelAnalysisWorkspace(userId, novelId, branchId, {
          charactersDraft: nextDraft,
        });
      } catch (e) {
        console.warn(
          "[submit_character_entities] workspace stage failed:",
          (e as Error).message,
        );
      }

      const uncovered = listUncoveredSurfaces(cws?.catalog, result.entities, {
        limit: 40,
        minUnitHits: 1,
      });
      const claimed = claimedSurfaceSet(result.entities).size;
      const coverNote = formatUncoveredForPrompt(
        uncovered,
        cws?.catalog.stats.length || 0,
        claimed,
      );
      const opNote =
        result.opLog?.length > 0
          ? `\nops：${result.opLog.slice(0, 12).join("；")}`
          : "";

      return {
        content:
          `${SUBMIT_ENTITIES_OK}：本批 upsert ${result.batchCount} 人，累计 ${result.totalCount} 人` +
          `（本批含锚点 ${withAnchors}/${entities.length || 0}）` +
          opNote +
          `\n${coverNote}`,
        messages: [],
      };
    },
  },
];
