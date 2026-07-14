import type { AgentDef } from "../types";
import { runSubAgentToolLoop } from "../tool-loop";
import { branchTools } from "./branch-tools";
import { intermediateTools } from "./intermediate-tools";

const TOOLS = [...branchTools, ...intermediateTools].map(t => ({
  name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown>,
}));

export const writerAgent: AgentDef = {
  execute: async (ctx, llm, onChunk) => {
    const isRewrite = ctx.prompt.includes("[MODE:rewrite]");

    const modeBlock = isRewrite
      ? `## 修改模式
1. 调 get_prose 工具取当前正文（要被改）。
2. 调 get_findings 工具取审查发现的问题清单。
3. 基于问题清单精确修改正文：只改列出的问题，不动其它。
4. 改完**必须调用 save_prose 工具**保存修改后完整正文。`
      : `## 创作模式
1. 调 get_outline 工具取大纲。
2. 必要时调 get_branch_text / get_branch_characters 补充前文。
3. 按大纲创作完整正文。
4. 写完**必须调用 save_prose 工具**保存完整正文。`;

    const baseSys = `你是小说执行写手。
${modeBlock}

## 文风铁律
- 严格遵循大纲（创作模式）或问题清单（修改模式）
- 禁止编造大纲/清单里没有的事件、人物、道具
- 创造力用在文字表现：氛围感官、对话节奏、心理层次、动作画面
- 直接输出正文，不要"以下是续写"之类引导语`;

    const sys = `${baseSys}

## 输出契约（必读）
- 必须最终调用 save_prose 工具存入产出正文，content 参数为完整正文。不调 save_prose 视为未完成。`;

    const uc = `${ctx.prompt}\n\n## 当前绑定分支\nnovelId=${ctx.novelId}, branchId=${ctx.branchId}`;

    const { finalText, trail } = await runSubAgentToolLoop(llm, sys, uc, TOOLS, ctx, onChunk);

    return {
      content: isRewrite ? "正文已按审查意见修改（已存储）。" : "正文已创建（已存储）。",
      messages: trail,
    };
  },
};
