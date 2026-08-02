/**
 * Agent prompt files — resolved via AgentConfig (name from frontmatter).
 */
import {
  getAgentFiles,
  loadAgentConfig,
  listAgentConfigs,
  type AgentFiles,
} from "@/core/agents/agent-config";

export type AgentPromptFiles = AgentFiles;

/** Snapshot of files by frontmatter name (built on first access). */
export function getAgentPromptFilesMap(): Record<string, AgentPromptFiles> {
  const out: Record<string, AgentPromptFiles> = {};
  for (const c of listAgentConfigs()) {
    if (c.files) out[c.name] = c.files;
  }
  return out;
}

/** @deprecated use getAgentPromptFiles / listAgentConfigs */
export const AGENT_PROMPT_FILES: Record<string, AgentPromptFiles> =
  new Proxy({} as Record<string, AgentPromptFiles>, {
    get(_t, prop: string | symbol) {
      if (typeof prop !== "string") return undefined;
      return getAgentFiles(prop);
    },
    ownKeys() {
      return listAgentConfigs().map((c) => c.name);
    },
    getOwnPropertyDescriptor(_t, prop: string | symbol) {
      if (typeof prop !== "string") return undefined;
      const f = getAgentFiles(prop);
      if (!f) return undefined;
      return { configurable: true, enumerable: true, value: f };
    },
  });

/** Identity is frontmatter name — no alias rewrite. */
export function resolvePromptAgentId(agentId: string): string {
  return String(agentId || "").trim();
}

export function getAgentPromptFiles(
  agentId: string,
): AgentPromptFiles | undefined {
  return getAgentFiles(agentId);
}

export function requireAgentConfig(agentId: string) {
  const c = loadAgentConfig(agentId);
  if (!c) throw new Error(`Unknown agent: ${agentId}`);
  return c;
}
