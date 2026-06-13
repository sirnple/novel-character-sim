import type { AppConfig, LLMProviderType } from "@/types";

export function getAppConfig(): AppConfig {
  const provider = (process.env.LLM_PROVIDER || "claude") as LLMProviderType;

  return {
    llm: {
      provider,
      claude: {
        apiKey: process.env.ANTHROPIC_API_KEY || "",
        model: process.env.CLAUDE_MODEL || "claude-sonnet-4-6",
      },
      openai: {
        apiKey: process.env.OPENAI_API_KEY || "",
        model: process.env.OPENAI_MODEL || "gpt-4o",
      },
      deepseek: {
        apiKey: process.env.DEEPSEEK_API_KEY || "",
        model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
        baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
      },
      maxTokens: parseInt(process.env.LLM_MAX_TOKENS || "4096", 10),
      temperature: parseFloat(process.env.LLM_TEMPERATURE || "0.7"),
    },
  };
}
