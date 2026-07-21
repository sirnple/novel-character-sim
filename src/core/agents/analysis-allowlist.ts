/**
 * Analysis master tools — mirror write master shape:
 *
 * | Kind | Write | Analysis |
 * |------|-------|----------|
 * | Sub-agent dispatch | agent(agent_type) | agent(agent_type) |
 * | User gate | ask_question | ask_question |
 * | Thin reads | get_branch_*, get_outline, get_findings | get_current_*, get_analysis_status |
 * | Program actions | accept_continuation, run_reviews | finish_novel_analysis |
 *
 * Domain work (including form) is NEVER a master tool — only via agent(agent_type).
 * run_form_analysis / scan_character_mentions / submit_* belong to sub-agents only.
 */
export const ANALYSIS_MASTER_TOOL_NAMES = [
  "agent",
  "ask_question",
  "get_current_novel",
  "get_current_branch",
  "get_analysis_status",
  "get_analysis_context",
  "finish_novel_analysis",
] as const;

export type AnalysisMasterToolName = (typeof ANALYSIS_MASTER_TOOL_NAMES)[number];

/** Write-mode sub-agents (verb-object), for mode-scoped agent() enum */
export const WRITE_SUBAGENT_TYPES = [
  "generate_outline",
  "write_prose",
  "review_outline",
  "review_character",
  "review_continuity",
  "review_foreshadowing",
  "review_style",
  "review_world",
  "review_pacing",
] as const;

/**
 * Analysis sub-agents via agent(agent_type=...).
 * Verb-object names, same style as write_prose / review_character.
 */
export const ANALYSIS_SUBAGENT_TYPES = [
  /** 章法：子 Agent 内调 run_form_analysis，主编不直接调该工具 */
  "analyze_form",
  "analyze_story_world",
  /** 角色列表分析（扫名/指代等均在子 Agent 内决策，主编只派此名） */
  "analyze_character_list",
  "extract_character_detail",
  "extract_character_relationships",
  "analyze_timeline",
  "extract_style",
  "extract_ideas",
] as const;

export type AnalysisSubagentType = (typeof ANALYSIS_SUBAGENT_TYPES)[number];

/**
 * Direct dependencies: must be ready before launching this agent.
 * Master must run missing deps first when user asks for a single domain.
 */
export const ANALYSIS_AGENT_DEPENDENCIES: Record<
  AnalysisSubagentType,
  readonly AnalysisSubagentType[]
> = {
  analyze_form: [],
  /** 名单依赖章法（分章/units） */
  analyze_character_list: ["analyze_form"],
  extract_character_detail: ["analyze_character_list"],
  extract_character_relationships: [
    "analyze_character_list",
    "extract_character_detail",
  ],
  analyze_story_world: ["analyze_form"],
  analyze_timeline: ["analyze_form"],
  extract_style: ["analyze_form"],
  extract_ideas: ["analyze_form"],
};

/** Status domain key → agent_type that produces it */
export const ANALYSIS_DOMAIN_TO_AGENT: Record<string, AnalysisSubagentType> = {
  form: "analyze_form",
  character_list: "analyze_character_list",
  character_detail: "extract_character_detail",
  character_relationships: "extract_character_relationships",
  story: "analyze_story_world",
  timeline: "analyze_timeline",
  style: "extract_style",
  ideas: "extract_ideas",
};

/**
 * Flatten transitive deps (topo order) for a target agent.
 * Does not include the target itself.
 */
export function listDependencyChain(
  targetRaw: string,
): AnalysisSubagentType[] {
  const target = resolveAnalysisAgentType(targetRaw) as AnalysisSubagentType;
  if (!(ANALYSIS_SUBAGENT_TYPES as readonly string[]).includes(target)) {
    return [];
  }
  const out: AnalysisSubagentType[] = [];
  const seen = new Set<string>();
  const visit = (id: AnalysisSubagentType) => {
    for (const d of ANALYSIS_AGENT_DEPENDENCIES[id] || []) {
      visit(d);
    }
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  };
  for (const d of ANALYSIS_AGENT_DEPENDENCIES[target] || []) {
    visit(d);
  }
  return out;
}

/**
 * Domains whose deps are all ready and domain itself is not ready —
 * master should dispatch these in one turn (runtime parallelizes agent tools).
 */
export function listParallelReadyAgents(
  readyByAgent: Partial<Record<string, boolean>>,
): AnalysisSubagentType[] {
  const out: AnalysisSubagentType[] = [];
  for (const id of ANALYSIS_SUBAGENT_TYPES) {
    if (readyByAgent[id]) continue;
    const deps = ANALYSIS_AGENT_DEPENDENCIES[id] || [];
    if (deps.every((d) => readyByAgent[d])) {
      out.push(id);
    }
  }
  return out;
}

/**
 * Given readiness map (agent_type → ready), build launch plan for one target.
 */
export function buildLaunchPlan(
  targetRaw: string,
  readyByAgent: Partial<Record<string, boolean>>,
): {
  target: string;
  known: boolean;
  ready: boolean;
  missingDeps: string[];
  /** Agents to run in order (missing deps first, then target if not ready) */
  sequence: string[];
  note: string;
} {
  const target = resolveAnalysisAgentType(targetRaw);
  const known = (ANALYSIS_SUBAGENT_TYPES as readonly string[]).includes(target);
  if (!known) {
    return {
      target: targetRaw,
      known: false,
      ready: false,
      missingDeps: [],
      sequence: [],
      note: `未知 agent_type: ${targetRaw}。合法：${ANALYSIS_SUBAGENT_TYPES.join(", ")}`,
    };
  }
  const chain = listDependencyChain(target);
  const missingDeps = chain.filter((id) => !readyByAgent[id]);
  const targetReady = !!readyByAgent[target];
  const sequence = [
    ...missingDeps,
    ...(targetReady ? [] : [target]),
  ];
  return {
    target,
    known: true,
    ready: targetReady && missingDeps.length === 0,
    missingDeps,
    sequence,
    note:
      sequence.length === 0
        ? `${target} 及其依赖均已就绪，无需再派（除非用户要求强制重跑）`
        : missingDeps.length
          ? `先派依赖 ${missingDeps.join(" → ")}，再派 ${target}`
          : `依赖已齐，直接派 ${target}`,
  };
}

/** Old noun-style / wrapper / truncated names → canonical verb-object agent_type */
export const ANALYSIS_AGENT_ALIASES: Record<string, AnalysisSubagentType> = {
  form_analysis: "analyze_form",
  run_form_analysis: "analyze_form",
  analyze_form_analysis: "analyze_form",
  form: "analyze_form",
  // story world — models often drop "_world"
  story_world: "analyze_story_world",
  analyze_story: "analyze_story_world",
  analyze_storyworld: "analyze_story_world",
  story: "analyze_story_world",
  story_info: "analyze_story_world",
  analyze_story_info: "analyze_story_world",
  // character list — canonical analyze_character_list; legacy names map here
  resolve_character_roster: "analyze_character_list",
  character_roster: "analyze_character_list",
  character_entity_resolve: "analyze_character_list",
  analyze_character: "analyze_character_list",
  analyze_characters: "analyze_character_list",
  character_list: "analyze_character_list",
  run_character_roster_agent: "analyze_character_list",
  character_detail: "extract_character_detail",
  character_detail_agent: "extract_character_detail",
  extract_character: "extract_character_detail",
  extract_characters: "extract_character_detail",
  character_relationships: "extract_character_relationships",
  extract_relationships: "extract_character_relationships",
  analyze_relationships: "extract_character_relationships",
  relationships: "extract_character_relationships",
  timeline_analysis: "analyze_timeline",
  timeline: "analyze_timeline",
  extract_timeline: "analyze_timeline",
  style_extract: "extract_style",
  style_extract_agent: "extract_style",
  analyze_style: "extract_style",
  style: "extract_style",
  idea_extract: "extract_ideas",
  idea_extract_agent: "extract_ideas",
  analyze_ideas: "extract_ideas",
  ideas: "extract_ideas",
  run_story_world_agent: "analyze_story_world",
  run_character_detail_agent: "extract_character_detail",
  run_character_relationships_agent: "extract_character_relationships",
  run_timeline_analysis_agent: "analyze_timeline",
  run_style_extract_agent: "extract_style",
  run_idea_extract_agent: "extract_ideas",
};

/** @deprecated use ANALYSIS_AGENT_ALIASES */
export const ANALYSIS_RUN_AGENT_MAP = ANALYSIS_AGENT_ALIASES;

/**
 * Normalize tool JSON schema for OpenAI-compatible gateways (OpenCode Go).
 * Empty `properties` / invalid required lists often cause HTTP 400 upstream.
 */
export function normalizeToolParametersForOpenAI(parameters: Record<string, unknown> | undefined): {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties?: boolean;
} {
  const raw = parameters && typeof parameters === "object" ? parameters : {};
  let properties =
    raw.properties && typeof raw.properties === "object"
      ? { ...(raw.properties as Record<string, unknown>) }
      : {};

  // Ensure each property has type
  for (const [k, v] of Object.entries(properties)) {
    if (!v || typeof v !== "object") {
      properties[k] = { type: "string", description: String(k) };
      continue;
    }
    const p = v as Record<string, unknown>;
    if (!p.type) p.type = "string";
    if (p.type === "array" && !p.items) {
      p.items = { type: "string" };
    }
    properties[k] = p;
  }

  let required = Array.isArray(raw.required)
    ? (raw.required as unknown[]).map(String).filter((r) => r in properties)
    : [];

  // Some gateways reject completely empty object schemas
  if (Object.keys(properties).length === 0) {
    properties = {
      _unused: {
        type: "string",
        description: "Optional unused placeholder so the schema is non-empty",
      },
    };
    required = [];
  }

  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

export function toOpenAIFunctionTools(
  tools: { name: string; description?: string; parameters?: Record<string, unknown> }[],
): {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: ReturnType<typeof normalizeToolParametersForOpenAI>;
  };
}[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description || t.name,
      parameters: normalizeToolParametersForOpenAI(t.parameters),
    },
  }));
}

/**
 * Build master tool schemas for chat mode.
 * Critical: `agent` is not a data tool — enum is mode-scoped so the LLM
 * cannot call write_prose from analysis master (or vice versa).
 */
export function buildMasterAgentToolSchema(mode: "write" | "analysis"): {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
} {
  if (mode === "analysis") {
    const types = [...ANALYSIS_SUBAGENT_TYPES];
    return {
      name: "agent",
      description:
        "【调度子 Agent】派发分析域子 Agent。agent_type 为动宾名：" +
        types.join(" / ") +
        "。prompt 只写 novelId 与 branchId，不要写操作步骤。",
      parameters: {
        type: "object",
        properties: {
          agent_type: {
            type: "string",
            enum: types,
            description: "分析子 Agent：" + types.join(", "),
          },
          prompt: {
            type: "string",
            description:
              "只需 novelId 与 branchId（可选一句任务名）。不要写步骤；做法与存储在子 Agent system 中。",
          },
        },
        required: ["agent_type", "prompt"],
      },
    };
  }

  const types = [...WRITE_SUBAGENT_TYPES];
  return {
    name: "agent",
    description:
      "【调度子 Agent，不是查询工具】派发一个创作子 Agent。" +
      "子 Agent 自取上下文并 save_*，只回短 hint。" +
      "agent_type：" +
      types.join(" / ") +
      "。prompt 只写任务说明，禁止粘贴正文。",
    parameters: {
      type: "object",
      properties: {
        agent_type: {
          type: "string",
          enum: types,
          description: "创作子 Agent：" + types.join(", "),
        },
        prompt: {
          type: "string",
          description:
            "任务说明（用户要求、MODE 标记等）。不要粘贴正文全文；子 agent 会自己取上下文。",
        },
      },
      required: ["agent_type", "prompt"],
    },
  };
}

/**
 * Resolve legacy / truncated agent_type → canonical id.
 * Exact alias first; then unique prefix of a canonical id
 * (e.g. analyze_story → analyze_story_world when unambiguous).
 */
export function resolveAnalysisAgentType(raw: string): string {
  const t = String(raw || "").trim();
  if (!t) return t;
  if (ANALYSIS_AGENT_ALIASES[t]) return ANALYSIS_AGENT_ALIASES[t];
  if ((ANALYSIS_SUBAGENT_TYPES as readonly string[]).includes(t)) return t;

  const lower = t.toLowerCase();
  if (ANALYSIS_AGENT_ALIASES[lower]) return ANALYSIS_AGENT_ALIASES[lower];

  // Unique prefix of canonical id only (min length avoids "s" → style)
  if (t.length >= 8) {
    const hits = (ANALYSIS_SUBAGENT_TYPES as readonly string[]).filter(
      (id) => id.startsWith(t) || id.startsWith(lower),
    );
    if (hits.length === 1) return hits[0];
  }
  return t;
}
