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
  findFirstSecondPersonAliasIssues,
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
      "提交指代消解结果（可分批）。每批按 name 合并进工作区，不覆盖其它已交角色。" +
      "name=第三人称稳定指称；aliases=仅第三人称；禁止我爸/你妈等。" +
      "成功含「角色实体已存」并回报本批/累计人数。",
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
            "实体 JSON。aliases 必须第三人称。" +
            '例：[{"name":"周伯彦","aliases":["周总","周屿的父亲"],"role":"supporting","briefDescription":"...","surfaces":["周伯彦","周总"]}]' +
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

      // name/aliases must be third-person only — reject so the model rewrites and resubmits
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

      const entities = normalizeResolvedEntities(raw);
      if (!entities.length) {
        return {
          content: "实体列表为空。请至少提交 1 个有效实体（name 必填，且非第一二人称）。",
          messages: [],
        };
      }

      // Merge batch into workspace (multi-submit safe)
      const result = saveResolvedEntities(userId, novelId, branchId, entities);
      if (!result.ok) {
        return { content: result.message, messages: [] };
      }
      // Stage full merged roster into analysis draft (same merge semantics)
      try {
        let aws = getNovelAnalysisWorkspace(userId, novelId, branchId);
        if (!aws) {
          const text =
            getCharacterExtractWorkspace(userId, novelId, branchId)?.fullText ||
            "";
          aws = beginNovelAnalysisWorkspace(userId, novelId, branchId, {
            fullText: text,
          });
        }
        // Rebuild draft from **full** merged entities so draft ≡ entities
        const staged = entitiesToProfiles(result.entities);
        const prev = aws.charactersDraft || [];
        const byName = new Map(
          prev.map((c) => [c.name.replace(/\s+/g, ""), c] as const),
        );
        for (const p of staged) {
          const key = p.name.replace(/\s+/g, "");
          if (!byName.has(key)) byName.set(key, p);
          else {
            const old = byName.get(key)!;
            byName.set(key, {
              ...old,
              aliases: Array.from(
                new Set([...(old.aliases || []), ...(p.aliases || [])]),
              ),
              // keep richer brief if any
              appearance: {
                summary:
                  (p.appearance?.summary || "").length >
                  (old.appearance?.summary || "").length
                    ? p.appearance?.summary || ""
                    : old.appearance?.summary || "",
              },
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
          `${SUBMIT_ENTITIES_OK}：本批 ${result.batchCount} 人，累计 ${result.totalCount} 人` +
          `（可继续分批 submit；待 finish_novel_analysis 落库）`,
        messages: [],
      };
    },
  },
];
