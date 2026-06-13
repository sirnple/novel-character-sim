import type { LLMProvider, LLMProviderType } from "@/types";

export interface ProviderConstructor {
  new (apiKey: string, defaultModel: string): LLMProvider;
}

export const PROVIDER_MODELS: Record<LLMProviderType, string> = {
  claude: "claude-sonnet-4-6",
  openai: "gpt-4o",
  deepseek: "deepseek-chat",
};
