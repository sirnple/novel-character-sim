import type { AgentDef } from "../types";
import { resolveAgentPrompt } from "@/core/prompts/resolve-agent-prompt";
import { runSubAgentToolLoop } from "../tool-loop";
import { saveOutline } from "../intermediate-store";
import { branchTools } from "./branch-tools";
import { intermediateReadTools } from "./intermediate-tools";
import { libraryTools } from "./library-tools";
import { getIdea } from "@/lib/db";

// Outline: branch context + idea library tools
const TOOLS = [
  ...branchTools,
  ...intermediateReadTools.filter(t => t.name === "get_outline"),
  ...libraryTools.filter(t => t.name === "list_ideas" || t.name === "get_ideas"),
].map(t => ({
  name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown>,
}));

export const outlineAgent: AgentDef = {
  execute: async (ctx, llm, onChunk, onTrail) => {
    let ideaBlock = "";
    const selected = (ctx.selectedIdeaIds || []).slice(0, 3);
    if (selected.length > 0) {
      const ideas = selected.map(id => getIdea(ctx.userId, id)).filter(Boolean);
      if (ideas.length) {
        ideaBlock =
          "\n\n## 用户已选定的点子（必须融入大纲，最多 3 条）\n" +
          ideas.map((i, n) => `${n + 1}. 【${i!.title}】${i!.content}`).join("\n");
      }
    } else if (ctx.autoPickIdeas) {
      ideaBlock =
        "\n\n## 点子库\n用户未预选点子。你可调用 list_ideas / get_ideas 自行挑选最多 3 条并融入大纲。";
    }

    // system = outline-system.md + outline-agent-contract.md (via map systemExtra)
    const { system: sys, user: baseUser } = resolveAgentPrompt("outline_writer", "zh", {
      prompt: ctx.prompt,
      novelId: ctx.novelId,
      branchId: ctx.branchId,
      selectionInstruction: "",
    });
    const uc = baseUser + ideaBlock;

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
