import type { AgentDef } from "../types";

export const writerAgent: AgentDef = {
  execute: async (ctx, llm, onChunk) => {
    let prose = "";
    const prevText = (ctx.novelText || "").slice(-5000);
    const uc = `${ctx.prompt}\n\n## 前文\n${prevText}\n\n直接输出正文，不要JSON包裹。`;
    if (onChunk) {
      await llm.chatStream(
        [{ role: "user", content: uc }],
        (acc) => { prose = acc; onChunk(acc); },
        { temperature: 0.7, maxTokens: 16384 }
      );
    } else {
      prose = await llm.chat(
        [{ role: "user", content: uc }],
        { temperature: 0.7, maxTokens: 16384 }
      );
    }
    return {
      content: prose,
      messages: [
        { role: "user", content: uc.slice(0, 800) },
        { role: "assistant", content: prose.slice(0, 500) + "..." },
      ],
    };
  },
};
