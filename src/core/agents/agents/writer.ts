import type { AgentDef } from "../types";
import { runSubAgentToolLoop } from "../tool-loop";
import { saveProse, getFindings } from "../intermediate-store";
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
4. 改完直接输出完整正文——你不需要调用 save_prose，产出会被执行层自动存储。`
      : `## 创作模式
1. 调 get_outline 工具取大纲。
2. 必要时调 get_branch_text / get_branch_characters 补充前文。
3. 按大纲创作完整正文。
4. 写完直接输出完整正文——你不需要调用 save_prose，产出会被执行层自动存储。`;

    const baseSys = `你是小说执行写手。
${modeBlock}

## 文风铁律
- 严格遵循大纲（创作模式）或问题清单（修改模式）
- 禁止编造大纲/清单里没有的事件、人物、道具
- 创造力用在文字表现：氛围感官、对话节奏、心理层次、动作画面
- 直接输出正文，不要"以下是续写"之类引导语`;

    const sys = `${baseSys}

## 输出契约
- 直接输出完整正文即可。执行层会把你的最终输出自动保存为 prose。`;

    const uc = `${ctx.prompt}\n\n## 当前绑定分支\nnovelId=${ctx.novelId}, branchId=${ctx.branchId}`;

    const { finalText, trail } = await runSubAgentToolLoop(llm, sys, uc, TOOLS, ctx, onChunk);

    if (!finalText || finalText.length < 50) {
      return {
        content: "正文生成失败：产出为空或过短。",
        messages: trail,
      };
    }
    saveProse(ctx.novelId, ctx.branchId, finalText);

    return {
      content: isRewrite ? "正文已按审查意见修改（已存储）。主 agent 可用 get_prose 获取。" : "正文已创建（已存储）。主 agent 可用 get_prose 获取。",
      messages: trail,
    };
  },
};