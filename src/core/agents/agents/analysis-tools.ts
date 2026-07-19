/**
 * Tools for novel analysis agents (master + domain sub-agents).
 * Form is a program tool wrap; others support submit_* for agent loops.
 */
import type { ToolDefinition } from "../types";
import {
  getBranchProse,
  getBranch,
  listBranches,
  getNovel,
  saveStoryInfo,
  saveNovelForm,
  saveTimeline,
  saveCharacters,
  getCharacters,
  getStoryInfo,
  getNovelForm,
  getTimeline,
  upsertExtractedStyle,
  replaceExtractedIdeas,
  listStyles,
  listIdeas,
  getBranchChapterMeta,
  saveBranchChapterMeta,
} from "@/lib/db";
import type { BranchChapterMeta, ChapterCatalogEntry } from "@/types";
import { parseNovel } from "@/core/parser/novel-parser";
import { buildNovelContext } from "@/core/parser/novel-parser";
import {
  analyzeNovelForm,
  buildFormDraftFromText,
  enrichFormDraftWithLlm,
} from "@/core/form/form-analyzer";
import { buildNameScanUnits } from "@/core/extractor/character-name-units";
import { entitiesToProfiles } from "./character-extract-tools";
import {
  ANALYSIS_AGENT_DEPENDENCIES,
  ANALYSIS_DOMAIN_TO_AGENT,
  ANALYSIS_SUBAGENT_TYPES,
  buildLaunchPlan,
  resolveAnalysisAgentType,
} from "../analysis-allowlist";
import {
  applyRelationshipEdges,
  detailPayloadIsRich,
  detailPayloadRejectReason,
  mergeCharacterProfiles,
  nameKey,
  profileDetailScore,
  profileHasDetail,
} from "../character-draft-utils";
import {
  getNovelAnalysisWorkspace,
  beginNovelAnalysisWorkspace,
  patchNovelAnalysisWorkspace,
} from "@/core/extractor/novel-analysis-workspace";
import {
  beginCharacterExtractWorkspace,
  getCharacterExtractWorkspace,
} from "@/core/extractor/character-extract-workspace";
import {
  BATCH_TEXT_BUDGET,
  formatBatchOverflowNotice,
} from "../batch-tool-limits";
import { buildSurfaceCatalog } from "@/core/extractor/character-surface-catalog";
import { scanUnitHitsWithLlm } from "@/core/extractor/character-name-scan";
import { relationshipTypePromptList } from "@/core/extractor/relationship-types";
import { createLLMProvider } from "@/core/llm/factory";
import { isChinese } from "@/lib/utils";
import type { StoryInfo, WritingStyle, ChapterTimeline, CharacterProfile, IdeaLibraryEntry, LLMProvider } from "@/types";

function ids(ctx: { userId: string; novelId: string; branchId: string }) {
  return {
    userId: ctx.userId || "guest",
    novelId: ctx.novelId || "",
    branchId: ctx.branchId || "main",
  };
}

/** Prefer real book title; never fall back to id when a non-empty title exists. */
function resolveBookTitle(userId: string, novelId: string): string {
  const novel = getNovel(userId, novelId);
  const t = (novel?.title || "").trim();
  if (t && t !== novelId) return t;
  // Some imports only store text on branch; title may still be on novels row empty
  const branches = listBranches(userId, novelId);
  const named = branches.find((b) => b.name && b.name !== "主线" && b.name !== "main");
  if (named?.name?.trim()) return named.name.trim();
  return t || novelId;
}

function loadText(userId: string, novelId: string, branchId: string): string {
  const ws = getNovelAnalysisWorkspace(userId, novelId, branchId);
  if (ws?.fullText) return ws.fullText;
  const { text } = getBranchProse(userId, novelId, branchId);
  if (text?.trim()) return text;
  return getNovel(userId, novelId)?.text || "";
}

function ensureWs(userId: string, novelId: string, branchId: string) {
  let ws = getNovelAnalysisWorkspace(userId, novelId, branchId);
  if (!ws) {
    ws = beginNovelAnalysisWorkspace(userId, novelId, branchId, {
      fullText: loadText(userId, novelId, branchId),
    });
  }
  return ws;
}

/**
 * LLM unit-scan → surface catalog (same path as character-extract-job).
 * Never uses programmatic surname heuristics for product roster.
 */
async function seedCharacterCatalogViaLlm(
  userId: string,
  novelId: string,
  branchId: string,
  text: string,
  units: ReturnType<typeof buildNameScanUnits>,
  llm: LLMProvider,
): Promise<{ surfaceCount: number; unitCount: number }> {
  let unitsLocal = units.length ? units : buildNameScanUnits(text);
  if (!unitsLocal.length) {
    unitsLocal = [
      {
        index: 0,
        label: "全文",
        start: 0,
        end: text.length,
        text,
      },
    ];
  }
  const { units: scannedUnits, unitHits } = await scanUnitHitsWithLlm(llm, text, {
    units: unitsLocal,
    zh: isChinese(text),
  });
  const catalog = buildSurfaceCatalog(unitHits, scannedUnits, text);
  beginCharacterExtractWorkspace(userId, novelId, branchId, {
    fullText: text,
    catalog,
    unitCount: scannedUnits.length,
  });
  return { surfaceCount: catalog.stats.length, unitCount: scannedUnits.length };
}

export const ANALYSIS_OK = {
  form: "章法已存",
  story: "故事世界已存",
  detail: "角色详情已存",
  rels: "角色关系已存",
  timeline: "时间线已存",
  style: "文风已存",
  ideas: "点子已存",
  finish: "全书分析已完成",
  /** LLM unit mention catalog ready (tool: scan_character_mentions) */
  scan: "角色指称已扫描",
  gate: "名单筛选已完成",
} as const;

/** Shared read + form + submit tools for domain agents */
export const analysisDomainTools: ToolDefinition[] = [
  {
    name: "get_current_novel",
    description:
      "获取当前绑定的小说：novelId、标题、正文长度、是否已有故事/角色/章法缓存。分析开始时必须先调用。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => {
      const { userId, novelId, branchId } = ids(ctx);
      if (!novelId) {
        return { content: "当前未绑定 novelId。", messages: [] };
      }
      const novel = getNovel(userId, novelId);
      const text = loadText(userId, novelId, branchId);
      const chars = getCharacters(userId, novelId);
      const story = getStoryInfo(userId, novelId);
      const form = getNovelForm(userId, novelId);
      const title = resolveBookTitle(userId, novelId);
      return {
        content: JSON.stringify(
          {
            novelId,
            title: title || "(无标题)",
            textLength: text.length || (novel?.text || "").length,
            hasText: text.length > 0,
            characterCount: chars.length,
            hasStory: !!story?.plotSummary,
            hasForm: !!form,
            note: "后续工具与子 Agent 均针对本 novelId；正文由工具按分支读取。",
          },
          null,
          2,
        ),
        messages: [],
      };
    },
  },
  {
    name: "get_current_branch",
    description:
      "获取当前绑定的分支：branchId、是否主线、正文长度、可用分支列表。分析开始时必须调用。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => {
      const { userId, novelId, branchId } = ids(ctx);
      if (!novelId) {
        return { content: "当前未绑定 novelId。", messages: [] };
      }
      const branch = getBranch(userId, novelId, branchId);
      const { text } = getBranchProse(userId, novelId, branchId);
      const all = listBranches(userId, novelId);
      return {
        content: JSON.stringify(
          {
            novelId,
            branchId,
            isMain: branchId === "main",
            branchExists: !!branch,
            branchTextLength: (text || branch?.text || "").length,
            availableBranches: all.map((b) => ({
              id: b.id,
              name: b.name || b.id,
              parentBranchId: b.parent_branch_id || "",
              charCount: b.char_count || 0,
            })),
            note: "分析默认使用当前 branchId（概览一般为 main）。",
          },
          null,
          2,
        ),
        messages: [],
      };
    },
  },
  {
    name: "get_analysis_context",
    description:
      "获取当前分析任务摘要：novelId、branchId、正文长度、modules、已完成域。可与 get_current_novel / get_current_branch 一起用。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => {
      const { userId, novelId, branchId } = ids(ctx);
      const text = loadText(userId, novelId, branchId);
      const ws = getNovelAnalysisWorkspace(userId, novelId, branchId);
      const novel = getNovel(userId, novelId);
      return {
        content: JSON.stringify(
          {
            novelId,
            title: novel?.title || "",
            branchId,
            textLength: text.length,
            modules: ws?.modules || [],
            forceRefresh: ws?.forceRefresh || false,
            hasForm: !!(ws?.form || getNovelForm(userId, novelId)),
            hasStory: !!(ws?.storyInfo || getStoryInfo(userId, novelId)),
            unitCount: ws?.units?.length || 0,
            characterCount: getCharacters(userId, novelId).length,
          },
          null,
          2,
        ),
        messages: [],
      };
    },
  },
  {
    name: "get_novel_excerpt",
    description: "获取小说代表性节选（开/中/尾），用于故事/文风等分析。",
    parameters: {
      type: "object",
      properties: {
        maxChars: { type: "number", description: "最大字符，默认 12000" },
      },
      required: [],
    },
    execute: async (args, ctx) => {
      const { userId, novelId, branchId } = ids(ctx);
      const text = loadText(userId, novelId, branchId);
      if (!text) return { content: "正文为空", messages: [] };
      const parsed = parseNovel(text);
      parsed.fullText = text;
      const max = Math.min(40000, Math.max(2000, Number(args.maxChars) || 12000));
      const excerpt = buildNovelContext(parsed, 5).slice(0, max);
      return { content: excerpt || text.slice(0, max), messages: [] };
    },
  },
  {
    name: "get_text_slice",
    description: "按 offset/length 读取正文切片。",
    parameters: {
      type: "object",
      properties: {
        offset: { type: "number", description: "起始 offset" },
        length: { type: "number", description: "长度，默认 800，最大 4000" },
      },
      required: ["offset"],
    },
    execute: async (args, ctx) => {
      const { userId, novelId, branchId } = ids(ctx);
      const text = loadText(userId, novelId, branchId);
      const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
      const length = Math.min(4000, Math.max(50, Math.floor(Number(args.length) || 800)));
      return {
        content: text.slice(offset, offset + length),
        messages: [],
      };
    },
  },
  {
    name: "list_text_units",
    description: "列出章法/切分后的文本单元（章或窗）。需先有章法或可从正文切窗。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => {
      const { userId, novelId, branchId } = ids(ctx);
      const ws = getNovelAnalysisWorkspace(userId, novelId, branchId);
      let units = ws?.units || [];
      if (!units.length) {
        const text = loadText(userId, novelId, branchId);
        units = buildNameScanUnits(text);
        if (ws) patchNovelAnalysisWorkspace(userId, novelId, branchId, { units });
      }
      const lines = units
        .slice(0, 200)
        .map((u, i) => `${i}. ${u.label} chars=${u.text?.length || 0}`)
        .join("\n");
      return {
        content: `共 ${units.length} 单元\n${lines}`,
        messages: [],
      };
    },
  },
  {
    name: "get_unit_text",
    description:
      "按单元下标读正文。**优先批量** indices（最多 6）。" +
      "若返回「输出超限」：缩小批量再读未返回项，必要时单条 index。",
    parameters: {
      type: "object",
      properties: {
        index: { type: "number", description: "单次：0-based unit index" },
        indices: {
          type: "array",
          description: "批量：多个 0-based index，最多 6 个",
          items: { type: "number" },
        },
        indices_json: {
          type: "string",
          description: "JSON 数组，如 [0,3,7]",
        },
        maxChars: {
          type: "number",
          description: "每单元截断。单读默认 8000；批读默认 2500，总预算约 16k",
        },
      },
      required: [],
    },
    execute: async (args, ctx) => {
      const { userId, novelId, branchId } = ids(ctx);
      const ws = getNovelAnalysisWorkspace(userId, novelId, branchId);
      const text = loadText(userId, novelId, branchId);
      let units = ws?.units || [];
      if (!units.length) units = buildNameScanUnits(text);

      const UNIT_BATCH_BUDGET = BATCH_TEXT_BUDGET;
      const UNIT_BATCH_MAX = 6;
      let indices: number[] = [];
      if (typeof args.indices_json === "string" && args.indices_json.trim()) {
        try {
          const p = JSON.parse(args.indices_json);
          const arr = Array.isArray(p) ? p : p?.indices;
          if (Array.isArray(arr)) {
            indices = arr.map((x: unknown) => Math.floor(Number(x)));
          }
        } catch {
          /* ignore */
        }
      }
      if (Array.isArray(args.indices)) {
        indices = args.indices.map((x: unknown) => Math.floor(Number(x)));
      }
      if (!indices.length && args.index != null && args.index !== "") {
        indices = [Math.floor(Number(args.index))];
      }
      indices = indices.filter((i) => Number.isFinite(i) && i >= 0);
      {
        const seen = new Set<number>();
        indices = indices.filter((i) => {
          if (seen.has(i)) return false;
          seen.add(i);
          return true;
        });
      }
      if (!indices.length) {
        return {
          content:
            "缺少 index/indices。优先批读：indices=[0,2,5]；单读：index=0。",
          messages: [],
        };
      }
      const allIndices = indices;
      const countOmitted = allIndices.slice(UNIT_BATCH_MAX).map(String);
      indices = allIndices.slice(0, UNIT_BATCH_MAX);
      const batch = indices.length > 1;
      const defaultMax = batch ? 2500 : 8000;
      const hardMax = batch ? 4000 : 20000;
      const max = Math.min(
        hardMax,
        Math.max(200, Number(args.maxChars) || defaultMax),
      );

      const parts: string[] = [];
      if (batch) {
        parts.push(
          `【批量 get_unit_text】请求 ${allIndices.length} 个单元，本批处理 ${indices.length} 个` +
            `（每单元最多 ${max} 字；输出预算 ${UNIT_BATCH_BUDGET} 字）`,
        );
      }
      let used = 0;
      let returned = 0;
      const budgetOmitted: string[] = [];
      for (let j = 0; j < indices.length; j++) {
        const i = indices[j];
        if (used >= UNIT_BATCH_BUDGET) {
          budgetOmitted.push(...indices.slice(j).map(String));
          break;
        }
        const u = units[i];
        if (!u) {
          parts.push(`【index=${i}】无此单元`);
          returned++;
          continue;
        }
        const body = (u.text || "").slice(0, max);
        const block = `【#${i} ${u.label}】chars=${(u.text || "").length}\n${body}`;
        parts.push(block);
        used += block.length;
        returned++;
      }
      const notices: string[] = [];
      if (countOmitted.length) {
        notices.push(
          formatBatchOverflowNotice({
            itemLabel: "文本单元",
            toolHint: "get_unit_text(indices=[...])",
            requested: allIndices.length,
            returned: indices.length - budgetOmitted.length,
            omitted: countOmitted,
            reason: "count_cap",
            countCap: UNIT_BATCH_MAX,
          }),
        );
      }
      if (budgetOmitted.length) {
        notices.push(
          formatBatchOverflowNotice({
            itemLabel: "文本单元",
            toolHint: "get_unit_text(indices=[...])",
            requested: indices.length,
            returned,
            omitted: budgetOmitted,
            reason: "output_budget",
            budget: UNIT_BATCH_BUDGET,
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
  // ── analyze_form agent tools (step-by-step; not a single black-box run) ──
  {
    name: "scan_chapter_catalog",
    description:
      "【章法子 Agent】程序扫描章节目录候选（标题行/偏移）。写入工作区 formCatalog。先调此工具。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => {
      const { userId, novelId, branchId } = ids(ctx);
      if (!novelId) return { content: "缺少 novelId", messages: [] };
      const text = loadText(userId, novelId, branchId);
      if (!text.trim()) return { content: "正文为空", messages: [] };
      let ws = getNovelAnalysisWorkspace(userId, novelId, branchId);
      if (!ws) {
        ws = beginNovelAnalysisWorkspace(userId, novelId, branchId, { fullText: text });
      }
      const draft = buildFormDraftFromText(novelId, text);
      patchNovelAnalysisWorkspace(userId, novelId, branchId, {
        formCatalog: draft.catalog,
        formCatalogHints: draft.catalogHints,
        formDraft: null, // catalog only; draft built next
      });
      const samples = draft.catalog.slice(0, 12).map((c, i) => {
        const num = c.number != null ? String(c.number) : "?";
        const title = (c.title || "").slice(0, 40);
        return `${i + 1}. #${num} ${title} @${c.startOffset}`;
      });
      return {
        content:
          `目录扫描完成：catalog=${draft.catalog.length} 条\n` +
          (draft.catalogHints.length
            ? `提示：${draft.catalogHints.slice(0, 5).join("；")}\n`
            : "") +
          `样例：\n${samples.join("\n") || "（无）"}\n` +
          `下一步：build_form_draft`,
        messages: [],
      };
    },
  },
  {
    name: "build_form_draft",
    description:
      "【章法子 Agent】根据目录程序推断分章/形态草稿 formDraft（无 LLM）。需已 scan_chapter_catalog 或可直接从正文重建。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => {
      const { userId, novelId, branchId } = ids(ctx);
      if (!novelId) return { content: "缺少 novelId", messages: [] };
      const text = loadText(userId, novelId, branchId);
      if (!text.trim()) return { content: "正文为空", messages: [] };
      let ws = getNovelAnalysisWorkspace(userId, novelId, branchId);
      if (!ws) {
        ws = beginNovelAnalysisWorkspace(userId, novelId, branchId, { fullText: text });
      }
      // Prefer rebuild from full text so draft+catalog stay consistent
      const draft = buildFormDraftFromText(novelId, text);
      patchNovelAnalysisWorkspace(userId, novelId, branchId, {
        formDraft: draft.profile,
        formCatalog: draft.catalog,
        formCatalogHints: draft.catalogHints,
      });
      const ch = draft.profile.chaptering;
      return {
        content:
          `章法草稿已建：formType=${draft.profile.formType} ` +
          `chaptering.enabled=${ch?.enabled} confidence=${ch?.confidence ?? 0} ` +
          `catalog=${draft.catalog.length}\n` +
          `samples=${(ch?.samples || []).slice(0, 3).join(" / ") || "无"}\n` +
          `可选：enrich_form_draft（LLM 校验目录）→ 必须 submit_form 落盘`,
        messages: [],
      };
    },
  },
  {
    name: "enrich_form_draft",
    description:
      "【章法子 Agent】用 LLM 校验目录、补叙事形态字段。需已有 formDraft。失败可跳过直接 submit_form。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx, llm) => {
      const { userId, novelId, branchId } = ids(ctx);
      const text = loadText(userId, novelId, branchId);
      const ws = getNovelAnalysisWorkspace(userId, novelId, branchId);
      if (!ws?.formDraft) {
        return {
          content: "无 formDraft：请先 build_form_draft",
          messages: [],
        };
      }
      const catalog = ws.formCatalog?.length
        ? ws.formCatalog
        : buildFormDraftFromText(novelId, text).catalog;
      const hints = ws.formCatalogHints || [];
      try {
        const provider = llm || createLLMProvider("analysis");
        const enriched = await enrichFormDraftWithLlm(
          ws.formDraft,
          text,
          catalog,
          hints,
          provider,
        );
        patchNovelAnalysisWorkspace(userId, novelId, branchId, {
          formDraft: enriched.profile,
          formCatalog: enriched.catalog,
          formCatalogHints: hints,
        });
        return {
          content:
            `LLM enrich 完成：formType=${enriched.profile.formType} ` +
            `catalog=${enriched.catalog.length} ` +
            `chaptering.enabled=${enriched.profile.chaptering?.enabled}\n` +
            `evidence=${(enriched.profile.narrativeArchitecture?.evidenceNotes || "").slice(0, 200)}\n` +
            `下一步：submit_form`,
          messages: [],
        };
      } catch (e) {
        return {
          content: `enrich 失败（可直接 submit 程序草稿）: ${(e as Error).message}`,
          messages: [],
        };
      }
    },
  },
  {
    name: "submit_form",
    description:
      "【章法子 Agent】将 formDraft 写入分析工作区（不写 DB）。成功含「章法已存」。" +
      "正式落库仅 finish_novel_analysis。",
    parameters: {
      type: "object",
      properties: {
        skipIfCached: {
          type: "boolean",
          description: "若库/工作区已有章法可跳过重建（默认 false）",
        },
      },
      required: [],
    },
    execute: async (args, ctx) => {
      const { userId, novelId, branchId } = ids(ctx);
      if (!novelId) return { content: "缺少 novelId", messages: [] };
      const text = loadText(userId, novelId, branchId);
      let ws = getNovelAnalysisWorkspace(userId, novelId, branchId);
      if (!ws) {
        ws = beginNovelAnalysisWorkspace(userId, novelId, branchId, {
          fullText: text,
        });
      }

      if (args.skipIfCached && (ws.form || getNovelForm(userId, novelId)) && !ws.forceRefresh) {
        const existing = ws.form || getNovelForm(userId, novelId)!;
        const units = ws.units?.length ? ws.units : buildNameScanUnits(text);
        patchNovelAnalysisWorkspace(userId, novelId, branchId, {
          form: existing,
          units,
        });
        return {
          content: `章法已就绪·跳过（工作区）。units=${units.length}。正式落库需 finish_novel_analysis。`,
          messages: [],
        };
      }

      let draft = ws.formDraft;
      let catalog: ChapterCatalogEntry[] = ws.formCatalog || [];
      if (!draft) {
        const built = buildFormDraftFromText(novelId, text);
        draft = built.profile;
        catalog = built.catalog;
        patchNovelAnalysisWorkspace(userId, novelId, branchId, {
          formDraft: draft,
          formCatalog: built.catalog,
          formCatalogHints: built.catalogHints,
        });
      }
      if (!catalog.length) {
        catalog = buildFormDraftFromText(novelId, text).catalog;
      }
      for (let i = 0; i < catalog.length; i++) {
        catalog[i] = {
          ...catalog[i],
          endOffset:
            i + 1 < catalog.length
              ? catalog[i + 1].startOffset
              : text.length,
        };
      }

      const units = buildNameScanUnits(text);
      // Workspace only — finish_novel_analysis writes novel_form + chapter meta
      patchNovelAnalysisWorkspace(userId, novelId, branchId, {
        form: draft,
        units,
        formDraft: draft,
        formCatalog: catalog,
      });
      return {
        content:
          `${ANALYSIS_OK.form}：units=${units.length} catalog=${catalog.length} ` +
          `formType=${draft.formType} chaptering=${draft.chaptering?.enabled ? "on" : "off"}。` +
          `已写入工作区（待 finish 落库）。`,
        messages: [],
      };
    },
  },
  {
    name: "run_form_analysis",
    description:
      "【兼容/批处理】一键串行：scan→draft→enrich→submit。analyze_form 子 Agent 应分步调用，不要用此黑盒。",
    parameters: {
      type: "object",
      properties: {
        forceRefresh: {
          type: "boolean",
          description: "true 时强制重跑；默认 false 且已有章法时直接跳过",
        },
      },
      required: [],
    },
    execute: async (args, ctx, llm) => {
      const { userId, novelId, branchId } = ids(ctx);
      if (!novelId) return { content: "缺少 novelId", messages: [] };
      const text = loadText(userId, novelId, branchId);
      if (!text.trim()) return { content: "正文为空", messages: [] };

      const force = Boolean(args.forceRefresh);
      const existing = getNovelForm(userId, novelId);
      let ws = getNovelAnalysisWorkspace(userId, novelId, branchId);
      if (!ws) {
        ws = beginNovelAnalysisWorkspace(userId, novelId, branchId, { fullText: text });
      }

      if ((existing || ws.form) && !force) {
        const form = ws.form || existing!;
        const units = ws.units?.length ? ws.units : buildNameScanUnits(text);
        patchNovelAnalysisWorkspace(userId, novelId, branchId, { form, units });
        return {
          content: `章法已就绪·跳过（工作区）。units=${units.length}。`,
          messages: [],
        };
      }

      try {
        let provider = llm;
        if (!provider) {
          try {
            provider = createLLMProvider("analysis");
          } catch {
            provider = undefined as any;
          }
        }
        const result = await analyzeNovelForm(novelId, text, provider);
        const catalog = result.catalog.map((c, i, arr) => ({
          ...c,
          endOffset:
            i + 1 < arr.length ? arr[i + 1].startOffset : text.length,
        }));
        const units = buildNameScanUnits(text);
        // Workspace only; finish commits DB
        patchNovelAnalysisWorkspace(userId, novelId, branchId, {
          form: result.profile,
          formDraft: result.profile,
          formCatalog: catalog,
          formCatalogHints: result.catalogHints,
          units,
        });
        return {
          content:
            `${ANALYSIS_OK.form}：units=${units.length} catalog=${catalog.length}。` +
            `（工作区；待 finish 落库。交互请用分步工具）`,
          messages: [],
        };
      } catch (e) {
        return {
          content: `章法分析失败: ${(e as Error).message}`,
          messages: [],
        };
      }
    },
  },
  {
    name: "scan_character_mentions",
    description:
      "【角色列表子 Agent】LLM 分段扫角色指称 surface，写入 catalog；" +
      "每条 surface 带出现位置 **锚点 a@offset**（供消解/详情按位置读文，防同名异人）。" +
      "成功含「角色指称已扫描」。之后 list_surface_candidates / lookup_* / submit_character_entities。" +
      "无 catalog 须先调；有 catalog 且未 forceRefresh 则复用。",
    parameters: {
      type: "object",
      properties: {
        forceRefresh: {
          type: "boolean",
          description: "true=强制重扫各 unit；false/省略=有 catalog 则复用",
        },
      },
      required: [],
    },
    execute: async (args, ctx, llm) => {
      const { userId, novelId, branchId } = ids(ctx);
      const text = loadText(userId, novelId, branchId);
      if (!text.trim()) {
        return { content: "正文为空，无法扫描角色指称", messages: [] };
      }

      const formatScanSummary = (
        mode: "cached" | "fresh",
        surfaceCount: number,
        unitCount: number,
        topLines: string[],
      ) => {
        const head =
          mode === "cached"
            ? `${ANALYSIS_OK.scan}（复用已有 catalog）`
            : `${ANALYSIS_OK.scan}（LLM 分段新建 catalog）`;
        const top =
          topLines.length > 0
            ? topLines.map((s, i) => `${i + 1}. ${s}`).join("\n")
            : "（无候选指称 — 扫描结果为空）";
        return (
          `${head}\n` +
          `units=${unitCount} surfaces=${surfaceCount}（每条含锚点 a@offset）\n` +
          `前 ${Math.min(30, topLines.length)} 个候选（含锚点样例）：\n${top}\n` +
          `完整列表 list_surface_candidates；消歧/详情请按锚点 lookup_offset(anchors=…)。`
        );
      };

      const topSurfaceLines = (
        stats: Array<{ surface: string; anchors?: Array<{ offset: number; unitLabel?: string }> }>,
      ) =>
        stats.slice(0, 30).map((s) => {
          const a0 = s.anchors?.[0];
          const a1 = s.anchors?.[1];
          const bits = [`「${s.surface}」`];
          if (a0) {
            bits.push(
              `锚点 a@${a0.offset}${a0.unitLabel ? " " + a0.unitLabel : ""}` +
                (a1 ? `；a@${a1.offset}` : "") +
                ((s.anchors?.length || 0) > 2 ? "…" : ""),
            );
          }
          return bits.join(" ");
        });

      const existing = getCharacterExtractWorkspace(userId, novelId, branchId);
      if (existing?.catalog?.stats?.length && !args.forceRefresh) {
        return {
          content: formatScanSummary(
            "cached",
            existing.catalog.stats.length,
            existing.unitCount || 0,
            topSurfaceLines(existing.catalog.stats),
          ),
          messages: [],
        };
      }
      if (!llm) {
        return {
          content:
            "扫描失败：缺少 LLM（scan_character_mentions 须分段模型抽取指称）",
          messages: [],
        };
      }
      const ws = getNovelAnalysisWorkspace(userId, novelId, branchId);
      const units = ws?.units?.length ? ws.units : buildNameScanUnits(text);
      if (ws && !ws.units?.length) {
        patchNovelAnalysisWorkspace(userId, novelId, branchId, { units });
      }
      try {
        const { surfaceCount, unitCount } = await seedCharacterCatalogViaLlm(
          userId,
          novelId,
          branchId,
          text,
          units,
          llm,
        );
        const after = getCharacterExtractWorkspace(userId, novelId, branchId);
        return {
          content: formatScanSummary(
            "fresh",
            surfaceCount,
            unitCount,
            topSurfaceLines(after?.catalog?.stats || []),
          ),
          messages: [],
        };
      } catch (e) {
        return {
          content: `角色指称扫描失败: ${(e as Error).message}`,
          messages: [],
        };
      }
    },
  },
  {
    name: "submit_story_world",
    description:
      "提交故事与世界观 JSON 到分析工作区（不写 DB）。成功含「故事世界已存」。落库用 finish_novel_analysis。",
    parameters: {
      type: "object",
      properties: {
        story_json: {
          type: "string",
          description: "StoryInfo JSON 字符串",
        },
      },
      required: ["story_json"],
    },
    execute: async (args, ctx) => {
      const { userId, novelId, branchId } = ids(ctx);
      try {
        const story = JSON.parse(String(args.story_json || "")) as StoryInfo;
        if (!story?.plotSummary && !story?.mainStoryline) {
          return { content: "story_json 缺少 plotSummary/mainStoryline", messages: [] };
        }
        ensureWs(userId, novelId, branchId);
        patchNovelAnalysisWorkspace(userId, novelId, branchId, { storyInfo: story });
        return {
          content: `${ANALYSIS_OK.story}（工作区，待 finish 落库）`,
          messages: [],
        };
      } catch (e) {
        return { content: `解析失败: ${(e as Error).message}`, messages: [] };
      }
    },
  },
  {
    name: "submit_character_detail",
    description:
      "提交单个角色多维度详情到工作区（不写 DB）。成功含「角色详情已存」。" +
      "detail_json 必须含 appearance+personality，且 drive/behavior/worldview|values/speakingStyle/background 至少 2 项；禁止只交性格简介。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "角色真实姓名" },
        detail_json: {
          type: "string",
          description:
            "人设 JSON 字符串。必含 appearance.summary、personality(traits/description)、" +
            "以及 drive、behavior、worldview/values、speakingStyle、background 中至少两项。" +
            "示例字段：appearance/personality/drive/behavior/worldview/values/speakingStyle/background",
        },
      },
      required: ["name", "detail_json"],
    },
    execute: async (args, ctx) => {
      const { userId, novelId, branchId } = ids(ctx);
      const name = String(args.name || "").trim();
      if (!name) return { content: "缺少 name", messages: [] };
      try {
        let detail: Record<string, unknown> = {};
        if (typeof args.detail_json === "string" && args.detail_json.trim()) {
          detail = JSON.parse(args.detail_json);
        } else if (args.detail_json && typeof args.detail_json === "object") {
          detail = args.detail_json as Record<string, unknown>;
        } else if (args.detail && typeof args.detail === "object") {
          detail = args.detail as Record<string, unknown>;
        }
        if (!detailPayloadIsRich(detail)) {
          const why = detailPayloadRejectReason(detail);
          return {
            content:
              `详情过空/维度不足，未写入 ${name}。${why}` +
              `请补全 appearance+personality 及至少两项其它维度后再 submit_character_detail。`,
            messages: [],
          };
        }
        const ws = ensureWs(userId, novelId, branchId);
        // Prefer staged draft, then entities stubs, then DB
        let chars = [...(ws.charactersDraft || [])];
        if (!chars.length) {
          const cws = getCharacterExtractWorkspace(userId, novelId, branchId);
          if (cws?.entities?.length) chars = entitiesToProfiles(cws.entities);
          else chars = [...getCharacters(userId, novelId)];
        }
        const idx = chars.findIndex(
          (c) => nameKey(c.name) === nameKey(name),
        );
        const brief = String(
          (detail as any).briefDescription ||
            (detail as any).appearance?.summary ||
            (detail as any).personality?.description ||
            "",
        );
        const incoming = {
          id: `tmp_${name}`,
          name,
          aliases: Array.isArray((detail as any).aliases)
            ? (detail as any).aliases
            : [],
          appearance: (detail as any).appearance || { summary: brief },
          personality: (detail as any).personality || {
            traits: [],
            description: brief,
            decisionStyle: "",
            underPressure: "",
          },
          drive: (detail as any).drive || {
            goal: "",
            motivation: "",
            fear: "",
            weakness: "",
            bottomLine: "",
            secret: "",
          },
          behavior: (detail as any).behavior || {
            patterns: [],
            habits: [],
            attitudeToAuthority: "",
          },
          worldview: String((detail as any).worldview || ""),
          values: Array.isArray((detail as any).values) ? (detail as any).values : [],
          speakingStyle: (detail as any).speakingStyle || {
            description: "",
            catchphrases: [],
            sentenceStyle: "",
            vocabulary: "",
            emotionalExpression: "",
          },
          voice: (detail as any).voice || { description: "" },
          background: (detail as any).background || {
            origin: "",
            keyEvents: [],
            description: "",
          },
          relationships: Array.isArray((detail as any).relationships)
            ? (detail as any).relationships
            : [],
        } as CharacterProfile;

        if (idx < 0) {
          chars.push(incoming);
        } else {
          chars[idx] = mergeCharacterProfiles(chars[idx], incoming);
        }
        // Re-apply any staged edges so detail merge does not drop them
        if (ws.relationshipEdges?.length) {
          const applied = applyRelationshipEdges(chars, ws.relationshipEdges);
          chars = applied.chars;
        }
        patchNovelAnalysisWorkspace(userId, novelId, branchId, {
          charactersDraft: chars,
        });
        const richN = chars.filter(profileHasDetail).length;
        const score = profileDetailScore(
          chars.find((c) => nameKey(c.name) === nameKey(name)),
        );
        return {
          content:
            `${ANALYSIS_OK.detail}:${name}（维度分 ${score}/7；工作区 ${chars.length} 人，完整详情 ${richN}；待确认保存）`,
          messages: [],
        };
      } catch (e) {
        return { content: `详情提交失败: ${(e as Error).message}`, messages: [] };
      }
    },
  },
  {
    name: "get_kept_roster",
    description:
      "当前角色名单摘要。每人含 **锚点 a@offset**（出现位置）；详情/消歧请 lookup_offset(anchors=…) 按锚点读文，勿只按姓名。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => {
      const { userId, novelId, branchId } = ids(ctx);
      const formatAnchors = (
        anchors: Array<{ offset: number; unitLabel?: string; surface?: string }> | undefined,
      ) => {
        if (!anchors?.length) return " 锚点=（无 — 请用 lookup_surface 或 scan 补）";
        return (
          " 锚点=" +
          anchors
            .slice(0, 6)
            .map((a) => {
              const bits = [`a@${a.offset}`];
              if (a.unitLabel) bits.push(a.unitLabel);
              if (a.surface) bits.push(`「${a.surface}」`);
              return bits.join(" ");
            })
            .join("；") +
          (anchors.length > 6 ? "…" : "")
        );
      };
      const ws = getNovelAnalysisWorkspace(userId, novelId, branchId);
      const draft = ws?.charactersDraft || [];
      if (draft.length) {
        return {
          content:
            "【读原文请用锚点】lookup_offset(anchors=[\"a@…\"]) 或 lookup_surface(surfaces=[…])\n" +
            draft
              .map(
                (c, i) =>
                  `${i + 1}. ${c.name}` +
                  (c.aliases?.length ? ` aliases=${c.aliases.join("/")}` : "") +
                  formatAnchors(c.mentionAnchors),
              )
              .join("\n"),
          messages: [],
        };
      }
      const cws = getCharacterExtractWorkspace(userId, novelId, branchId);
      if (cws?.entities?.length) {
        return {
          content:
            "【读原文请用锚点】lookup_offset(anchors=[\"a@…\"])\n" +
            cws.entities
              .map(
                (e, i) =>
                  `${i + 1}. ${e.name}` +
                  (e.aliases?.length ? ` aliases=${e.aliases.join("/")}` : "") +
                  formatAnchors(e.anchors),
              )
              .join("\n"),
          messages: [],
        };
      }
      const chars = getCharacters(userId, novelId);
      if (chars.length) {
        return {
          content:
            "【读原文请用锚点】lookup_offset(anchors=[\"a@…\"])\n" +
            chars
              .map(
                (c, i) =>
                  `${i + 1}. ${c.name}` +
                  (c.aliases?.length ? ` aliases=${c.aliases.join("/")}` : "") +
                  formatAnchors(c.mentionAnchors),
              )
              .join("\n"),
          messages: [],
        };
      }
      return { content: "（尚无角色名单）", messages: [] };
    },
  },
  {
    name: "get_relationship_type_catalog",
    description: "合法关系 type 列表（有向关系模型）。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async () => ({
      content: relationshipTypePromptList(true),
      messages: [],
    }),
  },
  {
    name: "submit_character_relationships",
    description:
      "提交有向关系边到工作区（不写 DB）。成功含「角色关系已存」。落库用 finish_novel_analysis。",
    parameters: {
      type: "object",
      properties: {
        edges_json: { type: "string", description: "边数组 JSON" },
      },
      required: ["edges_json"],
    },
    execute: async (args, ctx) => {
      const { userId, novelId, branchId } = ids(ctx);
      try {
        let edges: Array<Record<string, unknown>> = [];
        if (typeof args.edges_json === "string" && args.edges_json.trim()) {
          edges = JSON.parse(args.edges_json);
        } else if (Array.isArray(args.edges_json)) {
          edges = args.edges_json as Array<Record<string, unknown>>;
        } else if (Array.isArray(args.edges)) {
          edges = args.edges as Array<Record<string, unknown>>;
        }
        if (!Array.isArray(edges)) {
          return { content: "edges_json 须为数组", messages: [] };
        }
        const ws = ensureWs(userId, novelId, branchId);
        let chars = [...(ws.charactersDraft || [])];
        if (!chars.length) {
          const cws = getCharacterExtractWorkspace(userId, novelId, branchId);
          if (cws?.entities?.length) chars = entitiesToProfiles(cws.entities);
          else chars = [...getCharacters(userId, novelId)];
        }
        if (!chars.length) {
          return {
            content:
              "无角色名单，无法挂关系。请先 analyze_character_list / 有 charactersDraft。",
            messages: [],
          };
        }
        const { chars: next, applied } = applyRelationshipEdges(chars, edges);
        // Keep raw edges so later detail merge cannot drop them
        const prevEdges = ws.relationshipEdges || [];
        const mergedEdges = [...prevEdges, ...edges];
        patchNovelAnalysisWorkspace(userId, novelId, branchId, {
          charactersDraft: next,
          relationshipEdges: mergedEdges,
        });
        if (edges.length > 0 && applied === 0) {
          return {
            content:
              `关系边 ${edges.length} 条均未匹配到 from 角色名（检查姓名是否与名单一致）。未写入。`,
            messages: [],
          };
        }
        return {
          content: `${ANALYSIS_OK.rels}：提交 ${edges.length} 条，挂接 ${applied} 条（工作区，待确认保存）`,
          messages: [],
        };
      } catch (e) {
        return { content: `关系提交失败: ${(e as Error).message}`, messages: [] };
      }
    },
  },
  {
    name: "submit_timeline_events",
    description:
      "提交时间线 JSON 到工作区（不写 DB）。成功含「时间线已存」。落库用 finish_novel_analysis。",
    parameters: {
      type: "object",
      properties: {
        timeline_json: { type: "string", description: "ChapterTimeline JSON" },
      },
      required: ["timeline_json"],
    },
    execute: async (args, ctx) => {
      const { userId, novelId, branchId } = ids(ctx);
      try {
        const timeline = JSON.parse(String(args.timeline_json || "")) as ChapterTimeline;
        ensureWs(userId, novelId, branchId);
        patchNovelAnalysisWorkspace(userId, novelId, branchId, { timeline });
        return {
          content: `${ANALYSIS_OK.timeline}（工作区，待 finish 落库）`,
          messages: [],
        };
      } catch (e) {
        return { content: `时间线提交失败: ${(e as Error).message}`, messages: [] };
      }
    },
  },
  {
    name: "submit_style",
    description:
      "提交文风 JSON 到工作区（不写文笔库）。成功含「文风已存」。落库用 finish_novel_analysis。",
    parameters: {
      type: "object",
      properties: {
        style_json: { type: "string", description: "WritingStyle JSON" },
      },
      required: ["style_json"],
    },
    execute: async (args, ctx) => {
      const { userId, novelId, branchId } = ids(ctx);
      try {
        const style = JSON.parse(String(args.style_json || "")) as WritingStyle;
        ensureWs(userId, novelId, branchId);
        patchNovelAnalysisWorkspace(userId, novelId, branchId, { style });
        return {
          content: `${ANALYSIS_OK.style}（工作区，待 finish 落库）`,
          messages: [],
        };
      } catch (e) {
        return { content: `文风提交失败: ${(e as Error).message}`, messages: [] };
      }
    },
  },
  {
    name: "submit_ideas",
    description:
      "提交点子到工作区（不写点子库）。成功含「点子已存」。落库用 finish_novel_analysis。",
    parameters: {
      type: "object",
      properties: {
        ideas_json: { type: "string", description: "Idea 数组或 {ideas:[]}" },
      },
      required: ["ideas_json"],
    },
    execute: async (args, ctx) => {
      const { userId, novelId, branchId } = ids(ctx);
      try {
        const raw = JSON.parse(String(args.ideas_json || ""));
        const list = Array.isArray(raw) ? raw : raw.ideas || [];
        const bookTitle = resolveBookTitle(userId, novelId);
        const entries = list.map((it: any, i: number) => ({
          id: it.id || `idea_${novelId}_${i}`,
          title: String(it.title || `点子${i + 1}`),
          content: String(it.content || it.text || ""),
          tags: Array.isArray(it.tags) ? it.tags : [],
          source: "extracted" as const,
          sourceNovelId: novelId,
          sourceNovelTitle: bookTitle,
        }));
        ensureWs(userId, novelId, branchId);
        patchNovelAnalysisWorkspace(userId, novelId, branchId, { ideas: entries });
        return {
          content: `${ANALYSIS_OK.ideas}：${entries.length} 条（工作区，待 finish 落库）`,
          messages: [],
        };
      } catch (e) {
        return { content: `点子提交失败: ${(e as Error).message}`, messages: [] };
      }
    },
  },
];

/** Master-only orchestration tools */
export const analysisMasterTools: ToolDefinition[] = [
  // Re-export context tools on master list for explicit allow-list registration order
  ...analysisDomainTools.filter((t) =>
    ["get_current_novel", "get_current_branch", "get_analysis_context"].includes(t.name),
  ),
  {
    name: "get_analysis_status",
    description:
      "查看各分析域完成状态、依赖图、建议下一步。" +
      "用户点名单域时传 for_agent（如 extract_character_detail）→ 返回 launchPlan（缺依赖则 sequence 先依赖后目标）。" +
      "已完成域不要重复执行；单域按 launchPlan.sequence 调度。",
    parameters: {
      type: "object",
      properties: {
        for_agent: {
          type: "string",
          description:
            "可选。用户要单独拉起的子 Agent id（如 extract_character_detail、analyze_story_world）。" +
            "传入后 status.launchPlan 给出依赖检查与派工顺序。",
        },
      },
      required: [],
    },
    execute: async (args, ctx) => {
      const { userId, novelId, branchId } = ids(ctx);
      const ws = getNovelAnalysisWorkspace(userId, novelId, branchId);
      const cws = getCharacterExtractWorkspace(userId, novelId, branchId);
      // Prefer session workspace; fall back to already-committed DB
      const form = !!(ws?.form || getNovelForm(userId, novelId));
      const story = !!(ws?.storyInfo?.plotSummary || getStoryInfo(userId, novelId)?.plotSummary);
      const entitiesResolved = cws?.entities?.length || 0;
      const draftChars = ws?.charactersDraft?.length || 0;
      const dbChars = getCharacters(userId, novelId);
      const charactersInDb = dbChars.length;
      const characterList = entitiesResolved > 0 || draftChars > 0 || charactersInDb > 0;
      // Multi-dimension detail, not roster brief stubs
      const detailInDraft = (ws?.charactersDraft || []).filter(profileHasDetail).length;
      const detailInDb = dbChars.filter(profileHasDetail).length;
      const characterDetail = detailInDraft > 0 || detailInDb > 0;
      const relEdges = ws?.relationshipEdges?.length || 0;
      const relOnChars =
        (ws?.charactersDraft || []).reduce(
          (n, c) => n + (c.relationships?.length || 0),
          0,
        ) + dbChars.reduce((n, c) => n + (c.relationships?.length || 0), 0);
      const characterRelationships = relEdges > 0 || relOnChars > 0;
      const timeline = !!(ws?.timeline || getTimeline(userId, novelId, branchId));
      const style =
        !!ws?.style ||
        listStyles(userId).some((s) => s.sourceNovelId === novelId);
      const ideaCountWs = ws?.ideas?.length || 0;
      const ideaCountDb = listIdeas(userId).filter((i) => i.sourceNovelId === novelId).length;
      const ideas = ideaCountWs > 0 || ideaCountDb > 0;

      const domainReady: Record<string, boolean> = {
        form,
        character_list: characterList,
        character_detail: characterDetail,
        character_relationships: characterRelationships,
        story,
        timeline,
        style,
        ideas,
      };

      const done: string[] = [];
      const pending: string[] = [];
      for (const [key, ok] of Object.entries(domainReady)) {
        if (ok) done.push(key);
        else pending.push(key);
      }

      // agent_type → ready (for launch plan)
      const readyByAgent: Record<string, boolean> = {
        analyze_form: form,
        analyze_character_list: characterList,
        extract_character_detail: characterDetail,
        extract_character_relationships: characterRelationships,
        analyze_story_world: story,
        analyze_timeline: timeline,
        extract_style: style,
        extract_ideas: ideas,
      };

      const nextActions: string[] = [];
      if (!form) {
        nextActions.push('agent(agent_type="analyze_form")');
      } else {
        if (!characterList) nextActions.push('agent(agent_type="analyze_character_list")');
        else if (!characterDetail)
          nextActions.push('agent(agent_type="extract_character_detail")');
        else if (!characterRelationships)
          nextActions.push('agent(agent_type="extract_character_relationships")');
        if (!story) nextActions.push('agent(agent_type="analyze_story_world")');
        if (!timeline) nextActions.push('agent(agent_type="analyze_timeline")');
        if (!style) nextActions.push('agent(agent_type="extract_style")');
        if (!ideas) nextActions.push('agent(agent_type="extract_ideas")');
      }
      // Endgame: user must confirm save via ask_question, then finish
      if (pending.length === 0 && done.length > 0) {
        nextActions.push(
          'ask_question 确认保存 → finish_novel_analysis(userConfirmed=true)',
        );
      }

      const forAgentRaw =
        args.for_agent != null && String(args.for_agent).trim()
          ? String(args.for_agent).trim()
          : "";
      const launchPlan = forAgentRaw
        ? buildLaunchPlan(forAgentRaw, readyByAgent)
        : null;

      const status = {
        novelId,
        branchId,
        form,
        story,
        character_list: characterList,
        character_detail: characterDetail,
        character_relationships: characterRelationships,
        charactersInDb,
        charactersDraft: draftChars,
        detailRichDraft: detailInDraft,
        detailRichDb: detailInDb,
        entitiesResolved,
        relationshipEdges: relEdges,
        timeline,
        style,
        ideas,
        ideaCount: ideaCountWs || ideaCountDb,
        unitCount: ws?.units?.length || 0,
        canTimeline: form || (ws?.units?.length || 0) > 0,
        /** 子 Agent 依赖表（拉单域前必查） */
        dependencies: ANALYSIS_AGENT_DEPENDENCIES,
        domainToAgent: ANALYSIS_DOMAIN_TO_AGENT,
        agents: [...ANALYSIS_SUBAGENT_TYPES],
        readyByAgent,
        done,
        pending,
        nextActions,
        /** 用户点名单域时：缺依赖则 sequence = 依赖… + 目标 */
        launchPlan,
        decisionHint:
          pending.length === 0 && done.length > 0
            ? {
                mustAsk: true,
                question: `本轮分析已就绪（${done.join("、")}）。是否保存到本书与文笔/点子库？`,
                options: ["确认保存", "暂不保存"],
              }
            : done.length > 0
              ? {
                  mustAsk: true,
                  question: `已有：${done.join("、")}；仍缺：${pending.join("、")}。如何继续？`,
                  options: [
                    "只补缺失域（推荐）",
                    "全部重新分析",
                    "只重跑角色相关",
                    "先结束，不改动",
                  ],
                }
              : { mustAsk: false, question: null, options: [] },
      };
      return { content: JSON.stringify(status, null, 2), messages: [] };
    },
  },
  {
    name: "run_form_analysis",
    description: analysisDomainTools.find((t) => t.name === "run_form_analysis")!.description,
    parameters: analysisDomainTools.find((t) => t.name === "run_form_analysis")!.parameters,
    execute: analysisDomainTools.find((t) => t.name === "run_form_analysis")!.execute,
  },
  {
    name: "scan_character_mentions",
    description: analysisDomainTools.find((t) => t.name === "scan_character_mentions")!.description,
    parameters: analysisDomainTools.find((t) => t.name === "scan_character_mentions")!.parameters,
    execute: analysisDomainTools.find((t) => t.name === "scan_character_mentions")!.execute,
  },
  // Domain work is dispatched via agent(agent_type=story_world|character_*|...) — same as write master.
  // Do NOT register run_*_agent wrappers; that made sub-agents look like master tools.
  {
    name: "finish_novel_analysis",
    description:
      "在用户经 ask_question 明确「确认保存」之后调用：把本轮工作区结果写入本书与文笔/点子库。" +
      "未获用户确认不要调用。成功含「全书分析已完成」。",
    parameters: {
      type: "object",
      properties: {
        userConfirmed: {
          type: "boolean",
          description: "必须为 true：表示用户已在 ask_question 中确认保存",
        },
      },
      required: ["userConfirmed"],
    },
    execute: async (args, ctx) => {
      const confirmed =
        args.userConfirmed === true ||
        args.userConfirmed === "true" ||
        args.userConfirmed === 1 ||
        args.userConfirmed === "1";
      if (!confirmed) {
        return {
          content:
            "未落库：请先 ask_question 让用户「确认保存」，再 finish_novel_analysis(userConfirmed=true)。",
          messages: [],
        };
      }
      const { userId, novelId, branchId } = ids(ctx);
      const { commitAnalysisWorkspace } = await import("../commit-analysis");
      const result = commitAnalysisWorkspace({ userId, novelId, branchId });
      return {
        content: result.content.startsWith(ANALYSIS_OK.finish)
          ? result.content
          : `${ANALYSIS_OK.finish} ${result.content}`,
        messages: [],
      };
    },
  },
];

/** Deduped list for init registration */
export function allAnalysisTools(): ToolDefinition[] {
  const byName = new Map<string, ToolDefinition>();
  for (const t of [...analysisDomainTools, ...analysisMasterTools]) {
    byName.set(t.name, t);
  }
  return Array.from(byName.values());
}
