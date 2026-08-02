import { register } from "./registry";
import { registerAgent, getAgent, listAgentTypes } from "./agent-registry";
import { listAgentNames } from "./agent-config";
import { branchTools } from "./agents/branch-tools";
import { intermediateTools } from "./agents/intermediate-tools";
import { libraryTools } from "./agents/library-tools";
import { foreshadowTools } from "./agents/foreshadow-tools";
import {
  acceptContinuation,
  formatAcceptHint,
} from "@/core/foreshadowing/accept-continuation";
import { outlineAgent } from "./agents/outline";
import { writerCreateAgent, writerRewriteAgent } from "./agents/writer";
import {
  reviewCharacterAgent,
  reviewContinuityAgent,
  reviewForeshadowingAgent,
  reviewStyleAgent,
  reviewWorldAgent,
  reviewPacingAgent,
} from "./agents/review";
import { outlineReviewAgent } from "./agents/outline-review";
import { characterExtractTools } from "./agents/character-extract-tools";
import { ANALYSIS_AGENTS } from "./agents/analysis-agents";
import { allAnalysisTools } from "./agents/analysis-tools";

let registryInitialized = false;

/** Idempotent: safe to call from chat route and character extract job. */
export function initRegistry(): void {
  if (registryInitialized) return;
  registryInitialized = true;

  // Each agent carries config; registerAgent keys by agent.config.name
  registerAgent(outlineAgent);
  registerAgent(writerCreateAgent);
  registerAgent(writerRewriteAgent);
  registerAgent(outlineReviewAgent);
  registerAgent(reviewCharacterAgent);
  registerAgent(reviewContinuityAgent);
  registerAgent(reviewForeshadowingAgent);
  registerAgent(reviewStyleAgent);
  registerAgent(reviewWorldAgent);
  registerAgent(reviewPacingAgent);

  for (const agent of ANALYSIS_AGENTS) {
    registerAgent(agent);
  }

  const agentNames = listAgentTypes();
  register({
    name: "agent",
    description:
      "调用子 Agent（LLM tool loop）。agent_type 必须是 system md frontmatter 的 name。" +
      `可用: ${agentNames.join(", ")}。只传任务说明，勿塞正文。`,
    parameters: {
      type: "object",
      properties: {
        agent_type: {
          type: "string",
          enum: agentNames.length ? agentNames : listAgentNames(),
          description:
            "子 Agent 的 frontmatter name（与 system md 中 name: 一致）",
        },
        prompt: {
          type: "string",
          description:
            "任务说明（用户要求、MODE 标记等）。不要粘贴正文全文；子 agent 会自己取上下文。",
        },
      },
      required: ["agent_type", "prompt"],
    },
    execute: async (args, ctx, llm, onChunk) => {
      const raw = String(args.agent_type || "").trim();
      const agentImpl = getAgent(raw);
      if (!agentImpl) {
        throw new Error(
          `未知子 Agent: ${raw}。可用 frontmatter name: ${listAgentTypes().join(", ")}`,
        );
      }
      return agentImpl.execute(
        { prompt: args.prompt as string, ...ctx },
        llm,
        onChunk,
      );
    },
  });

  register({
    name: "ask_question",
    description:
      "向用户提问并等待回答。需要用户做选择或确认时必须调用。调用后本回合结束，等用户回答后再继续。",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "要问用户的问题（简洁、可操作）",
        },
        options: {
          type: "array",
          description: "可选：2–6 个供点击的选项。不传则用户只能自由输入。",
          items: { type: "string" },
        },
      },
      required: ["question"],
    },
    execute: async (args) => {
      const q = String(args.question || "");
      const opts = Array.isArray(args.options) ? args.options.map(String) : [];
      return {
        content: JSON.stringify({
          question: q,
          options: opts,
          status: "awaiting_user",
        }),
        messages: [],
      };
    },
  });

  register({
    name: "accept_continuation",
    description:
      "用户确认「接受续写」时调用：把当前草稿写入本分支正文，伏笔账本按 realized 更新。",
    parameters: {
      type: "object",
      properties: {
        note: {
          type: "string",
          description: "可选：简述用户选择",
        },
      },
      required: [],
    },
    execute: async (_args, ctx) => {
      const result = acceptContinuation({
        userId: ctx.userId,
        novelId: ctx.novelId,
        branchId: ctx.branchId,
      });
      return {
        content: formatAcceptHint(result),
        messages: [],
      };
    },
  });

  register({
    name: "run_reviews",
    description:
      "并行运行六个审查 agent（角色/连贯/伏笔/风格/世界观/节奏）。正文写完后调用一次即可。",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "传给各审查 agent 的简短说明",
        },
      },
      required: [],
    },
    execute: async () => {
      return { content: "请由 chat 路由执行 run_reviews", messages: [] };
    },
  });

  for (const tool of branchTools) register(tool);
  for (const tool of intermediateTools) register(tool);
  for (const tool of libraryTools) register(tool);
  for (const tool of foreshadowTools) register(tool);
  for (const tool of characterExtractTools) register(tool);
  for (const tool of allAnalysisTools()) register(tool);
}
