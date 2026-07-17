import type { CharacterProfile, SceneDefinition, SceneOutline } from "@/types";
import type { ChapterSummary, ForeshadowingEntry } from "@/core/codex/types";
import { createLLMProvider } from "@/core/llm/factory";
import { isChinese } from "@/lib/utils";
import { renderPrompt } from "@/core/prompts/renderer";

// ============================================================
// Outline Agent — 小说大纲生成器
// ============================================================

const OUTLINE_SCHEMA = {
  name: "chapter_outline",
  description: "续写大纲，包含时间空间设定、焦点角色、情节点、伏笔、字数估算和章数规划",
  parameters: {
    type: "object",
    properties: {
      chapterTitle: { type: "string", description: "续写标题（5-20字）" },
      chapterGoal: { type: "string", description: "续写目标：这次续写要达成什么（1-2句话）" },
      estimatedWordCount: { type: "number", description: "预计续写字数（建议 2000-8000 字）" },
      estimatedChapters: { type: "number", description: "预计续写章数（建议 1-3 章）" },
      timeSpan: { type: "string", description: "时间跨度（例如：紧接前文、三日后、半月后、三年后）" },
      seasonAndTime: { type: "string", description: "季节与昼夜特征（例如：深秋的黄昏、盛夏的正午、冬夜的凌晨）" },
      locations: {
        type: "array",
        items: { type: "string" },
        description: "涉及的地点（例如：城东旧茶馆、荒野古战场、韩立洞府）",
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
  allowAdult?: boolean;
}, onEvent?: (event: any) => void): Promise<OutlineResult> {
  const { characters, continueFromChapter, continueFromLabel, chapterSummaries,
    activeForeshadowing, worldBible, authorNotes, previousProse, selectCharacters, allowAdult } = input;

  const llm = createLLMProvider("write");
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

  const systemPrompt = renderPrompt("outline-system.md", { selectionInstruction });
  const userPrompt = renderPrompt("outline-user.md", {
    continueFromLabel,
    previousProse: previousProse ? previousProse.slice(-500) : "",
    summaryText,
    charSummaries,
    worldBible,
    foreshadowingText,
    authorText,
  });
  const t0 = Date.now();
  const result = await llm.chatWithTool<SceneOutline>(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    OUTLINE_SCHEMA,
    { temperature: 0.4, maxTokens: 2048 }
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
