import type { Agent, AskUserRequest } from "../types";
import { getAgent } from "../agent-registry";
import { listProseReviewAgentNames } from "../agent-config";
import { getFindings } from "../intermediate-store";

/** Prose review agents — names from frontmatter (category review, excl. outline). */
export function getReviewAgentTypes(): string[] {
  return listProseReviewAgentNames();
}

/** @deprecated use getReviewAgentTypes() */
export const REVIEW_AGENT_TYPES = listProseReviewAgentNames();

export type ReviewAgentType = string;

export type ReviewProgressEvent =
  | { phase: "start"; agentType: ReviewAgentType }
  | { phase: "done"; agentType: ReviewAgentType; content: string; messages: any[] }
  | { phase: "error"; agentType: ReviewAgentType; error: string };

/**
 * Run the six review agents concurrently.
 * - Does NOT global-clear findings (rewrite 仍可读旧清单；各维 save_findings overwrite 本维)
 * - Each agent get_prose (read) in parallel — safe
 * - Each save_findings(dimension, overwrite=true) replaces only that agent’s dim
 * - onProgress lets the SSE layer open one tool card per dimension
 * - If any dimension hits critical get miss, askUser is bubbled for direct user ask
 */
export async function runReviewsParallel(
  ctx: {
    prompt: string;
    novelId: string;
    branchId: string;
    userId: string;
    selectedStyleId?: string | null;
  },
  llm: Parameters<Agent["execute"]>[1],
  onProgress?: (ev: ReviewProgressEvent) => void,
): Promise<{
  content: string;
  messages: any[];
  results: { agentType: string; content: string }[];
  askUser?: AskUserRequest;
}> {
  const prompt = ctx.prompt?.trim() || "正文已写完，请自行 get_prose 后按你的维度审查。";
  const reviewTypes = getReviewAgentTypes();

  const results = await Promise.all(
    reviewTypes.map(async (agentType) => {
      onProgress?.({ phase: "start", agentType });
      const agentDef = getAgent(agentType);
      if (!agentDef) {
        const content = `${agentType}: 未注册`;
        onProgress?.({ phase: "error", agentType, error: content });
        return { agentType, content, messages: [] as any[], askUser: undefined as AskUserRequest | undefined };
      }
      try {
        // Do not share onChunk across parallel agents (stream interleaving);
        // each card gets trail via onProgress done.
        const result = await agentDef.execute(
          {
            prompt,
            novelId: ctx.novelId,
            branchId: ctx.branchId,
            userId: ctx.userId,
            selectedStyleId: ctx.selectedStyleId ?? null,
          },
          llm,
        );
        onProgress?.({
          phase: "done",
          agentType,
          content: result.content,
          messages: result.messages || [],
        });
        return {
          agentType,
          content: result.content,
          messages: result.messages || [],
          askUser: result.askUser,
        };
      } catch (e) {
        const err = (e as Error).message || String(e);
        onProgress?.({ phase: "error", agentType, error: err });
        return {
          agentType,
          content: `${agentType}: 失败 — ${err}`,
          messages: [] as any[],
          askUser: undefined as AskUserRequest | undefined,
        };
      }
    }),
  );

  const firstAsk = results.find((r) => r.askUser)?.askUser;
  const total = getFindings(ctx.novelId, ctx.branchId).length;
  const lines = results.map(r => `- ${r.content}`);
  const content = firstAsk
    ? `审查因关键数据缺失已中止（部分维度可能已完成）。\n` + lines.join("\n")
    : `六维审查已并行完成（共 ${total} 条 findings）。\n` +
      lines.join("\n") +
      `\n主 agent 请 get_findings 汇总后 ask_question 询问用户是否修改。`;

  return {
    content,
    messages: results.flatMap(r => r.messages || []),
    results: results.map(r => ({ agentType: r.agentType, content: r.content })),
    askUser: firstAsk,
  };
}
