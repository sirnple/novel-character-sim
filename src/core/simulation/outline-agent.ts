import type { CharacterProfile, SceneDefinition, SceneOutline } from "@/types";
import type { ChapterSummary, ForeshadowingEntry } from "@/core/codex/types";
import { createLLMProvider } from "@/core/llm/factory";
import { isChinese } from "@/lib/utils";

// ============================================================
// Outline Agent — 小说大纲生成器
// ============================================================

const OUTLINE_SCHEMA = {
  name: "chapter_outline",
  description: "小说章节大纲，规划章节的情节结构和角色线索",
  parameters: {
    type: "object",
    properties: {
      chapterTitle: { type: "string", description: "章节标题（5-20字）" },
      chapterGoal: { type: "string", description: "章节目标：这一章要达成什么（1-2句话）" },
      plotPoints: {
        type: "array",
        minItems: 3,
        maxItems: 6,
        items: {
          type: "object",
          properties: {
            sequence: { type: "number", description: "序号" },
            description: { type: "string", description: "这个情节点发生什么（1-2句话）" },
            involvedCharacters: {
              type: "array",
              items: { type: "string" },
              description: "涉及的角色名",
            },
            mood: { type: "string", description: "情绪/氛围" },
          },
          required: ["sequence", "description", "involvedCharacters", "mood"],
        },
        description: "3-5个关键情节点",
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
        description: "各角色在本章的线索和发展",
      },
      newForeshadowing: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string", description: "新埋伏笔的描述" },
            type: { type: "string", enum: ["plot", "character", "world", "relationship", "mystery", "theme"], description: "伏笔类型" },
            suggestedRevealWindow: { type: "string", description: "建议在哪章回收" },
          },
          required: ["description", "type"],
        },
        description: "建议在本章埋入的新伏笔",
      },
      foreshadowingToReveal: {
        type: "array",
        items: { type: "string" },
        description: "建议在本章回收的已有伏笔描述",
      },
      emotionalArc: {
        type: "string",
        description: "本章的情感弧线，从开篇到结尾的情绪变化（如：平静→暗流→冲突→释放）",
      },
      chapterEnding: { type: "string", description: "本章如何收尾（1-2句话）" },
      pacing: { type: "string", enum: ["fast", "medium", "slow"], description: "本章节奏" },
    },
    required: ["chapterTitle", "chapterGoal", "plotPoints", "characterThreads", "emotionalArc", "chapterEnding", "pacing"],
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
}): Promise<OutlineResult> {
  const { characters, continueFromChapter, continueFromLabel, chapterSummaries,
    activeForeshadowing, worldBible, authorNotes, previousProse } = input;

  const llm = createLLMProvider();
  const zh = characters.length > 0 && isChinese(characters[0].personality.description);

  // ---- Character profiles ----
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

  const systemPrompt = zh
    ? `你是一位经验丰富的小说大纲师。你的任务是为小说的下一章设计大纲。

## 你的角色
你不是编剧，不是场景节拍设计师。你是小说大纲师——你思考的是"这一章要写什么"，而不是"这个场景怎么拍"。

## 承接信息
当前已写到：${continueFromLabel}
下一章是：第 ${continueFromChapter + 1} 章
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

## 创作指南

### 最重要的原则：聚焦
一堂出色的章节通常只聚焦 2-3 个角色。不是所有角色都需要在这一章中出现。
从所有角色中，挑选本章最需要推进其线索的 2-3 个角色作为"本章焦点角色"。
其他角色如果不需要出场，就让他们"在后台"——读者知道他们存在，但本章不写。

### 关于情节设计
- 设计 3-5 个关键情节点，每个情节点是"一段情节"的粒度，而非"一个动作"或"一句对话"
- 好的情节点描述：角色A发现了关于角色B的秘密，决定暗中调查。
- 差的情节点描述：角色A打开了门，看到角色B正在打电话。
- 让角色驱动情节——他们的欲望、恐惧、弱点、秘密是情节的引擎
- 利用角色之间的关系制造戏剧张力——爱恨、利益、阶级、秘密

### 大纲必须包含的元件
一个完整的小说大纲，必须指明以下内容：
1. **时间**：本章发生在什么时间段？延续前一章？跳跃了几天/几个月/几年？是春夏秋冬哪个季节？白天还是夜晚居多？
2. **空间**：本章发生在哪里？是一个地点还是跨越多个地点？地点之间是如何转换的？本章的空间场景跟前一章相比有什么变化？
3. **焦点角色**：本章以哪些角色为核心视角？为什么是这些角色——他们的哪条线索到了需要推进的时候？
4. **情节线**：本章要发生什么？这条情节线怎么从前一章自然延伸出来？怎么推向下一章的入口？
5. **角色发展**：本章焦点角色各自发生了什么变化？他们的关系、认知、处境有没有推进？
6. **伏笔布局**：本章埋下什么新线索？本章回收了什么旧线索？

### 关于角色线索
- 每个角色都需要在本章中有所发展，哪怕只是一小步
- 角色的发展必须与其核心目标、恐惧、弱点相关
- 不要让角色"停下来等剧情"——每个人都在为自己的目标行动

### 关于伏笔
- 主动建议可以埋入的新伏笔
- 如果活跃伏笔中有适合在本章推进或回收的，纳入情节点中
- 不要为了"用伏笔"而强行插入——只回收那些情节自然流向的伏笔

### 关于结构
- 章节需要有完整的叙事弧线：开场 → 发展 → 冲突升级/转折 → 收尾
- 收尾要有余韵——一个悬念、一句有分量的话、一个意象——而非机械的总结
- 节奏要与内容匹配：战斗/追逐用快节奏，心理描写/情感纠葛用慢节奏`
    : `You are an experienced novel outliner. Design the outline for the next chapter.

## Your Role
You are a novel outliner, not a screenwriter or beat designer. You think in terms of "what should this chapter contain," not "how to shoot this scene."

## Context
Written up to: ${continueFromLabel}
Next chapter: Chapter ${continueFromChapter + 1}
${previousProse ? `\n## Recent Prose\n${previousProse.slice(-500)}` : ""}

## Chapter Summaries
${summaryText}

## Characters (Current State)
${charSummaries}

${worldBible ? `## World\n- Period: ${worldBible.timePeriod}\n- Location: ${worldBible.location || "TBD"}\n- Power System: ${worldBible.powerSystem || "TBD"}\n- Atmosphere: ${worldBible.atmosphere || "TBD"}` : ""}

## Active Foreshadowing
${foreshadowingText}

## Author Notes
${authorText}

## Critical Rule: Focus
A strong chapter typically focuses on 2-3 characters, not all of them. Pick the 2-3 characters whose story threads most need advancing this chapter. Others stay "off-screen."

## Outline Must Include
1. **Time**: When does this chapter take place? Immediate continuation, or a time skip of days/months/years? Season? Time of day?
2. **Space**: Where does this chapter happen? Single location, or spanning multiple? How do characters move between spaces? How does the location change from the previous chapter?
3. **Focus Characters**: Which 2-3 characters are the core of this chapter? Why these characters — what thread needs advancing?
4. **Plot Line**: What happens? How does it naturally extend from the previous chapter and push toward the next?
5. **Character Development**: What changes for each focus character? How do their relationships, knowledge, or circumstances evolve?
6. **Foreshadowing**: What new threads to plant? Which existing ones to resolve?

## Output Format
Design 3-5 PLOT POINTS (not beats or actions). A plot point is "X discovers Y's secret and decides to investigate" — not "X opens a door and sees Y on the phone."
Complete narrative arc: opening → development → escalation → resolution.
Ending must leave resonance — suspense, a meaningful line, an image — not mechanical summary.
Pacing must match content: fast for action/combat, slow for psychological/emotional.`;

  const userPrompt = zh
    ? `请为第 ${continueFromChapter + 1} 章设计大纲。包括：

**本章时间/空间**
- 时间跨度和背景（是否跳跃？延续前一章？季节/昼夜特征？）
- 空间场景（在哪发生？单地点还是多地点？与前一章的空间变化？）

**本章焦点角色**
- 从所有角色中选出 2-3 个本章最需要推进线索的焦点角色
- 说明为什么选他们——哪条线索到了需要推进的时候

**核心情节**
- 章节标题（5-20字）
- 章节目标（要达成什么）
- 3-5个关键情节点（每个：描述、涉及角色、氛围）

**角色发展**
- 每个焦点角色的发展变化

**伏笔**
- 建议新埋的伏笔
- 建议回收的已有伏笔

**收尾与节奏**
- 情感弧线
- 章节收尾
- 节奏（fast/medium/slow）`
    : `Design the outline for Chapter ${continueFromChapter + 1}. Include: time/space context, 2-3 focus characters, 3-5 plot points, character development, foreshadowing, emotional arc, ending, pacing.`;

  console.log(`[OutlineAgent] Generating outline for chapter ${continueFromChapter + 1} (${characters.length} chars)...`);
  const t0 = Date.now();

  const result = await llm.chatWithTool<SceneOutline>(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    OUTLINE_SCHEMA,
    { temperature: 0.7, maxTokens: 2048 }
  );

  console.log(`[OutlineAgent] Done in ${Date.now() - t0}ms: "${result.chapterTitle || result.sceneTitle}"`);
  return { outline: result, prompt: { system: systemPrompt, user: userPrompt } };
}

// Backward compat — re-export old name
export { generateOutline as runOutlineWriter };
