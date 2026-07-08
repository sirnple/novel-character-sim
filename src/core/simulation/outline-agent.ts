import type { CharacterProfile, SceneDefinition, SceneOutline } from "@/types";
import type { ChapterSummary, ForeshadowingEntry } from "@/core/codex/types";
import { createLLMProvider } from "@/core/llm/factory";
import { isChinese } from "@/lib/utils";

// ============================================================
// Outline Agent — 小说大纲生成器
// ============================================================

const OUTLINE_SCHEMA = {
  name: "chapter_outline",
  description: "小说章节大纲，包含时间空间设定、焦点角色、情节点、伏笔和节奏",
  parameters: {
    type: "object",
    properties: {
      chapterTitle: { type: "string", description: "章节标题（5-20字）" },
      chapterGoal: { type: "string", description: "章节目标：这一章要达成什么（1-2句话）" },
      timeSpan: { type: "string", description: "本章时间跨度（例如：紧接前章、三日后、半月后、三年后）" },
      seasonAndTime: { type: "string", description: "季节与昼夜特征（例如：深秋的黄昏、盛夏的正午、冬夜的凌晨）" },
      locations: {
        type: "array",
        items: { type: "string" },
        description: "本章涉及的地点（例如：城东旧茶馆、荒野古战场、韩立洞府）",
      },
      focusCharacters: {
        type: "array",
        minItems: 2,
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "角色名" },
            reason: { type: "string", description: "为什么选这个角色——哪条线索到了需要推进的时候" },
          },
          required: ["name", "reason"],
        },
        description: "本章焦点角色（2-3个）——本章只让这些角色作为出场的核心，其他角色不应作为重点出场",
      },
      plotPoints: {
        type: "array",
        minItems: 3,
        maxItems: 6,
        items: {
          type: "object",
          properties: {
            sequence: { type: "number", description: "序号" },
            description: { type: "string", description: "这个情节点发生什么（1-2句话，章节级粒度）" },
            involvedCharacters: {
              type: "array",
              items: { type: "string" },
              description: "涉及的角色名",
            },
            mood: { type: "string", description: "这个情节点的情绪/氛围" },
          },
          required: ["sequence", "description", "involvedCharacters", "mood"],
        },
        description: "3-5个关键情节点（章节级粒度，不是动作级。例：'韩立发现了海月天的秘密，决定暗中调查'而非'韩立推开门看到海月天在打电话'）",
      },
      characterThreads: {
        type: "array",
        items: {
          type: "object",
          properties: {
            characterName: { type: "string", description: "角色名" },
            development: { type: "string", description: "本章该角色的发展/变化（1句话）" },
          },
          required: ["characterName", "development"],
        },
        description: "焦点角色在本章的发展变化",
      },
      newForeshadowing: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string", description: "新埋伏笔的描述" },
            type: { type: "string", enum: ["plot", "character", "world", "relationship", "mystery", "theme"], description: "伏笔类型" },
            suggestedRevealWindow: { type: "string", description: "建议在哪几章之间回收" },
          },
          required: ["description", "type"],
        },
        description: "建议在本章埋入的新伏笔（不超过3个）",
      },
      foreshadowingToReveal: {
        type: "array",
        items: { type: "string" },
        description: "建议在本章推进或回收的已有伏笔描述",
      },
      emotionalArc: {
        type: "string",
        description: "本章情感弧线（例如：平静→暗流→冲突→爆发→余波）",
      },
      chapterEnding: { type: "string", description: "本章如何收尾（1-2句话，要有余韵，不要总结）" },
      pacing: { type: "string", enum: ["fast", "medium", "slow"], description: "本章节奏" },
    },
    required: ["chapterTitle", "chapterGoal", "timeSpan", "seasonAndTime", "locations", "focusCharacters", "plotPoints", "characterThreads", "emotionalArc", "chapterEnding", "pacing"],
  },
};

export interface OutlineResult {
  outline: SceneOutline;
  prompt: { system: string; user: string };
}

/**
 * 大纲 Agent。
 * 承接第 N 章的结尾，为下一章生成完整的小说大纲。
 */
export async function generateOutline(input: {
  characters: CharacterProfile[];
  continueFromChapter: number;
  continueFromLabel: string;
  chapterSummaries?: ChapterSummary[];
  activeForeshadowing?: ForeshadowingEntry[];
  worldBible?: { timePeriod: string; location: string; powerSystem: string; atmosphere: string };
  authorNotes?: string;
  previousProse?: string;
  /** If true, only select 2-3 characters instead of all */
  selectCharacters?: boolean;
}, onEvent?: (event: any) => void): Promise<OutlineResult> {
  const { characters, continueFromChapter, continueFromLabel, chapterSummaries,
    activeForeshadowing, worldBible, authorNotes, previousProse, selectCharacters } = input;

  const llm = createLLMProvider();
  const zh = characters.length > 0 && isChinese(characters[0].personality.description);

  // ---- Character profiles (full detail, but AI will pick 2-3) ----
  const charSummaries = characters
    .map((c) => {
      const traits = Array.isArray(c.personality.traits) ? c.personality.traits.join("、") : String(c.personality.traits || "");
      const goal = c.drive?.goal || "";
      const motivation = c.drive?.motivation || "";
      const fear = c.drive?.fear || "";
      const weakness = c.drive?.weakness || "";
      const bottomLine = c.drive?.bottomLine || "";
      const secret = c.drive?.secret || "";
      const speaking = c.speakingStyle?.description || "";
      const worldview = c.worldview || "";
      const rels = (Array.isArray(c.relationships) ? c.relationships : [])
        .filter((r) => r.characterName && characters.some((sc) => sc.name === r.characterName))
        .map((r) => `${r.characterName}（${r.type || "关联"}，${r.dynamics || "不明"}）`)
        .join("；");
      return `【${c.name}】
  性格：${traits}。${c.personality.description}
  目标：${goal}。动机：${motivation}。
  恐惧：${fear}。弱点：${weakness}。
  ${bottomLine ? `底线：${bottomLine}。` : ""}${secret ? `秘密：${secret}。` : ""}
  说话风格：${speaking}。${worldview ? `世界观：${worldview}。` : ""}
  ${rels ? `关系：${rels}` : ""}`;
    })
    .join("\n\n");

  // ---- Chapter summaries ----
  const summaryText = (chapterSummaries || []).length > 0
    ? (chapterSummaries || []).map(s => `第${s.chapterNumber}章：${s.summary}`).join("\n")
    : "无前文章节摘要。";

  // ---- Foreshadowing ----
  const foreshadowingText = (activeForeshadowing || []).length > 0
    ? (activeForeshadowing || []).map(f =>
        `[${f.type}] ${f.description}（第${f.plantedChapter}章埋入，建议回收：${f.suggestedRevealWindow}）`)
      .join("\n")
    : "暂无活跃伏笔。";

  // ---- Author notes ----
  const authorText = authorNotes || "无特殊要求。";

  const selectionInstruction = selectCharacters && characters.length > 3
    ? zh
      ? `## ⚠️ 最重要：选择焦点角色
下面列出了所有角色，但你**只能选择 2-3 个**作为本章的核心。其他角色不应在本章中出现或只作为背景提及。

选择标准：谁的线索在当前情节位置最需要推进？谁的目标/恐惧/秘密正在被触发？`
      : ""
    : "";

  const systemPrompt = zh
    ? `你是一位经验丰富的小说大纲师。你的任务是为小说续写设计场景大纲。

## 你的角色
你是小说大纲师——你思考的是"这次续写要写什么"，而不是"这个场景怎么拍"。
好的大纲师的标志是：知道**哪些角色暂时不需要出场**。

${selectionInstruction}

## 承接信息
续写起点：${continueFromLabel}
${previousProse ? `\n## 最近篇章末尾\n${previousProse.slice(-500)}` : ""}

## 前文章节摘要
${summaryText}

## 角色档案（当前状态）
${charSummaries}

${worldBible ? `## 世界观\n- 时代：${worldBible.timePeriod}\n- 主舞台：${worldBible.location || "未指定"}\n- 力量体系：${worldBible.powerSystem || "未指定"}\n- 氛围：${worldBible.atmosphere || "未指定"}` : ""}

## 活跃伏笔
${foreshadowingText}

## 作者意图
${authorText}

## 大纲核心要素

一个完整的续写大纲，必须明确以下信息：

### 1. 时间
本次续写发生在什么时间？紧接前文还是跳跃了几天/几个月/几年？什么季节？白天还是夜晚？
时间影响角色行为、情绪和可用的场景元素。

### 2. 空间
本次续写发生在哪里？一个地点还是多个地点？地点之间如何过渡？
与前文相比，空间发生了怎样的变化？这种变化是情节驱动的还是为了展示角色状态？
至少列出 1-2 个具体的地点。

### 3. 焦点角色（最重要）
从所有角色中选出 2-3 个最适合本次续写发展的角色。好的续写通常聚焦少数人——不是所有角色都需要出场。
说明为什么选他们：是哪条线索到了需要推进的时候？是内在动机、外部冲突、还是关系变化？

### 4. 情节点
设计 3-5 个关键情节点。注意粒度——情节点是"一段情节"，不是"一个动作"。
- 好的情节点：韩立发现了海月天与木邬的秘密交易，决定暗中调查。
- 差的情节点：韩立推开门，看到海月天正在和木邬说话。
让角色欲望、恐惧、弱点驱动情节。利用角色关系制造张力。

### 5. 角色发展
每个焦点角色在本次续写中发生了什么变化？哪怕只是一小步——认知的改变、关系的推进、目标的明朗化。
不能让角色"原地踏步"或只是被动反应——他们必须为自己的目标行动。

### 6. 伏笔
- 本次续写可以埋入什么新线索？（不超过 3 个，质量优先）
- 如果有活跃伏笔恰好到了可以推进或回收的节点，明确指出是哪一个。
- 不建议为了"用完伏笔"而强行回收——只纳入那些情节自然流向的伏笔。

### 7. 结构与收尾
- 完整的叙事弧线：开场 → 发展 → 冲突/转折 → 收尾
- 收尾要有余韵——悬念、有分量的对话、一个意象——而非总结感悟
- 节奏与内容匹配：战斗/追逐用快节奏，心理/情感用慢节奏`

    : `You are an experienced novel outliner. Design the outline for the next chapter.

## Your Role
You are a novel outliner. You think in terms of "what should this chapter contain," not scene beats or screenplay direction. A good outliner knows which characters should NOT appear in the current chapter.

${selectionInstruction}

## Context
Written up to: ${continueFromLabel}
Next: Chapter ${continueFromChapter + 1}
${previousProse ? `\n## Recent Prose\n${previousProse.slice(-500)}` : ""}

## Chapter Summaries
${summaryText}

## Characters (Current State)
${charSummaries}

${worldBible ? `## World\n- Period: ${worldBible.timePeriod}\n- Location: ${worldBible.location || "TBD"}\n- Power: ${worldBible.powerSystem || "TBD"}\n- Atmosphere: ${worldBible.atmosphere || "TBD"}` : ""}

## Active Foreshadowing
${foreshadowingText}

## Author Notes
${authorText}

## Essential Outline Elements
1. **Time**: When does this chapter take place? Immediate continuation or time skip? Season, time of day?
2. **Space**: Where? Single or multiple locations? How do locations change from previous chapter? List at least 1-2 specific locations.
3. **Focus Characters**: Pick 2-3 characters. Who needs their thread advanced? Why?
4. **Plot Points**: 3-5 chapter-level plot points (not action-level). Let desire/fear/weakness/secret drive the plot.
5. **Character Development**: What changes for each focus character?
6. **Foreshadowing**: Plant new clues (max 3, quality over quantity). Resolve existing ones only if the plot naturally flows there.
7. **Structure**: Complete arc (opening→development→escalation→resolution). Ending as resonance, not summary. Pacing matches content.`;

  const userPrompt = zh
    ? `请为续写设计场景大纲。续写起点：${continueFromLabel}

**1) 时间与空间**
- 时间跨度（紧接前文 / 数日后 / 数月后 / 数年后？）
- 季节与昼夜特征
- 具体地点列表（至少 1-2 个）
- 与前文相比空间有什么变化？

**2) 焦点角色（选 2-3 个）**
- 角色名：为什么选他/她——哪条线索需要推进？

**3) 核心情节**
- 续写标题（5-20字）
- 续写目标（这次续写要达成什么？）
- 3-5个关键情节点（每个：序号、描述、涉及角色、氛围）

**4) 角色发展**
- 每个焦点角色在本次续写中的变化

**5) 伏笔与收尾**
- 建议新埋的伏笔（不超过3个）
- 建议回收/推进的已有伏笔
- 情感弧线（从开篇到结尾的情绪变化）
- 续写收尾（要有余韵，不要总结）
- 节奏（fast/medium/slow）`
    : `Design the outline for Chapter ${continueFromChapter + 1}. Include: 1) Time and space, 2) 2-3 focus characters with justification, 3) Chapter title, goal, 3-5 plot points, 4) Character development, 5) New and existing foreshadowing, emotional arc, chapter ending, pacing.`;

  console.log(`[OutlineAgent] Generating outline for chapter ${continueFromChapter + 1} (${characters.length} chars)...`);
  const t0 = Date.now();

  if (onEvent) onEvent({ type: "agent", agentId: "outline", name: "大纲", status: "running" });

  const result = await llm.chatWithTool<SceneOutline>(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    OUTLINE_SCHEMA,
    { temperature: 0.7, maxTokens: 2048 }
  );

  console.log(`[OutlineAgent] Done in ${Date.now() - t0}ms: "${result.chapterTitle || result.sceneTitle}"`);

  if (onEvent) {
    onEvent({
      type: "agent",
      agentId: "outline",
      name: "大纲",
      status: "done",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
        { role: "assistant", content: JSON.stringify(result) },
      ],
    });
  }

  return { outline: result, prompt: { system: systemPrompt, user: userPrompt } };
}

// Backward compat — re-export old name
export { generateOutline as runOutlineWriter };
