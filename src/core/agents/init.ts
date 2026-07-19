import { register } from "./registry";
import { registerAgent, getAgent, listAgentTypes } from "./agent-registry";
import { branchTools } from "./agents/branch-tools";
import { intermediateTools } from "./agents/intermediate-tools";
import { libraryTools } from "./agents/library-tools";
import { foreshadowTools } from "./agents/foreshadow-tools";
import {
  acceptContinuation,
  formatAcceptHint,
} from "@/core/foreshadowing/accept-continuation";
import { outlineAgent } from "./agents/outline";
import { writerAgent } from "./agents/writer";
import {
  reviewCharacterAgent, reviewContinuityAgent, reviewForeshadowingAgent,
  reviewStyleAgent, reviewWorldAgent, reviewPacingAgent,
} from "./agents/review";
import { outlineReviewAgent } from "./agents/outline-review";
import { characterExtractTools } from "./agents/character-extract-tools";
import { ANALYSIS_AGENT_REGISTRATIONS } from "./agents/analysis-agents";
import { allAnalysisTools } from "./agents/analysis-tools";
import { resolveAnalysisAgentType } from "./analysis-allowlist";

const AGENT_TYPES = [
  // write — verb-object
  "generate_outline", "write_prose", "review_outline",
  "review_character", "review_continuity", "review_foreshadowing",
  "review_style", "review_world", "review_pacing",
  // analysis master + domain — verb-object
  "novel_analysis",
  "analyze_form",
  "analyze_story_world",
  "analyze_character_list",
  "extract_character_detail",
  "extract_character_relationships",
  "analyze_timeline",
  "extract_style",
  "extract_ideas",
] as const;

let registryInitialized = false;

/** Idempotent: safe to call from chat route and character extract job. */
export function initRegistry(): void {
  if (registryInitialized) return;
  registryInitialized = true;

  registerAgent("generate_outline", outlineAgent);
  registerAgent("write_prose", writerAgent);
  registerAgent("review_outline", outlineReviewAgent);
  registerAgent("review_character", reviewCharacterAgent);
  registerAgent("review_continuity", reviewContinuityAgent);
  registerAgent("review_foreshadowing", reviewForeshadowingAgent);
  registerAgent("review_style", reviewStyleAgent);
  registerAgent("review_world", reviewWorldAgent);
  registerAgent("review_pacing", reviewPacingAgent);

  for (const { id, def } of ANALYSIS_AGENT_REGISTRATIONS) {
    registerAgent(id, def);
  }

  register({
    name: "agent",
    description:
      "调用子 Agent（动宾命名）。写作: generate_outline/write_prose/review_*；" +
      "分析: analyze_form / analyze_story_world / analyze_character_list / extract_character_detail / " +
      "extract_character_relationships / analyze_timeline / extract_style / extract_ideas。" +
      "只传任务说明，勿塞正文。",
    parameters: {
      type: "object",
      properties: {
        agent_type: {
          type: "string",
          enum: [...AGENT_TYPES],
          description:
            "子 Agent 类型（动宾）：generate_outline、write_prose、review_*、" +
            "analyze_form、analyze_story_world、analyze_character_list、extract_character_detail、" +
            "extract_character_relationships、analyze_timeline、extract_style、extract_ideas",
        },
        prompt: {
          type: "string",
          description: "任务说明（用户要求、MODE 标记、或「正文已写完请审查」等）。不要粘贴正文全文；子 agent 会自己取上下文。",
        },
      },
      required: ["agent_type", "prompt"],
    },
    execute: async (args, ctx, llm, onChunk) => {
      const raw = String(args.agent_type || "");
      // Analysis aliases (analyze_story → analyze_story_world); write ids pass through
      const resolved =
        resolveAnalysisAgentType(raw) || raw;
      const agentDef = getAgent(resolved) || getAgent(raw);
      if (!agentDef) {
        throw new Error(
          `Unknown agent: ${raw}` +
            (resolved !== raw ? ` (resolved: ${resolved})` : "") +
            `。可用: ${listAgentTypes().join(", ")}`,
        );
      }
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

  // Master: user confirmed accept after findings Q&A
  register({
    name: "accept_continuation",
    description:
      "用户确认「接受续写」时调用：把当前草稿写入本分支正文，伏笔账本按 realized（实际落实）更新——" +
      "plan 里没写进正文的不假装回收/新埋。不要在用户只说「修改」时调用。",
    parameters: {
      type: "object",
      properties: {
        note: {
          type: "string",
          description: "可选：简述用户选择（如接受续写）",
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

  for (const tool of characterExtractTools) {
    register(tool);
  }

  for (const tool of allAnalysisTools()) {
    register(tool);
  }
}
