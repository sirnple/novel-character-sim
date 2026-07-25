/**
 * Optional in-process metrics for chatWithTool attempts (experiments).
 * Enable with LLM_METRICS=1 or call beginChatWithToolMetrics().
 */

export type ChatWithToolAttemptMetric = {
  ts: string;
  model: string;
  tool: string;
  thinking: "enabled" | "disabled" | "default";
  maxTokens: number;
  finish: string | null;
  contentLen: number;
  reasoningLen: number;
  /** Present when API returns usage.completion_tokens */
  completionTokens: number | null;
  promptTokens: number | null;
  /** finish=length (hit max_tokens ceiling) */
  finishLength: boolean;
  /** Prefer-content empty (CoT-only / truncated JSON path) */
  contentEmpty: boolean;
  /**
   * Heuristic: thinking budget likely insufficient for final JSON.
   * true when thinking=enabled and (finish=length or content empty).
   */
  budgetInsufficient: boolean;
  parseOk: boolean | null;
  label?: string;
};

let collecting = false;
let attempts: ChatWithToolAttemptMetric[] = [];
let label: string | undefined;

export function isChatWithToolMetricsEnabled(): boolean {
  if (collecting) return true;
  const f = (process.env.LLM_METRICS || "").toLowerCase();
  return f === "1" || f === "true" || f === "yes";
}

export function beginChatWithToolMetrics(opts?: { label?: string }): void {
  collecting = true;
  attempts = [];
  label = opts?.label;
}

export function endChatWithToolMetrics(): ChatWithToolAttemptMetric[] {
  collecting = false;
  const out = attempts;
  attempts = [];
  label = undefined;
  return out;
}

export function getChatWithToolMetricsSnapshot(): ChatWithToolAttemptMetric[] {
  return attempts.slice();
}

export function recordChatWithToolAttempt(
  partial: Omit<ChatWithToolAttemptMetric, "ts" | "finishLength" | "contentEmpty" | "budgetInsufficient"> & {
    finish?: string | null;
  },
): void {
  if (!isChatWithToolMetricsEnabled() && !collecting) return;
  const finish = partial.finish ?? null;
  const finishLength = finish === "length";
  const contentEmpty = (partial.contentLen || 0) === 0;
  const budgetInsufficient =
    partial.thinking === "enabled" && (finishLength || contentEmpty);
  attempts.push({
    ts: new Date().toISOString(),
    model: partial.model,
    tool: partial.tool,
    thinking: partial.thinking,
    maxTokens: partial.maxTokens,
    finish,
    contentLen: partial.contentLen,
    reasoningLen: partial.reasoningLen,
    completionTokens: partial.completionTokens ?? null,
    promptTokens: partial.promptTokens ?? null,
    finishLength,
    contentEmpty,
    budgetInsufficient,
    parseOk: partial.parseOk ?? null,
    label: partial.label ?? label,
  });
}

export function summarizeChatWithToolMetrics(
  rows: ChatWithToolAttemptMetric[],
): {
  totalAttempts: number;
  enabledAttempts: number;
  disabledAttempts: number;
  budgetInsufficientCount: number;
  budgetInsufficientRate: number;
  finishLengthCount: number;
  contentEmptyOnEnabled: number;
  parseFailCount: number;
  byThinking: Record<string, number>;
} {
  const enabled = rows.filter((r) => r.thinking === "enabled");
  const budget = enabled.filter((r) => r.budgetInsufficient);
  return {
    totalAttempts: rows.length,
    enabledAttempts: enabled.length,
    disabledAttempts: rows.filter((r) => r.thinking === "disabled").length,
    budgetInsufficientCount: budget.length,
    budgetInsufficientRate: enabled.length
      ? budget.length / enabled.length
      : 0,
    finishLengthCount: rows.filter((r) => r.finishLength).length,
    contentEmptyOnEnabled: enabled.filter((r) => r.contentEmpty).length,
    parseFailCount: rows.filter((r) => r.parseOk === false).length,
    byThinking: rows.reduce(
      (acc, r) => {
        acc[r.thinking] = (acc[r.thinking] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    ),
  };
}
