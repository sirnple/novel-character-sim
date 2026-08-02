/**
 * Registry of **Agents** (LLM tool-calling loops).
 * Key is always `agent.config.name` from system md frontmatter — no separate id.
 */
import type { Agent, AgentConfig } from "./types";
import { requireAgentConfigBySystem } from "./agent-config";
import { runWithTokenContext } from "@/lib/token-usage-context";

const agentMap = new Map<string, Agent>();

/**
 * Define a built-in Agent by its **system md file**.
 * `name` is read from that file's frontmatter — do not pass name as a second identity.
 *
 * @param systemFile e.g. `"outline-system.md"` (must be in AGENT_FILE_SPECS)
 * @param build Receives loaded config; use `config.name` / `config.tools` inside
 */
export function defineAgent(
  systemFile: string,
  build: (config: AgentConfig) => Agent["execute"],
): Agent {
  const config = requireAgentConfigBySystem(systemFile);
  return { config, execute: build(config) };
}

/**
 * Register one Agent. Key = `agent.config.name` only.
 */
export function registerAgent(agent: Agent): void {
  const name = agent.config?.name;
  if (!name) {
    throw new Error(
      "registerAgent: agent.config.name is required (from md frontmatter)",
    );
  }
  if (agentMap.has(name)) {
    throw new Error(`Agent "${name}" is already registered`);
  }

  const wrapped: Agent = {
    config: agent.config,
    execute: (ctx, llm, onChunk, onTrail) =>
      runWithTokenContext(
        {
          agentId: name, // token telemetry field; value is frontmatter name
          category: "agent",
          userId: ctx.userId,
          novelId: ctx.novelId,
          branchId: ctx.branchId,
        },
        () => agent.execute(ctx, llm, onChunk, onTrail),
      ),
  };
  agentMap.set(name, wrapped);
}

/** Lookup by exact frontmatter `name` only (no aliases). */
export function getAgent(type: string): Agent | undefined {
  return agentMap.get(String(type || "").trim());
}

export function getRegisteredAgentConfig(
  type: string,
): AgentConfig | undefined {
  return getAgent(type)?.config;
}

/** Registered frontmatter names. */
export function listAgentTypes(): string[] {
  return Array.from(agentMap.keys());
}
