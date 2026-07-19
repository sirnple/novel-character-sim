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

/**
 * Stage roster entities as profiles in analysis workspace (DB only on finish).
 * Roster brief is NOT personality/appearance detail — leave those empty so
 * profileHasDetail stays false until extract_character_detail submits full dims.
 */
export function entitiesToProfiles(entities: ResolvedEntity[]): CharacterProfile[] {
  return entities.map((e, i) => {
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
    name: "list_surface_candidates",
    description:
      "列出 scan_character_mentions 得到的候选角色指称 surface（尚未指代消解）。可分页。" +
      "例：孙悟空、齐天大圣、周屿的母亲。无 catalog 时先调 scan_character_mentions。",
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
      "按 **锚点 offset** 读原文（消解/详情请用名单里的 a@offset，勿只靠角色名）。" +
      "**优先批量** offsets/anchors（最多 " +
      `${LOOKUP_OFFSET_BATCH_MAX}）。` +
      '例：offsets=[1200,8800] 或 anchors_json=["a@1200","a@8800"]。',
    parameters: {
      type: "object",
      properties: {
        offset: {
          type: "number",
          description: "单次：正文起始 offset（0-based）= 锚点数字部分",
        },
        length: {
          type: "number",
          description: "单次读取长度，默认 400，最大 2000；批读默认更短",
        },
        offsets: {
          type: "array",
          description: `多个 offset 或 {offset,length}，最多 ${LOOKUP_OFFSET_BATCH_MAX}`,
          items: {},
        },
        offsets_json: {
          type: "string",
          description: 'JSON：数字数组或 [{"offset":0,"length":400},...]',
        },
        anchors: {
          type: "array",
          description: '锚点 id 或对象，如 ["a@1200",{"offset":8800}]',
          items: {},
        },
        anchors_json: {
          type: "string",
          description: '锚点 JSON，如 ["a@1200","a@8800"]',
        },
      },
      required: [],
    },
    execute: async (args, ctx) => {
      const { userId, novelId, branchId } = wsKey(ctx);
      const ws = getCharacterExtractWorkspace(userId, novelId, branchId);
      // Fall back to analysis fullText if extract workspace missing (detail agent)
      let fullText = ws?.fullText || "";
      if (!fullText) {
        const aws = getNovelAnalysisWorkspace(userId, novelId, branchId);
        fullText = aws?.fullText || "";
      }
      if (!fullText) {
        return { content: "无正文可读（请先 scan 或加载小说）", messages: [] };
      }
      // Merge anchors into offset batch
      const fromAnchors = normalizeAnchors(
        typeof args.anchors_json === "string" && args.anchors_json.trim()
          ? (() => {
              try {
                return JSON.parse(args.anchors_json as string);
              } catch {
                return [];
              }
            })()
          : args.anchors,
      ).map((a) => ({ offset: a.offset }));
      const mergedRanges = [
        ...parseOffsetBatch(args as Record<string, unknown>),
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
            "缺少 offset/offsets/anchors。优先用名单锚点：anchors=[\"a@1200\",\"a@8800\"]。",
          messages: [],
        };
      }
      const countOmitted = allRanges.slice(LOOKUP_OFFSET_BATCH_MAX);
      let ranges = allRanges.slice(0, LOOKUP_OFFSET_BATCH_MAX);
      const batch = ranges.length > 1;
      const defaultLen = batch ? 350 : 400;
      const maxLen = batch ? 800 : 2000;
      const globalLen =
        args.length != null
          ? Math.min(maxLen, Math.max(50, Math.floor(Number(args.length) || defaultLen)))
          : null;
      const parts: string[] = [];
      if (batch) {
        parts.push(
          `【批量 lookup_offset】请求 ${allRanges.length} 处，本批处理 ${ranges.length} 处` +
            `（每段默认 ${defaultLen}、上限 ${maxLen}；输出预算 ${BATCH_TEXT_BUDGET} 字）`,
        );
      }
      let used = 0;
      let returned = 0;
      const budgetOmitted: Array<{ offset: number }> = [];
      for (let i = 0; i < ranges.length; i++) {
        const r = ranges[i];
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
        const block =
          `--- a@${offset} offset=${offset}..${end} / total=${fullText.length} ---\n${slice}`;
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
      "提交指代消解结果（可分批）。每批按 name 合并。" +
      "须带 surfaces；**建议带 anchors**（a@offset）归属此人的出现位置；同名异人拆成多条不同 name 或不同锚点集。" +
      "aliases 仅第三人称。成功含「角色实体已存」。",
    parameters: {
      type: "object",
      properties: {
        entities: {
          type: "array",
          description: "角色实体列表",
          items: { type: "string" },
        },
        entities_json: {
          type: "string",
          description:
            "实体 JSON。aliases 第三人称；anchors 为出现位置。" +
            '例：[{"name":"周伯彦","aliases":["周总"],"surfaces":["周伯彦","周总"],"anchors":[{"offset":1200,"unitLabel":"第1章"},{"offset":8800}]}]' +
            "（不可 aliases 含 我爸/你爸）",
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

      const deicticIssues = findFirstSecondPersonAliasIssues(raw);
      if (deicticIssues.length) {
        return {
          content:
            `未写入：name/aliases 含第一或二人称指示语，请改成第三人称稳定称呼后重交 submit_character_entities。\n` +
            `问题：${deicticIssues.slice(0, 20).join("；")}` +
            (deicticIssues.length > 20 ? `…共${deicticIssues.length}处` : "") +
            `\n正确例：周伯彦 aliases=["周总","周屿的父亲"]；错误例：aliases=["我爸","你爸"]。`,
          messages: [],
        };
      }

      let entities = normalizeResolvedEntities(raw);
      if (!entities.length) {
        return {
          content: "实体列表为空。请至少提交 1 个有效实体（name 必填，且非第一二人称）。",
          messages: [],
        };
      }

      // Attach catalog anchors when agent omitted them
      const cws = getCharacterExtractWorkspace(userId, novelId, branchId);
      entities = enrichEntitiesWithCatalogAnchors(entities, cws?.catalog);
      const withAnchors = entities.filter((e) => (e.anchors?.length || 0) > 0).length;

      const result = saveResolvedEntities(userId, novelId, branchId, entities);
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
      return {
        content:
          `${SUBMIT_ENTITIES_OK}：本批 ${result.batchCount} 人，累计 ${result.totalCount} 人` +
          `（本批含锚点 ${withAnchors}/${entities.length}；可继续分批；待 finish 落库）`,
        messages: [],
      };
    },
  },
];
