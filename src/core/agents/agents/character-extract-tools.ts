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
  formatLookupResult,
  formatSurfaceCandidatesForPrompt,
} from "@/core/extractor/character-surface-catalog";
import {
  normalizeResolvedEntities,
  SUBMIT_ENTITIES_OK,
  type ResolvedEntity,
} from "@/core/extractor/character-entity-types";
import {
  beginNovelAnalysisWorkspace,
  getNovelAnalysisWorkspace,
  patchNovelAnalysisWorkspace,
} from "@/core/extractor/novel-analysis-workspace";
import type { CharacterProfile } from "@/types";

/**
 * Stage roster entities as profiles in analysis workspace (DB only on finish).
 * Roster brief is NOT personality/appearance detail — leave those empty so
 * profileHasDetail stays false until extract_character_detail submits full dims.
 */
export function entitiesToProfiles(entities: ResolvedEntity[]): CharacterProfile[] {
  return entities.map((e, i) => {
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
    } as CharacterProfile;
  });
}

function wsKey(ctx: { userId: string; novelId: string; branchId: string }) {
  return {
    userId: ctx.userId || "guest",
    novelId: ctx.novelId || "",
    branchId: ctx.branchId || "main",
  };
}

export const characterExtractTools: ToolDefinition[] = [
  {
    name: "list_surface_candidates",
    description:
      "列出分段扫名得到的候选称呼表面串（尚未指代消解）。可按 limit 截断。" +
      "例：孙悟空、齐天大圣、悟空 会分列。",
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
          content: "无扫名工作区。请确认角色抽取 job 已完成分段扫描。",
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
      "查询某个称呼在小说正文中的出现位置及前后文，用于判断是否与其他称呼指同一人。" +
      "例：查「齐天大圣」附近是否在写孙悟空；查「天蓬元帅」是否对应猪八戒。",
    parameters: {
      type: "object",
      properties: {
        surface: {
          type: "string",
          description: "要查询的称呼，如 齐天大圣、悟空",
        },
        maxHits: {
          type: "number",
          description: "最多返回几处上下文，默认 3，最大 6",
        },
      },
      required: ["surface"],
    },
    execute: async (args, ctx) => {
      const { userId, novelId, branchId } = wsKey(ctx);
      const ws = getCharacterExtractWorkspace(userId, novelId, branchId);
      if (!ws) {
        return { content: "无扫名工作区，无法查文。", messages: [] };
      }
      const surface = String(args.surface || "").trim();
      if (!surface) {
        return { content: "缺少 surface 参数", messages: [] };
      }
      const maxHits = Math.min(6, Math.max(1, Math.floor(Number(args.maxHits) || 3)));
      const hits = ws.catalog.lookup(surface, maxHits);
      return {
        content: formatLookupResult(surface, hits),
        messages: [],
      };
    },
  },
  {
    name: "lookup_offset",
    description:
      "按正文绝对字符 offset 读取一段原文（用于精读某次 lookup_surface 命中附近）。",
    parameters: {
      type: "object",
      properties: {
        offset: {
          type: "number",
          description: "正文起始 offset（0-based）",
        },
        length: {
          type: "number",
          description: "读取长度，默认 400，最大 2000",
        },
      },
      required: ["offset"],
    },
    execute: async (args, ctx) => {
      const { userId, novelId, branchId } = wsKey(ctx);
      const ws = getCharacterExtractWorkspace(userId, novelId, branchId);
      if (!ws) {
        return { content: "无扫名工作区", messages: [] };
      }
      const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
      const length = Math.min(2000, Math.max(50, Math.floor(Number(args.length) || 400)));
      const end = Math.min(ws.fullText.length, offset + length);
      const slice = ws.fullText.slice(offset, end);
      return {
        content:
          `offset=${offset}..${end} / total=${ws.fullText.length}\n` +
          slice.replace(/\s+/g, " ").trim(),
        messages: [],
      };
    },
  },
  {
    name: "submit_character_entities",
    description:
      "提交指代消解结果。每个实体：name=真实姓名，aliases=封号/外号/简称，surfaces=归入此人的所有候选表面串。" +
      "同一人只一条。完成后必须调用本工具，程序只认工具落盘。",
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
            "实体列表的 JSON 字符串。优先使用本字段。" +
            '格式：[{"name":"孙悟空","aliases":["齐天大圣","悟空"],"role":"protagonist","briefDescription":"...","surfaces":["孙悟空","齐天大圣","悟空"]}]',
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
        // Models sometimes pass array of objects despite schema saying string items
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

      const entities = normalizeResolvedEntities(raw);
      if (!entities.length) {
        return {
          content: "实体列表为空。请至少提交 1 个有效实体（name 必填）。",
          messages: [],
        };
      }

      const result = saveResolvedEntities(userId, novelId, branchId, entities);
      if (!result.ok) {
        return { content: result.message, messages: [] };
      }
      // Stage in analysis workspace only — finish_novel_analysis commits to DB
      try {
        let aws = getNovelAnalysisWorkspace(userId, novelId, branchId);
        if (!aws) {
          const text = getCharacterExtractWorkspace(userId, novelId, branchId)?.fullText || "";
          aws = beginNovelAnalysisWorkspace(userId, novelId, branchId, { fullText: text });
        }
        const staged = entitiesToProfiles(entities);
        const prev = aws.charactersDraft || [];
        const byName = new Map(prev.map((c) => [c.name.replace(/\s+/g, ""), c] as const));
        for (const p of staged) {
          const key = p.name.replace(/\s+/g, "");
          if (!byName.has(key)) byName.set(key, p);
          else {
            const old = byName.get(key)!;
            byName.set(key, {
              ...old,
              aliases: Array.from(new Set([...(old.aliases || []), ...(p.aliases || [])])),
            });
          }
        }
        patchNovelAnalysisWorkspace(userId, novelId, branchId, {
          charactersDraft: Array.from(byName.values()),
        });
      } catch (e) {
        console.warn(
          "[submit_character_entities] workspace stage failed:",
          (e as Error).message,
        );
      }
      return {
        content:
          `${SUBMIT_ENTITIES_OK}：${result.message}` +
          `（工作区 ${entities.length} 人，待 finish_novel_analysis 落库）`,
        messages: [],
      };
    },
  },
];
