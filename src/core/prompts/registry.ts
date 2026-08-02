// ============================================================
// Prompt Registry — Admin list from AgentConfig
// ============================================================

import {
  agentConfigToPromptMeta,
  listAgentConfigs,
  loadAgentConfig,
  type AgentCategory,
} from "@/core/agents/agent-config";

export interface AgentPromptMeta {
  agentId: string;
  name: string;
  description: string;
  category: AgentCategory;
  variables: string[];
  bilingual: boolean;
}

/** Derived from AgentConfig (name/description from frontmatter). */
export function getAgentRegistry(): AgentPromptMeta[] {
  return listAgentConfigs().map(agentConfigToPromptMeta);
}

/**
 * Lazy registry list. Prefer getAgentRegistry() so frontmatter reloads after cache clear.
 * Eager snapshot for modules that import AGENT_REGISTRY at load time.
 */
export const AGENT_REGISTRY: AgentPromptMeta[] = getAgentRegistry();

export function getAgentMeta(agentId: string): AgentPromptMeta | undefined {
  const c = loadAgentConfig(agentId);
  return c ? agentConfigToPromptMeta(c) : undefined;
}

export function getAgentsByCategory(): Record<string, AgentPromptMeta[]> {
  const groups: Record<string, AgentPromptMeta[]> = {
    master: [],
    extraction: [],
    simulation: [],
    writing: [],
    review: [],
  };
  for (const agent of getAgentRegistry()) {
    if (groups[agent.category]) {
      groups[agent.category].push(agent);
    }
  }
  return groups;
}
