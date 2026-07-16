import { register } from "./registry";
import { registerAgent, getAgent } from "./agent-registry";
import { branchTools } from "./agents/branch-tools";
import { intermediateTools } from "./agents/intermediate-tools";
import { libraryTools } from "./agents/library-tools";
import { foreshadowTools } from "./agents/foreshadow-tools";
import { outlineAgent } from "./agents/outline";
import { writerAgent } from "./agents/writer";
import {
  reviewCharacterAgent, reviewContinuityAgent, reviewForeshadowingAgent,
  reviewStyleAgent, reviewWorldAgent, reviewPacingAgent,
} from "./agents/review";
import { outlineReviewAgent } from "./agents/outline-review";

const AGENT_TYPES = [
  "generate_outline", "write_prose", "review_outline",
  "review_character", "review_continuity", "review_foreshadowing",
  "review_style", "review_world", "review_pacing",
] as const;

export function initRegistry(): void {
  registerAgent("generate_outline", outlineAgent);
  registerAgent("write_prose", writerAgent);
  registerAgent("review_outline", outlineReviewAgent);
  registerAgent("review_character", reviewCharacterAgent);
  registerAgent("review_continuity", reviewContinuityAgent);
  registerAgent("review_foreshadowing", reviewForeshadowingAgent);
  registerAgent("review_style", reviewStyleAgent);
  registerAgent("review_world", reviewWorldAgent);
  registerAgent("review_pacing", reviewPacingAgent);

  register({
    name: "agent",
    description:
      "调用子 Agent。可选: generate_outline（含自动大纲审核）、review_outline、write_prose、review_*。只传任务说明，勿塞正文。",
    parameters: {
      type: "object",
      properties: {
        agent_type: {
          type: "string",
          enum: [...AGENT_TYPES],
          description: "Agent 类型: " + AGENT_TYPES.join(", "),
        },
        prompt: {
          type: "string",
          description: "任务说明（用户要求、MODE 标记、或「正文已写完请审查」等）。不要粘贴正文全文；子 agent 会自己取上下文。",
        },
      },
      required: ["agent_type", "prompt"],
    },
    execute: async (args, ctx, llm, onChunk) => {
      const agentDef = getAgent(args.agent_type as string);
      if (!agentDef) throw new Error(`Unknown agent: ${args.agent_type}`);
      // Nested agent tool path has no trail sink; chat route calls agents directly with onTrail
      return agentDef.execute({ prompt: args.prompt as string, ...ctx }, llm, onChunk);
    },
  });

  // Master-only: pause for user input (handled specially in chat route)
  register({
    name: "ask_question",
    description:
      "向用户提问并等待回答。需要用户做选择或确认时必须调用（如：确认大纲、是否按审查修改、选续写方向）。调用后本回合结束，等用户回答后再继续。",
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
      // Real interaction is driven by the chat route + frontend; this is a fallback.
      const q = String(args.question || "");
      const opts = Array.isArray(args.options) ? args.options.map(String) : [];
      return {
        content: JSON.stringify({ question: q, options: opts, status: "awaiting_user" }),
        messages: [],
      };
    },
  });

  // Master-only: parallel six-dimension review (handled in chat route with Promise.all)
  register({
    name: "run_reviews",
    description:
      "并行运行六个审查 agent（角色/连贯/伏笔/风格/世界观/节奏）。正文写完后调用一次即可，不要串行调六个 review_*。可选 prompt 传给每个审查员。",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "传给各审查 agent 的简短说明，默认「正文已写完，请审查」",
        },
      },
      required: [],
    },
    execute: async () => {
      // Real parallel run is in chat/route; this is a schema placeholder.
      return { content: "请由 chat 路由执行 run_reviews", messages: [] };
    },
  });

  for (const tool of branchTools) {
    register(tool);
  }

  for (const tool of intermediateTools) {
    register(tool);
  }

  for (const tool of libraryTools) {
    register(tool);
  }

  for (const tool of foreshadowTools) {
    register(tool);
  }
}
