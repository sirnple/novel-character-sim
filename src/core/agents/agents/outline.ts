import type { AgentDef } from "../types";
import { renderPrompt } from "@/core/prompts/renderer";
import { runSubAgentToolLoop } from "../tool-loop";
import { branchTools } from "./branch-tools";

const BRANCH_TOOL_SCHEMAS = branchTools.map(t => ({
  name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown>,
}));

export const outlineAgent: AgentDef = {
  execute: async (ctx, llm, onChunk) => {
    const sys = renderPrompt("outline-system.md", {});
    const uc = `${ctx.prompt}\n\n## 当前绑定分支\nnovelId=${ctx.novelId}, branchId=${ctx.branchId}\n\n如需前文/角色/时间线，请调用 get_branch_* 工具自取（参数 novelId 与 branchId 同上）。`;
    const { finalText, trail } = await runSubAgentToolLoop(llm, sys, uc, BRANCH_TOOL_SCHEMAS, ctx, onChunk);
    return {
      content: finalText,
      messages: trail,
    };
  },
};
