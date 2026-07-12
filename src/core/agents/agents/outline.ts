import type { AgentDef } from "../types";
import { renderPrompt } from "@/core/prompts/renderer";

export const outlineAgent: AgentDef = {
  execute: async (ctx, llm, onChunk) => {
    const sys = renderPrompt("outline-system.md", {});
    const lastText = (ctx.novelText || "").slice(-3000);
    const label = ctx.continueFromLabel && ctx.continueFromLabel !== "未知"
      ? ctx.continueFromLabel
      : `全文末尾（共${(ctx.novelText || "").length}字）`;
    const uc = `${ctx.prompt}\n\n## 续写点\n${label}\n\n## 最近前文（续写点之前的内容）\n${lastText}`;
    let r: string;
    if (onChunk) {
      r = await llm.chatStream(
        [{ role: "system", content: sys }, { role: "user", content: uc }],
        (acc) => onChunk(acc),
        { temperature: 0.4, maxTokens: 4096 }
      );
    } else {
      r = await llm.chat(
        [{ role: "system", content: sys }, { role: "user", content: uc }],
        { temperature: 0.4, maxTokens: 4096 }
      );
    }
    return {
      content: r,
      messages: [{ role: "assistant", content: r }],
    };
  },
};
