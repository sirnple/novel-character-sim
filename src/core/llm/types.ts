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

/** DeepSeek role defaults (overridden by env). */
export const DEEPSEEK_ROLE_MODELS = {
  analysis: "deepseek-v4-flash",
  write: "deepseek-v4-pro",
} as const;

/** OpenCode Go role defaults (overridden by env). Same IDs as Go catalog. */
export const OPENCODE_GO_ROLE_MODELS = {
  analysis: "deepseek-v4-flash",
  write: "deepseek-v4-pro",
} as const;
