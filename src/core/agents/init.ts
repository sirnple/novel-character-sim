import { register } from "./registry";
import { registerAgent, getAgent, listAgentTypes } from "./agent-registry";
import { listAgentNames } from "./agent-config";
import { branchTools } from "./agents/branch-tools";
import { intermediateTools } from "./agents/intermediate-tools";
import { libraryTools } from "./agents/library-tools";
import { characterIntroTools } from "./agents/character-intro-tools";
import { foreshadowTools } from "./agents/foreshadow-tools";
import {
  acceptContinuation,
  formatAcceptHint,
} from "@/core/foreshadowing/accept-continuation";
import {
  outlineCreateAgent,
  outlineRewriteAgent,
} from "./agents/outline";
import { writerCreateAgent, writerRewriteAgent } from "./agents/writer";
import { chapterTitleAgent } from "./agents/chapter-title";
import {
  reviewCharacterAgent,
  reviewContinuityAgent,
  reviewForeshadowingAgent,
  reviewStyleAgent,
  reviewWorldAgent,
  reviewPacingAgent,
  reviewAiTasteAgent,
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
  registerAgent(outlineCreateAgent);
  registerAgent(outlineRewriteAgent);
  registerAgent(writerCreateAgent);
  registerAgent(writerRewriteAgent);
  registerAgent(chapterTitleAgent);
  registerAgent(outlineReviewAgent);
  registerAgent(reviewCharacterAgent);
  registerAgent(reviewContinuityAgent);
  registerAgent(reviewForeshadowingAgent);
  registerAgent(reviewStyleAgent);
  registerAgent(reviewWorldAgent);
  registerAgent(reviewPacingAgent);
  registerAgent(reviewAiTasteAgent);

  for (const agent of ANALYSIS_AGENTS) {
    registerAgent(agent);
  }

  const agentNames = listAgentTypes();
  register({
    name: "agent",
    description:
      "调用子 Agent。agent_type = system md frontmatter 的 name。" +
      `可用: ${agentNames.join(", ")}。` +
      "续写子 agent 只需 agent_type（程序注入 novelId/branchId）；勿塞正文/大纲/findings 全文。",
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
            "可选；续写子 agent 可省略（只绑定 novelId/branchId）。勿粘贴正文/大纲全文。",
        },
      },
      required: ["agent_type"],
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
        { prompt: String(args.prompt ?? ""), ...ctx },
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
      const result = await acceptContinuation({
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
      "并行运行正文审查 agent（角色/连贯/伏笔/风格/世界观/节奏/AI痕迹）。正文写完后调用一次即可；无需 prompt。",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    execute: async () => {
      return { content: "请由 chat 路由执行 run_reviews", messages: [] };
    },
  });

  for (const tool of branchTools) register(tool);
  for (const tool of intermediateTools) register(tool);
  for (const tool of libraryTools) register(tool);
  for (const tool of characterIntroTools) register(tool);
  for (const tool of foreshadowTools) register(tool);
  for (const tool of characterExtractTools) register(tool);
  for (const tool of allAnalysisTools()) register(tool);
}
