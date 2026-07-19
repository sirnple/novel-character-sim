import OpenAI from "openai";
import type { LLMProvider, LLMMessage, ToolSchema } from "@/types";
import type { StreamEvent } from "@/core/agents/types";
import { extractJSON } from "@/lib/utils";
import { logSession } from "@/lib/session-log";
import { recordTokenUsage, usageFromOpenAI } from "@/lib/token-meter";
import { toOpenAIFunctionTools } from "@/core/agents/analysis-allowlist";

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

/** Models that default to chain-of-thought (DeepSeek V4 etc.). */
function isReasoningModel(model: string): boolean {
  const m = (model || "").toLowerCase();
  return (
    m.includes("deepseek-v4") ||
    m.includes("deepseek-reasoner") ||
    m.includes("reasoner")
  );
}

/**
 * Prefer `content` (where JSON mode puts the payload).
 * Only fall back to reasoning_* if content is empty (misconfigured thinking).
 */
function assistantMessageText(
  message: any,
  opts?: { preferContentOnly?: boolean },
): string {
  if (!message) return "";
  const content = message.content;
  if (typeof content === "string" && content.trim()) return content;
  if (Array.isArray(content)) {
    const joined = content
      .map((p: any) =>
        typeof p === "string" ? p : p?.text || p?.content || "",
      )
      .join("");
    if (joined.trim()) return joined;
  }
  if (opts?.preferContentOnly) {
    return typeof content === "string" ? content : "";
  }
  for (const key of ["reasoning_content", "reasoning", "refusal"] as const) {
    const v = message[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  return typeof content === "string" ? content : "";
}

/**
 * Structured JSON extras for DeepSeek V4 / OpenCode Go.
 * Docs: https://api-docs.deepseek.com/guides/json_mode/
 *        https://api-docs.deepseek.com/guides/thinking_mode/
 *
 * Quality path: keep thinking **enabled** (better extract/merge) + high max_tokens
 * so final JSON still lands in `content`.
 * Reliability path: `thinking: disabled` when content is empty (budget eaten by CoT).
 */
function structuredOutputExtras(
  model: string,
  thinking: "enabled" | "disabled" | "default" = "default",
): Record<string, unknown> {
  const extras: Record<string, unknown> = {
    response_format: { type: "json_object" },
  };
  if (isReasoningModel(model) && thinking !== "default") {
    extras.thinking = { type: thinking };
  }
  return extras;
}

function effectiveMaxTokens(
  requested: number | undefined,
  fallback: number,
  floor = 1024,
): number {
  const n = requested ?? fallback;
  return Math.max(n, floor);
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

    const maxTokens = effectiveMaxTokens(options?.maxTokens, 4096, 1024);
    const output = await withRetry(async () => {
      const response: any = await this.client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        temperature: options?.temperature ?? 0.7,
        messages: toOpenAIMessages(messages),
      } as any);
      const text = assistantMessageText(response.choices[0]?.message);
      if (!text.trim()) {
        throw new Error(
          `JSON parse error (retryable): empty assistant content (model=${model})`,
        );
      }
      recordTokenUsage({
        model,
        operation: "chat",
        usage: usageFromOpenAI(response.usage),
        messages,
        outputText: text,
      });
      return text;
    }, `chat(model=${model})`);

    const elapsed = Date.now() - t0;
    console.log(
      `[LLM:chat] model=${model} elapsed=${elapsed}ms outputLen=${output.length}`,
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
    const reasoning = isReasoningModel(model);
    // Quality path: thinking ON shares max_tokens with final JSON — raise floor hard.
    // DeepSeek docs: JSON lives in content; CoT in reasoning_content (same budget).
    const qualityMaxTokens = effectiveMaxTokens(
      options?.maxTokens,
      8192,
      reasoning ? 12_288 : 2048,
    );
    // Fallback path: thinking OFF — smaller budget is enough for JSON only.
    const fallbackMaxTokens = effectiveMaxTokens(
      options?.maxTokens,
      4096,
      4096,
    );

    console.log(
      `[LLM:chatWithTool] model=${model} tool=${toolSchema.name} ` +
        `inputLen=${inputLen} qualityMax=${qualityMaxTokens} ` +
        `fallbackMax=${fallbackMaxTokens} json_object=1 starting...`,
    );
    const t0 = Date.now();

    // DeepSeek JSON mode requires the word "json" in the prompt.
    const toolPrompt = [
      messages.map((m) => `${m.role}: ${(m.content ?? "")}`).join("\n\n"),
      "",
      "Return a single valid JSON object that matches this schema (json):",
      JSON.stringify(toolSchema.parameters, null, 2),
      "Put the JSON in the final answer content only. No markdown fences.",
    ].join("\n");

    const attempt = async (
      thinking: "enabled" | "disabled" | "default",
      maxTokens: number,
    ): Promise<T> => {
      const response: any = await this.client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        temperature: options?.temperature ?? 0.3,
        messages: [{ role: "user", content: toolPrompt }],
        ...structuredOutputExtras(model, thinking),
      } as any);

      const msg = response.choices[0]?.message;
      // Official: with json_object, parse `content` (not reasoning_content).
      let rawText = assistantMessageText(msg, { preferContentOnly: true });
      if (!rawText.trim()) {
        rawText = assistantMessageText(msg);
      }
      const contentLen =
        typeof msg?.content === "string" ? msg.content.length : 0;
      const reasoningLen =
        typeof msg?.reasoning_content === "string"
          ? msg.reasoning_content.length
          : 0;
      const finish = response.choices[0]?.finish_reason;
      console.log(
        `[LLM:chatWithTool] model=${model} tool=${toolSchema.name} ` +
          `thinking=${thinking} maxTokens=${maxTokens} finish=${finish} ` +
          `outputLen=${rawText.length} contentLen=${contentLen} reasoningLen=${reasoningLen}`,
      );
      recordTokenUsage({
        model,
        operation: `chatWithTool:${toolSchema.name}`,
        usage: usageFromOpenAI(response.usage),
        messages: [{ content: toolPrompt }],
        outputText: rawText,
      });

      if (!rawText.trim()) {
        throw new Error(
          `JSON parse error (retryable): empty content ` +
            `(tool=${toolSchema.name}, thinking=${thinking}, finish=${finish})`,
        );
      }
      try {
        return extractJSON<T>(rawText);
      } catch (jsonError) {
        const errMsg =
          jsonError instanceof Error ? jsonError.message : String(jsonError);
        throw new Error(`JSON parse error (retryable): ${errMsg}`);
      }
    };

    const result = await withRetry(async () => {
      // 1) Quality: thinking enabled + large max_tokens (prefer this)
      try {
        return await attempt(
          reasoning ? "enabled" : "default",
          qualityMaxTokens,
        );
      } catch (e1) {
        // 2) Reliability only: disable thinking so entire budget → JSON content
        if (reasoning) {
          console.warn(
            `[LLM:chatWithTool] tool=${toolSchema.name} thinking=enabled failed, ` +
              `retry thinking=disabled maxTokens=${fallbackMaxTokens}: ` +
              `${(e1 as Error).message?.slice(0, 120)}`,
          );
          return await attempt("disabled", fallbackMaxTokens);
        }
        throw e1;
      }
    }, `chatWithTool(tool=${toolSchema.name}, model=${model})`);

    const elapsed = Date.now() - t0;
    console.log(
      `[LLM:chatWithTool] model=${model} tool=${toolSchema.name} elapsed=${elapsed}ms ok`,
    );
    return result;
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

    const maxTokens = effectiveMaxTokens(options?.maxTokens, 4096, 1024);
    const response: any = await this.client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      temperature: options?.temperature ?? 0.7,
      stream: true,
      stream_options: { include_usage: true },
      messages: toOpenAIMessages(messages),
    } as any);

    let fullText = "";
    let streamUsage: any = null;
    for await (const chunk of response) {
      if ((chunk as any).usage) streamUsage = (chunk as any).usage;
      const delta = (chunk as any).choices[0]?.delta;
      if (!delta) continue;
      const piece =
        (typeof delta.content === "string" && delta.content) ||
        (typeof delta.reasoning_content === "string" &&
          delta.reasoning_content) ||
        "";
      if (piece) {
        fullText += piece;
        onChunk(fullText);
      }
    }

    const elapsed = Date.now() - t0;
    console.log(
      `[LLM:chatStream] model=${model} elapsed=${elapsed}ms outputLen=${fullText.length}`
    );
    recordTokenUsage({
      model,
      operation: "chatStream",
      usage: usageFromOpenAI(streamUsage),
      messages,
      outputText: fullText,
    });

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

    // Normalize schemas for OpenCode Go / DeepSeek (empty properties → 400)
    const openaiTools = toOpenAIFunctionTools(
      tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters as Record<string, unknown>,
      })),
    );

    const convertedMessages = messages.map(m => convertAnthropicBlocksToOpenAI(m));
    let stream: any;
    const createBody = (withStreamUsage: boolean) =>
      ({
        model,
        max_tokens: options?.maxTokens || 4096,
        temperature: options?.temperature ?? 0.4,
        messages: convertedMessages,
        tools: openaiTools,
        stream: true,
        ...(withStreamUsage ? { stream_options: { include_usage: true } } : {}),
      }) as any;

    try {
      try {
        stream = await this.client.chat.completions.create(createBody(true));
      } catch (e1) {
        const msg1 = (e1 as Error).message || "";
        // Retry without stream_options if gateway rejects the field
        if (/400|stream_options|Upstream/i.test(msg1)) {
          console.warn(
            `[LLM:chatWithTools] retry without stream_options after: ${msg1.slice(0, 200)}`,
          );
          stream = await this.client.chat.completions.create(createBody(false));
        } else {
          throw e1;
        }
      }
    } catch (e) {
      const errMsg = (e as Error).message || String(e);
      const toolNames = tools.map((t) => t.name).join(",");
      logSession({
        ts: new Date().toISOString(),
        type: "chat_with_tools_error",
        error: errMsg,
        model,
        toolCount: tools.length,
        toolNames: toolNames.slice(0, 500),
        messages: convertedMessages.map((m: any) => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content.slice(0, 500) : JSON.stringify(m.content).slice(0, 500),
          hasToolCalls: !!m.tool_calls,
          toolCallsCount: m.tool_calls?.length || 0,
          toolCallId: m.tool_call_id || null,
        })),
      });
      // Surface actionable context for analysis panel (not bare upstream 400)
      const enriched = new Error(
        `${errMsg}` +
          (errMsg.includes("Upstream") || errMsg.includes("400")
            ? ` [model=${model} tools=${tools.length} inputChars≈${inputLen}. ` +
              `If this persists after retries, check OPENCODE/DEEPSEEK key and analysis model id.]`
            : ""),
      );
      (enriched as any).cause = e;
      throw enriched;
    }

    let currentToolId = "";
    let currentToolName = "";
    let currentToolArgs = "";
    let outputLen = 0;
    let streamUsage: any = null;
    let outText = "";

    for await (const chunk of stream) {
      if ((chunk as any).usage) streamUsage = (chunk as any).usage;
      const delta = (chunk as any).choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        outputLen += delta.content.length;
        outText += delta.content;
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
    recordTokenUsage({
      model,
      operation: "chatWithTools",
      usage: usageFromOpenAI(streamUsage),
      messages: convertedMessages,
      outputText: outText + (currentToolArgs || ""),
    });
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
