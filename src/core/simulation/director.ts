import type { CharacterProfile, SceneDefinition, SimulationRound, SceneOutline } from "@/types";
import { createLLMProvider } from "@/core/llm/factory";
import { buildDirectorSystemPrompt } from "./types";
import { isChinese } from "@/lib/utils";

// ============================================================
// Outline Writer — 导演先编写场景剧本大纲
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
): Promise<SceneOutline> {
  const llm = createLLMProvider();
  const zh = characters.length > 0 && isChinese(characters[0].personality.description);

  // Build character summaries
  const charSummaries = characters
    .map((c) => {
      const traits = c.personality.traits.join("、");
      const rels = c.relationships
        .filter((r) => characters.some((sc) => sc.name === r.characterName))
        .map((r) => `${r.characterName}（${r.type}）`)
        .join("、");
      return `【${c.name}】性格：${traits}。${c.personality.description} 价值观：${c.values.join("、")}。${rels ? ` 与在场角色的关系：${rels}` : ""}`;
    })
    .join("\n\n");

  const systemPrompt = zh
    ? `你是一位经验丰富的编剧。为以下场景设计一个紧凑的剧本大纲。

## 场景设定
- 地点：${scene.location}
- 时间：${scene.timeOfDay}
- 天气：${scene.weather}
- 氛围：${scene.atmosphere}
- 初始情境：${scene.initialSituation}
- 情节类型：${scene.plot.conflictType || "未指定"}
- 故事节点：${scene.plot.storyBeat || "未指定"}
- 赌注：${scene.plot.stakes || "未指定"}

## 出场角色
${charSummaries}

## 要求
- 设计 3-5 个紧凑的情节节拍，每个节拍推动场景向结局发展
- 情感弧线要有起伏，避免平铺直叙
- 每个节拍明确指定出场的角色
- 场景结局要有力度：可以是转折、揭示、冲突升级或暂时平静
${previousProse ? `\n## 已有前文\n${previousProse.slice(-300)}\n请在此基础上延续场景。` : ""}`
    : `You are an experienced screenwriter. Design a compact scene outline.

## Scene
- Location: ${scene.location}
- Time: ${scene.timeOfDay}
- Weather: ${scene.weather}
- Atmosphere: ${scene.atmosphere}
- Situation: ${scene.initialSituation}

## Characters
${charSummaries}

## Requirements
- Design 3-5 tight beats
- Each beat specifies which characters are involved
- Clear emotional arc
- Strong ending${previousProse ? `\n\n## Previous prose\n${previousProse.slice(-300)}` : ""}`;

  const userPrompt = zh
    ? `请为这个场景编写剧本大纲。包括：
1. 场景标题
2. 场景目标
3. 3-5个情节节拍（每个节拍：描述、出场角色、氛围）
4. 情感弧线
5. 场景结局
6. 预计轮数`
    : `Write a scene outline with title, goal, 3-5 beats, emotional arc, ending, and estimated rounds.`;

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
  return result;
}

// ============================================================
// Round Director — 调度者，不写叙述
// ============================================================

export interface DirectorDecision {
  beatNumber: number;          // 当前推进大纲第几个节拍
  focusCharacter: string;      // 本轮 POV 角色名
  moodTone: string;            // 本轮情绪基调
  pacing: "fast" | "medium" | "slow";
  conflictIntensity: number;   // 1-10
  activeCharacters: string[];  // 需要回应的角色
  isSceneEnd: boolean;
}

const DIRECTOR_SCHEMA = {
  name: "director_decision",
  description: "Director's scheduling decision — who speaks, what mood, what beat",
  parameters: {
    type: "object",
    properties: {
      beatNumber: {
        type: "number",
        description: "当前推进大纲第几个节拍（1-based）。若没有大纲则填当前轮次。",
      },
      focusCharacter: {
        type: "string",
        description: "本轮聚焦的角色名——以谁的主观视角来展开这一轮",
      },
      moodTone: {
        type: "string",
        description: "本轮情绪基调，如：紧张、温情、压抑、爆发、暧昧、绝望",
      },
      pacing: {
        type: "string",
        enum: ["fast", "medium", "slow"],
        description: "节奏：fast=快节奏短对话冲突升级，medium=正常推进，slow=内心独白氛围铺垫",
      },
      conflictIntensity: {
        type: "number",
        minimum: 1,
        maximum: 10,
        description: "当前冲突强度 1-10。1=风平浪静，5=暗流涌动，10=全面爆发",
      },
      activeCharacters: {
        type: "array",
        items: { type: "string" },
        description: "本轮应该回应的角色名列表",
      },
      isSceneEnd: {
        type: "boolean",
        description: "场景是否达到自然终点",
      },
    },
    required: ["beatNumber", "focusCharacter", "moodTone", "pacing", "conflictIntensity", "activeCharacters", "isSceneEnd"],
  },
};

export async function runDirector(
  characters: CharacterProfile[],
  scene: SceneDefinition,
  previousRounds: SimulationRound[],
  outline?: SceneOutline | null
): Promise<DirectorDecision> {
  const llm = createLLMProvider();
  const zh = characters.length > 0 && isChinese(characters[0].personality.description);

  // Build system prompt with strong scheduling-only constraint
  const systemPrompt = buildDirectorSystemPrompt(characters, scene);

  // Build outline context
  let outlineContext = "";
  if (outline?.beats?.length) {
    const currentBeatIndex = Math.min(previousRounds.length, outline.beats.length - 1);

    outlineContext = zh
      ? `\n## 场景大纲
目标：${outline.sceneGoal}
情感弧线：${outline.emotionalArc}
结局：${outline.sceneEnding}

节拍进度：
${outline.beats.map((b, i) => {
  const marker = i < currentBeatIndex ? "✅" : i === currentBeatIndex ? "▶️ 当前" : "⏳";
  return `${marker} 节拍${b.beatNumber}：${b.description} [出场: ${b.activeCharacters.join("、")}] [氛围: ${b.mood}]`;
}).join("\n")}

已完成 ${previousRounds.length} 轮 / 预计 ${outline.estimatedRounds} 轮。严格按节拍顺序推进。当前应该推进节拍 ${outline.beats[Math.min(previousRounds.length, outline.beats.length - 1)]?.beatNumber || 1}。`
      : `\n## Outline\nGoal: ${outline.sceneGoal}\nBeats: ${outline.beats.map((b) => `Beat ${b.beatNumber}: ${b.description} [${b.activeCharacters.join(", ")}]`).join(" | ")}\nProgress: ${previousRounds.length}/${outline.estimatedRounds}`;
  }

  // Build scene plot context
  const plotContext = zh
    ? `\n## 情节约束（必须遵循）
- 冲突类型：${scene.plot.conflictType || "未指定"}
- 故事节点：${scene.plot.storyBeat || "未指定"}
- 关键事件：${scene.plot.keyEvent || "未指定"}
- 赌注：${scene.plot.stakes || "未指定"}
- 情感弧线：${scene.plot.emotionalArc || "未指定"}`
    : "";

  // Build history
  const historyContext = previousRounds.length > 0
    ? `\n\n## 之前的轮次\n${previousRounds.map((r) =>
        `${zh ? '第' : 'R'}${r.roundNumber}${zh ? '轮' : ''}: ${zh ? '聚焦' : 'Focus'} ${r.characterResponses[0]?.characterName || '?'} | ${zh ? '情绪' : 'Mood'}: ${r.directorAction}`).join("\n")}`
    : "";

  const userPrompt = zh
    ? `你是调度者，不是叙述者。不要写叙事文字。

${outlineContext}${plotContext}${historyContext}

第 ${previousRounds.length + 1} 轮。请调度这一轮：
- 当前推大纲第几个节拍？
- 以谁的视角展开？
- 情绪基调是什么？
- 节奏快慢？
- 冲突强度 1-10？
- 哪些角色需要回应？

只有场景的戏剧弧线真正完结（冲突已解决、情感已释放、没有更多可发展的）时才设 isSceneEnd: true。即使大纲节拍已全部完成，如果还有戏剧张力，就继续。宁可多一轮也不要草率结束。`
    : `You are the SCHEDULER, not the narrator. Do NOT write narrative.

${outlineContext}${plotContext}${historyContext}

Round ${previousRounds.length + 1}. Schedule this round: beatNumber, focusCharacter, moodTone, pacing, conflictIntensity (1-10), activeCharacters, isSceneEnd.`;

  return llm.chatWithTool<DirectorDecision>(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    DIRECTOR_SCHEMA,
    { temperature: 0.7, maxTokens: 400 }
  );
}
