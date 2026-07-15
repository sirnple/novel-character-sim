import type { AgentDef } from "../types";
import { renderPrompt } from "@/core/prompts/renderer";
import { runSubAgentToolLoop } from "../tool-loop";
import { saveOutline } from "../intermediate-store";
import { branchTools } from "./branch-tools";
import { intermediateReadTools } from "./intermediate-tools";

// Outline only needs branch context + get_outline; never save_* from LLM
const TOOLS = [
  ...branchTools,
  ...intermediateReadTools.filter(t => t.name === "get_outline"),
].map(t => ({
  name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown>,
}));

export const outlineAgent: AgentDef = {
  execute: async (ctx, llm, onChunk, onTrail) => {
    // Craft rules (shared with simulation outline) + agent-framework tool contract
    const sys =
      renderPrompt("outline-system.md", {}) +
      "\n\n" +
      renderPrompt("outline-agent-contract.md", {});

    const uc = renderPrompt("outline-agent-user.md", {
      prompt: ctx.prompt,
      novelId: ctx.novelId,
      branchId: ctx.branchId,
    });

    const { finalText, trail } = await runSubAgentToolLoop(llm, sys, uc, TOOLS, ctx, onChunk, onTrail);

    // 由 execute 层强制把大纲存进 store —— 不依赖 LLM 主动调 save_outline
    if (!finalText || finalText.length < 50) {
      return {
        content: "大纲生成失败：产出为空或过短，请重试 generate_outline。",
        messages: trail,
      };
    }
    saveOutline(ctx.novelId, ctx.branchId, finalText);

    return {
      content: "大纲已生成（已存储）。主 agent 可用 get_outline 工具获取。",
      messages: trail,
    };
  },
};
