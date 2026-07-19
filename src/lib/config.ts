import type { AppConfig, LLMProviderType } from "@/types";
import { runtimeEnv } from "@/lib/runtime-env";

/** Runtime env (Railway/Docker). See runtime-env.ts. */
function env(name: string, fallback: string = ""): string {
  return runtimeEnv(name, fallback);
}

/**
 * First non-empty among names (canonical first, then legacy aliases).
 */
function envFirst(...names: string[]): string {
  for (const n of names) {
    const v = env(n);
    if (v) return v;
  }
  return "";
}

/**
 * App LLM config.
 *
 * Canonical env (preferred):
 * - LLM_PROVIDER: claude | openai | deepseek | opencode-go
 * - LLM_API_KEY: API key for the active provider
 * - LLM_ANALYSIS_MODEL / LLM_WRITE_MODEL: role models
 * - LLM_BASE_URL: optional OpenAI-compatible base (…/v1)
 * - LLM_MAX_TOKENS / LLM_TEMPERATURE
 *
 * Legacy aliases still work so old .env files keep running:
 * - OPENCODE_API_KEY, DEEPSEEK_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY
 * - DEEPSEEK_ANALYSIS_MODEL, DEEPSEEK_WRITE_MODEL, DEEPSEEK_MODEL, DEEPSEEK_BASE_URL
 * - OPENCODE_BASE_URL
 */
export function getAppConfig(): AppConfig {
  const provider = (env("LLM_PROVIDER", "claude")) as LLMProviderType;

  // Shared role models (canonical LLM_* with DEEPSEEK_* fallback)
  const analysisModel = envFirst(
    "LLM_ANALYSIS_MODEL",
    "DEEPSEEK_ANALYSIS_MODEL",
    "DEEPSEEK_MODEL",
  ) || "deepseek-v4-flash";
  const writeModel = envFirst(
    "LLM_WRITE_MODEL",
    "DEEPSEEK_WRITE_MODEL",
    "DEEPSEEK_MODEL",
  ) || "deepseek-v4-pro";
  const defaultModel = envFirst("LLM_MODEL", "DEEPSEEK_MODEL") || analysisModel;

  // Active provider API key: LLM_API_KEY first, then provider-specific
  const llmApiKey = env("LLM_API_KEY");
  const openCodeKey = envFirst("LLM_API_KEY", "OPENCODE_API_KEY");
  const deepseekKey = envFirst("LLM_API_KEY", "DEEPSEEK_API_KEY");
  const claudeKey = envFirst("LLM_API_KEY", "ANTHROPIC_API_KEY");
  const openaiKey = envFirst("LLM_API_KEY", "OPENAI_API_KEY");

  const openCodeBase = envFirst(
    "LLM_BASE_URL",
    "OPENCODE_BASE_URL",
  ) || "https://opencode.ai/zen/go/v1";

  const deepseekBase = envFirst(
    "LLM_BASE_URL",
    "DEEPSEEK_BASE_URL",
  ) || "https://api.deepseek.com/v1";

  return {
    llm: {
      provider,
      claude: {
        apiKey: claudeKey,
        model: env("CLAUDE_MODEL", "claude-sonnet-4-6"),
      },
      openai: {
        apiKey: openaiKey,
        model: env("OPENAI_MODEL", "gpt-4o"),
      },
      deepseek: {
        apiKey: deepseekKey,
        model: defaultModel,
        analysisModel,
        writeModel,
        baseURL: deepseekBase,
      },
      opencodeGo: {
        apiKey: openCodeKey || deepseekKey,
        baseURL: openCodeBase,
        analysisModel,
        writeModel,
      },
      maxTokens: parseInt(env("LLM_MAX_TOKENS", "4096"), 10),
      temperature: parseFloat(env("LLM_TEMPERATURE", "0.7")),
    },
  };
}

/** Which env names to set for the active provider (docs / errors). */
export function llmConfigHint(provider: LLMProviderType): string {
  switch (provider) {
    case "opencode-go":
      return "LLM_API_KEY (or OPENCODE_API_KEY), LLM_ANALYSIS_MODEL, LLM_WRITE_MODEL";
    case "deepseek":
      return "LLM_API_KEY (or DEEPSEEK_API_KEY), LLM_ANALYSIS_MODEL, LLM_WRITE_MODEL, optional LLM_BASE_URL";
    case "openai":
      return "LLM_API_KEY (or OPENAI_API_KEY), OPENAI_MODEL";
    case "claude":
      return "LLM_API_KEY (or ANTHROPIC_API_KEY), CLAUDE_MODEL";
    default:
      return "LLM_PROVIDER, LLM_API_KEY";
  }
}
