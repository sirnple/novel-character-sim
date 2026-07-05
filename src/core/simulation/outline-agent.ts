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

### 关于情节设计
- 设计 3-5 个关键情节点，每个情节点是"一段情节"的粒度，而非"一个动作"或"一句对话"
- 好的情节点描述：角色A发现了关于角色B的秘密，决定暗中调查。
- 差的情节点描述：角色A打开了门，看到角色B正在打电话。
- 让角色驱动情节——他们的欲望、恐惧、弱点、秘密是情节的引擎
- 利用角色之间的关系制造戏剧张力——爱恨、利益、阶级、秘密

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

## Guidelines
- Design 3-5 plot points at chapter level, not scene level
- Each character should have a meaningful development
- Propose new foreshadowing and identify which existing ones should be revealed
- Complete narrative arc: opening → development → escalation → resolution
- Pacing must match content`;

  const userPrompt = zh
    ? `请为第 ${continueFromChapter + 1} 章设计大纲。包括：
1. 章节标题
2. 章节目标
3. 3-5个关键情节点（每个：描述、涉及角色、氛围）
4. 各角色的发展线索
5. 建议新埋伏笔
6. 建议回收的伏笔
7. 情感弧线
8. 章节收尾
9. 节奏建议（fast/medium/slow）`
    : `Design the outline for Chapter ${continueFromChapter + 1}: 1. title, 2. goal, 3. 3-5 plot points, 4. character threads, 5. new foreshadowing, 6. foreshadowing to reveal, 7. emotional arc, 8. ending, 9. pacing.`;

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
