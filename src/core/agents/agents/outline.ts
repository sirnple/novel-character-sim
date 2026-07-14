import type { AgentDef } from "../types";
import { renderPrompt } from "@/core/prompts/renderer";
import { runSubAgentToolLoop } from "../tool-loop";
import { branchTools } from "./branch-tools";
import { intermediateTools } from "./intermediate-tools";

const TOOLS = [...branchTools, ...intermediateTools].map(t => ({
  name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown>,
}));

export const outlineAgent: AgentDef = {
  execute: async (ctx, llm, onChunk) => {
    const baseSys = renderPrompt("outline-system.md", {});
    const sys = `${baseSys}

## 输出契约（必读）
1. 你必须以完整的大纲正文结尾。
2. 输出大纲后必须**立刻调用 save_outline 工具**（content 参数为大纲全文）。不调 save_outline 视为未完成。
3. 这是产出大纲给后续 write_prose 用，writer 会单独 get_outline，不要把 bypass 路径走完就退。`;

    const uc = `${ctx.prompt}\n\n## 当前绑定分支\nnovelId=${ctx.novelId}, branchId=${ctx.branchId}\n\n如需前文/角色/时间线，请调用 get_branch_* 工具自取（参数 novelId 与 branchId 同上）。`;

    const { finalText, trail } = await runSubAgentToolLoop(llm, sys, uc, TOOLS, ctx, onChunk);

    return {
      content: "大纲已生成（已存储）。writer 可用 get_outline 工具获取。",
      messages: trail,
    };
  },
};
