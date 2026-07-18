import type { LLMProvider, LLMMessage, ToolSchema } from "@/types";
import type { StreamEvent } from "@/core/agents/types";
import { ClaudeProvider } from "./claude";
import { OpenAIProvider } from "./openai";

/** OpenAI-compatible chat completions base (…/v1). */
export const OPENCODE_GO_OPENAI_BASE_URL = "https://opencode.ai/zen/go/v1";

/**
 * Anthropic SDK baseURL root — SDK calls `${baseURL}/v1/messages`.
 * OpenCode Go MiniMax / Qwen models use this path.
 */
export const OPENCODE_GO_ANTHROPIC_BASE_URL = "https://opencode.ai/zen/go";

/**
 * Models that use Anthropic Messages API on OpenCode Go
 * (see https://opencode.ai/docs/zh-cn/go/ endpoints table).
 */
const ANTHROPIC_STYLE_PREFIXES = ["minimax-", "qwen3"] as const;

export function isOpencodeGoAnthropicModel(model: string): boolean {
  const id = model.trim().toLowerCase();
  return ANTHROPIC_STYLE_PREFIXES.some((p) => id.startsWith(p));
}

/**
 * OpenCode Go subscription gateway.
 *
 * Docs: https://opencode.ai/docs/zh-cn/go/
 *
 * - Most models → OpenAI-compatible `…/v1/chat/completions`
 *   (Grok, GLM, Kimi, DeepSeek, MiMo, …)
 * - MiniMax / Qwen3.x → Anthropic-compatible `…/v1/messages`
 *
 * API key from https://opencode.ai/auth (OpenCode Zen / Go).
 */
export class OpencodeGoProvider implements LLMProvider {
  private openai: OpenAIProvider;
  private anthropic: ClaudeProvider;
  private defaultModel: string;

  constructor(
    apiKey: string,
    defaultModel: string = "deepseek-v4-flash",
    /**
     * OpenAI-compatible base URL ending in `/v1`.
     * Anthropic root is derived by stripping trailing `/v1`.
     */
    openaiBaseURL: string = OPENCODE_GO_OPENAI_BASE_URL
  ) {
    const openaiBase = openaiBaseURL.replace(/\/+$/, "");
    const anthropicBase =
      openaiBase.replace(/\/v1$/i, "") || OPENCODE_GO_ANTHROPIC_BASE_URL;

    this.defaultModel = defaultModel;
    this.openai = new OpenAIProvider(apiKey, defaultModel, openaiBase);
    this.anthropic = new ClaudeProvider(apiKey, defaultModel, anthropicBase);
  }

  private backend(model?: string): LLMProvider {
    const m = model || this.defaultModel;
    return isOpencodeGoAnthropicModel(m) ? this.anthropic : this.openai;
  }

  chat(
    messages: LLMMessage[],
    options?: { model?: string; maxTokens?: number; temperature?: number }
  ): Promise<string> {
    return this.backend(options?.model).chat(messages, options);
  }

  chatWithTool<T>(
    messages: LLMMessage[],
    toolSchema: ToolSchema,
    options?: { model?: string; maxTokens?: number; temperature?: number }
  ): Promise<T> {
    return this.backend(options?.model).chatWithTool(
      messages,
      toolSchema,
      options
    );
  }

  chatStream(
    messages: LLMMessage[],
    onChunk: (text: string) => void,
    options?: { model?: string; maxTokens?: number; temperature?: number }
  ): Promise<string> {
    return this.backend(options?.model).chatStream(messages, onChunk, options);
  }

  chatWithTools(
    messages: LLMMessage[],
    tools: ToolSchema[],
    options?: { model?: string; maxTokens?: number; temperature?: number }
  ): AsyncGenerator<StreamEvent> {
    return this.backend(options?.model).chatWithTools(
      messages,
      tools,
      options
    );
  }
}
