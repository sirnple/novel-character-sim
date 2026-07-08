// ============================================================
// Review Orchestrator — Run 6 parallel review agents
// ============================================================

import type { WritersCodex, ReviewReport, ReviewFinding, ProseAnnotation } from "./types";
import type { CharacterProfile } from "@/types";
import { createLLMProvider } from "@/core/llm/factory";
import { isChinese } from "@/lib/utils";

export interface SharedReviewContext {
  novelTitle: string;
  chapterNumber: number;
  outline: import("@/types").SceneOutline | null;
  scene: import("@/types").SceneDefinition;
  previousProse: string;
  characterStates: { name: string; currentLocation: string; currentEmotion: string; currentGoal: string }[];
  narrativeStyle: { pointOfView: string; tone: string; targetLength: string };
}

export function buildSharedReviewSystemPrompt(ctx: SharedReviewContext): string {
  const zh = isChinese(ctx.previousProse || ctx.scene.initialSituation || "");

  const beats = ctx.outline?.beats || ctx.outline?.plotPoints || [];
  const beatsText = beats.length > 0
    ? beats.map((b: any) => {
        const seq = b.beatNumber || b.sequence || "?";
        const desc = b.description || "";
        const chars = (b.activeCharacters || b.involvedCharacters || []).join("、");
        const mood = b.mood || "";
        return `  节拍${seq}：${desc} [出场：${chars}] [氛围：${mood}]`;
      }).join("\n")
    : "（无预设节拍）";

  const charStates = ctx.characterStates.length > 0
    ? ctx.characterStates.map(cs =>
        `- ${cs.name}：位置=${cs.currentLocation}, 情绪=${cs.currentEmotion}, 当前目标=${cs.currentGoal}`
      ).join("\n")
    : "（无角色状态数据）";

  const prevText = ctx.previousProse
    ? ctx.previousProse.slice(-2000)
    : "这是第一章，无前文";

  if (zh) {
    return `你是小说《${ctx.novelTitle}》的审查编辑。你正在审查第${ctx.chapterNumber}章的生成文字。

## 本章写作目标
- 场景目标/章节目标：${ctx.outline?.sceneGoal || ctx.outline?.chapterGoal || "（未指定）"}
- 情感弧线：${ctx.outline?.emotionalArc || "（未指定）"}
- 预期结尾：${ctx.outline?.sceneEnding || ctx.outline?.chapterEnding || "（未指定）"}
- 情节节拍：
${beatsText}
- 节奏要求：${ctx.outline?.pacing || "（未指定）"}

## 作者设定的场景
- 地点：${ctx.scene.location || "（未指定）"}
- 时间：${ctx.scene.timeOfDay}
- 天气：${ctx.scene.weather}
- 氛围：${ctx.scene.atmosphere}
- 初始情境：${ctx.scene.initialSituation || "（无）"}

## 前文上下文（承接点前的原文）
${prevText}

## 出场角色当前状态
${charStates}

## 叙事要求
- 视角：${ctx.narrativeStyle.pointOfView}
- 基调：${ctx.narrativeStyle.tone}
- 目标篇幅：${ctx.narrativeStyle.targetLength}`;
  }

  return `You are a review editor for "${ctx.novelTitle}". You are reviewing Chapter ${ctx.chapterNumber}.

## Chapter Writing Goals
- Goal: ${ctx.outline?.sceneGoal || ctx.outline?.chapterGoal || "(unspecified)"}
- Emotional Arc: ${ctx.outline?.emotionalArc || "(unspecified)"}
- Expected Ending: ${ctx.outline?.sceneEnding || ctx.outline?.chapterEnding || "(unspecified)"}
- Plot Beats:
${beatsText}
- Pacing: ${ctx.outline?.pacing || "(unspecified)"}

## Author's Scene Setting
- Location: ${ctx.scene.location || "(unspecified)"}
- Time: ${ctx.scene.timeOfDay}
- Weather: ${ctx.scene.weather}
- Atmosphere: ${ctx.scene.atmosphere}
- Initial Situation: ${ctx.scene.initialSituation || "(none)"}

## Previous Prose Context (before the continuation point)
${prevText}

## Character Current States
${charStates}

## Narrative Requirements
- Point of View: ${ctx.narrativeStyle.pointOfView}
- Tone: ${ctx.narrativeStyle.tone}
- Target Length: ${ctx.narrativeStyle.targetLength}`;
}

interface ReviewInput {
  generatedProse: string;
  codex: WritersCodex;
  chapterNumber: number;
  sharedSystemPrompt?: string;
}

const REVIEW_SCHEMA = {
  name: "review_findings",
  description: "Review findings for generated prose",
  parameters: {
    type: "object" as const,
    properties: {
      findings: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            severity: { type: "string" as const, enum: ["critical", "major", "minor"] },
            location: { type: "string" as const },
            description: { type: "string" as const },
            suggestion: { type: "string" as const },
            snippet: { type: "string" as const },
            autoFixable: { type: "boolean" as const },
            fixedText: { type: "string" as const },
          },
          required: ["severity", "description", "suggestion"],
        },
      },
      summary: { type: "string" as const },
    },
    required: ["findings", "summary"],
  },
};

/**
 * Run all 6 review dimensions in parallel against the generated prose.
 * Returns a merged report with auto-fixes applied.
 */
export async function runFullReview(input: ReviewInput): Promise<ReviewReport> {
  const llm = createLLMProvider();
  const zh = isChinese(input.generatedProse);

  // Run all 6 reviewers in parallel
  const results = await Promise.all([
    reviewCharacterConsistency(input, llm, zh),
    reviewContinuity(input, llm, zh),
    reviewForeshadowing(input, llm, zh),
    reviewStyle(input, llm, zh),
    reviewWorldBuilding(input, llm, zh),
    reviewPacing(input, llm, zh),
  ]);

  // Merge all findings
  const allFindings: ReviewFinding[] = [];
  const updatedStates: Partial<any>[] = [];
  const newForeshadowingList: any[] = [];
  const revealedForeshadowingList: string[] = [];
  let chapterSummary: any = null;

  for (const result of results) {
    if (result.findings) allFindings.push(...result.findings);
    if (result.stateUpdates) updatedStates.push(...result.stateUpdates);
    if (result.newForeshadowing) newForeshadowingList.push(...result.newForeshadowing);
    if (result.revealedForeshadowing) revealedForeshadowingList.push(...result.revealedForeshadowing);
    if (result.chapterSummary && !chapterSummary) chapterSummary = result.chapterSummary;
  }

  const autoFixed = allFindings.filter(f => f.autoFixable && f.fixedText && f.snippet);
  const needsHuman = allFindings.filter(
    f => !f.autoFixable && (f.severity === "critical" || f.severity === "major")
  );

  return {
    findings: allFindings,
    autoFixedCount: autoFixed.length,
    needsHumanReview: needsHuman,
    updatedStates,
    newForeshadowing: newForeshadowingList,
    revealedForeshadowing: revealedForeshadowingList,
    newChapterSummary: chapterSummary || {
      chapterNumber: input.chapterNumber,
      title: "",
      summary: input.generatedProse.slice(0, 200),
      keyEvents: [],
      characterChanges: {},
    },
  };
}

// ---- Individual Review Functions ----

interface ReviewResult {
  findings: ReviewFinding[];
  stateUpdates?: any[];
  newForeshadowing?: any[];
  revealedForeshadowing?: string[];
  chapterSummary?: any;
}

async function reviewCharacterConsistency(
  input: ReviewInput,
  llm: ReturnType<typeof createLLMProvider>,
  zh: boolean
): Promise<ReviewResult> {
  const chars = input.codex.characterDossiers;
  const charContext = chars.profiles
    .map(p => {
      const state = chars.currentStates.find(s => s.characterId === p.id);
      const qs = chars.quotes[p.name] || [];
      const quoteText = qs
        .slice(0, 3)
        .map(q => `[${q.emotion}]"${q.text}"`)
        .join(" | ");
      return `【${p.name}】`
        + `\n  性格: ${p.personality.traits.join("、")}`
        + `\n  说话风格: ${p.speakingStyle.description}`
        + `\n  口头禅: ${p.speakingStyle.catchphrases.join("、") || "无"}`
        + `\n  当前状态: ${state ? `${state.currentLocation}, ${state.currentEmotion}, 目标:${state.currentGoal}` : "未知"}`
        + (quoteText ? `\n  语录: ${quoteText}` : "");
    })
    .join("\n\n");

  const prompt = zh
    ? `你是角色一致性审查员。对照角色设定，检查生成文字中是否有角色行为/语言偏离设定。

## 角色设定
${charContext}

## 生成文字
${input.generatedProse.slice(0, 8000)}

注意：
- 角色可以在压力下做反常行为，前提是有场景铺垫
- 角色可以变化成长，但需要有迹可循
- 只报告明显的、无铺垫的断裂
- 没有问题返回空数组`

    : `You are a character consistency reviewer. Check the generated prose against character profiles for behavior/speech drift.\n\n## Characters\n${charContext}\n\n## Prose\n${input.generatedProse.slice(0, 8000)}`;

  const result = await llm.chatWithTool<any>(
    input.sharedSystemPrompt
      ? [
          { role: "system", content: input.sharedSystemPrompt },
          { role: "user", content: prompt }
        ]
      : [{ role: "user", content: prompt }],
    { ...REVIEW_SCHEMA, name: "character_review" },
    { temperature: 0.2, maxTokens: 4096 }
  );

  return {
    findings: (result.findings || []).map((f: any) => ({
      dimension: "character" as const,
      severity: f.severity,
      location: f.location || "",
      description: f.description,
      suggestion: f.suggestion,
      snippet: f.snippet,
      autoFixable: f.severity === "minor" && !!f.fixedText,
      fixedText: f.fixedText,
    })),
  };
}

async function reviewContinuity(
  input: ReviewInput,
  llm: ReturnType<typeof createLLMProvider>,
  zh: boolean
): Promise<ReviewResult> {
  const summaries = input.codex.narrativeContext.chapterSummaries
    .map(c => `第${c.chapterNumber}章: ${c.summary}`)
    .join("\n");
  const states = input.codex.characterDossiers.currentStates
    .map(s => `${s.name}: alive=${s.alive}, loc=${s.currentLocation}`)
    .join("\n");

  const prompt = zh
    ? `你是连贯性审查员。检查生成文字的逻辑矛盾和事实错误。

## 已知前文摘要
${summaries}

## 角色当前状态
${states}

## 生成文字
${input.generatedProse.slice(0, 8000)}

检查:
1. 已死亡或已离开场景的角色是否又出现并说话/行动
2. 物体或设定凭空出现（前文未提及的武器、物品等）
3. 因果链断裂（事件B发生了但缺乏前因）
4. 时间线矛盾（提到某事件"刚发生"但它其实在时间线更早）
5. 同一角色在同一场景说出矛盾的信息

只报告真实存在的问题。没有问题返回空数组。`

    : `You are a continuity reviewer. Check for logical contradictions in the generated prose vs established facts.\n\n## Chapter Summaries\n${summaries}\n\n## Character States\n${states}\n\n## Prose\n${input.generatedProse.slice(0, 8000)}`;

  const result = await llm.chatWithTool<any>(
    input.sharedSystemPrompt
      ? [
          { role: "system", content: input.sharedSystemPrompt },
          { role: "user", content: prompt }
        ]
      : [{ role: "user", content: prompt }],
    { ...REVIEW_SCHEMA, name: "continuity_review" },
    { temperature: 0.1, maxTokens: 4096 }
  );

  return {
    findings: (result.findings || []).map((f: any) => ({
      dimension: "continuity" as const,
      severity: f.severity,
      location: f.location || "",
      description: f.description,
      suggestion: f.suggestion,
      snippet: f.snippet,
      autoFixable: f.severity === "minor" && !!f.fixedText,
      fixedText: f.fixedText,
    })),
  };
}

async function reviewForeshadowing(
  input: ReviewInput,
  llm: ReturnType<typeof createLLMProvider>,
  zh: boolean
): Promise<ReviewResult> {
  const active = input.codex.foreshadowingLedger.active;
  if (active.length === 0) {
    return { findings: [] };
  }

  const activeList = active
    .map(
      f =>
        `[${f.type}] ${f.description} (第${f.plantedChapter}章埋入, 建议回收: ${f.suggestedRevealWindow})`
    )
    .join("\n");

  const prompt = zh
    ? `你是伏笔追踪员。检查生成文字中是否有伏笔被推进或回收。

## 活跃伏笔
${activeList}

## 生成文字
${input.generatedProse.slice(0, 8000)}

请识别:
1. 新埋的伏笔（描述、类型、建议回收窗口）
2. 已回收的活跃伏笔
3. 应该回收但未提及的伏笔`

    : `You are a foreshadowing tracker. Check if any active foreshadowing is advanced or resolved.\n\n## Active\n${activeList}\n\n## Prose\n${input.generatedProse.slice(0, 8000)}`;

  const schemaWithExtras = {
    ...REVIEW_SCHEMA,
    name: "foreshadowing_review",
    parameters: {
      type: "object" as const,
      properties: {
        ...REVIEW_SCHEMA.parameters.properties,
        newForeshadowing: {
          type: "array" as const,
          items: {
            type: "object" as const,
            properties: {
              type: { type: "string" as const },
              description: { type: "string" as const },
              suggestedRevealWindow: { type: "string" as const },
            },
          },
        },
        revealedForeshadowing: {
          type: "array" as const,
          items: { type: "string" as const },
        },
      },
    },
  };

  const result = await llm.chatWithTool<any>(
    input.sharedSystemPrompt
      ? [
          { role: "system", content: input.sharedSystemPrompt },
          { role: "user", content: prompt }
        ]
      : [{ role: "user", content: prompt }],
    schemaWithExtras,
    { temperature: 0.2, maxTokens: 4096 }
  );

  return {
    findings: (result.findings || []).map((f: any) => ({
      dimension: "foreshadowing" as const,
      severity: f.severity,
      location: f.location || "",
      description: f.description,
      suggestion: f.suggestion,
      snippet: f.snippet,
      autoFixable: f.severity !== "critical" && !!f.fixedText,
    })),
    newForeshadowing: result.newForeshadowing || [],
    revealedForeshadowing: result.revealedForeshadowing || [],
  };
}

async function reviewStyle(
  input: ReviewInput,
  llm: ReturnType<typeof createLLMProvider>,
  zh: boolean
): Promise<ReviewResult> {
  const fp = input.codex.styleProfiles.fingerprint;
  const styleGuide = [
    `类型: ${input.codex.styleProfiles.writingStyle?.genre || ""}`,
    `风格描述: ${input.codex.styleProfiles.writingStyle?.styleDescription || ""}`,
    `平均句长: ${fp.avgSentenceLength} 字`,
    `对话占比: ${Math.round(fp.dialogueRatio * 100)}%`,
    `常用句式开头: ${fp.commonOpeners.join("、")}`,
    `常用转折词: ${fp.commonConnectors.join("、")}`,
    `词汇层级: ${fp.vocabularyTier}`,
    `节奏特征: ${fp.pacingSignature}`,
  ].join("\n");

  const prompt = zh
    ? `你是风格一致性审查员。检查生成文字是否与原著风格指纹一致。

## 风格指纹
${styleGuide}

## 生成文字
${input.generatedProse.slice(0, 8000)}

检查:
1. 句长是否偏离（平均句长应与指纹接近）
2. 对话比例是否合理
3. 是否有AI味的公式化表达（如反复出现的套话、过度使用的感叹、机械的过渡词）
4. 句式是否单调重复
5. 与原著代表性片段的笔法是否一致

critical = 严重风格断裂（如古风小说突然出现现代网络用语）
major = 明显的风格不一致
minor = 可微调的措辞问题`

    : `You are a style consistency reviewer. Check if the generated prose matches the original style fingerprint.\n\n## Fingerprint\n${styleGuide}\n\n## Prose\n${input.generatedProse.slice(0, 8000)}`;

  const result = await llm.chatWithTool<any>(
    input.sharedSystemPrompt
      ? [
          { role: "system", content: input.sharedSystemPrompt },
          { role: "user", content: prompt }
        ]
      : [{ role: "user", content: prompt }],
    { ...REVIEW_SCHEMA, name: "style_review" },
    { temperature: 0.2, maxTokens: 4096 }
  );

  return {
    findings: (result.findings || []).map((f: any) => ({
      dimension: "style" as const,
      severity: f.severity,
      location: f.location || "",
      description: f.description,
      suggestion: f.suggestion,
      snippet: f.snippet,
      autoFixable: f.severity === "minor" && !!f.fixedText,
      fixedText: f.fixedText,
    })),
  };
}

async function reviewWorldBuilding(
  input: ReviewInput,
  llm: ReturnType<typeof createLLMProvider>,
  zh: boolean
): Promise<ReviewResult> {
  const w = input.codex.worldBible;

  const prompt = zh
    ? `你是世界观一致性审查员。检查生成文字是否违反世界观设定。

## 世界观设定
- 时代背景: ${w.timePeriod}
- 主要地点: ${w.location}
- 社会结构: ${w.socialStructure}
- 力量体系: ${w.powerSystem}
- 势力/门派: ${w.factions.join("、")}
- 世界规则: ${w.rules.join("、")}

## 生成文字
${input.generatedProse.slice(0, 8000)}

检查:
1. 力量体系规则是否被打破（如修仙小说中突然出现科技武器）
2. 社会结构是否被违反（如等级森严的世界中平民对皇帝不敬却无后果）
3. 势力关系是否正确
4. 地点描述是否与设定矛盾`

    : `You are a world-building consistency reviewer. Check if the generated prose violates world rules.\n\n## World\n${JSON.stringify(w)}\n\n## Prose\n${input.generatedProse.slice(0, 8000)}`;

  const result = await llm.chatWithTool<any>(
    input.sharedSystemPrompt
      ? [
          { role: "system", content: input.sharedSystemPrompt },
          { role: "user", content: prompt }
        ]
      : [{ role: "user", content: prompt }],
    { ...REVIEW_SCHEMA, name: "world_review" },
    { temperature: 0.1, maxTokens: 4096 }
  );

  return {
    findings: (result.findings || []).map((f: any) => ({
      dimension: "world" as const,
      severity: f.severity,
      location: f.location || "",
      description: f.description,
      suggestion: f.suggestion,
      snippet: f.snippet,
      autoFixable: f.severity === "minor" && !!f.fixedText,
      fixedText: f.fixedText,
    })),
  };
}

async function reviewPacing(
  input: ReviewInput,
  llm: ReturnType<typeof createLLMProvider>,
  zh: boolean
): Promise<ReviewResult> {
  const prompt = zh
    ? `你是节奏审查员。检查生成文字是否符合要求的节奏和冲突强度。

## 要求
- 节奏: ${input.codex.currentTask.pacing}
- 冲突类型: ${input.codex.currentTask.conflictType}
- 故事节点: ${input.codex.currentTask.storyBeat}
- 赌注: ${input.codex.currentTask.stakes}

## 生成文字
${input.generatedProse.slice(0, 8000)}

检查:
1. 节奏是否与要求一致（fast=紧凑短句/medium=正常推进/slow=从容铺陈）
2. 冲突强度是否与故事节点匹配（高潮前的铺垫/冲突爆发/收尾释放）
3. 是否拖沓（关键情节被无关描写淹没）或过于仓促（重要转折一笔带过）`

    : `You are a pacing reviewer. Check if the generated prose pacing matches requirements.\n\n## Requirements\n- Pacing: ${input.codex.currentTask.pacing}\n- Conflict: ${input.codex.currentTask.conflictType}\n- Beat: ${input.codex.currentTask.storyBeat}\n\n## Prose\n${input.generatedProse.slice(0, 8000)}`;

  const result = await llm.chatWithTool<any>(
    input.sharedSystemPrompt
      ? [
          { role: "system", content: input.sharedSystemPrompt },
          { role: "user", content: prompt }
        ]
      : [{ role: "user", content: prompt }],
    { ...REVIEW_SCHEMA, name: "pacing_review" },
    { temperature: 0.2, maxTokens: 4096 }
  );

  return {
    findings: (result.findings || []).map((f: any) => ({
      dimension: "pacing" as const,
      severity: f.severity,
      location: f.location || "",
      description: f.description,
      suggestion: f.suggestion,
      snippet: f.snippet,
      autoFixable: f.severity === "minor" && !!f.fixedText,
      fixedText: f.fixedText,
    })),
  };
}

/**
 * Rewrite prose to fix all auto-fixable review findings.
 * Returns corrected prose, or original if no auto-fixable findings exist.
 */
export async function rewriteProse(
  originalProse: string,
  findings: ReviewFinding[],
  _codex: WritersCodex
): Promise<string> {
  const autoFixable = findings.filter(f => f.autoFixable && f.snippet && f.suggestion);

  if (autoFixable.length === 0) {
    return originalProse;
  }

  const llm = createLLMProvider();
  const zh = isChinese(originalProse);

  const findingsText = autoFixable.map((f, i) =>
    `${i + 1}. [${f.dimension}] ${f.description}\n   问题片段: "${f.snippet}"\n   修改建议: ${f.suggestion}${f.fixedText ? `\n   建议修改为: "${f.fixedText}"` : ""}`
  ).join("\n\n");

  const prompt = zh
    ? `你是小说续写的修订编辑。请根据以下审查发现的问题，重写整段文字，修复所有标记的问题。

## 需要修复的问题
${findingsText}

## 原文
${originalProse}

## 修订要求
- 修复以上所有问题
- 保持叙事流畅、风格一致、角色声音不变
- 不修改与问题无关的内容
- 直接输出修订后的完整文字，不要用JSON包裹`
    : `You are a prose revision editor. Rewrite the text below fixing all flagged issues.

## Issues to Fix
${findingsText}

## Original Prose
${originalProse}

## Requirements
- Fix all issues listed above
- Maintain narrative flow and style consistency
- Do not change content unrelated to flagged issues
- Output the complete revised prose directly, no JSON wrapper`;

  const corrected = await llm.chat(
    [{ role: "user", content: prompt }],
    { temperature: 0.4, maxTokens: 16384 }
  );

  return corrected || originalProse;
}

/**
 * Generate annotation cards from review findings.
 * Each annotation shows the original snippet vs corrected text.
 */
export function generateAnnotations(
  findings: ReviewFinding[]
): ProseAnnotation[] {
  return findings.map(f => ({
    id: Math.random().toString(36).slice(2, 10),
    finding: f,
    originalSnippet: f.snippet || "",
    fixedSnippet: f.fixedText || "",
  }));
}
