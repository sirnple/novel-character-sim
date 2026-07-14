import { register } from "./registry";
import { registerAgent, getAgent } from "./agent-registry";
import { branchTools } from "./agents/branch-tools";
import { intermediateTools } from "./agents/intermediate-tools";
import { outlineAgent } from "./agents/outline";
import { writerAgent } from "./agents/writer";
import {
  reviewCharacterAgent, reviewContinuityAgent, reviewForeshadowingAgent,
  reviewStyleAgent, reviewWorldAgent, reviewPacingAgent,
} from "./agents/review";

const AGENT_TYPES = [
  "generate_outline", "write_prose",
  "review_character", "review_continuity", "review_foreshadowing",
  "review_style", "review_world", "review_pacing",
] as const;

export function initRegistry(): void {
  registerAgent("generate_outline", outlineAgent);
  registerAgent("write_prose", writerAgent);
  registerAgent("review_character", reviewCharacterAgent);
  registerAgent("review_continuity", reviewContinuityAgent);
  registerAgent("review_foreshadowing", reviewForeshadowingAgent);
  registerAgent("review_style", reviewStyleAgent);
  registerAgent("review_world", reviewWorldAgent);
  registerAgent("review_pacing", reviewPacingAgent);

  register({
    name: "agent",
    description: "调用创作Agent执行任务。先获取必要上下文，再把角色、前文、大纲等信息写入prompt。",
    parameters: {
      type: "object",
      properties: {
        agent_type: {
          type: "string",
          enum: [...AGENT_TYPES],
          description: "要调用哪个Agent。可选: " + AGENT_TYPES.join(", "),
        },
        prompt: {
          type: "string",
          description: "传给Agent的完整任务描述，包含所有上下文（角色、前文、大纲等）",
        },
      },
      required: ["agent_type", "prompt"],
    },
    execute: async (args, ctx, llm, onChunk) => {
      const agentDef = getAgent(args.agent_type as string);
      if (!agentDef) throw new Error(`Unknown agent: ${args.agent_type}`);
      return agentDef.execute({ prompt: args.prompt as string, ...ctx }, llm, onChunk);
    },
  });

  for (const tool of branchTools) {
    register(tool);
  }

  for (const tool of intermediateTools) {
    register(tool);
  }
}
