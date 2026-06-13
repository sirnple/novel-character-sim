import OpenAI from "openai";
import type { LLMProvider, LLMMessage, ToolSchema } from "@/types";
import { extractJSON } from "@/lib/utils";

/**
 * OpenAI-compatible provider. Supports OpenAI, DeepSeek, and any other
 * OpenAI-compatible API by passing a custom baseURL.
 */
export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private defaultModel: string;

  constructor(
    apiKey: string,
    defaultModel: string = "gpt-4o",
    baseURL?: string
  ) {
    this.client = new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
      maxRetries: 3,
      timeout: 300000, // 5 minutes
    });
    this.defaultModel = defaultModel;
  }

  async chat(
    messages: LLMMessage[],
    options?: { model?: string; maxTokens?: number; temperature?: number }
  ): Promise<string> {
    const model = options?.model || this.defaultModel;
    const inputLen = messages.reduce((sum, m) => sum + m.content.length, 0);

    console.log(`[LLM:chat] model=${model} inputLen=${inputLen} starting...`);
    const t0 = Date.now();

    const response = await withRetry(
      () =>
        this.client.chat.completions.create({
          model,
          max_tokens: options?.maxTokens || 4096,
          temperature: options?.temperature ?? 0.7,
          messages: messages.map((m) => ({
            role: m.role as "system" | "user" | "assistant",
            content: m.content,
          })),
        }),
      `chat(model=${model})`
    );

    const elapsed = Date.now() - t0;
    const output = response.choices[0]?.message?.content || "";
    console.log(
      `[LLM:chat] model=${model} elapsed=${elapsed}ms outputLen=${output.length}`
    );

    return output;
  }

  async chatWithTool<T>(
    messages: LLMMessage[],
    toolSchema: ToolSchema,
    options?: { model?: string; maxTokens?: number; temperature?: number }
  ): Promise<T> {
    const model = options?.model || this.defaultModel;
    const inputLen = messages.reduce((sum, m) => sum + m.content.length, 0);

    console.log(
      `[LLM:chatWithTool] model=${model} tool=${toolSchema.name} inputLen=${inputLen} starting...`
    );
    const t0 = Date.now();

    const toolPrompt = [
      messages.map((m) => `${m.role}: ${m.content}`).join("\n\n"),
      "",
      "IMPORTANT: You must respond with a valid JSON object that matches this schema:",
      JSON.stringify(toolSchema.parameters, null, 2),
      "Respond ONLY with the JSON object, no other text.",
    ].join("\n");

    const response = await withRetry(
      () =>
        this.client.chat.completions.create({
          model,
          max_tokens: options?.maxTokens || 4096,
          temperature: options?.temperature ?? 0.3,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: toolPrompt }],
        }),
      `chatWithTool(tool=${toolSchema.name}, model=${model})`
    );

    const elapsed = Date.now() - t0;
    const rawText = response.choices[0]?.message?.content || "";
    console.log(
      `[LLM:chatWithTool] model=${model} tool=${toolSchema.name} elapsed=${elapsed}ms outputLen=${rawText.length}`
    );

    try {
      return extractJSON<T>(rawText);
    } catch (jsonError) {
      const msg = jsonError instanceof Error ? jsonError.message : String(jsonError);
      // If JSON is unbalanced (truncated response), treat as network error and retry
      if (msg.includes("Unbalanced JSON") || msg.includes("Failed to parse JSON")) {
        console.warn(`[LLM:chatWithTool] JSON parse failed, will retry: ${msg.substring(0, 100)}`);
        throw new Error(`JSON parse error (retryable): ${msg}`);
      }
      throw jsonError;
    }
  }
}

/**
 * Retry wrapper with exponential backoff, specialized for network errors.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries: number = 5
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const msg = lastError.message || "";

      // Retry on network errors AND truncated/parse failures
      const isNetworkError =
        msg.includes("Premature close") ||
        msg.includes("ECONNRESET") ||
        msg.includes("ETIMEDOUT") ||
        msg.includes("socket hang up") ||
        msg.includes("Connection error") ||
        msg.includes("fetch failed") ||
        msg.includes("network") ||
        msg.includes("JSON parse error (retryable)");

      if (!isNetworkError || attempt >= maxRetries) {
        throw lastError;
      }

      const delay = Math.min(2000 * Math.pow(2, attempt - 1), 15000);
      console.warn(
        `[LLM] ${label} attempt ${attempt}/${maxRetries} failed: ${msg.substring(0, 100)}. ` +
          `Retrying in ${delay}ms...`
      );
      await sleep(delay);
    }
  }

  throw lastError!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
