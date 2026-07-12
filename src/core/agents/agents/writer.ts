import type { AgentDef } from "../types";

export const writerAgent: AgentDef = {
  execute: async (ctx, llm, onChunk) => {
    let prose = "";
    const isRewrite = ctx.prompt.includes("修改") || ctx.prompt.includes("修复");

    const sys = isRewrite
      ? `你是小说审校编辑。你的任务是**精确修改**正文中的具体问题。
## 铁律
1. **只改列出的问题**。问题列表以外的一切，哪怕你觉得不好，也不准改
2. **最小化改动**。改一个词能解决的，不改一句话；改一句能解决的，不改一段
3. **禁止新增任何内容**。不添加新对话、新描写、新情节
4. 输出完整正文，不要任何解释`
      : `你是小说执行写手。根据大纲创作正文。
## 核心规则
1. **严格遵循大纲**。大纲规定的场景顺序、事件因果、人物出场顺序，必须一一执行。不得跳过、不得重组、不得添加大纲中没有的场景
2. **禁止创造事件**。大纲没写的新事件、新人物、新地点、新道具，一个字都不准加。你无权决定"发生了什么"
3. **你的创造力用在文字上**：
   - 环境氛围与感官细节（气味、光线、温度）
   - 人物对话的节奏与措辞
   - 心理活动的层次与分寸
   - 动作描写的画面感
4. **禁止编造原文未提及的设定**。所有人物关系、道具去向、已发生事件以原文为准
5. 直接输出正文，不要写"以下是续写"之类的引导语`;

    const uc = ctx.prompt;

    if (onChunk) {
      await llm.chatStream(
        [{ role: "system", content: sys }, { role: "user", content: uc }],
        (acc) => { prose = acc; onChunk(acc); },
        { temperature: 0.5, maxTokens: 16384 }
      );
    } else {
      prose = await llm.chat(
        [{ role: "system", content: sys }, { role: "user", content: uc }],
        { temperature: 0.5, maxTokens: 16384 }
      );
    }

    return {
      content: prose,
      messages: [{ role: "assistant", content: prose.slice(0, 500) + "..." }],
    };
  },
};
