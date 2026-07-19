/**
 * Resolve tool allowlists from agent markdown frontmatter.
 * Primary system file only (not systemExtra / user templates).
 */
import { getAgentPromptFiles } from "./agent-prompt-map";
import { loadPromptFrontmatter } from "./renderer";
import { getTool } from "@/core/agents/registry";

/**
 * Tool allowlist declared on the agent's primary system markdown.
 * Returns [] when file missing or tools not declared.
 */
export function getAgentAllowedTools(agentId: string, language: string = "zh"): string[] {
  const files = getAgentPromptFiles(agentId);
  if (!files) return [];

  const useEn = language === "en";
  const systemFile = useEn && files.systemEn ? files.systemEn : files.system;

  try {
    const fm = loadPromptFrontmatter(systemFile);
    const tools = fm.tools;
    if (!Array.isArray(tools)) return [];
    return tools.map((t) => String(t).trim()).filter(Boolean);
  } catch (e) {
    console.warn(
      `[prompts] failed to read tools for ${agentId}:`,
      (e as Error).message,
    );
    return [];
  }
}

/** Frontmatter name/description for admin or diagnostics. */
export function getAgentFrontmatterMeta(
  agentId: string,
  language: string = "zh",
): { name?: string; description?: string; tools: string[] } {
  const files = getAgentPromptFiles(agentId);
  if (!files) return { tools: [] };
  const useEn = language === "en";
  const systemFile = useEn && files.systemEn ? files.systemEn : files.system;
  try {
    const fm = loadPromptFrontmatter(systemFile);
    return {
      name: typeof fm.name === "string" ? fm.name : undefined,
      description: typeof fm.description === "string" ? fm.description : undefined,
      tools: Array.isArray(fm.tools)
        ? fm.tools.map((t) => String(t).trim()).filter(Boolean)
        : [],
    };
  } catch {
    return { tools: [] };
  }
}

export type ToolSchemaLite = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

/**
 * Build tool schemas from allowlist + global tool registry.
 * Requires initRegistry() first. Unknown names are skipped with a warning.
 */
export function buildSchemasFromAllowlist(allow: string[]): ToolSchemaLite[] {
  const out: ToolSchemaLite[] = [];
  for (const name of allow) {
    const def = getTool(name);
    if (!def) {
      console.warn(`[agent-tools] tool "${name}" not registered; skipped`);
      continue;
    }
    out.push({
      name: def.name,
      description: def.description,
      parameters: def.parameters as Record<string, unknown>,
    });
  }
  return out;
}

/** Convenience: allowlist from md frontmatter → schemas. */
export function resolveAgentToolSchemas(
  agentId: string,
  language: string = "zh",
): ToolSchemaLite[] {
  return buildSchemasFromAllowlist(getAgentAllowedTools(agentId, language));
}
