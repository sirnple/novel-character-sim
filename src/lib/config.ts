import type { AppConfig, LLMProviderType } from "@/types";

/**
 * Read an env var at RUNTIME (not build-time).
 *
 * IMPORTANT: We use bracket notation `process.env[name]` instead of
 * `process.env.NAME` because Next.js webpack's DefinePlugin inlines
 * the latter at build time.  Bracket notation survives bundling so
 * Railway / Docker runtime variables are picked up correctly.
 */
function env(name: string, fallback: string = ""): string {
  return (process.env as Record<string, string | undefined>)[name] || fallback;
}

export function getAppConfig(): AppConfig {
  const provider = (env("LLM_PROVIDER", "claude")) as LLMProviderType;

  return {
    llm: {
      provider,
      claude: {
        apiKey: env("ANTHROPIC_API_KEY"),
        model: env("CLAUDE_MODEL", "claude-sonnet-4-6"),
      },
      openai: {
        apiKey: env("OPENAI_API_KEY"),
        model: env("OPENAI_MODEL", "gpt-4o"),
      },
      deepseek: {
        apiKey: env("DEEPSEEK_API_KEY"),
        model: env("DEEPSEEK_MODEL", "deepseek-chat"),
        baseURL: env("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
      },
      maxTokens: parseInt(env("LLM_MAX_TOKENS", "4096"), 10),
      temperature: parseFloat(env("LLM_TEMPERATURE", "0.7")),
    },
  };
}
