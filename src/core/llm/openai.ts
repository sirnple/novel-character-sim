import OpenAI from "openai";
import type { LLMProvider, LLMMessage, ToolSchema } from "@/types";
import type { StreamEvent } from "@/core/agents/types";
import { extractJSON } from "@/lib/utils";
import { logSession } from "@/lib/session-log";

function len(m: LLMMessage): number {
  const c = m.content;
  if (typeof c === "string") return c.length;
  if (Array.isArray(c)) return JSON.stringify(c).length;
  return 0;
}

function toOpenAIMessages(messages: LLMMessage[]): any[] {
  return messages.map(m => ({
    role: m.role as "system" | "user" | "assistant" | "tool",
    content: typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content : "",
    ...(m.role === "tool" && "tool_call_id" in m ? { tool_call_id: (m as any).tool_call_id } : {}),
  }));
}

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
    const inputLen = messages.reduce((sum, m) => sum + len(m), 0);

    console.log(`[LLM:chat] model=${model} inputLen=${inputLen} starting...`);
    const t0 = Date.now();

    const response: any = await withRetry(
      () =>
        this.client.chat.completions.create({
          model,
          max_tokens: options?.maxTokens || 4096,
          temperature: options?.temperature ?? 0.7,
          messages: toOpenAIMessages(messages),
        } as any),
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
    const inputLen = messages.reduce((sum, m) => sum + len(m), 0);

    console.log(
      `[LLM:chatWithTool] model=${model} tool=${toolSchema.name} inputLen=${inputLen} starting...`
    );
    const t0 = Date.now();

    const toolPrompt = [
      messages.map((m) => `${m.role}: ${(m.content ?? "")}`).join("\n\n"),
      "",
      "IMPORTANT: You must respond with a valid JSON object that matches this schema:",
      JSON.stringify(toolSchema.parameters, null, 2),
      "Respond ONLY with the JSON object, no other text.",
    ].join("\n");

    const response: any = await withRetry(
      () =>
        this.client.chat.completions.create({
          model,
          max_tokens: options?.maxTokens || 4096,
          temperature: options?.temperature ?? 0.3,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: toolPrompt }],
        } as any),
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
      if (msg.includes("Unbalanced JSON") || msg.includes("Failed to parse JSON")) {
        console.warn(`[LLM:chatWithTool] JSON parse failed, will retry: ${msg.substring(0, 100)}`);
        throw new Error(`JSON parse error (retryable): ${msg}`);
      }
      throw jsonError;
    }
  }

  async chatStream(
    messages: LLMMessage[],
    onChunk: (text: string) => void,
    options?: { model?: string; maxTokens?: number; temperature?: number }
  ): Promise<string> {
    const model = options?.model || this.defaultModel;
    const inputLen = messages.reduce((sum, m) => sum + len(m), 0);
    console.log(`[LLM:chatStream] model=${model} inputLen=${inputLen} starting...`);
    const t0 = Date.now();

    const response: any = await this.client.chat.completions.create({
      model,
      max_tokens: options?.maxTokens || 4096,
      temperature: options?.temperature ?? 0.7,
      stream: true,
      messages: toOpenAIMessages(messages),
    } as any);

    let fullText = "";
    for await (const chunk of response) {
      const delta = (chunk as any).choices[0]?.delta?.content;
      if (delta) {
        fullText += delta;
        onChunk(fullText);
      }
    }

    const elapsed = Date.now() - t0;
    console.log(
      `[LLM:chatStream] model=${model} elapsed=${elapsed}ms outputLen=${fullText.length}`
    );

    return fullText;
  }

  async *chatWithTools(
    messages: LLMMessage[],
    tools: ToolSchema[],
    options?: { model?: string; maxTokens?: number; temperature?: number }
  ): AsyncGenerator<StreamEvent> {
    const model = options?.model || this.defaultModel;
    const inputLen = messages.reduce((sum, m) => sum + len(m), 0);
    console.log(`[LLM:chatWithTools] model=${model} tools=${tools.map(t => t.name).join(",")} inputLen=${inputLen} starting...`);
    const t0 = Date.now();

    const openaiTools = tools.map(t => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: "object" as const,
          properties: t.parameters.properties || {},
          required: t.parameters.required || [],
        },
      },
    }));

    const convertedMessages = messages.map(m => convertAnthropicBlocksToOpenAI(m));
    let stream: any;
    try {
      stream = await this.client.chat.completions.create({
        model,
        max_tokens: options?.maxTokens || 4096,
        temperature: options?.temperature ?? 0.4,
        messages: convertedMessages,
        tools: openaiTools,
        stream: true,
      } as any);
    } catch (e) {
      logSession({
        ts: new Date().toISOString(),
        type: "chat_with_tools_error",
        error: (e as Error).message,
        model,
        messages: convertedMessages.map((m: any) => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content.slice(0, 500) : JSON.stringify(m.content).slice(0, 500),
          hasToolCalls: !!m.tool_calls,
          toolCallsCount: m.tool_calls?.length || 0,
          toolCallId: m.tool_call_id || null,
        })),
      });
      throw e;
    }

    let currentToolId = "";
    let currentToolName = "";
    let currentToolArgs = "";
    let outputLen = 0;

    for await (const chunk of stream) {
      const delta = (chunk as any).choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        outputLen += delta.content.length;
        yield { type: "text_delta", text: delta.content };
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.id) {
            if (currentToolId && currentToolId !== tc.id) {
              try {
                yield { type: "tool_use", id: currentToolId, name: currentToolName, args: JSON.parse(currentToolArgs) };
              } catch { /* skip incomplete */ }
            }
            if (tc.id !== currentToolId) {
              currentToolId = tc.id;
              currentToolName = tc.function?.name || "";
              currentToolArgs = "";
            }
          }
          if (tc.function?.arguments) {
            currentToolArgs += tc.function.arguments;
          }
        }
      }
    }

    if (currentToolId) {
      try {
        yield { type: "tool_use", id: currentToolId, name: currentToolName, args: JSON.parse(currentToolArgs) };
      } catch { /* skip */ }
    }

    const elapsed = Date.now() - t0;
    console.log(`[LLM:chatWithTools] model=${model} elapsed=${elapsed}ms outputLen=${outputLen}`);
    yield { type: "done" };
  }
}

function convertAnthropicBlocksToOpenAI(m: LLMMessage): any {
  const content = m.content;
  const role = m.role;

  // Tool message — preserve tool_call_id
  if (role === "tool") {
    return {
      role: "tool",
      tool_call_id: (m as any).tool_call_id,
      content: typeof content === "string" ? content : JSON.stringify(content ?? ""),
    };
  }

  // Assistant message with tool_calls — preserve
  if (role === "assistant" && (m as any).tool_calls && (m as any).tool_calls.length > 0) {
    return {
      role: "assistant",
      content: typeof content === "string" ? content : null,
      tool_calls: (m as any).tool_calls,
    };
  }

  // String content — pass through
  if (typeof content === "string") return { role, content };
  if (content === null) return { role, content: "" };

  // Array content (Anthropic blocks)
  const arr = content as any[];

  const toolUses = arr.filter((b: any) => b.type === "tool_use");
  if (toolUses.length > 0) {
    return {
      role: "assistant",
      content: null,
      tool_calls: toolUses.map((tu: any) => ({
        id: tu.id,
        type: "function",
        function: { name: tu.name, arguments: JSON.stringify(tu.input) },
      })),
    };
  }

  const toolResults = arr.filter((b: any) => b.type === "tool_result");
  if (toolResults.length > 0) {
    return {
      role: "tool",
      tool_call_id: toolResults[0].tool_use_id,
      content: typeof toolResults[0].content === "string" ? toolResults[0].content : JSON.stringify(toolResults[0].content),
    };
  }

  // Fallback: stringify text blocks
  return { role, content: arr.map((b: any) => b.text || JSON.stringify(b)).join("") };
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
