/**
 * AgentConfig — identity of an **Agent** (LLM + tools loop).
 *
 * **name** comes only from system markdown frontmatter (`name:`).
 * There is no separate agent id — name is the identity.
 *
 * Code binds implementations to **system md paths** (not name strings).
 * Lookup by name is for dispatch (`agent(agent_type=name)`) and soft aliases.
 *
 * Industry: Agent = model-driven tool loop; Workflow = predetermined path.
 */
import type { AgentFrontmatter } from "@/core/prompts/frontmatter";
import { loadPromptFrontmatter } from "@/core/prompts/renderer";

export type AgentCategory =
  | "master"
  | "extraction"
  | "simulation"
  | "writing"
  | "review";

/** Files for one agent (paths only — identity is frontmatter.name). */
export interface AgentFiles {
  system: string;
  systemExtra?: string;
  user?: string;
}

/** Code-side packaging next to a system md (not the agent name). */
export interface AgentFileSpec extends AgentFiles {
  category: AgentCategory;
  /** Template vars for Admin / resolveAgentPrompt */
  variables?: string[];
  /**
   * No multi-turn LLM (e.g. job launcher still exposed via agent() tool).
   * System md may be empty-bodied; frontmatter still supplies name.
   */
  jobOnly?: boolean;
}

export interface AgentConfig {
  /** From frontmatter `name:` — the only identity of a built-in agent */
  name: string;
  /** From frontmatter `description` (display / admin) */
  description: string;
  /** From frontmatter `tools` */
  tools: string[];
  category: AgentCategory;
  variables: string[];
  files: AgentFiles;
  jobOnly?: boolean;
}

/**
 * All agent system prompts to load. Order is stable for Admin lists.
 * **Do not key by agent name here** — name is read from each file's frontmatter.
 */
export const AGENT_FILE_SPECS: AgentFileSpec[] = [
  // masters — file paths are stable; identity is frontmatter `name:`
  {
    system: "master-system.md",
    category: "master",
    variables: ["novelId", "branchId"],
  },
  {
    system: "novel_analysis-system.md", // name: analyst
    category: "extraction",
    variables: [],
  },
  // analysis
  {
    system: "chapter_structure_indexer.md", // name: chapter_structure_indexer
    user: "chapter_structure_indexer-user.md",
    category: "extraction",
    variables: ["prompt", "novelId", "branchId"],
  },
  {
    system: "analyze_story_world-system.md", // name: story_world
    user: "analyze_story_world-user.md",
    category: "extraction",
    variables: ["prompt", "novelId", "branchId"],
  },
  {
    system: "analyze_character_list-system.md", // name: character_list
    user: "analyze_character_list-user.md",
    category: "extraction",
    variables: ["prompt", "novelId", "branchId", "surfaceCount", "unitCount"],
  },
  {
    system: "extract_character_detail-system.md", // name: character_detail
    user: "extract_character_detail-user.md",
    category: "extraction",
    variables: ["prompt", "novelId", "branchId"],
  },
  {
    system: "extract_character_relationships-system.md", // name: character_relationships
    user: "extract_character_relationships-user.md",
    category: "extraction",
    variables: ["prompt", "novelId", "branchId"],
  },
  {
    system: "extract_style-system.md", // name: style
    user: "extract_style-user.md",
    category: "extraction",
    variables: ["prompt", "novelId", "branchId"],
  },
  {
    system: "extract_ideas-system.md", // name: ideas
    user: "extract_ideas-user.md",
    category: "extraction",
    variables: ["prompt", "novelId", "branchId"],
  },
  {
    system: "analyze_timeline-system.md", // name: timeline
    category: "extraction",
    variables: ["prompt", "novelId", "branchId"],
    jobOnly: true,
  },
  // write
  {
    system: "outline_creator.md", // name: outline_creator
    category: "simulation",
    variables: ["prompt", "novelId", "branchId"],
  },
  {
    system: "outline_rewriter.md", // name: outline_rewriter
    category: "simulation",
    variables: ["prompt", "novelId", "branchId"],
  },
  {
    system: "writer_create-system.md", // name: writer
    user: "writer_create-user.md",
    category: "writing",
    variables: ["prompt", "novelId", "branchId"],
  },
  {
    system: "writer_rewrite-system.md", // name: rewriter
    user: "writer_rewrite-user.md",
    category: "writing",
    variables: ["prompt", "novelId", "branchId"],
  },
  {
    system: "chapter_title_generator.md", // name: chapter_title_generator
    category: "writing",
    variables: ["prompt", "novelId", "branchId"],
  },
  // review
  {
    system: "outline_review-system.md", // name: outline_reviewer
    user: "review-user.md",
    category: "review",
    variables: ["prompt", "novelId", "branchId"],
  },
  {
    system: "character_consistency_review-system.md", // name: character_reviewer
    user: "review-user.md",
    category: "review",
    variables: ["prompt", "novelId", "branchId", "dimensionName", "dimensionCode"],
  },
  {
    system: "continuity_review-system.md", // name: continuity_reviewer
    user: "review-user.md",
    category: "review",
    variables: ["prompt", "novelId", "branchId", "dimensionName", "dimensionCode"],
  },
  {
    system: "foreshadowing_review-system.md", // name: foreshadow_reviewer
    user: "review-user.md",
    category: "review",
    variables: ["prompt", "novelId", "branchId", "dimensionName", "dimensionCode"],
  },
  {
    system: "style_review-system.md", // name: style_reviewer
    user: "review-user.md",
    category: "review",
    variables: ["prompt", "novelId", "branchId", "dimensionName", "dimensionCode"],
  },
  {
    system: "world_review-system.md", // name: world_reviewer
    user: "review-user.md",
    category: "review",
    variables: ["prompt", "novelId", "branchId", "dimensionName", "dimensionCode"],
  },
  {
    system: "pacing_review-system.md", // name: pacing_reviewer
    user: "review-user.md",
    category: "review",
    variables: ["prompt", "novelId", "branchId", "dimensionName", "dimensionCode"],
  },
  {
    system: "ai_review-system.md", // name: ai_reviewer
    user: "review-user.md",
    category: "review",
    variables: ["prompt", "novelId", "branchId", "dimensionName", "dimensionCode"],
  },
];

/** @deprecated use AGENT_FILE_SPECS + loadAgentConfig; kept for path lookups */
export const AGENT_FILES: Record<string, AgentFiles> = {};

let indexByName: Map<string, AgentConfig> | null = null;
let filesByName: Map<string, AgentFiles> | null = null;
/** system md filename → config (for defineAgent / makeLoopAgent) */
let indexBySystemFile: Map<string, AgentConfig> | null = null;

function toolsFromFrontmatter(fm: AgentFrontmatter): string[] {
  if (!Array.isArray(fm.tools)) return [];
  return fm.tools.map((t) => String(t).trim()).filter(Boolean);
}

function buildIndex(): Map<string, AgentConfig> {
  if (indexByName) return indexByName;

  const map = new Map<string, AgentConfig>();
  const filesMap = new Map<string, AgentFiles>();
  const bySystem = new Map<string, AgentConfig>();

  for (const spec of AGENT_FILE_SPECS) {
    const fm = loadPromptFrontmatter(spec.system);
    const name = String(fm.name ?? "").trim();
    if (!name) {
      throw new Error(
        `Agent system md missing frontmatter name: ${spec.system}`,
      );
    }
    if (map.has(name)) {
      throw new Error(
        `Duplicate agent frontmatter name "${name}" (file ${spec.system})`,
      );
    }

    const files: AgentFiles = {
      system: spec.system,
      systemExtra: spec.systemExtra,
      user: spec.user,
    };
    filesMap.set(name, files);

    const config: AgentConfig = {
      name, // only from frontmatter
      description: String(fm.description ?? name),
      tools: toolsFromFrontmatter(fm),
      category: spec.category,
      variables: spec.variables ? [...spec.variables] : [],
      files,
      jobOnly: spec.jobOnly === true,
    };
    map.set(name, config);
    bySystem.set(spec.system, config);
  }

  indexByName = map;
  filesByName = filesMap;
  indexBySystemFile = bySystem;

  // Populate legacy AGENT_FILES map for prompt path helpers
  for (const [n, f] of filesMap) {
    AGENT_FILES[n] = f;
  }

  return map;
}

/** Canonical frontmatter names currently loaded. */
export function listAgentNames(): string[] {
  return [...buildIndex().keys()];
}

/** @deprecated use listAgentNames */
export const ALL_AGENT_NAMES: string[] = []; // filled lazily via listAgentNames

/**
 * Normalize agent name for lookup — trim only.
 * No soft aliases: must equal frontmatter `name:` exactly.
 */
export function resolveAgentName(raw: string): string {
  return String(raw || "").trim();
}

/** @deprecated use resolveAgentName */
export const resolveAgentConfigId = resolveAgentName;

/**
 * Load config by frontmatter `name` (exact).
 * Prefer {@link loadAgentConfigBySystem} when defining a built-in agent.
 */
export function loadAgentConfig(name: string): AgentConfig | null {
  const index = buildIndex();
  return index.get(resolveAgentName(name)) || null;
}

/**
 * Load config by system md filename (e.g. `outline-system.md`).
 * This is how code binds an implementation — name is read from that file.
 */
export function loadAgentConfigBySystem(systemFile: string): AgentConfig | null {
  buildIndex();
  const key = String(systemFile || "").trim();
  return indexBySystemFile?.get(key) || null;
}

export function requireAgentConfigBySystem(systemFile: string): AgentConfig {
  const c = loadAgentConfigBySystem(systemFile);
  if (!c) {
    throw new Error(
      `requireAgentConfigBySystem: no AgentConfig for system md "${systemFile}" ` +
        `(add it to AGENT_FILE_SPECS and set frontmatter name:)`,
    );
  }
  return c;
}

export function listAgentConfigs(): AgentConfig[] {
  return [...buildIndex().values()];
}

/** Require config by frontmatter name (exact). */
export function requireAgentConfig(name: string): AgentConfig {
  const c = loadAgentConfig(name);
  if (!c) {
    throw new Error(
      `requireAgentConfig: no config for name="${name}" (check system md frontmatter name:)`,
    );
  }
  return c;
}

/** Frontmatter name for a system md file. */
export function agentNameFromSystem(systemFile: string): string {
  return requireAgentConfigBySystem(systemFile).name;
}

/** @deprecated use agentNameFromSystem or loadAgentConfig */
export function agentName(name: string): string {
  return requireAgentConfig(name).name;
}

export function listAgentConfigsByCategory(
  ...categories: AgentCategory[]
): AgentConfig[] {
  const set = new Set(categories);
  return listAgentConfigs().filter((c) => set.has(c.category));
}

/**
 * Write master can dispatch these (simulation + writing + review).
 * Names come from frontmatter via AGENT_FILE_SPECS — not a hand-maintained string table.
 */
export function listWriteSubagentNames(): string[] {
  return listAgentConfigsByCategory("simulation", "writing", "review").map(
    (c) => c.name,
  );
}

/**
 * Analysis master can dispatch these (extraction, excluding analyst master).
 */
export function listAnalysisSubagentNames(): string[] {
  return listAgentConfigsByCategory("extraction")
    .filter((c) => c.name !== "analyst")
    .map((c) => c.name);
}

/** Prose review agents (category review, excluding outline_reviewer). */
export function listProseReviewAgentNames(): string[] {
  return listAgentConfigsByCategory("review")
    .filter((c) => c.name !== "outline_reviewer")
    .map((c) => c.name);
}

export function getAgentConfig(name: string): AgentConfig | null {
  try {
    return loadAgentConfig(name);
  } catch (e) {
    console.warn(`[agent-config] ${(e as Error).message}`);
    return null;
  }
}

/** Files for an agent by frontmatter name. */
export function getAgentFiles(name: string): AgentFiles | undefined {
  buildIndex();
  return filesByName?.get(resolveAgentName(name));
}

/** Admin / registry list shape — display `name` is frontmatter name (not description). */
export function agentConfigToPromptMeta(c: AgentConfig) {
  return {
    agentId: c.name,
    /** frontmatter `name:` — primary label in UI */
    name: c.name,
    description: c.description,
    category: c.category,
    variables: c.variables,
    bilingual: false as const,
  };
}

/** Test helper: drop cached index after md edits. */
export function clearAgentConfigCache(): void {
  indexByName = null;
  filesByName = null;
  indexBySystemFile = null;
  for (const k of Object.keys(AGENT_FILES)) delete AGENT_FILES[k];
}
