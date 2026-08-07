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
import {
  agentNameFromSystem,
  listAnalysisSubagentNames,
  listWriteSubagentNames,
} from "./agent-config";

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

/**
 * Write-mode sub-agents — names from system md frontmatter (via AGENT_FILE_SPECS).
 * Not a hand-maintained string table.
 */
export const WRITE_SUBAGENT_TYPES: readonly string[] = listWriteSubagentNames();

/**
 * Analysis sub-agents via agent(agent_type=...).
 * Names from frontmatter (extraction category, excluding analyst master).
 */
export const ANALYSIS_SUBAGENT_TYPES: readonly string[] =
  listAnalysisSubagentNames();

export type AnalysisSubagentType = string;

/**
 * Status domain key → agent frontmatter name.
 * Names loaded from system md (not hardcoded name strings).
 */
export const ANALYSIS_DOMAIN_TO_AGENT: Record<string, string> = {
  form: agentNameFromSystem("chapter_structure_indexer.md"),
  character_list: agentNameFromSystem("analyze_character_list-system.md"),
  character_detail: agentNameFromSystem("extract_character_detail-system.md"),
  character_relationships: agentNameFromSystem(
    "extract_character_relationships-system.md",
  ),
  story: agentNameFromSystem("analyze_story_world-system.md"),
  timeline: agentNameFromSystem("analyze_timeline-system.md"),
  style: agentNameFromSystem("extract_style-system.md"),
  ideas: agentNameFromSystem("extract_ideas-system.md"),
};

/** Domain readiness graph (status keys, not agent names). */
const DOMAIN_DEPENDENCIES: Record<string, readonly string[]> = {
  form: [],
  character_list: ["form"],
  character_detail: ["character_list"],
  character_relationships: ["character_list", "character_detail"],
  story: ["form"],
  timeline: ["form"],
  style: ["form"],
  ideas: ["form"],
};

/**
 * Direct dependencies by agent_type (frontmatter name).
 * Built from domain graph + ANALYSIS_DOMAIN_TO_AGENT.
 */
export const ANALYSIS_AGENT_DEPENDENCIES: Record<string, readonly string[]> =
  Object.fromEntries(
    Object.entries(DOMAIN_DEPENDENCIES).map(([domain, depDomains]) => {
      const agent = ANALYSIS_DOMAIN_TO_AGENT[domain];
      const deps = depDomains
        .map((d) => ANALYSIS_DOMAIN_TO_AGENT[d])
        .filter(Boolean);
      return [agent, deps];
    }),
  );

/**
 * Status domain keys that do **not** block writing or analysis wrap-up/save.
 * Timeline runs as an async background job; partial/missing timeline is OK for 写作.
 */
export const ANALYSIS_OPTIONAL_DOMAINS = ["timeline"] as const;
export type AnalysisOptionalDomain = (typeof ANALYSIS_OPTIONAL_DOMAINS)[number];

/**
 * Minimum domains for 写作 gate (matches write page + overview canContinue):
 * 目录/章法 · 故事 · 角色名单. Detail/rels/style/ideas/timeline are not required.
 */
export const ANALYSIS_WRITE_REQUIRED_DOMAINS = [
  "form",
  "story",
  "character_list",
] as const;
export type AnalysisWriteRequiredDomain =
  (typeof ANALYSIS_WRITE_REQUIRED_DOMAINS)[number];

export function isOptionalAnalysisDomain(domain: string): boolean {
  return (ANALYSIS_OPTIONAL_DOMAINS as readonly string[]).includes(domain);
}

/** Split status domain keys into required vs optional pending for wrap-up. */
export function partitionAnalysisPending(pending: string[]): {
  pendingRequired: string[];
  pendingOptional: string[];
} {
  const pendingRequired: string[] = [];
  const pendingOptional: string[] = [];
  for (const d of pending) {
    if (isOptionalAnalysisDomain(d)) pendingOptional.push(d);
    else pendingRequired.push(d);
  }
  return { pendingRequired, pendingOptional };
}

export function isWriteReadyFromDomainMap(
  ready: Partial<Record<string, boolean>>,
): boolean {
  return ANALYSIS_WRITE_REQUIRED_DOMAINS.every((d) => !!ready[d]);
}

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
 * Normalize agent_type from the model — trim only.
 * Must equal a registered frontmatter `name` exactly (no soft aliases / prefix guess).
 */
export function resolveAnalysisAgentType(raw: string): string {
  return String(raw || "").trim();
}
