import type { LLMProvider } from "@/types";
import { getAppConfig } from "@/lib/config";
import { ClaudeProvider } from "./claude";
import { OpenAIProvider } from "./openai";

let cachedProvider: LLMProvider | null = null;

export function createLLMProvider(): LLMProvider {
  // Return cached if available (avoid re-creating on every API call)
  if (cachedProvider) return cachedProvider;

  const config = getAppConfig();
  const { provider, claude, openai, deepseek } = config.llm;

  switch (provider) {
    case "claude":
      if (!claude.apiKey || claude.apiKey === "your-anthropic-api-key-here") {
        throw new Error(
          "ANTHROPIC_API_KEY not configured. Please set it in .env.local"
        );
      }
      cachedProvider = new ClaudeProvider(claude.apiKey, claude.model);
      return cachedProvider;

    case "openai":
      if (!openai.apiKey || openai.apiKey === "your-openai-api-key-here") {
        throw new Error(
          "OPENAI_API_KEY not configured. Please set it in .env.local"
        );
      }
      cachedProvider = new OpenAIProvider(openai.apiKey, openai.model);
      return cachedProvider;

    case "deepseek":
      if (!deepseek.apiKey || deepseek.apiKey === "your-deepseek-api-key-here") {
        throw new Error(
          "DEEPSEEK_API_KEY not configured. Please set it in .env.local"
        );
      }
      cachedProvider = new OpenAIProvider(
        deepseek.apiKey,
        deepseek.model,
        deepseek.baseURL
      );
      return cachedProvider;

    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}

/** Reset cached provider (e.g., when config changes) */
export function resetProvider(): void {
  cachedProvider = null;
}
