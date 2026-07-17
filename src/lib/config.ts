import type { AppConfig, LLMProviderType } from "@/types";
import { runtimeEnv } from "@/lib/runtime-env";

/** Runtime env (Railway/Docker). See runtime-env.ts. */
function env(name: string, fallback: string = ""): string {
  return runtimeEnv(name, fallback);
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
        // Fallback if role-specific model unset
        model: env("DEEPSEEK_MODEL", "deepseek-v4-flash"),
        // 分析：提取故事/角色/目录/时间线/书名等
        analysisModel: env(
          "DEEPSEEK_ANALYSIS_MODEL",
          env("DEEPSEEK_MODEL", "deepseek-v4-flash"),
        ),
        // 续写：写作 agent / 模拟 / 审查
        writeModel: env(
          "DEEPSEEK_WRITE_MODEL",
          env("DEEPSEEK_MODEL", "deepseek-v4-pro"),
        ),
        baseURL: env("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
      },
      maxTokens: parseInt(env("LLM_MAX_TOKENS", "4096"), 10),
      temperature: parseFloat(env("LLM_TEMPERATURE", "0.7")),
    },
  };
}
