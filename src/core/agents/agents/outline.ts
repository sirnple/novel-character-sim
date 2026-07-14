import type { AgentDef } from "../types";
import { renderPrompt } from "@/core/prompts/renderer";
import { runSubAgentToolLoop } from "../tool-loop";
import { saveOutline } from "../intermediate-store";
import { branchTools } from "./branch-tools";
import { intermediateTools } from "./intermediate-tools";

const TOOLS = [...branchTools, ...intermediateTools].map(t => ({
  name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown>,
}));

export const outlineAgent: AgentDef = {
  execute: async (ctx, llm, onChunk) => {
    const baseSys = renderPrompt("outline-system.md", {});
    const sys = `${baseSys}

## 输出契约
- 必须以完整大纲正文结尾。
- 你不需要调用 save_outline——产出的大纲会被执行层自动存储。
- 想获取前文/角色/时间线，请调用 get_branch_* 工具自取。`;

    const uc = `${ctx.prompt}\n\n## 当前绑定分支\nnovelId=${ctx.novelId}, branchId=${ctx.branchId}`;

    const { finalText, trail } = await runSubAgentToolLoop(llm, sys, uc, TOOLS, ctx, onChunk);

    // 由 execute 层强制把大纲存进 store —— 不依赖 LLM 主动调 save_outline
    // （LLM 在 4096 token 限制下经常把大纲文本写完就 stop、不再 emit 工具调用）
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
