/**
 * AsyncLocalStorage context for attributing LLM token usage
 * to user / novel / branch / agent without threading args everywhere.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface TokenUsageContext {
  userId?: string;
  novelId?: string;
  branchId?: string;
  agentId?: string;
  /** free-form: extract | agent | simulation | title_parse ... */
  category?: string;
}

const als = new AsyncLocalStorage<TokenUsageContext>();

export function runWithTokenContext<T>(
  ctx: TokenUsageContext,
  fn: () => T,
): T {
  const parent = als.getStore() || {};
  return als.run({ ...parent, ...ctx }, fn);
}

export function getTokenContext(): TokenUsageContext {
  return als.getStore() || {};
}
