import type { LLMProvider, LLMUsageRole } from "@/types";
import { getAppConfig } from "@/lib/config";
import { ClaudeProvider } from "./claude";
import { OpenAIProvider } from "./openai";

const cached = new Map<string, LLMProvider>();

function resolveModel(role: LLMUsageRole = "write"): string {
  const config = getAppConfig();
  const { provider, claude, openai, deepseek } = config.llm;
  if (provider === "claude") return claude.model;
  if (provider === "openai") return openai.model;
  // deepseek: role-specific models
  if (role === "analysis") {
    return deepseek.analysisModel || deepseek.model || "deepseek-v4-flash";
  }
  return deepseek.writeModel || deepseek.model || "deepseek-v4-pro";
}

/**
 * @param role - "analysis" for extract/form/timeline; "write" for 续写 agents (default)
 */
export function createLLMProvider(role: LLMUsageRole = "write"): LLMProvider {
  const config = getAppConfig();
  const { provider, claude, openai, deepseek } = config.llm;
  const model = resolveModel(role);
  const cacheKey = `${provider}:${role}:${model}`;

  const hit = cached.get(cacheKey);
  if (hit) return hit;

  let instance: LLMProvider;

  switch (provider) {
    case "claude":
      if (!claude.apiKey || claude.apiKey === "your-anthropic-api-key-here") {
        throw new Error(
          "ANTHROPIC_API_KEY not configured. Please set it in .env.local",
        );
      }
      instance = new ClaudeProvider(claude.apiKey, model);
      break;

    case "openai":
      if (!openai.apiKey || openai.apiKey === "your-openai-api-key-here") {
        throw new Error(
          "OPENAI_API_KEY not configured. Please set it in .env.local",
        );
      }
      instance = new OpenAIProvider(openai.apiKey, model);
      break;

    case "deepseek":
      if (!deepseek.apiKey || deepseek.apiKey === "your-deepseek-api-key-here") {
        throw new Error(
          "DEEPSEEK_API_KEY not configured. Please set it in .env.local",
        );
      }
      instance = new OpenAIProvider(deepseek.apiKey, model, deepseek.baseURL);
      break;

    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }

  console.log(`[LLM] provider=${provider} role=${role} model=${model}`);
  cached.set(cacheKey, instance);
  return instance;
}

/** Reset cached providers (e.g., when config changes) */
export function resetProvider(): void {
  cached.clear();
}
