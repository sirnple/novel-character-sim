import type { LLMProvider, LLMProviderType } from "@/types";

export interface ProviderConstructor {
  new (apiKey: string, defaultModel: string): LLMProvider;
}

export const PROVIDER_MODELS: Record<LLMProviderType, string> = {
  claude: "claude-sonnet-4-6",
  openai: "gpt-4o",
  deepseek: "deepseek-v4-flash",
  "opencode-go": "deepseek-v4-flash",
};

/** Default role model ids (overridden by LLM_ANALYSIS_MODEL / LLM_WRITE_MODEL). */
export const DEFAULT_ROLE_MODELS = {
  analysis: "deepseek-v4-flash",
  write: "deepseek-v4-pro",
} as const;

/** @deprecated use DEFAULT_ROLE_MODELS */
export const DEEPSEEK_ROLE_MODELS = DEFAULT_ROLE_MODELS;
/** @deprecated use DEFAULT_ROLE_MODELS */
export const OPENCODE_GO_ROLE_MODELS = DEFAULT_ROLE_MODELS;
