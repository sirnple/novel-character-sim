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
  | { phase: "chunk"; agentType: ReviewAgentType; content: string }
  | { phase: "trail"; agentType: ReviewAgentType; messages: any[] }
  | { phase: "done"; agentType: ReviewAgentType; content: string; messages: any[] }
  | { phase: "error"; agentType: ReviewAgentType; error: string };

/**
 * Run all prose review agents concurrently.
 * - Per-dim save_findings(overwrite) only replaces that dim (not full wipe)
 * - onProgress: start / trail / chunk / done for live sub-agent cards
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
  // Sub-agents only need novelId/branchId; system md has the rest
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
        // Per-agent onChunk/onTrail so UI cards fill while running (not only on done)
        const result = await agentDef.execute(
          {
            prompt: "",
            novelId: ctx.novelId,
            branchId: ctx.branchId,
            userId: ctx.userId,
            selectedStyleId: ctx.selectedStyleId ?? null,
          },
          llm,
          (text) => onProgress?.({ phase: "chunk", agentType, content: text }),
          (messages) =>
            onProgress?.({ phase: "trail", agentType, messages: messages || [] }),
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
    : `七维审查已并行完成（共 ${total} 条 findings）。\n` +
      lines.join("\n") +
      `\n主 agent 请 get_findings 汇总后 ask_question 询问用户是否修改。`;

  return {
    content,
    messages: results.flatMap(r => r.messages || []),
    results: results.map(r => ({ agentType: r.agentType, content: r.content })),
    askUser: firstAsk,
  };
}
