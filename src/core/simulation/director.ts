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
// Round Director — 基于大纲的逐轮导演
// ============================================================

const DIRECTOR_SCHEMA = {
  name: "director_decision",
  description: "Director's scene advancement decision",
  parameters: {
    type: "object",
    properties: {
      sceneDevelopment: {
        type: "string",
        description: "What happens next in the scene (1-3 sentences)",
      },
      activeCharacters: {
        type: "array",
        items: { type: "string" },
        description: "Names of characters who should react in this round",
      },
      moodShift: {
        type: "string",
        description: "How the mood or tension shifts in this beat",
      },
      isSceneEnd: {
        type: "boolean",
        description: "Whether the scene has reached a natural conclusion",
      },
    },
    required: ["sceneDevelopment", "activeCharacters", "isSceneEnd"],
  },
};

export async function runDirector(
  characters: CharacterProfile[],
  scene: SceneDefinition,
  previousRounds: SimulationRound[],
  outline?: SceneOutline | null
): Promise<DirectorDecision> {
  const llm = createLLMProvider();
  const systemPrompt = buildDirectorSystemPrompt(characters, scene);

  const zh = characters.length > 0 && isChinese(characters[0].personality.description);

  // Build outline context if available
  let outlineContext = "";
  if (outline?.beats?.length) {
    const currentBeatIndex = Math.min(previousRounds.length, outline.beats.length - 1);
    const upcomingBeats = outline.beats.slice(currentBeatIndex);

    outlineContext = zh
      ? `\n\n## 场景大纲（导演剧本）
- 场景目标：${outline.sceneGoal}
- 情感弧线：${outline.emotionalArc}
- 预计结局：${outline.sceneEnding}

### 节拍规划：
${outline.beats
  .map((b, i) => {
    const marker = i < currentBeatIndex ? "✅" : i === currentBeatIndex ? "▶️" : "⏳";
    return `${marker} 节拍${b.beatNumber}：${b.description} [出场: ${b.activeCharacters.join("、")}] [氛围: ${b.mood}]`;
  })
  .join("\n")}

### 当前进度
- 已完成 ${previousRounds.length} 轮 / 预计 ${outline.estimatedRounds} 轮
- 当前应推进到：${upcomingBeats[0] ? `节拍${upcomingBeats[0].beatNumber} — ${upcomingBeats[0].description}` : "场景收尾"}

请根据大纲推进场景。如果已到最后一个节拍或场景发展到了自然终点，设置 isSceneEnd: true。`
      : `\n\n## Scene Outline
- Goal: ${outline.sceneGoal}
- Arc: ${outline.emotionalArc}
- Ending: ${outline.sceneEnding}

Beats:
${outline.beats
  .map((b, i) => {
    const done = i < Math.min(previousRounds.length, outline.beats.length);
    return `${done ? "✅" : "⏳"} Beat ${b.beatNumber}: ${b.description} [Cast: ${b.activeCharacters.join(", ")}] [Mood: ${b.mood}]`;
  })
  .join("\n")}

Progress: ${previousRounds.length}/${outline.estimatedRounds} rounds done.
Follow this outline. Set isSceneEnd when appropriate.`;
  }

  // Build history context
  const historyContext =
    previousRounds.length > 0
      ? `\n\n${zh ? '## 目前为止发生的事' : '## WHAT HAS HAPPENED SO FAR'}\n${previousRounds
          .map(
            (r) =>
              `${zh ? '第' : 'Round '}${r.roundNumber}${zh ? '轮' : ''}:\n${r.directorAction}\n${r.characterResponses
                .map((cr) => `${cr.characterName}: "${cr.dialogue}" [${cr.actions}]`)
                .join("\n")}`
          )
          .join("\n\n")}`
      : "";

  const userPrompt = zh
    ? `现在是第${previousRounds.length === 0 ? "一" : "下一"}轮。
${previousRounds.length === 0 ? "请设置场景的开场。" : "根据已发生的事推进场景。"}
${outlineContext}${historyContext}

接下来发生什么？`
    : `It's time for the ${previousRounds.length === 0 ? "first" : "next"} round.
${previousRounds.length === 0 ? "Set the opening of the scene." : "Advance the scene with the next development."}
${outlineContext}${historyContext}

What happens next?`;

  return llm.chatWithTool<DirectorDecision>(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    DIRECTOR_SCHEMA,
    { temperature: 0.8, maxTokens: 500 }
  );
}
