import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, LLMMessage, ToolSchema } from "@/types";
import type { StreamEvent } from "@/core/agents/types";
import { extractJSON } from "@/lib/utils";
import { recordTokenUsage, usageFromClaude } from "@/lib/token-meter";
import { parseToolCallArguments } from "@/core/llm/parse-tool-args";

export class ClaudeProvider implements LLMProvider {
  private client: Anthropic;
  private defaultModel: string;

  /**
   * @param baseURL - Optional Anthropic-compatible root (SDK appends `/v1/messages`).
   *   e.g. OpenCode Go: `https://opencode.ai/zen/go`
   */
  constructor(
    apiKey: string,
    defaultModel: string = "claude-sonnet-4-6",
    baseURL?: string
  ) {
    this.client = new Anthropic({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });
    this.defaultModel = defaultModel;
  }

  async chat(
    messages: LLMMessage[],
    options?: { model?: string; maxTokens?: number; temperature?: number }
  ): Promise<string> {
    const systemMsg = messages.find((m) => m.role === "system");
    const chatMessages = messages
      .filter((m) => m.role !== "system" && m.content != null)
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content as string | any[],
      }));

    const response = await this.client.messages.create({
      model: options?.model || this.defaultModel,
      max_tokens: options?.maxTokens || 4096,
      temperature: options?.temperature ?? 0.7,
      system: systemMsg?.content,
      messages: chatMessages,
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Claude returned no text response");
    }
    const model = options?.model || this.defaultModel;
    recordTokenUsage({
      model,
      operation: "chat",
      usage: usageFromClaude(response.usage),
      messages,
      outputText: textBlock.text,
    });
    return textBlock.text;
  }

  async chatWithTool<T>(
    messages: LLMMessage[],
    toolSchema: ToolSchema,
    options?: {
      model?: string;
      maxTokens?: number;
      temperature?: number;
      cotTag?: string;
      saveCotPrompt?: boolean;
    }
  ): Promise<T> {
    // ... same implementation
    const systemMsg = messages.find((m) => m.role === "system");
    const chatMessages = messages
      .filter((m) => m.role !== "system" && m.content != null)
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content as string | any[],
      }));

    const toolSystemPrompt = [
      systemMsg?.content || "",
      "",
      "IMPORTANT: You must respond with a valid JSON object that matches the following schema. Do not include any text outside the JSON object.",
      "Schema:",
      JSON.stringify(toolSchema.parameters, null, 2),
      "",
      "Respond ONLY with the JSON object, no other text.",
    ]
      .filter(Boolean)
      .join("\n");

    const response = await this.client.messages.create({
      model: options?.model || this.defaultModel,
      max_tokens: options?.maxTokens || 4096,
      temperature: options?.temperature ?? 0.3,
      system: toolSystemPrompt,
      messages: chatMessages,
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Claude returned no text in tool call");
    }

    const rawText = textBlock.text;
    const model = options?.model || this.defaultModel;
    recordTokenUsage({
      model,
      operation: `chatWithTool:${toolSchema.name}`,
      usage: usageFromClaude(response.usage),
      messages,
      outputText: rawText,
    });
    return extractJSON<T>(rawText);
  }

  async chatStream(
    messages: LLMMessage[],
    onChunk: (text: string) => void,
    options?: { model?: string; maxTokens?: number; temperature?: number }
  ): Promise<string> {
    const systemMsg = messages.find((m) => m.role === "system");
    const chatMessages = messages
      .filter((m) => m.role !== "system" && m.content != null)
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content as string | any[],
      }));

    const stream = await this.client.messages.create({
      model: options?.model || this.defaultModel,
      max_tokens: options?.maxTokens || 4096,
      temperature: options?.temperature ?? 0.7,
      system: systemMsg?.content,
      messages: chatMessages,
      stream: true,
    });

    let fullText = "";
    let finalUsage: any = null;
    for await (const event of stream) {
      if (event.type === "message_delta" && (event as any).usage) {
        finalUsage = (event as any).usage;
      }
      if (event.type === "message_start" && (event as any).message?.usage) {
        finalUsage = { ...(finalUsage || {}), ...(event as any).message.usage };
      }
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        fullText += event.delta.text;
        onChunk(fullText);
      }
    }

    const model = options?.model || this.defaultModel;
    recordTokenUsage({
      model,
      operation: "chatStream",
      usage: usageFromClaude(finalUsage),
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
    const systemMsg = messages.find(m => m.role === "system");
    const chatMessages = messages
      .filter(m => m.role !== "system")
      .map(m => ({ role: m.role as "user" | "assistant", content: m.content as string | any[] }));

    const anthropicTools = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: "object" as const,
        properties: t.parameters.properties as Record<string, unknown>,
        required: t.parameters.required || [],
      },
    }));

    const stream = this.client.messages.stream({
      model: options?.model || this.defaultModel,
      max_tokens: options?.maxTokens || 4096,
      temperature: options?.temperature ?? 0.4,
      system: systemMsg?.content || "",
      messages: chatMessages,
      tools: anthropicTools,
    });

    let currentToolId = "";
    let currentToolName = "";
    let currentToolArgs = "";
    let lastArgDeltaEmit = 0;
    let outText = "";
    let finalUsage: any = null;

    for await (const event of stream) {
      if (event.type === "message_delta" && (event as any).usage) {
        finalUsage = { ...(finalUsage || {}), ...(event as any).usage };
      }
      if (event.type === "message_start" && (event as any).message?.usage) {
        finalUsage = { ...(finalUsage || {}), ...(event as any).message.usage };
      }
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        outText += event.delta.text;
        yield { type: "text_delta", text: event.delta.text };
      } else if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
        currentToolId = event.content_block.id;
        currentToolName = event.content_block.name;
        currentToolArgs = "";
        lastArgDeltaEmit = 0;
      } else if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
        currentToolArgs += event.delta.partial_json;
        if (
          currentToolId &&
          currentToolArgs.length >= 80 &&
          currentToolArgs.length - lastArgDeltaEmit >= 400
        ) {
          lastArgDeltaEmit = currentToolArgs.length;
          yield {
            type: "tool_arg_delta",
            id: currentToolId,
            name: currentToolName || "tool",
            argsChars: currentToolArgs.length,
            preview: `组装参数中… ${currentToolArgs.length} 字`,
          };
        }
      } else if (event.type === "content_block_stop") {
        if (currentToolId) {
          const args = parseToolCallArguments(currentToolArgs, currentToolName);
          if (args) {
            yield { type: "tool_use", id: currentToolId, name: currentToolName, args };
          } else {
            console.warn(
              `[LLM:claude] drop tool_use name=${currentToolName} argsLen=${currentToolArgs.length}`,
            );
          }
          currentToolId = "";
          currentToolName = "";
          currentToolArgs = "";
        }
      }
    }

    const model = options?.model || this.defaultModel;
    recordTokenUsage({
      model,
      operation: "chatWithTools",
      usage: usageFromClaude(finalUsage),
      messages,
      outputText: outText + currentToolArgs,
    });
    yield { type: "done" };
  }
}
