/**
 * Default prompts — loaded from markdown files via agent-prompt-map.
 * Admin "reset" clears DB overrides so these md defaults apply again.
 */
import { getDefaultPromptFromMd, type DefaultPromptPair } from "./resolve-agent-prompt";

export type DefaultPrompt = DefaultPromptPair;

export function getDefaultPrompt(agentId: string, language: string): DefaultPrompt | null {
  return getDefaultPromptFromMd(agentId, language);
}
