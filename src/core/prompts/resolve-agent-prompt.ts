/**
 * Resolve agent prompts: Admin DB override → markdown defaults.
 * All runtime agents should call this (or getDefaultPrompt) instead of hardcoding.
 */
import { getAgentPrompt } from "@/lib/db";
import { getAgentPromptFiles } from "./agent-prompt-map";
import { loadPromptFile, renderTemplate } from "./renderer";

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

/** Defaults purely from markdown files (no DB). */
export function getDefaultPromptFromMd(
  agentId: string,
  language: string = "zh",
): DefaultPromptPair | null {
  const files = getAgentPromptFiles(agentId);
  if (!files) return null;

  const useEn = language === "en";
  try {
    const systemFile = useEn && files.systemEn ? files.systemEn : files.system;
    const extraFile = useEn
      ? files.systemExtraEn || files.systemExtra
      : files.systemExtra;
    const userFile = useEn && files.userEn ? files.userEn : files.user;

    const systemPrompt = joinParts(
      loadPromptFile(systemFile),
      extraFile ? loadPromptFile(extraFile) : undefined,
    );
    const userPromptTemplate = userFile ? loadPromptFile(userFile) : "";
    return { systemPrompt, userPromptTemplate };
  } catch (e) {
    console.warn(`[prompts] failed to load defaults for ${agentId}/${language}:`, (e as Error).message);
    return null;
  }
}

/**
 * Effective templates: non-null DB fields override md defaults.
 * (Admin reset sets DB fields to NULL → falls back to md.)
 */
export function getEffectivePromptTemplates(
  agentId: string,
  language: string = "zh",
): DefaultPromptPair {
  const defaults = getDefaultPromptFromMd(agentId, language) || {
    systemPrompt: "",
    userPromptTemplate: "",
  };
  const row = getAgentPrompt(agentId, language);
  return {
    systemPrompt:
      row?.system_prompt != null && row.system_prompt !== ""
        ? row.system_prompt
        : defaults.systemPrompt,
    userPromptTemplate:
      row?.user_prompt_template != null && row.user_prompt_template !== ""
        ? row.user_prompt_template
        : defaults.userPromptTemplate,
  };
}

/** Render system (+ optional user) for runtime LLM calls. */
export function resolveAgentPrompt(
  agentId: string,
  language: string,
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
  language: string,
  vars: Record<string, any> = {},
): string {
  return resolveAgentPrompt(agentId, language, vars).system;
}
