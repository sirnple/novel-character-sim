import type { AgentDef } from "../types";
import { renderPrompt } from "@/core/prompts/renderer";

export const outlineAgent: AgentDef = {
  execute: async (ctx, llm, onChunk) => {
    const sys = renderPrompt("outline-system.md", {});
    const uc = `${ctx.prompt}\n\n## 续写点\n${ctx.continueFromLabel || "未知"}`;
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
