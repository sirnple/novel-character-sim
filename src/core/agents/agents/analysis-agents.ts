/**
 * Novel analysis agents: master + domain sub-agents.
 * Order (master): form → characters → (story ∥ timeline ∥ style ∥ ideas)
 */
import type { Agent, ToolDefinition } from "../types";
import { defineAgent } from "../agent-registry";
import { makeLoopAgent } from "./make-loop-agent";
import { characterEntityResolveAgent } from "./character-entity-resolve";
import {
  analysisDomainTools,
  analysisMasterTools,
  ANALYSIS_OK,
} from "./analysis-tools";
import { characterExtractTools } from "./character-extract-tools";
import { getTool } from "../registry";
import { buildMasterAgentToolSchema } from "../analysis-allowlist";
import { resolveAgentSystem } from "@/core/prompts/resolve-agent-prompt";
import { runSubAgentToolLoop } from "../tool-loop";
import { toolSaveSucceeded } from "../save-verify";
import type { TrailMessage } from "../types";

function pick(names: string[], pool: ToolDefinition[]): ToolDefinition[] {
  const byName = new Map(pool.map((t) => [t.name, t]));
  return names.map((n) => byName.get(n)).filter(Boolean) as ToolDefinition[];
}

const domain = analysisDomainTools;
const master = analysisMasterTools;
/** Domain tools + surface/anchor lookup (list + detail agents). */
const domainWithLookup: ToolDefinition[] = (() => {
  const m = new Map<string, ToolDefinition>();
  for (const t of [...analysisDomainTools, ...characterExtractTools]) {
    if (!m.has(t.name)) m.set(t.name, t);
  }
  return Array.from(m.values());
})();

// ---- Domain sub-agents ----

/**
 * 章节结构索引：主编只派 agent(chapter_structure_indexer)。
 * 分步工具：scan → build → list_form_catalog(分页) → apply_catalog_tracks → set_form_narrative → submit_form
 * 禁止一次 LLM 吐全书 trackLabels；禁止 run_form_analysis 黑盒。
 * 状态域 key 仍为 form（工作区/写作门槛）；agent_type 为 frontmatter name。
 */
export const formAnalysisAgent: Agent = makeLoopAgent({
  system: "chapter_structure_indexer.md",
  tools: (() => {
    const core = pick(
      [
        "get_analysis_context",
        "scan_chapter_catalog",
        "build_form_draft",
        "list_form_catalog",
        "apply_catalog_tracks",
        "set_form_narrative",
        "submit_form",
        "list_text_units",
      ],
      domain,
    );
    const ask = getTool("ask_question");
    return ask ? [...core, ask] : core;
  })(),
  submitTool: "submit_form",
  okMarker: ANALYSIS_OK.form,
  // Long books: many list_form_catalog pages + track batches
  maxSteps: 36,
  temperature: 0.2,
});

export const storyWorldAgent: Agent = makeLoopAgent({
  system: "analyze_story_world-system.md",
  tools: pick(
    ["get_analysis_context", "get_novel_excerpt", "get_text_slice", "list_text_units", "get_unit_text", "submit_story_world"],
    domain,
  ),
  submitTool: "submit_story_world",
  okMarker: ANALYSIS_OK.story,
  maxSteps: 16,
});

/** Roster — user prompt only novel/branch; system + toolSaveSucceeded like save_prose */
export const characterRosterAgent: Agent = characterEntityResolveAgent;

const characterDetailLoop = makeLoopAgent({
  system: "extract_character_detail-system.md",
  tools: pick(
    [
      "get_analysis_context",
      "get_kept_roster",
      "get_novel_excerpt",
      "list_text_units",
      "get_unit_text",
      "get_text_slice",
      // Anchor-aware reads (same-name different people)
      "lookup_surface",
      "lookup_offset",
      "submit_character_detail",
    ],
    domainWithLookup,
  ),
  submitTool: "submit_character_detail",
  okMarker: ANALYSIS_OK.detail,
  maxSteps: 24,
});

/** After loop: require real detail content in workspace (not empty stubs). */
export const characterDetailAgent: Agent = {
  config: characterDetailLoop.config,
  execute: async (ctx, llm, onChunk, onTrail) => {
    const result = await characterDetailLoop.execute(ctx, llm, onChunk, onTrail);
    const { getNovelAnalysisWorkspace } = await import(
      "@/core/extractor/novel-analysis-workspace"
    );
    const { profileHasDetail } = await import("../character-draft-utils");
    const ws = getNovelAnalysisWorkspace(
      ctx.userId,
      ctx.novelId,
      ctx.branchId || "main",
    );
    const draft = ws?.charactersDraft || [];
    const rich = draft.filter(profileHasDetail);
    // Need multi-dimension profiles, not roster brief-as-personality
    if (rich.length === 0) {
      return {
        content:
          `character_detail 失败：工作区无多维度详情（仅名单空壳、只填性格、或未 submit）。` +
          `每人须 submit_character_detail：appearance+personality，并至少两项 drive/behavior/worldview|values/speakingStyle/background。` +
          ` 当前 draft=${draft.length}`,
        messages: result.messages,
      };
    }
    return {
      content: `character_detail 完成：多维度详情 ${rich.length}/${draft.length} 人`,
      messages: result.messages,
    };
  },
};

const characterRelationshipsLoop = makeLoopAgent({
  system: "extract_character_relationships-system.md",
  tools: pick(
    [
      "get_analysis_context",
      "get_kept_roster",
      "get_relationship_type_catalog",
      "get_novel_excerpt",
      "list_text_units",
      "get_unit_text",
      "submit_character_relationships",
    ],
    domain,
  ),
  submitTool: "submit_character_relationships",
  okMarker: ANALYSIS_OK.rels,
  maxSteps: 20,
});

export const characterRelationshipsAgent: Agent = {
  config: characterRelationshipsLoop.config,
  execute: async (ctx, llm, onChunk, onTrail) => {
    const result = await characterRelationshipsLoop.execute(ctx, llm, onChunk, onTrail);
    const { getNovelAnalysisWorkspace } = await import(
      "@/core/extractor/novel-analysis-workspace"
    );
    const ws = getNovelAnalysisWorkspace(
      ctx.userId,
      ctx.novelId,
      ctx.branchId || "main",
    );
    const edges = ws?.relationshipEdges?.length || 0;
    const relOnChars = (ws?.charactersDraft || []).reduce(
      (n, c) => n + (c.relationships?.length || 0),
      0,
    );
    // Empty graph is allowed if tool was called with []; loop already verified submit
    if (!result.content.includes("失败") && edges === 0 && relOnChars === 0) {
      // Still OK if agent legitimately found no edges — content will say 0 条
      return result;
    }
    return {
      content:
        result.content.includes("失败")
          ? result.content
          : `character_relationships 完成：edges=${edges} 挂接=${relOnChars}`,
      messages: result.messages,
    };
  },
};

/**
 * Timeline launcher — predetermined path (workflow-like), not an LLM loop.
 * Still exposed via agent() for master UX (jobOnly AgentConfig).
 */
export const timelineAnalysisAgent = defineAgent(
  "analyze_timeline-system.md",
  (config) => {
    const name = config.name;
    return async (ctx, _llm, onChunk) => {
    const userId = String(ctx.userId || "");
    const novelId = String(ctx.novelId || "");
    const branchId = String(ctx.branchId || "main");
    if (!userId || !novelId) {
      return {
        content: `${name} 失败：缺少 userId/novelId`,
        messages: [],
      };
    }

    const { getTimeline, listTimelineJobRows } = await import("@/lib/db");
    const existing = getTimeline(userId, novelId, branchId);
    const nCh = existing?.chapters?.length || existing?.totalChapters || 0;
    if (nCh > 0) {
      const msg = `${ANALYSIS_OK.timeline}：已有 ${nCh} 章（跳过重跑；强制请用户确认后清缓存）`;
      onChunk?.(msg);
      return { content: msg, messages: [] };
    }

    const jobs = listTimelineJobRows(userId, novelId, branchId);
    const active = jobs.find((j) =>
      ["queued", "running"].includes(String(j.status)),
    );
    if (active) {
      const msg =
        `${ANALYSIS_OK.timelineJob}：job=${active.id} status=${active.status}` +
        `（后台进行中，不阻塞写作/保存）`;
      onChunk?.(msg);
      return { content: msg, messages: [] };
    }

    try {
      const { startTimelineJob } = await import("@/core/form/timeline-job");
      const job = startTimelineJob({ userId, novelId, branchId });
      const msg =
        `${ANALYSIS_OK.timelineJob}：job=${job.id} units=${job.total}` +
        `（已后台排队，写作不依赖其完成）`;
      onChunk?.(msg);
      return { content: msg, messages: [] };
    } catch (e) {
      return {
        content: `${name} 启动失败: ${(e as Error).message}`,
        messages: [],
      };
    }
  };
  },
);

/** @deprecated use timelineAnalysisAgent */
export const timelineAnalysisWorkflow = timelineAnalysisAgent;

export const styleExtractAgent: Agent = makeLoopAgent({
  system: "extract_style-system.md",
  tools: pick(
    ["get_analysis_context", "get_novel_excerpt", "get_text_slice", "submit_style"],
    domain,
  ),
  submitTool: "submit_style",
  okMarker: ANALYSIS_OK.style,
  maxSteps: 12,
});

export const ideaExtractAgent: Agent = makeLoopAgent({
  system: "extract_ideas-system.md",
  tools: pick(
    ["get_analysis_context", "get_novel_excerpt", "get_text_slice", "submit_ideas"],
    domain,
  ),
  submitTool: "submit_ideas",
  okMarker: ANALYSIS_OK.ideas,
  maxSteps: 12,
});

// ---- Master: orchestration only ----

export const novelAnalysisAgent = defineAgent(
  "novel_analysis-system.md",
  (config) => {
    const name = config.name;
    return async (ctx, llm, onChunk, onTrail) => {
    // System from md only; user is rendered in code (no novel-analysis-master-user.md).
    const sys = resolveAgentSystem(name, "zh");

    const toolBlock = `

## 可用编排
- 先 get_current_* + **get_analysis_status**（看 parallelReady / nextActions / writeReady / pendingRequired）
- **波次**：章法 → 同轮并行（名单∥故事∥时间线∥文风∥点子）→ 详情 → 关系
- 依赖已齐的兄弟域：同一回复里多个 agent()，系统并行执行；禁止无谓串行
- **时间线 timeline**：只启动后台 job，立刻返回；**不阻塞**写作与 finish
- **写作就绪 writeReady**：章法 + 故事 + 角色名单即可；勿等时间线跑完
- pending 仅剩 timeline 或 pendingRequired 为空时：可收尾保存，勿干等时间线
- **用户点名单域**：get_analysis_status(for_agent=目标) → launchPlan
- 范围不清 → ask_question（收尾须含保存选项）
- **已 done 的域**：用户再要求分析 → 必须 ask 是否重新分析/覆盖，禁止静默重跑
- 章法/目录：agent(chapter_structure_indexer)（禁止主编直接 run_form_analysis）
- 用户要求保存或点选保存 → finish_novel_analysis(userConfirmed=true)
`;

    // Same shape as chat route: mode-scoped agent schema + thin master tools
    const agentSchema = buildMasterAgentToolSchema("analysis");
    const masterNames = [
      "get_current_novel",
      "get_current_branch",
      "get_analysis_context",
      "get_analysis_status",
      "finish_novel_analysis",
      "ask_question",
    ];
    const tools = [
      {
        name: agentSchema.name,
        description: agentSchema.description,
        parameters: agentSchema.parameters,
      },
      ...masterNames
        .map((name) => {
          const t = getTool(name) || master.find((m) => m.name === name);
          if (!t) return null;
          return {
            name: t.name,
            description: t.description,
            parameters: t.parameters as Record<string, unknown>,
          };
        })
        .filter(Boolean),
    ] as {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }[];

    const task =
      (ctx.prompt || "").trim() ||
      `组织分析小说 ${ctx.novelId} 分支 ${ctx.branchId || "main"}`;
    const uc = `${task}${toolBlock}`;

    const run = (user: string) =>
      runSubAgentToolLoop(llm, sys, user, tools, ctx, onChunk, onTrail, {
        maxTokens: 4096,
        temperature: 0.2,
        maxSteps: 40,
      });

    let loop = await run(uc);
    let trail = loop.trail;
    let fin = toolSaveSucceeded(trail, "finish_novel_analysis", ANALYSIS_OK.finish);
    if (!fin.ok) {
      const retry = await run(
        `${uc}\n\n## 系统纠错\n请在各模块完成后调用 finish_novel_analysis。`,
      );
      trail = trail.concat(retry.trail.filter((m) => m.role !== "system") as TrailMessage[]);
      fin = toolSaveSucceeded(trail, "finish_novel_analysis", ANALYSIS_OK.finish);
    }
    return {
      content: fin.ok
        ? fin.detail
        : `全书分析未 finish：${fin.detail || loop.finalText || "未知"}`,
      messages: trail,
    };
  };
  },
);

/**
 * Analysis agents to register — each already carries `config` from frontmatter.
 * No alias registrations; master must call agent_type by frontmatter name.
 */
export const ANALYSIS_AGENTS: Agent[] = [
  novelAnalysisAgent,
  formAnalysisAgent,
  storyWorldAgent,
  characterRosterAgent,
  characterDetailAgent,
  characterRelationshipsAgent,
  timelineAnalysisAgent,
  styleExtractAgent,
  ideaExtractAgent,
];

/** @deprecated use ANALYSIS_AGENTS */
export const ANALYSIS_AGENT_IMPLEMENTATIONS = ANALYSIS_AGENTS.map((agent) => ({
  name: agent.config.name,
  agent,
}));
