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
  listTimelineJobRows,
  upsertExtractedStyle,
  normalizeWritingStyle,
  normalizeIdeaEntries,
  replaceExtractedIdeas,
  listStyles,
  listIdeas,
  getBranchChapterMeta,
  saveBranchChapterMeta,
} from "@/lib/db";
import type {
  BranchChapterMeta,
  ChapterCatalogEntry,
  ChapterTrack,
  NovelFormProfile,
} from "@/types";
import { parseNovel } from "@/core/parser/novel-parser";
import { buildNovelContext } from "@/core/parser/novel-parser";
import {
  analyzeNovelForm,
  buildFormDraftFromText,
  analyzeCatalogCoherence,
  flagSuspiciousChapterName,
  rawLineAtOffset,
} from "@/core/form/form-analyzer";
import { buildNameScanUnits } from "@/core/character-analysis/runtime/character-name-units";
import {
  applyTrackLabels,
  catalogTrackStats,
  effectiveTrack,
  isChapterTrack,
} from "@/core/form/chapter-track";
import { entitiesToProfiles } from "./character-extract-tools";
import {
  ANALYSIS_AGENT_DEPENDENCIES,
  ANALYSIS_OPTIONAL_DOMAINS,
  ANALYSIS_WRITE_REQUIRED_DOMAINS,
  partitionAnalysisPending,
  isWriteReadyFromDomainMap,
  ANALYSIS_DOMAIN_TO_AGENT,
  ANALYSIS_SUBAGENT_TYPES,
  buildLaunchPlan,
  listParallelReadyAgents,
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
  saveResolvedEntities,
} from "@/core/character-analysis/runtime/character-extract-workspace";
import {
  BATCH_TEXT_BUDGET,
  formatBatchOverflowNotice,
} from "../batch-tool-limits";
import { buildSurfaceCatalog } from "@/core/character-analysis/runtime/character-surface-catalog";
import { scanUnitHitsWithLlm } from "@/core/character-analysis/runtime/character-name-scan";
import {
  runCharacterAnalysisPipeline,
  pipelineResultToExtractSeed,
  sealCrossNameLedgerFromEntities,
  formatCharacterPipelineProgress,
} from "@/core/character-analysis";
import { buildLocalEntitiesFromUnitHits } from "@/core/character-analysis/runtime/character-local-entities";
import { relationshipTypePromptList } from "@/core/extractor/relationship-types";
import { createLLMProvider } from "@/core/llm/factory";
import { resolveMentionScanOptions } from "@/lib/runtime-settings";
import { isChinese } from "@/lib/utils";
import type {
  StoryInfo,
  WritingStyle,
  ChapterTimeline,
  CharacterProfile,
  IdeaLibraryEntry,
  LLMProvider,
} from "@/types";

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
 * New character analysis pipeline (stage①–④)
 * → seed character-extract workspace for analyze_character_list.
 */
async function seedCharacterCatalogViaPipeline(
  userId: string,
  novelId: string,
  branchId: string,
  text: string,
  llm: LLMProvider,
  /**
   * UI progress: prefer emitting full 【进度】 lines via onProgressLine.
   * Legacy (done,total,label) kept for unit-scan path compatibility.
   */
  onProgress?: (done: number, total: number, label: string) => void,
  onProgressLine?: (line: string) => void,
): Promise<{
  surfaceCount: number;
  unitCount: number;
  localEntityCount: number;
  entityCount: number;
  uncertainPairCount: number;
}> {
  // User: mentionScanConcurrency (default 4); admin/debug: privileged (default 30)
  const scanOpts = resolveMentionScanOptions({ userId });
  const conc = Math.max(1, Math.min(32, scanOpts.concurrency));
  const result = await runCharacterAnalysisPipeline(text, llm, {
    concurrency: conc,
    stage3Agent: true,
    stage3Concurrency: conc,
    stage4Concurrency: conc,
    agentContextRadius: 220,
    onStageProgress: (ev) => {
      const line = formatCharacterPipelineProgress(ev);
      onProgressLine?.(line);
      // Map to weighted overall so legacy listeners still get a stable total=100
      const m = line.match(/角色列表\s+(\d+)\s*\/\s*100/);
      const overall = m ? parseInt(m[1]!, 10) : 0;
      onProgress?.(overall, 100, line.replace(/^【进度】\s*/, ""));
    },
  });

  const seed = pipelineResultToExtractSeed(result, text);
  beginCharacterExtractWorkspace(userId, novelId, branchId, {
    fullText: text,
    catalog: seed.catalog,
    unitCount: seed.units.length,
    localEntities: seed.localEntities,
    units: seed.units,
    unitHits: seed.unitHits,
  });
  // Prefer stage③ global entities over overlap-seed
  const saved = saveResolvedEntities(
    userId,
    novelId,
    branchId,
    seed.entities,
    { replace: true },
  );
  const ws = getCharacterExtractWorkspace(userId, novelId, branchId);
  if (ws) {
    sealCrossNameLedgerFromEntities(ws, saved.entities);
    // Uncertain oneshot pairs for outer agent tools (not a pipeline stage)
    ws.corefUncertainPairs = seed.uncertainPairs || [];
    // Prefer post-④ roster (pipeline mutates stage3.characters after canonicalName)
    ws.corefRoster =
      result.stage4?.characters || result.stage3.characters || [];
    ws.updatedAt = new Date().toISOString();
  }
  return {
    surfaceCount: seed.catalog.stats.length,
    unitCount: seed.units.length,
    localEntityCount: seed.localEntities.length,
    entityCount: saved.entities.length,
    uncertainPairCount: seed.uncertainPairs?.length ?? 0,
  };
}

/**
 * Legacy LLM unit-scan path (kept for tests / fallback).
 */
async function seedCharacterCatalogViaLlm(
  userId: string,
  novelId: string,
  branchId: string,
  text: string,
  units: ReturnType<typeof buildNameScanUnits>,
  llm: LLMProvider,
  onProgress?: (done: number, total: number, label: string) => void,
): Promise<{ surfaceCount: number; unitCount: number; localEntityCount: number }> {
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
    userId,
    onProgress,
  });
  const catalog = buildSurfaceCatalog(unitHits, scannedUnits, text);
  const localEntities = buildLocalEntitiesFromUnitHits(
    scannedUnits,
    unitHits,
    text,
  );
  beginCharacterExtractWorkspace(userId, novelId, branchId, {
    fullText: text,
    catalog,
    unitCount: scannedUnits.length,
    localEntities,
    units: scannedUnits,
    unitHits,
  });
  return {
    surfaceCount: catalog.stats.length,
    unitCount: scannedUnits.length,
    localEntityCount: localEntities.length,
  };
}

export const ANALYSIS_OK = {
  form: "章法已存",
  story: "故事世界已存",
  detail: "角色详情已存",
  rels: "角色关系已存",
  /** Full timeline payload in workspace (legacy / rare LLM submit path) */
  timeline: "时间线已存",
  /** Preferred: async job kicked off; does not wait for full extract */
  timelineJob: "时间线任务已启动",
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
      const stats = catalogTrackStats(draft.catalog);
      const samples = draft.catalog.slice(0, 8).map((c, i) => {
        const num = c.number != null ? String(c.number) : "?";
        const title = (c.title || "").slice(0, 40);
        const tr = effectiveTrack(c);
        return `${i}. #${num} [${tr}] ${title} @${c.startOffset}`;
      });
      return {
        content:
          `目录扫描完成：catalog=${draft.catalog.length} 条 ` +
          `track≈ main ${stats.main} · extra ${stats.extra} · 序/尾/卷 ${stats.front_matter + stats.back_matter + stats.volume}\n` +
          (draft.catalogHints.length
            ? `提示：${draft.catalogHints.slice(0, 5).join("；")}\n`
            : "") +
          `样例：\n${samples.join("\n") || "（无）"}\n` +
          `下一步：build_form_draft → list_form_catalog（分页审轨）→ apply_catalog_tracks → set_form_narrative → submit_form`,
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
      const stats = catalogTrackStats(draft.catalog);
      const coherence = analyzeCatalogCoherence(draft.catalog);
      return {
        content:
          `章法草稿已建：formType=${draft.profile.formType} ` +
          `chaptering.enabled=${ch?.enabled} confidence=${ch?.confidence ?? 0} ` +
          `catalog=${draft.catalog.length}（main ${stats.main} / extra ${stats.extra}）\n` +
          `主线连贯：${coherence.coherent ? "ok" : "弱"} ${coherence.notes.slice(0, 2).join("；")}\n` +
          `samples=${(ch?.samples || []).slice(0, 3).join(" / ") || "无"}\n` +
          `下一步：list_form_catalog 分页审轨 → apply_catalog_tracks 修正 → set_form_narrative 补形态 → submit_form\n` +
          `（不要一次要模型输出全书 track 列表）`,
        messages: [],
      };
    },
  },
  {
    name: "list_form_catalog",
    description:
      "【章法子 Agent】分页列出目录（全库 index）。长书必须多轮调用。" +
      "filter=all|main|non_main|suspicious。每页默认 40、最多 80 条，只含 title/track/number，无大段正文。",
    parameters: {
      type: "object",
      properties: {
        offset: { type: "number", description: "起始 index，默认 0" },
        limit: { type: "number", description: "本页条数 1–80，默认 40" },
        filter: {
          type: "string",
          description: "all | main | non_main | suspicious（默认 all）",
        },
      },
      required: [],
    },
    execute: async (args, ctx) => {
      const { userId, novelId, branchId } = ids(ctx);
      const text = loadText(userId, novelId, branchId);
      const ws = getNovelAnalysisWorkspace(userId, novelId, branchId);
      const catalog = ws?.formCatalog?.length
        ? ws.formCatalog
        : buildFormDraftFromText(novelId, text).catalog;
      if (!catalog.length) {
        return { content: "无目录：请先 scan_chapter_catalog", messages: [] };
      }
      const filter = String(args.filter || "all").toLowerCase();
      const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
      const limit = Math.min(80, Math.max(1, Math.floor(Number(args.limit) || 40)));

      const indices: number[] = [];
      for (let i = 0; i < catalog.length; i++) {
        const c = catalog[i];
        const tr = effectiveTrack(c);
        const raw = rawLineAtOffset(text, c.startOffset) || c.title;
        const sus = flagSuspiciousChapterName(c.title, raw).suspicious;
        if (filter === "main" && tr !== "main") continue;
        if (filter === "non_main" && tr === "main") continue;
        if (filter === "suspicious" && !sus && tr === "main") continue;
        indices.push(i);
      }

      const pageIdx = indices.slice(offset, offset + limit);
      const rows = pageIdx.map((i) => {
        const c = catalog[i];
        const raw = (rawLineAtOffset(text, c.startOffset) || c.title).slice(0, 80);
        const sus = flagSuspiciousChapterName(c.title, raw).suspicious;
        return {
          index: i,
          number: c.number ?? null,
          title: (c.title || "").slice(0, 80),
          track: effectiveTrack(c),
          kind: c.kind || null,
          suspicious: sus,
          rawLine: raw,
        };
      });
      const nextOffset =
        offset + limit < indices.length ? offset + limit : null;
      const stats = catalogTrackStats(catalog);
      return {
        content: JSON.stringify(
          {
            catalogTotal: catalog.length,
            filter,
            matched: indices.length,
            offset,
            limit,
            nextOffset,
            trackStats: stats,
            rows,
            hint:
              nextOffset != null
                ? `还有下一页：list_form_catalog(offset=${nextOffset}, limit=${limit}, filter=${filter})`
                : "本 filter 已读完；可 apply_catalog_tracks 或 set_form_narrative / submit_form",
          },
          null,
          0,
        ),
        messages: [],
      };
    },
  },
  {
    name: "apply_catalog_tracks",
    description:
      "【章法子 Agent】按全库 index 批量修正 track（可多次调用）。" +
      "overrides_json: [{\"index\":12,\"track\":\"extra\"},...]。单次最多 100 条。" +
      "track=main|extra|front_matter|back_matter|volume。只改正误 seed，不要为全书每条 main 再写一遍。",
    parameters: {
      type: "object",
      properties: {
        overrides_json: {
          type: "string",
          description: 'JSON 数组，如 [{"index":3,"track":"extra"}]',
        },
      },
      required: ["overrides_json"],
    },
    execute: async (args, ctx) => {
      const { userId, novelId, branchId } = ids(ctx);
      const ws = getNovelAnalysisWorkspace(userId, novelId, branchId);
      const catalog = ws?.formCatalog;
      if (!catalog?.length) {
        return { content: "无 formCatalog：请先 scan/build", messages: [] };
      }
      let raw: unknown;
      try {
        raw =
          typeof args.overrides_json === "string"
            ? JSON.parse(args.overrides_json)
            : args.overrides_json;
      } catch {
        return { content: "overrides_json 不是合法 JSON", messages: [] };
      }
      if (!Array.isArray(raw)) {
        return { content: "overrides_json 须为数组", messages: [] };
      }
      if (raw.length > 100) {
        return {
          content: `单次最多 100 条，本次 ${raw.length}。请拆成多轮 apply_catalog_tracks。`,
          messages: [],
        };
      }
      const labels = raw.map((row) => {
        if (!row || typeof row !== "object") return null;
        const o = row as { index?: unknown; track?: unknown };
        const track = typeof o.track === "string" ? o.track : "";
        if (!isChapterTrack(track)) return null;
        return { index: Number(o.index), track };
      });
      const valid = labels.filter(Boolean) as { index: number; track: string }[];
      const next = applyTrackLabels(catalog, valid);
      const changed = valid.filter((v) => {
        const before = effectiveTrack(catalog[v.index]);
        return before !== v.track;
      }).length;
      patchNovelAnalysisWorkspace(userId, novelId, branchId, {
        formCatalog: next,
      });
      const stats = catalogTrackStats(next);
      return {
        content:
          `已应用 track 覆盖 ${valid.length} 条（约 ${changed} 条相对 seed 有变）。` +
          `现 track≈ main ${stats.main} · extra ${stats.extra} · 其它 ${stats.total - stats.main - stats.extra}。` +
          `可继续 list_form_catalog / apply_catalog_tracks，或 set_form_narrative → submit_form。`,
        messages: [],
      };
    },
  },
  {
    name: "set_form_narrative",
    description:
      "【章法子 Agent】写入/覆盖 formDraft 的形态字段（不写 DB）。" +
      "fields_json 可含 formType、chapteringEnabled、chapteringConfidence、primaryTemplate、" +
      "povScheme、timeScheme、evidenceNotes、genreHints、continuationRules。" +
      "可多次调用；最后 submit_form。",
    parameters: {
      type: "object",
      properties: {
        fields_json: {
          type: "string",
          description: "形态字段 JSON 对象",
        },
      },
      required: ["fields_json"],
    },
    execute: async (args, ctx) => {
      const { userId, novelId, branchId } = ids(ctx);
      const text = loadText(userId, novelId, branchId);
      let ws = getNovelAnalysisWorkspace(userId, novelId, branchId);
      if (!ws?.formDraft) {
        const built = buildFormDraftFromText(novelId, text);
        ws = beginNovelAnalysisWorkspace(userId, novelId, branchId, {
          fullText: text,
        });
        patchNovelAnalysisWorkspace(userId, novelId, branchId, {
          formDraft: built.profile,
          formCatalog: built.catalog,
          formCatalogHints: built.catalogHints,
        });
        ws = getNovelAnalysisWorkspace(userId, novelId, branchId)!;
      }
      let fields: Record<string, unknown>;
      try {
        fields =
          typeof args.fields_json === "string"
            ? JSON.parse(args.fields_json)
            : (args.fields_json as Record<string, unknown>);
      } catch {
        return { content: "fields_json 不是合法 JSON", messages: [] };
      }
      if (!fields || typeof fields !== "object") {
        return { content: "fields_json 须为对象", messages: [] };
      }
      const draft = { ...ws.formDraft } as NovelFormProfile;
      if (typeof fields.formType === "string") {
        draft.formType = fields.formType as NovelFormProfile["formType"];
      }
      const ch = { ...(draft.chaptering || {}) };
      if (typeof fields.chapteringEnabled === "boolean") {
        ch.enabled = fields.chapteringEnabled;
      }
      if (Number.isFinite(Number(fields.chapteringConfidence))) {
        ch.confidence = Number(fields.chapteringConfidence);
      }
      draft.chaptering = ch as NovelFormProfile["chaptering"];
      const na = { ...(draft.narrativeArchitecture || {}) };
      if (typeof fields.primaryTemplate === "string") {
        na.primaryTemplate =
          fields.primaryTemplate as NovelFormProfile["narrativeArchitecture"]["primaryTemplate"];
      }
      if (typeof fields.povScheme === "string") na.povScheme = fields.povScheme;
      if (typeof fields.timeScheme === "string") {
        na.timeScheme =
          fields.timeScheme as NovelFormProfile["narrativeArchitecture"]["timeScheme"];
      }
      if (typeof fields.evidenceNotes === "string") {
        na.evidenceNotes = fields.evidenceNotes;
      }
      if (Array.isArray(fields.genreHints)) {
        na.genreHints = fields.genreHints.map(String);
      }
      draft.narrativeArchitecture =
        na as NovelFormProfile["narrativeArchitecture"];
      if (Array.isArray(fields.continuationRules)) {
        draft.continuationRules = fields.continuationRules
          .map(String)
          .filter(Boolean)
          .slice(0, 10);
      }
      draft.updatedAt = new Date().toISOString();
      patchNovelAnalysisWorkspace(userId, novelId, branchId, {
        formDraft: draft,
      });
      return {
        content:
          `形态字段已更新：formType=${draft.formType} ` +
          `chaptering.enabled=${draft.chaptering?.enabled} ` +
          `template=${draft.narrativeArchitecture?.primaryTemplate || "?"}\n` +
          `可继续 set_form_narrative 或 submit_form。`,
        messages: [],
      };
    },
  },
  {
    name: "submit_form",
    description:
      "【章法子 Agent】将 formDraft 写入分析工作区（不写 DB）。成功含「章法已存」。" +
      "章法域通常 submit 一次后结束；若需修正可再次覆盖提交。",
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
          content: `章法已就绪·跳过（工作区）。units=${units.length}。`,
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
      // Workspace only — master finish commits novel_form + chapter meta
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
          `已写入工作区。`,
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

      // forceRefresh=true 强制重跑；默认有章法则跳过（与工具描述一致）
      const force = args.forceRefresh === true;
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
            `（已写入工作区；交互请用分步工具）`,
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
      "【角色列表】流水线 ①窗扫 → ②overlap → ③oneshot 消解(可 uncertain) → ④canonicalName；" +
      "写入 catalog / localEntities / entities。成功含「角色指称已扫描」。" +
      "若有 uncertain 对，用 list_coref_uncertain_pairs + list_cooccur_neighbors 等工具再判，" +
      "然后 merge/split 或 resolve_coref_uncertain_pair。名单：scan →（消歧）→ submit。" +
      "已有缓存默认跳过；forceRefresh=true 重跑。",
    parameters: {
      type: "object",
      properties: {
        forceRefresh: {
          type: "boolean",
          description:
            "true=强制全书重扫；默认 false/省略则复用已有 catalog",
        },
        legacyUnitScan: {
          type: "boolean",
          description:
            "true=旧路径（按章 unit 扫名，无 stage3）；默认 false 用新 pipeline",
        },
      },
      required: [],
    },
    execute: async (args, ctx, llm, onChunk) => {
      const { userId, novelId, branchId } = ids(ctx);
      const text = loadText(userId, novelId, branchId);
      if (!text.trim()) {
        return { content: "正文为空，无法扫描角色指称", messages: [] };
      }

      const formatScanSummary = (
        surfaceCount: number,
        unitCount: number,
        topLines: string[],
        localEntityCount?: number,
        entityCount?: number,
        skipped?: boolean,
        pipeline?: boolean,
        uncertainN?: number,
      ) => {
        const head = skipped
          ? `${ANALYSIS_OK.scan}（已缓存，跳过重扫）`
          : pipeline
            ? `${ANALYSIS_OK.scan}（①窗扫→②overlap→③oneshot→④canonicalName；catalog）`
            : `${ANALYSIS_OK.scan}（旧路径：LLM 分段扫名+局部消解；catalog）`;
        const top =
          topLines.length > 0
            ? topLines.map((s, i) => `${i + 1}. ${s}`).join("\n")
            : "（无候选指称 — 扫描结果为空）";
        const localN =
          localEntityCount != null
            ? localEntityCount
            : getCharacterExtractWorkspace(userId, novelId, branchId)
                ?.localEntities?.length ?? 0;
        const entN =
          entityCount != null
            ? entityCount
            : getCharacterExtractWorkspace(userId, novelId, branchId)?.entities
                ?.length ?? 0;
        const unc =
          uncertainN ??
          getCharacterExtractWorkspace(userId, novelId, branchId)
            ?.corefUncertainPairs?.length ??
          0;
        const nextHint = skipped
          ? `请继续：list 核对 → submit_character_entities；须重扫时 forceRefresh=true。`
          : pipeline
            ? unc > 0
              ? `entities 已预填（${entN} 人），另有 ${unc} 对 oneshot 不确定。` +
                `请 list_coref_uncertain_pairs → list_cooccur_neighbors 查多级共现 → resolve_coref_uncertain_pair，再 submit。`
              : `entities 已由 ①–④ 预填（${entN} 人）。请 list 核对后 submit_character_entities。`
            : `全书消解：list_near_alias_candidates → list_local_entities → lookup(u@) → submit merge/split。`;
        return (
          `${head}\n` +
          `windows/units=${unitCount} surfaces=${surfaceCount} localEntities=${localN}` +
          (entN ? ` entities=${entN}` : "") +
          (unc ? ` uncertainPairs=${unc}` : "") +
          `\n` +
          `前 ${Math.min(30, topLines.length)} 个 surface：\n${top}\n` +
          nextHint
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

      const forceRefresh = args?.forceRefresh === true;
      const legacyUnitScan = args?.legacyUnitScan === true;
      const existing = getCharacterExtractWorkspace(userId, novelId, branchId);
      const hasCatalog =
        (existing?.catalog?.stats?.length || 0) > 0 &&
        (existing?.localEntities?.length || 0) > 0;
      if (hasCatalog && !forceRefresh) {
        return {
          content: formatScanSummary(
            existing!.catalog.stats.length,
            existing!.unitCount || existing!.localEntities?.length || 0,
            topSurfaceLines(existing!.catalog.stats),
            existing!.localEntities?.length ?? 0,
            existing!.entities?.length ?? 0,
            true,
            (existing!.entities?.length || 0) > 0,
          ),
          messages: [],
        };
      }

      if (!llm) {
        return {
          content:
            "扫描失败：缺少 LLM（scan_character_mentions 须模型抽取）",
          messages: [],
        };
      }
      const ws = getNovelAnalysisWorkspace(userId, novelId, branchId);
      const units = ws?.units?.length ? ws.units : buildNameScanUnits(text);
      if (ws && !ws.units?.length) {
        patchNovelAnalysisWorkspace(userId, novelId, branchId, { units });
      }
      try {
        let lastEmit = 0;
        /** Legacy unit-scan progress (done/total within scan units). */
        const emitLegacy = (done: number, total: number, label: string) => {
          const now = Date.now();
          if (done < total && now - lastEmit < 250) return;
          lastEmit = now;
          const pct = total > 0 ? Math.round((done / total) * 100) : 0;
          onChunk?.(
            `【进度】角色列表 ${done}/${total}（${pct}%）· 旧路径扫名 · ${label}`,
          );
        };
        /** Pipeline stages ①–④: line already formatted. */
        const emitLine = (line: string) => {
          const now = Date.now();
          // Always emit stage boundaries (①0%、②、③、④、完成)
          const force =
            /①窗扫 0\//.test(line) ||
            /②overlap/.test(line) ||
            /③消解/.test(line) ||
            /④命名/.test(line) ||
            /完成/.test(line);
          if (!force && now - lastEmit < 280) return;
          lastEmit = now;
          onChunk?.(line);
        };

        if (legacyUnitScan) {
          const { surfaceCount, unitCount, localEntityCount } =
            await seedCharacterCatalogViaLlm(
              userId,
              novelId,
              branchId,
              text,
              units,
              llm,
              emitLegacy,
            );
          const after = getCharacterExtractWorkspace(userId, novelId, branchId);
          return {
            content: formatScanSummary(
              surfaceCount,
              unitCount,
              topSurfaceLines(after?.catalog?.stats || []),
              localEntityCount,
              after?.entities?.length ?? 0,
              false,
              false,
            ),
            messages: [],
          };
        }

        const seeded = await seedCharacterCatalogViaPipeline(
          userId,
          novelId,
          branchId,
          text,
          llm,
          undefined,
          emitLine,
        );
        const after = getCharacterExtractWorkspace(userId, novelId, branchId);
        // Stage draft for UI / later detail agent
        try {
          if (after?.entities?.length) {
            const staged = entitiesToProfiles(after.entities);
            if (getNovelAnalysisWorkspace(userId, novelId, branchId)) {
              patchNovelAnalysisWorkspace(userId, novelId, branchId, {
                charactersDraft: staged,
              });
            }
          }
        } catch {
          /* best-effort draft */
        }
        return {
          content: formatScanSummary(
            seeded.surfaceCount,
            seeded.unitCount,
            topSurfaceLines(after?.catalog?.stats || []),
            seeded.localEntityCount,
            seeded.entityCount,
            false,
            true,
            seeded.uncertainPairCount,
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
    name: "list_coref_uncertain_pairs",
    description:
      "列出 Stage③ oneshot 标为 uncertain、pipeline 未合并的角色对。" +
      "每对含 idA/idB、surfaces、score、reason。配合 list_cooccur_neighbors / lookup 判断后，" +
      "用 resolve_coref_uncertain_pair 或 submit merge 处理。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => {
      const { userId, novelId, branchId } = ids(ctx);
      const ws = getCharacterExtractWorkspace(userId, novelId, branchId);
      const pairs = ws?.corefUncertainPairs || [];
      if (!pairs.length) {
        return {
          content: "无 uncertain 对（oneshot 均已 same/diff，或尚未 scan）。",
          messages: [],
        };
      }
      const lines = pairs.map((p, i) => {
        return (
          `${i + 1}. ${p.idA} ↔ ${p.idB} score=${p.score.toFixed(2)}\n` +
          `   A={${(p.surfacesA || []).slice(0, 8).join("、")}}\n` +
          `   B={${(p.surfacesB || []).slice(0, 8).join("、")}}\n` +
          `   reason: ${(p.reason || "").slice(0, 160)}`
        );
      });
      return {
        content:
          `uncertain 对共 ${pairs.length}：\n` +
          lines.join("\n") +
          `\n建议：list_cooccur_neighbors(idA/idB) 查多级共现 → resolve_coref_uncertain_pair。`,
        messages: [],
      };
    },
  },
  {
    name: "list_cooccur_neighbors",
    description:
      "查看角色共现网络（窗级，可多级）。id 为 coref roster id（见 uncertain 对或 entities）。" +
      "hops=1 一跳邻居；hops=2 含邻居的邻居摘要。只助关系结构，勿因邻居相似直接合并。",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "角色 id（c559 或 uncertain 对中的 id）" },
        hops: { type: "number", description: "1 或 2，默认 1" },
        limit: { type: "number", description: "每层最多条数，默认 8" },
      },
      required: ["id"],
    },
    execute: async (args, ctx) => {
      const { userId, novelId, branchId } = ids(ctx);
      const ws = getCharacterExtractWorkspace(userId, novelId, branchId);
      const roster = (ws?.corefRoster || []) as Array<{
        id: string;
        windowLo?: number;
        windowHi?: number;
        gender?: string;
        age?: string;
        mentions?: Array<{ surface?: string }>;
      }>;
      if (!roster.length) {
        return {
          content: "无 corefRoster（请先 scan_character_mentions 新 pipeline）",
          messages: [],
        };
      }
      const id = String(args.id || "").trim();
      const hops = Math.max(1, Math.min(2, Number(args.hops) || 1));
      const limit = Math.max(1, Math.min(16, Number(args.limit) || 8));
      const byId = new Map(roster.map((c) => [c.id, c]));
      if (!byId.has(id)) {
        return {
          content: `未知 id=${id}。可用 id 示例：${roster
            .slice(0, 12)
            .map((c) => c.id)
            .join(", ")}`,
          messages: [],
        };
      }
      // Build cooccur from roster window ranges (same window index co-occur)
      const byWin = new Map<number, string[]>();
      for (const c of roster) {
        const lo = c.windowLo ?? 0;
        const hi = c.windowHi ?? lo;
        for (let w = lo; w <= hi; w++) {
          const list = byWin.get(w) || [];
          list.push(c.id);
          byWin.set(w, list);
        }
      }
      const coWith = new Map<string, Map<string, number>>();
      const bump = (a: string, b: string) => {
        if (a === b) return;
        if (!coWith.has(a)) coWith.set(a, new Map());
        const m = coWith.get(a)!;
        m.set(b, (m.get(b) || 0) + 1);
      };
      byWin.forEach((idsInWin) => {
        const uniq = Array.from(new Set(idsInWin));
        for (let i = 0; i < uniq.length; i++) {
          for (let j = i + 1; j < uniq.length; j++) {
            bump(uniq[i]!, uniq[j]!);
            bump(uniq[j]!, uniq[i]!);
          }
        }
      });
      const card = (cid: string, co: number) => {
        const c = byId.get(cid);
        const ss = Array.from(
          new Set((c?.mentions || []).map((m) => (m.surface || "").trim()).filter(Boolean)),
        ).slice(0, 8);
        return (
          `${cid} co=${co} {${ss.join("、") || "?"}} ` +
          `win=[${c?.windowLo ?? "?"}..${c?.windowHi ?? "?"}]`
        );
      };
      const neigh = Array.from(coWith.get(id)?.entries() || [])
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit);
      if (!neigh.length) {
        return { content: `${id} 一跳共现邻居：（无）`, messages: [] };
      }
      let out =
        `【${id} 一跳共现】\n` +
        neigh.map(([nid, co]) => `- ${card(nid, co)}`).join("\n");
      if (hops >= 2) {
        const lines2: string[] = [];
        const seen = new Set<string>([id, ...neigh.map(([n]) => n)]);
        for (const [nid] of neigh.slice(0, 5)) {
          const n2 = Array.from(coWith.get(nid)?.entries() || [])
            .filter(([x]) => !seen.has(x))
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);
          for (const [x, co] of n2) {
            seen.add(x);
            lines2.push(`- via ${nid} → ${card(x, co)}`);
          }
        }
        if (lines2.length) {
          out += `\n【二跳摘要】\n` + lines2.slice(0, 16).join("\n");
        }
      }
      return { content: out, messages: [] };
    },
  },
  {
    name: "resolve_coref_uncertain_pair",
    description:
      "处理 list_coref_uncertain_pairs 中的一对：verdict=merge 则合并两实体（keep/absorb 用 id），" +
      "distinct 则记为不同人并从 uncertain 列表移除。不写 DB，改 entities。",
    parameters: {
      type: "object",
      properties: {
        idA: { type: "string", description: "uncertain 对中实体 A 的 id" },
        idB: { type: "string", description: "uncertain 对中实体 B 的 id" },
        verdict: {
          type: "string",
          enum: ["merge", "distinct"],
          description: "merge=同一人；distinct=不是同一人",
        },
        keep: {
          type: "string",
          description: "merge 时保留的 entity 名或 id（默认 idA 对应实体）",
        },
        reason: { type: "string", description: "判定理由（可选）" },
      },
      required: ["idA", "idB", "verdict"],
    },
    execute: async (args, ctx) => {
      const { userId, novelId, branchId } = ids(ctx);
      const ws = getCharacterExtractWorkspace(userId, novelId, branchId);
      if (!ws) {
        return { content: "无角色提取工作区，请先 scan", messages: [] };
      }
      const idA = String(args.idA || "").trim();
      const idB = String(args.idB || "").trim();
      const verdict = String(args.verdict || "").trim();
      const reason = String(args.reason || "").trim();
      const pairs = ws.corefUncertainPairs || [];
      const idx = pairs.findIndex(
        (p) =>
          (p.idA === idA && p.idB === idB) ||
          (p.idA === idB && p.idB === idA),
      );
      if (idx < 0) {
        return {
          content: `未找到 uncertain 对 ${idA}~${idB}。请 list_coref_uncertain_pairs。`,
          messages: [],
        };
      }
      const pair = pairs[idx]!;

      if (verdict === "distinct") {
        pairs.splice(idx, 1);
        ws.corefUncertainPairs = pairs;
        ws.updatedAt = new Date().toISOString();
        return {
          content:
            `已记录 distinct：${idA} ≠ ${idB}` +
            (reason ? `（${reason}）` : "") +
            `。剩余 uncertain=${pairs.length}`,
          messages: [],
        };
      }
      if (verdict !== "merge") {
        return { content: "verdict 须为 merge 或 distinct", messages: [] };
      }

      // Match entities by corefId first, then by surface bag
      const entities = ws.entities || [];
      const matchEnt = (cid: string, surfaces: string[]) => {
        const byId = entities.find((e) => e.corefId === cid);
        if (byId) return byId;
        const bag = new Set(surfaces.map((s) => s.trim()).filter(Boolean));
        return entities.find((e) => {
          const names = [e.name, ...(e.aliases || []), ...(e.surfaces || [])];
          return names.some((n) => bag.has((n || "").trim()));
        });
      };
      const eA = matchEnt(idA, pair.surfacesA);
      const eB = matchEnt(idB, pair.surfacesB);
      if (!eA || !eB) {
        return {
          content:
            `未能在 entities 中定位双方，uncertain 对仍保留（请手工 merge keep/absorb 后重试）。` +
            ` A surfaces={${pair.surfacesA.slice(0, 5).join("、")}}` +
            ` B={${pair.surfacesB.slice(0, 5).join("、")}}`,
          messages: [],
        };
      }
      if (eA.name === eB.name) {
        pairs.splice(idx, 1);
        ws.corefUncertainPairs = pairs;
        ws.updatedAt = new Date().toISOString();
        return {
          content: `两 id 已对应同一 entity「${eA.name}」。剩余 uncertain=${pairs.length}`,
          messages: [],
        };
      }
      const keepName = String(args.keep || eA.name).trim() || eA.name;
      const absorbName = keepName === eA.name ? eB.name : eA.name;
      const keep = entities.find((e) => e.name === keepName) || eA;
      const absorb = entities.find((e) => e.name === absorbName) || eB;
      const aliasSet = new Set([
        ...(keep.aliases || []),
        ...(keep.surfaces || []),
        absorb.name,
        ...(absorb.aliases || []),
        ...(absorb.surfaces || []),
      ]);
      aliasSet.delete(keep.name);
      keep.aliases = Array.from(aliasSet);
      keep.surfaces = Array.from(
        new Set([...(keep.surfaces || []), ...(absorb.surfaces || [])]),
      );
      if (!keep.corefId) keep.corefId = eA.corefId || eB.corefId;
      if (absorb.anchors?.length) {
        keep.anchors = [...(keep.anchors || []), ...absorb.anchors].slice(0, 48);
      }
      ws.entities = entities.filter((e) => e.name !== absorb.name);
      pairs.splice(idx, 1);
      ws.corefUncertainPairs = pairs;
      ws.updatedAt = new Date().toISOString();
      return {
        content:
          `已 merge：保留「${keep.name}」，吸收「${absorb.name}」` +
          (reason ? `（${reason}）` : "") +
          `。entities=${ws.entities.length} 剩余 uncertain=${pairs.length}`,
        messages: [],
      };
    },
  },
  {
    name: "submit_story_world",
    description:
      "提交故事与世界观 JSON 到分析工作区（不写 DB）。成功含「故事世界已存」。" +
      "本域通常完整提交一次后结束；若需修正可再次覆盖。",
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
          content: `${ANALYSIS_OK.story}（已写入工作区）`,
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
      "提交**单个**角色多维度详情到工作区（不写 DB）。成功含「角色详情已存」。" +
      "可按角色多次调用（一人一调）；全部目标角色交完后本域才结束，单次成功≠名单全做完。" +
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
            `${ANALYSIS_OK.detail}:${name}（维度分 ${score}/7；工作区 ${chars.length} 人，完整详情 ${richN}）`,
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
      "提交有向关系边到工作区（不写 DB）。成功含「角色关系已存」。" +
      "可分批、多次调用（边会累计/合并）；单次成功≠关系域已全部完成。",
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
          content: `${ANALYSIS_OK.rels}：提交 ${edges.length} 条，挂接 ${applied} 条（已写入工作区）`,
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
      "提交时间线 JSON 到分析工作区（不写 DB）。成功含「时间线已存」。" +
      "通常整份时间线提交一次后结束；若需修正可再次覆盖。",
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
          content: `${ANALYSIS_OK.timeline}（已写入工作区）`,
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
      "提交文风 JSON 到分析工作区，并同步写入文笔库。" +
      "style_json 须为 WritingStyle 字段（genre, styleDescription, narrativeTechniques, " +
      "languageFeatures, pacingDescription, tone, examplePassages, contentRating）；" +
      "也接受中文键自由结构（会归一化）。成功含「文风已存」。",
    parameters: {
      type: "object",
      properties: {
        style_json: {
          type: "string",
          description:
            "WritingStyle JSON，推荐字段：genre, styleDescription, languageFeatures, " +
            "pacingDescription, tone, narrativeTechniques[], examplePassages[], contentRating",
        },
      },
      required: ["style_json"],
    },
    execute: async (args, ctx) => {
      const { userId, novelId, branchId } = ids(ctx);
      try {
        const raw = JSON.parse(String(args.style_json || ""));
        const style = normalizeWritingStyle(raw);
        if (!style) {
          return {
            content:
              "文风提交失败：JSON 无法归一化为 WritingStyle（需 styleDescription/genre/tone 等有效字段）。" +
              "请用英文键：genre, styleDescription, languageFeatures, pacingDescription, tone。",
            messages: [],
          };
        }
        ensureWs(userId, novelId, branchId);
        patchNovelAnalysisWorkspace(userId, novelId, branchId, { style });
        const title = resolveBookTitle(userId, novelId);
        const lib = upsertExtractedStyle(userId, novelId, title, style);
        return {
          content: lib
            ? `${ANALYSIS_OK.style}（已写入工作区 + 文笔库「${lib.name}」）`
            : `${ANALYSIS_OK.style}（已写入工作区；文笔库写入失败）`,
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
      "提交点子到工作区（不写点子库）。成功含「点子已存」。" +
      "ideas_json 为数组或 {ideas:[]}；每项必须有 title + content（2–4 句说明）。" +
      "也接受中文键（标题/内容/描述/标签），会归一化。无 content 的条目会被丢弃。" +
      "通常整批提交一次后结束；若需修正可再次覆盖。",
    parameters: {
      type: "object",
      properties: {
        ideas_json: {
          type: "string",
          description:
            'Idea 数组或 {ideas:[{title,content,tags[]}]}；推荐英文键，content 必填',
        },
      },
      required: ["ideas_json"],
    },
    execute: async (args, ctx) => {
      const { userId, novelId, branchId } = ids(ctx);
      try {
        const raw = JSON.parse(String(args.ideas_json || ""));
        const bookTitle = resolveBookTitle(userId, novelId);
        const { entries, rejected, emptyContent } = normalizeIdeaEntries(raw, {
          novelId,
          novelTitle: bookTitle,
        });
        if (!entries.length) {
          return {
            content:
              `点子提交失败：没有可用条目（${emptyContent ? `有 ${emptyContent} 条缺 content；` : ""}` +
              `丢弃 ${rejected}）。每条必须含 title + content（2–4 句可执行说明）。` +
              `示例：[{"title":"…","content":"…","tags":["设定"]}]`,
            messages: [],
          };
        }
        ensureWs(userId, novelId, branchId);
        patchNovelAnalysisWorkspace(userId, novelId, branchId, { ideas: entries });
        const note =
          rejected > 0
            ? `（另丢弃 ${rejected} 条空内容/无效）`
            : "";
        return {
          content: `${ANALYSIS_OK.ideas}：${entries.length} 条（已写入工作区）${note}`,
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
      "查看各分析域完成状态（已入库 published + 本轮会话 session）、依赖图、建议下一步。" +
      "done = 会话或已入库有结果（客观事实）；是否全量重跑由你根据**用户本轮意图**判断，不是由 force 开关决定。" +
      "用户点名单域时传 for_agent → launchPlan。" +
      "普通补缺：pending 直接派；用户明确一键/从头/全部重跑：即使 done 也按波次全派且不必再 ask。",
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

      // ── 会话草稿（未确认保存）──
      const sessionForm = !!(ws?.form || ws?.formDraft);
      const sessionStory = !!ws?.storyInfo?.plotSummary;
      const entitiesResolved = cws?.entities?.length || 0;
      const draftChars = ws?.charactersDraft?.length || 0;
      const sessionCharacterList = entitiesResolved > 0 || draftChars > 0;
      const detailInDraft = (ws?.charactersDraft || []).filter(profileHasDetail).length;
      const sessionCharacterDetail = detailInDraft > 0;
      const relEdges = ws?.relationshipEdges?.length || 0;
      const relOnDraft = (ws?.charactersDraft || []).reduce(
        (n, c) => n + (c.relationships?.length || 0),
        0,
      );
      const sessionCharacterRelationships = relEdges > 0 || relOnDraft > 0;
      const sessionTimeline = !!ws?.timeline;
      const sessionStyle = !!ws?.style;
      const ideaCountWs = ws?.ideas?.length || 0;
      const sessionIdeas = ideaCountWs > 0;

      // ── 已入库（确认保存后）──
      const dbForm = !!getNovelForm(userId, novelId);
      const dbStory = !!getStoryInfo(userId, novelId)?.plotSummary;
      const dbChars = getCharacters(userId, novelId);
      const charactersInDb = dbChars.length;
      const dbCharacterList = charactersInDb > 0;
      const detailInDb = dbChars.filter(profileHasDetail).length;
      const dbCharacterDetail = detailInDb > 0;
      const relOnDb = dbChars.reduce(
        (n, c) => n + (c.relationships?.length || 0),
        0,
      );
      const dbCharacterRelationships = relOnDb > 0;
      const dbTimeline = !!getTimeline(userId, novelId, branchId);
      const dbStyle = listStyles(userId).some((s) => s.sourceNovelId === novelId);
      const ideaCountDb = listIdeas(userId).filter((i) => i.sourceNovelId === novelId).length;
      const dbIdeas = ideaCountDb > 0;

      // ── 编排用 ready：会话 OR 已入库（客观「有结果」）──
      // 是否重跑由主编根据用户意图判断，禁止用 force 把 DB 抹成「未分析」
      const form = sessionForm || dbForm;
      const story = sessionStory || dbStory;
      const characterList = sessionCharacterList || dbCharacterList;
      const characterDetail = sessionCharacterDetail || dbCharacterDetail;
      const characterRelationships =
        sessionCharacterRelationships || dbCharacterRelationships;
      const timelineData = sessionTimeline || dbTimeline;
      const tlJobs = listTimelineJobRows(userId, novelId, branchId);
      const latestTlJob = tlJobs[0] || null;
      const timelineJobStatus = latestTlJob?.status || null;
      const timelineJobStarted = !!(
        latestTlJob &&
        ["queued", "running", "done"].includes(String(latestTlJob.status))
      );
      const timeline = timelineData || timelineJobStarted;
      const style = sessionStyle || dbStyle;
      const ideas = sessionIdeas || dbIdeas;

      // 一键 wipe 后可能带 hint（仅提示意图，不改变 done 算法）
      const userRequestedFullRerun = !!ws?.forceRefresh;

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
      const { pendingRequired, pendingOptional } =
        partitionAnalysisPending(pending);
      const writeReady = isWriteReadyFromDomainMap(domainReady);

      // agent_type → ready (for launch plan / fill-missing)
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

      const parallelReady = listParallelReadyAgents(readyByAgent);
      const nextActions: string[] = [];
      if (userRequestedFullRerun) {
        nextActions.push(
          "用户要求全书/一键从头：即使 done 也按波次全量派工（章法→名单∥故事∥时间线∥文风∥点子→详情→关系），" +
            "禁止因 done 跳过，禁止再 ask 是否重跑。",
        );
      }
      if (!form) {
        nextActions.push('agent(agent_type="analyze_form")');
      } else if (parallelReady.length > 1) {
        nextActions.push(
          `同轮并行派发（勿串行）：${parallelReady
            .map((a) => `agent(agent_type="${a}")`)
            .join(" ∥ ")}`,
        );
      } else if (parallelReady.length === 1) {
        nextActions.push(`agent(agent_type="${parallelReady[0]}")`);
      }
      // Character chain after list exists (detail/rels not always in parallelReady alone)
      if (form && characterList && !characterDetail) {
        if (!parallelReady.includes("extract_character_detail")) {
          nextActions.push('agent(agent_type="extract_character_detail")');
        }
      } else if (form && characterDetail && !characterRelationships) {
        if (!parallelReady.includes("extract_character_relationships")) {
          nextActions.push(
            'agent(agent_type="extract_character_relationships")',
          );
        }
      }
      // Wrap-up when required domains done — timeline optional/background never blocks
      if (pendingRequired.length === 0 && done.length > 0 && !userRequestedFullRerun) {
        const optNote =
          pendingOptional.length > 0
            ? `（可选后台仍缺：${pendingOptional.join("、")}；不阻塞写作与保存）`
            : "";
        nextActions.push(
          `本轮可收尾${optNote}：ask_question 选项须含「确认保存到本书」；` +
            "用户点选保存或文字要求保存 → finish_novel_analysis(userConfirmed=true)。" +
            "时间线为后台异步，勿等待其完成再 finish。",
        );
      } else if (writeReady && pendingRequired.length > 0) {
        nextActions.push(
          "写作门槛已齐（章法·故事·角色名单）；可继续补 pendingRequired，" +
            "或先 ask 是否保存；时间线可选不阻塞。",
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
        /**
         * 客观事实：会话或已入库有结果。
         * 是否重跑看用户意图 + userRequestedFullRerun，不要把 force 当成「全未分析」。
         */
        published: {
          form: dbForm,
          story: dbStory,
          character_list: dbCharacterList,
          character_detail: dbCharacterDetail,
          character_relationships: dbCharacterRelationships,
          timeline: dbTimeline,
          style: dbStyle,
          ideas: dbIdeas,
        },
        session: {
          form: sessionForm,
          story: sessionStory,
          character_list: sessionCharacterList,
          character_detail: sessionCharacterDetail,
          character_relationships: sessionCharacterRelationships,
          timeline: sessionTimeline,
          style: sessionStyle,
          ideas: sessionIdeas,
        },
        /** 一键 wipe 后的意图提示；主编应全量派工，但仍如实反映 published */
        userRequestedFullRerun,
        forceRefresh: userRequestedFullRerun,
        sessionMode: userRequestedFullRerun ? "full_intent" : "normal",
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
        /** Timeline data present (not just job started) */
        timelineData,
        /** Orchestration ready: data OR background job started */
        timeline,
        timelineJobStatus,
        timelineJobId: latestTlJob?.id || null,
        /** Optional domains never block 写作 / finish */
        optionalDomains: [...ANALYSIS_OPTIONAL_DOMAINS],
        writeRequiredDomains: [...ANALYSIS_WRITE_REQUIRED_DOMAINS],
        writeReady,
        style,
        ideas,
        ideaCount: ideaCountWs || ideaCountDb,
        /** Deps ready & not done — dispatch all in one turn (runtime parallel) */
        parallelReady,
        unitCount: ws?.units?.length || 0,
        canTimeline: form || (ws?.units?.length || 0) > 0,
        /** 子 Agent 依赖表（拉单域前必查） */
        dependencies: ANALYSIS_AGENT_DEPENDENCIES,
        domainToAgent: ANALYSIS_DOMAIN_TO_AGENT,
        agents: [...ANALYSIS_SUBAGENT_TYPES],
        readyByAgent,
        done,
        pending,
        pendingRequired,
        pendingOptional,
        nextActions,
        /** 用户点名单域时：缺依赖则 sequence = 依赖… + 目标 */
        launchPlan,
        /** Human-readable dependency tree for master to show users */
        dependencyTree: {
          ascii: [
            "analyze_form（章法）",
            "├─ analyze_character_list（角色名单）",
            "│  ├─ extract_character_detail（角色详情）",
            "│  │  └─ extract_character_relationships（角色关系）",
            "│  └─ （详情是关系的依赖）",
            "├─ analyze_story_world（故事世界）",
            "├─ analyze_timeline（时间线 · 后台可选，不阻塞写作）",
            "├─ extract_style（文风）",
            "└─ extract_ideas（点子）",
          ].join("\n"),
          edges: ANALYSIS_AGENT_DEPENDENCIES,
        },

        /**
         * Guidance only — master invents ask_question options for this user turn.
         * Do NOT hardcode a fixed menu; options must be unambiguous for humans.
         */
        decisionHint: {
          /** Required domains complete (timeline optional does not block) */
          alreadyComplete: pendingRequired.length === 0 && done.length > 0,
          writeReady,
          /** Soft: only suggest asking when scope is unclear (partial done, vague user request) */
          shouldClarifyScope:
            done.length > 0 &&
            // still missing something, or user may mean re-run vs fill
            true,
          doneDomainsZh: done.map((d) => {
            const map: Record<string, string> = {
              form: "章法",
              character_list: "角色名单",
              character_detail: "角色详情",
              character_relationships: "角色关系",
              story: "故事世界",
              timeline: "时间线",
              style: "文风",
              ideas: "点子",
            };
            return map[d] || d;
          }),
          pendingDomainsZh: pending.map((d) => {
            const map: Record<string, string> = {
              form: "章法",
              character_list: "角色名单",
              character_detail: "角色详情",
              character_relationships: "角色关系",
              story: "故事世界",
              timeline: "时间线",
              style: "文风",
              ideas: "点子",
            };
            return map[d] || d;
          }),
          pendingOptionalZh: pendingOptional.map((d) =>
            d === "timeline" ? "时间线（后台可选）" : d,
          ),
          agentZh: {
            analyze_form: "章法",
            analyze_character_list: "角色名单",
            extract_character_detail: "角色详情",
            extract_character_relationships: "角色关系",
            analyze_story_world: "故事世界",
            analyze_timeline: "时间线（后台）",
            extract_style: "文风",
            extract_ideas: "点子",
          },
          /** Rules the master must follow when writing options (not a fixed list) */
          optionRules: [
            "不要写死/照抄固定菜单；按用户本轮意图与 done/pending 现场组织选项",
            "每个选项语义唯一：用户点了之后只能有一种理解，不能既像「只重角色」又像「全书重跑」",
            "禁止歧义词单独当选项：如「全部重新分析」「重新分析」「再分析一遍」（未说明范围）",
            "若涉及将派工：用中文写清范围（章法/角色名单/角色详情/角色关系/故事…），需要时加「将运行：A → B」中文步骤",
            "禁止在用户可见 options 里写英文 agent_type",
            "角色可拆成：仅名单 / 仅详情 / 仅关系 / 名单+详情+关系；不要合成含糊的「角色相关」",
            "「全书重跑」必须写明含章法且很慢；与「只重角色」严格分开",
            "本轮分析告一段落时：options 必须包含「确认保存到本书」或「保存分析结果」",
            "用户点了保存类选项，或文字要求保存 → finish_novel_analysis(userConfirmed=true)，不要再追问",
            "用户要求分析已在 done 中的域：必须 ask 是否重新分析（覆盖）还是保留；禁止静默重跑",
            "done=会话或已入库有结果；用户明确一键/从头/全部重跑时即使 done 也全量派工且不必再 ask",
            "userRequestedFullRerun 仅为意图提示，不要把 published 假装成未分析",
            "parallelReady 有多项时：同轮多个 agent() 并行，禁止无谓串行",
            "时间线为后台异步可选：不阻塞写作；勿等待时间线跑完再保存；pending 仅剩 timeline 时仍可 finish",
            "写作就绪 = 章法目录 + 故事 + 角色名单（status.writeReady）；detail/rels/文风/点子/时间线非写作硬门槛",
            "选项数量适中（一般 2～5 个），只放与当前用户意图相关的，不要堆无关全书菜单",
          ],
          /** Prefer offering save on wrap-up (not a “nag ban”) */
          requireSaveOptionOnWrapUp: true,
        },
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
      "用户要求保存，或 ask_question 选了保存类选项后调用：把本轮工作区写入本书与文笔/点子库。" +
      "userConfirmed=true 表示用户已同意保存（文字要求或点选均可）。成功含「全书分析已完成」。",
    parameters: {
      type: "object",
      properties: {
        userConfirmed: {
          type: "boolean",
          description:
            "必须为 true：用户已要求保存，或已点选「确认保存到本书」等保存选项",
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
            "未落库：用户需文字要求保存，或在 ask_question 中点选保存选项后，" +
            "再 finish_novel_analysis(userConfirmed=true)。",
          messages: [],
        };
      }
      const { userId, novelId, branchId } = ids(ctx);
      const { commitAnalysisWorkspace } = await import("../commit-analysis");
      const result = commitAnalysisWorkspace({ userId, novelId, branchId });
      // 仅 ok 时打成功标记；空提交/forceRefresh 缺域不得被 toolSaveSucceeded 当成完成
      if (!result.ok) {
        return {
          content: result.content.startsWith("未落库")
            ? result.content
            : `未落库：${result.content}`,
          messages: [],
        };
      }
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

