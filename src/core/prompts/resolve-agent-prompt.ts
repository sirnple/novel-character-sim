/**
 * Resolve agent prompts: Admin DB override → markdown defaults.
 * All runtime agents should call this (or getDefaultPrompt) instead of hardcoding.
 *
 * Markdown files keep standard frontmatter (name/description/tools).
 * - Admin defaults: full file text (frontmatter included).
 * - LLM runtime: frontmatter stripped, then {{vars}} rendered.
 */
import { getAgentPrompt } from "@/lib/db";
import { getAgentPromptFiles } from "./agent-prompt-map";
import { loadPromptFile, loadPromptRaw, renderTemplate } from "./renderer";
import { stripFrontmatter } from "./frontmatter";
export { getAgentAllowedTools, resolveAgentToolSchemas } from "./agent-tools";

export interface ResolvedPrompt {
  system: string;
  user: string;
}

export interface DefaultPromptPair {
  systemPrompt: string;
  userPromptTemplate: string;
}

function joinParts(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join("\n\n");
}

/**
 * Defaults purely from markdown files (no DB).
 * **Full file text including frontmatter** — for Admin display/edit.
 * LLM path must use {@link getEffectivePromptTemplates} / {@link resolveAgentPrompt}
 * which strip YAML before sending to the model.
 */
export function getDefaultPromptFromMd(
  agentId: string,
  _language: string = "zh",
): DefaultPromptPair | null {
  const files = getAgentPromptFiles(agentId);
  if (!files) return null;

  try {
    const systemPrompt = joinParts(
      loadPromptRaw(files.system),
      files.systemExtra ? loadPromptRaw(files.systemExtra) : undefined,
    );
    const userPromptTemplate = files.user ? loadPromptRaw(files.user) : "";
    return { systemPrompt, userPromptTemplate };
  } catch (e) {
    console.warn(
      `[prompts] failed to load defaults for ${agentId}:`,
      (e as Error).message,
    );
    return null;
  }
}

/**
 * Body-only defaults (frontmatter stripped). Used when composing LLM prompts.
 */
export function getDefaultPromptBodiesFromMd(
  agentId: string,
  _language: string = "zh",
): DefaultPromptPair | null {
  const files = getAgentPromptFiles(agentId);
  if (!files) return null;

  try {
    const systemPrompt = joinParts(
      loadPromptFile(files.system),
      files.systemExtra ? loadPromptFile(files.systemExtra) : undefined,
    );
    const userPromptTemplate = files.user ? loadPromptFile(files.user) : "";
    return { systemPrompt, userPromptTemplate };
  } catch (e) {
    console.warn(
      `[prompts] failed to load body defaults for ${agentId}:`,
      (e as Error).message,
    );
    return null;
  }
}

/**
 * Effective templates for LLM: non-null DB fields override md defaults.
 * Always strips leading frontmatter so YAML never reaches the model
 * (whether source is md file or Admin-saved full document).
 */
export function getEffectivePromptTemplates(
  agentId: string,
  _language: string = "zh",
): DefaultPromptPair {
  const defaults = getDefaultPromptBodiesFromMd(agentId) || {
    systemPrompt: "",
    userPromptTemplate: "",
  };
  const row = getAgentPrompt(agentId, "zh");
  const systemRaw =
    row?.system_prompt != null && row.system_prompt !== ""
      ? row.system_prompt
      : defaults.systemPrompt;
  const userRaw =
    row?.user_prompt_template != null && row.user_prompt_template !== ""
      ? row.user_prompt_template
      : defaults.userPromptTemplate;
  return {
    systemPrompt: stripFrontmatter(systemRaw),
    userPromptTemplate: stripFrontmatter(userRaw),
  };
}

/** Render system (+ optional user) for runtime LLM calls. */
export function resolveAgentPrompt(
  agentId: string,
  language: string = "zh",
  vars: Record<string, any> = {},
): ResolvedPrompt {
  const t = getEffectivePromptTemplates(agentId, language);
  return {
    system: renderTemplate(t.systemPrompt, vars),
    user: renderTemplate(t.userPromptTemplate, vars),
  };
}

/** Convenience: system only. */
export function resolveAgentSystem(
  agentId: string,
  language: string = "zh",
  vars: Record<string, any> = {},
): string {
  return resolveAgentPrompt(agentId, language, vars).system;
}
