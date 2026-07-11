import type { AgentDef, AgentContext } from "../types";
import type { LLMProvider } from "@/types";
import { renderPrompt } from "@/core/prompts/renderer";

export const outlineAgent: AgentDef = {
  execute: async (ctx, llm) => {
    const sys = renderPrompt("outline-system.md", {});
    const prevText = (ctx.novelText || "").slice(-3000);
    const uc = `${ctx.prompt}\n\n## 续写点\n${ctx.continueFromLabel || "未知"}\n\n## 最近前文\n${prevText}`;
    const r = await llm.chat(
      [{ role: "system", content: sys }, { role: "user", content: uc }],
      { temperature: 0.4, maxTokens: 2048 }
    );
    return {
      content: r,
      messages: [
        { role: "user", content: uc.slice(0, 1500) },
        { role: "assistant", content: r },
      ],
    };
  },
};
