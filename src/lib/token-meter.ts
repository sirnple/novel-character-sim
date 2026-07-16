/**
 * Record LLM token usage (API usage fields or estimate) into token_usage table.
 */
import { randomUUID } from "node:crypto";
import { saveTokenUsage } from "@/lib/db";
import { getTokenContext } from "@/lib/token-usage-context";

export interface TokenUsageNumbers {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated: boolean;
}

/** Rough estimate for providers that omit usage (CJK-aware). */
export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const rest = Math.max(0, text.length - cjk);
  return Math.max(1, Math.ceil(cjk / 1.5 + rest / 4));
}

export function estimateUsageFromMessages(
  messages: { content?: unknown }[],
  outputText = "",
): TokenUsageNumbers {
  let inputChars = 0;
  for (const m of messages) {
    const c = m.content;
    if (typeof c === "string") inputChars += c.length;
    else if (c != null) inputChars += JSON.stringify(c).length;
  }
  const promptTokens = estimateTokensFromText("x".repeat(inputChars));
  const completionTokens = estimateTokensFromText(outputText);
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    estimated: true,
  };
}

export function usageFromOpenAI(usage: any | null | undefined): TokenUsageNumbers | null {
  if (!usage) return null;
  const prompt = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
  const completion = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
  const total = Number(usage.total_tokens ?? prompt + completion) || prompt + completion;
  if (prompt === 0 && completion === 0 && total === 0) return null;
  return { promptTokens: prompt, completionTokens: completion, totalTokens: total, estimated: false };
}

export function usageFromClaude(usage: any | null | undefined): TokenUsageNumbers | null {
  if (!usage) return null;
  const prompt = Number(usage.input_tokens ?? 0) || 0;
  const completion = Number(usage.output_tokens ?? 0) || 0;
  if (prompt === 0 && completion === 0) return null;
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: prompt + completion,
    estimated: false,
  };
}

export function recordTokenUsage(opts: {
  model?: string;
  operation: string;
  usage?: TokenUsageNumbers | null;
  /** used only when usage missing */
  messages?: { content?: unknown }[];
  outputText?: string;
  agentId?: string;
  userId?: string;
  novelId?: string;
  branchId?: string;
  category?: string;
}): void {
  try {
    const ctx = getTokenContext();
    let numbers = opts.usage || null;
    if (!numbers) {
      numbers = estimateUsageFromMessages(opts.messages || [], opts.outputText || "");
    }
    if (!numbers.totalTokens && !numbers.promptTokens && !numbers.completionTokens) return;

    saveTokenUsage({
      id: randomUUID(),
      userId: opts.userId ?? ctx.userId,
      novelId: opts.novelId ?? ctx.novelId,
      branchId: opts.branchId ?? ctx.branchId,
      agentId: opts.agentId ?? ctx.agentId,
      category: opts.category ?? ctx.category,
      model: opts.model || "",
      operation: opts.operation,
      promptTokens: numbers.promptTokens,
      completionTokens: numbers.completionTokens,
      totalTokens: numbers.totalTokens,
      estimated: numbers.estimated,
    });
  } catch (e) {
    console.warn("[token-meter] record failed:", (e as Error).message);
  }
}
