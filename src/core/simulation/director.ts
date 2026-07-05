import type { CharacterProfile, SceneDefinition, SimulationRound, SceneOutline } from "@/types";
import { createLLMProvider } from "@/core/llm/factory";
import { isChinese } from "@/lib/utils";

// ============================================================
// Outline Writer — 编剧生成场景剧本大纲
// ============================================================

const OUTLINE_SCHEMA = {
  name: "scene_outline",
  description: "场景剧本大纲，规划整个场景的情节结构",
  parameters: {
    type: "object",
    properties: {
      sceneTitle: { type: "string", description: "场景标题（5-15字）" },
      sceneGoal: { type: "string", description: "场景目标：这个场景要达成什么（1-2句话）" },
      beats: {
        type: "array",
        minItems: 3,
        maxItems: 6,
        items: {
          type: "object",
          properties: {
            beatNumber: { type: "number", description: "节拍序号" },
            description: { type: "string", description: "这个节拍发生什么（1-2句话）" },
            activeCharacters: {
              type: "array",
              items: { type: "string" },
              description: "这个节拍涉及的角色名",
            },
            mood: { type: "string", description: "这个节拍的情绪/氛围" },
          },
          required: ["beatNumber", "description", "activeCharacters", "mood"],
        },
        description: "3-5个关键情节节拍",
      },
      emotionalArc: {
        type: "string",
        description: "情感弧线，描述从开场到结束的情绪变化（如：紧张→冲突→爆发→和解）",
      },
      sceneEnding: { type: "string", description: "场景如何收尾（1-2句话）" },
      estimatedRounds: { type: "number", description: "预计需要几轮完成（3-6）" },
    },
    required: ["sceneTitle", "sceneGoal", "beats", "emotionalArc", "sceneEnding", "estimatedRounds"],
  },
};

export interface DirectorDecision {
  sceneDevelopment: string;
  activeCharacters: string[];
  moodShift?: string;
  isSceneEnd: boolean;
}

/**
 * 导演在场景开始前先编写完整的剧本大纲。
 * 大纲包含场景目标、情节节拍、情感弧线和预计轮数。
 */
export async function runOutlineWriter(
  characters: CharacterProfile[],
  scene: SceneDefinition,
  previousProse?: string
): Promise<{ outline: SceneOutline; prompt: { system: string; user: string } }> {
  const llm = createLLMProvider();
  const zh = characters.length > 0 && isChinese(characters[0].personality.description);

  // Build character summaries — rich descriptions so the AI understands who these people are
  const charSummaries = characters
    .map((c) => {
      const traits = Array.isArray(c.personality.traits) ? c.personality.traits.join("、") : String(c.personality.traits || "");
      const values = Array.isArray(c.values) ? c.values.join("、") : String(c.values || "");
      const goal = c.drive?.goal || "";
      const weakness = c.drive?.weakness || "";
      const speaking = c.speakingStyle?.description || "";
      const worldview = c.worldview || "";
      const rels = (Array.isArray(c.relationships) ? c.relationships : [])
        .filter((r) => characters.some((sc) => sc.name === r.characterName))
        .map((r) => `${r.characterName}（${r.type}，${r.dynamics}）`)
        .join("；");
      return `【${c.name}】
  性格：${traits}。${c.personality.description}
  ${goal ? `目标：${goal}。` : ""}${weakness ? `弱点：${weakness}。` : ""}
  说话风格：${speaking}。${worldview ? `世界观：${worldview}。` : ""}
  ${rels ? `与在场角色的关系：${rels}` : ""}`;
    })
    .join("\n\n");

  const systemPrompt = zh
    ? `你是一位经验丰富的创意编剧。为你接手的这个场景构思一个精彩的剧本大纲。

## 场景
地点：${scene.location || "待定"}
时间：${scene.timeOfDay}
天气：${scene.weather}
氛围：${scene.atmosphere}
${scene.initialSituation ? `初始情境：${scene.initialSituation}` : ""}

## 出场角色
${charSummaries}

## 创作要求
- 设计 3-5 个连续的情节节拍，推动场景从开场走向一个有力的结局
- 每个节拍要利用角色之间的关系——冲突、结盟、背叛、谈判、揭露——让角色互动驱动剧情
- 情感弧线要有起伏：可以是紧张→爆发→缓和，也可以是平静→暗流→危机→转折
- 场景结局不能平淡收场——要有转折、揭示、危机升级、或角色关系的重大变化${previousProse ? `\n\n## 衔接前文\n${previousProse.slice(-300)}\n请在以上内容的基础上设计延续的场景。` : ""}`
    : `You are an experienced creative screenwriter. Design a compelling scene outline for the following setup.

## Scene
Location: ${scene.location || "TBD"}
Time: ${scene.timeOfDay}
Weather: ${scene.weather}
Atmosphere: ${scene.atmosphere}
${scene.initialSituation ? `Initial Situation: ${scene.initialSituation}` : ""}

## Characters
${charSummaries}

## Requirements
- Design 3-5 consecutive beats that drive the scene from opening to a decisive ending
- Each beat must exploit character relationships — conflict, alliance, betrayal, negotiation, revelation — let character dynamics drive the plot
- Emotional arc must have meaningful shape: rising tension, reversal, or earned resolution
- The ending must not be flat — it requires a twist, revelation, escalation, or significant relationship change${previousProse ? `\n\n## Previous Prose\n${previousProse.slice(-300)}\nContinue from here.` : ""}`;

  const userPrompt = zh
    ? `请为这个场景编写剧本大纲。包括：
1. 场景标题（5-15字）
2. 场景目标（这个场景要达成什么，1-2句话）
3. 3-5个情节节拍（每个节拍：描述、出场角色、氛围）
4. 情感弧线（从开场到结束的情绪变化，如"紧张→冲突→爆发→余波"）
5. 场景结局（如何收尾）
6. 预计轮数（3-6轮）`
    : `Write a scene outline with: 1. scene title, 2. scene goal, 3. 3-5 beats (description, active characters, mood), 4. emotional arc, 5. scene ending, 6. estimated rounds (3-6).`;

  console.log(`[OutlineWriter] Writing scene outline (zh=${zh}, chars=${characters.length})...`);
  const t0 = Date.now();

  const result = await llm.chatWithTool<SceneOutline>(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    OUTLINE_SCHEMA,
    { temperature: 0.7, maxTokens: 2048 }
  );

  console.log(`[OutlineWriter] Done in ${Date.now() - t0}ms: "${result.sceneTitle}" (${result.beats?.length || 0} beats, ${result.estimatedRounds} rounds)`);
  return { outline: result, prompt: { system: systemPrompt, user: userPrompt } };
}
