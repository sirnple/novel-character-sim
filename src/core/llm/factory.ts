import type { LLMProvider, LLMUsageRole } from "@/types";
import { getAppConfig, llmConfigHint } from "@/lib/config";
import { ClaudeProvider } from "./claude";
import { OpenAIProvider } from "./openai";
import { OpencodeGoProvider } from "./opencode-go";

const cached = new Map<string, LLMProvider>();

function resolveModel(role: LLMUsageRole = "write"): string {
  const config = getAppConfig();
  const { provider, claude, openai, deepseek, opencodeGo } = config.llm;
  if (provider === "claude") return claude.model;
  if (provider === "openai") return openai.model;
  if (provider === "opencode-go") {
    if (role === "analysis") {
      return opencodeGo.analysisModel || deepseek.analysisModel || "deepseek-v4-flash";
    }
    return opencodeGo.writeModel || deepseek.writeModel || "deepseek-v4-pro";
  }
  // deepseek direct
  if (role === "analysis") {
    return deepseek.analysisModel || deepseek.model || "deepseek-v4-flash";
  }
  return deepseek.writeModel || deepseek.model || "deepseek-v4-pro";
}

function missingKeyError(provider: string): Error {
  return new Error(
    `LLM API key not configured for provider=${provider}. Set ${llmConfigHint(provider as any)} in .env.local (prefer LLM_API_KEY).`,
  );
}

/**
 * @param role - "analysis" for extract/form/timeline; "write" for 续写 agents (default)
 */
export function createLLMProvider(role: LLMUsageRole = "write"): LLMProvider {
  const config = getAppConfig();
  const { provider, claude, openai, deepseek, opencodeGo } = config.llm;
  const model = resolveModel(role);
  // Include key fingerprint length so rotating keys without restart still needs resetProvider;
  // cache key is provider+role+model only (key read each time from env via getAppConfig).
  const cacheKey = `${provider}:${role}:${model}`;

  const hit = cached.get(cacheKey);
  if (hit) return hit;

  let instance: LLMProvider;

  switch (provider) {
    case "claude":
      if (!claude.apiKey || claude.apiKey.includes("your-")) {
        throw missingKeyError(provider);
      }
      instance = new ClaudeProvider(claude.apiKey, model);
      break;

    case "openai":
      if (!openai.apiKey || openai.apiKey.includes("your-")) {
        throw missingKeyError(provider);
      }
      instance = new OpenAIProvider(openai.apiKey, model);
      break;

    case "deepseek":
      if (!deepseek.apiKey || deepseek.apiKey.includes("your-")) {
        throw missingKeyError(provider);
      }
      instance = new OpenAIProvider(deepseek.apiKey, model, deepseek.baseURL);
      break;

    case "opencode-go":
      if (!opencodeGo.apiKey || opencodeGo.apiKey.includes("your-")) {
        throw missingKeyError(provider);
      }
      instance = new OpencodeGoProvider(
        opencodeGo.apiKey,
        model,
        opencodeGo.baseURL,
      );
      break;

    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }

  const keySrc =
    provider === "opencode-go"
      ? `keyLen=${opencodeGo.apiKey.length}`
      : provider === "deepseek"
        ? `keyLen=${deepseek.apiKey.length}`
        : `keyLen=${(provider === "claude" ? claude.apiKey : openai.apiKey).length}`;
  console.log(
    `[LLM] provider=${provider} role=${role} model=${model} ${keySrc}`,
  );
  cached.set(cacheKey, instance);
  return instance;
}

/** Reset cached providers (e.g., when config changes) */
export function resetProvider(): void {
  cached.clear();
}
