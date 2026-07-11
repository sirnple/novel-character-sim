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
export async function runFullReview(input: ReviewInput, onEvent?: (event: any) => void): Promise<ReviewReport> {
  const llm = createLLMProvider();
  const zh = isChinese(input.generatedProse);

  function emitReviewAgent(agentId: string, name: string, status: "running" | "done", messages?: any[]) {
    if (onEvent) onEvent({ type: "agent", agentId, name, status, messages });
  }

  // Run all 6 reviewers in parallel
  const agentDefs = [
    { id: "review_char", name: "角色一致性", fn: reviewCharacterConsistency },
    { id: "review_cont", name: "连贯性", fn: reviewContinuity },
    { id: "review_fore", name: "伏笔追踪", fn: reviewForeshadowing },
    { id: "review_style", name: "风格", fn: reviewStyle },
    { id: "review_world", name: "世界观", fn: reviewWorldBuilding },
    { id: "review_pace", name: "节奏", fn: reviewPacing },
  ];

  const results = await Promise.all(
    agentDefs.map(async (def) => {
      emitReviewAgent(def.id, def.name, "running");
      const r = await def.fn(input, llm, zh);
      emitReviewAgent(def.id, def.name, "done", [
        { role: "system", content: input.sharedSystemPrompt || "" },
        { role: "user", content: def.name + "审查" },
        { role: "assistant", content: JSON.stringify(r.findings) },
      ]);
      return r;
    })
  );

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

  const needsHuman = allFindings.filter(f => f.severity === "critical");

  return {
    findings: allFindings,
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

interface CleanReviewResult {
  findings: ReviewFinding[];
  converged: boolean;
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
        + `\n  性格: ${p.personality.traits?.join?.("、") || p.personality.traits || ""}`
        + `\n  说话风格: ${p.speakingStyle.description}`
        + `\n  口头禅: ${p.speakingStyle.catchphrases?.join?.("、") || p.speakingStyle.catchphrases || "无"}`
        + `\n  当前状态: ${state ? `${state.currentLocation}, ${state.currentEmotion}, 目标:${state.currentGoal}` : "未知"}`
        + (quoteText ? `\n  语录: ${quoteText}` : "");
    })
    .join("\n\n");

  const prompt = zh
    ? `你是角色一致性审查员。你的工作是检查生成文字中角色的行为和对话是否与他们的性格设定一致。

### 严重级别
- **critical** = 角色行为与其核心人格彻底矛盾（如一个胆小的角色突然主动挑衅强者），且场景完全没有铺垫这种变化
- **major** = 角色的说话风格明显偏离设定（如口头禅消失、句式突然改变），但行为大致合理。或者驱动力相关的矛盾
- **minor** = 措辞微调问题（如用语偏向但仍在角色可接受范围），可以是自动修正

### 检查清单
1. 角色的行为是否符合其性格特征和驱动力
2. 角色的对话是否匹配其说话风格和口头禅
3. 角色是否在未铺垫的情况下做了与其恐惧/底线冲突的事
4. 角色的决策是否与其核心目标一致
5. 角色在压力下的反应是否符合其档案中描述的模式

### 注意
- 角色在极度情绪下可以暂时偏离日常风格，有场景铺垫的突破是合理的
- 角色可以成长和变化，但需要有迹可循（由前文事件驱动，而非凭空）
- 只报告明显的、无铺垫的断裂。有铺垫的角色变化不是问题

## 审查标准示例
### 正确 finding 示例
{"findings":[{"severity":"major","location":"第3段","description":"张小凡说'没问题，我来承担'，但他的人设是极度缺乏自信、遇事退缩。此处没有铺垫他为什么会突然变得有担当。","suggestion":"改为他犹豫片刻后低声说'我试试'，或者在前文加入他被师父训话后决定改变的铺垫","snippet":"张小凡点点头：\"没问题，我来承担。\"","autoFixable":true,"fixedText":"张小凡低下头，犹豫了好一会儿，才低声道：\"我...我试试。\""}]}

### 错误 finding 示例（不要报）
不报：角色在极度愤怒时说了一句不符合日常风格的重话。
原因：角色在强烈情绪下可以暂时偏离常态，这是合理的戏剧表达，不是角色断裂。

## 角色设定
${charContext}

## 审查任务
以下是需要审查的生成文字：
${input.generatedProse.slice(0, 8000)}

请输出你的审查发现。没有发现则返回空数组。`

    : `You are a character consistency reviewer. Your job is to check whether the characters' behavior and dialogue in the generated prose are consistent with their established profiles.

### Severity Levels
- **critical** = The character's behavior fundamentally contradicts their core personality (e.g., a timid character suddenly and unprovokedly challenges a powerful opponent), with no scene groundwork to justify the shift
- **major** = The character's speaking style noticeably deviates from their profile (e.g., signature catchphrase absent, sentence structure suddenly changed), but general behavior is roughly reasonable. Or a motivation-related contradiction
- **minor** = Subtle wording issues (e.g., diction leans slightly away from the character's normal register but is still within acceptable range), can be auto-fixed

### Checklist
1. Does the character's behavior match their personality traits and driving motivations?
2. Does the character's dialogue match their speaking style and catchphrases?
3. Does the character act against their established fears or boundaries without adequate scene groundwork?
4. Are the character's decisions consistent with their core goals?
5. Does the character's reaction under pressure match the patterns described in their profile?

### Notes
- Characters under extreme emotion may temporarily deviate from their everyday style; breakthroughs with scene groundwork are legitimate
- Characters can grow and change, but it must be traceable (driven by prior events, not out of nowhere)
- Only report clear, unestablished breaks. A justified character shift is not an issue

## Review Standard Examples
### Correct Finding Example
{"findings":[{"severity":"major","location":"Paragraph 3","description":"Zhang Xiaofan says 'No problem, I'll take responsibility,' but his profile is extreme lack of confidence and avoidance of confrontation. There is no groundwork explaining why he would suddenly be so assertive.","suggestion":"Change to him hesitating and whispering 'I'll try,' or add a preceding scene where he resolves to change after being reprimanded by his master","snippet":"Zhang Xiaofan nodded: \"No problem, I'll take responsibility.\"","autoFixable":true,"fixedText":"Zhang Xiaofan lowered his head, hesitated for a long moment, then whispered: \"I... I'll try.\""}]}

### Wrong Finding Example (Do Not Report)
Do not report: A character says something harsher than usual in a moment of extreme anger.
Why: Characters under strong emotion can temporarily deviate from their norm. This is legitimate dramatic expression, not a character break.

## Characters
${charContext}

## Review Task
Below is the generated prose to review:
${input.generatedProse.slice(0, 8000)}

Output your review findings. Return an empty array if no issues found.`

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
    })),
  };
}

async function reviewCharacterConsistencyClean(
  fullNovelText: string,
  generatedProse: string,
  llm: ReturnType<typeof createLLMProvider>,
  zh: boolean
): Promise<CleanReviewResult> {
  const prompt = zh
    ? `## 审查指南
你是角色一致性审查员。对照原文中角色的性格和说话方式，检查生成文字中是否有角色行为/语言偏离设定。只基于原文判断，不要凭空假设。

### 严重级别
- **critical** = 角色行为与其在原文中展现的核心人格彻底矛盾，且生成文字中无任何铺垫
- **major** = 说话风格明显偏离原文中该角色的习惯（如口头禅消失、句式突变）
- **minor** = 措辞微调问题，不影响整体角色一致性

### 收敛判断
如果生成文字中的角色表现与原文高度一致，设置 converged: true。
即使有 minor 级别的问题，如果它们不影响整体角色一致性，也可以设置 converged: true。
只有当存在 critical 或 major 级别的问题时，才设置 converged: false。

## 原文（角色在原文中的全部表现）
${fullNovelText.slice(0, 60000)}

## 生成文字
${generatedProse.slice(0, 8000)}

请输出你的审查发现和收敛判断。没有发现则返回空数组并设置 converged: true。`

    : `## Review Guidelines
You are a character consistency reviewer. Check the generated prose against how characters behave and speak in the original text. Judge only from the original text, don't assume.

### Severity
- **critical** = Character acts completely contrary to core personality shown in original, with no setup
- **major** = Speaking style noticeably deviates from patterns in original
- **minor** = Minor diction refinement, doesn't affect overall consistency

### Convergence
Set converged: true if character portrayal is highly consistent with original. Minor issues don't prevent convergence.
Only set converged: false for critical or major issues.

## Original Text
${fullNovelText.slice(0, 60000)}

## Generated Prose
${generatedProse.slice(0, 8000)}

Output your findings and convergence judgment. Return empty findings and converged: true if nothing to report.`;

  const schema = {
    name: "character_review_clean",
    description: "Review findings for character consistency in clean mode",
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
            },
            required: ["severity", "description", "suggestion"],
          },
        },
        converged: { type: "boolean" as const },
      },
      required: ["findings", "converged"],
    },
  };

  const result = await llm.chatWithTool<any>(
    [{ role: "user", content: prompt }],
    schema,
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
    })),
    converged: result.converged ?? (result.findings || []).length === 0,
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

### 严重级别
- **critical** = 已死亡的角色出现并行动；关键事实与已建立的事件链矛盾；前文明确否定的事件被当作事实
- **major** = 物品或信息凭空出现（前文未提及）；角色知道了他不应该知道的信息；因果链断裂（事件B发生了但缺乏前因）
- **minor** = 细节不一致但不对情节逻辑产生实质性影响（如配角名字笔误等）

### 检查清单
1. 已死亡或已离开场景的角色是否又出现并说话/行动
2. 物体或设定是否凭空出现（前文未提及的武器、物品等）
3. 因果链是否断裂（事件B发生了但缺乏前因）
4. 时间线是否矛盾（提到某事件"刚发生"但它其实在时间线更早）
5. 同一角色在同一场景中是否说出了矛盾的信息
6. 角色是否知道了他们不应该知道的信息（跨场景信息泄露）
7. 开头是否与前文自然接续——不能以章节标题（如"# 第一章"、"第X章"）或完全无关的场景突兀起笔

## 审查标准示例
### 正确 finding 示例
{"findings":[{"severity":"critical","location":"第5段","description":"林震南在此场景中出现并与主角说话，但他在第12章已被确认死亡。","suggestion":"移除林震南，改用其他在世角色传达此信息，或将其改为回忆/闪回场景","snippet":"林震南从门外走进来，笑道：\"好久不见。\"","snippet":"","suggestion":""}]}

### 错误 finding 示例（不要报）
不报：客栈布局中院子在左侧但上一章说是右侧的细节不一致。
原因：这类细节不一致不影响情节逻辑，属于可容忍的笔误，不应作为审查问题报告。只报告对情节有实质影响的矛盾。

## 已知前文摘要
${summaries}

## 角色当前状态
${states}

## 审查任务
以下是需要审查的生成文字：
${input.generatedProse.slice(0, 8000)}

请输出你的审查发现。没有发现则返回空数组。`

    : `You are a continuity reviewer. Check for logical contradictions in the generated prose versus established facts.

### Severity Levels
- **critical** = A dead character appears and acts; a key fact contradicts the established event chain; an event previously definitively negated is treated as fact
- **major** = An object or piece of information appears from nowhere; a character knows information they should not have; the causal chain is broken (event B happens without any preceding cause)
- **minor** = Detail inconsistencies that do not materially affect plot logic (e.g., a side character's name typo)

### Checklist
1. Does a dead or departed character reappear and speak/act?
2. Do objects or established facts appear from nowhere (weapons, items not previously mentioned)?
3. Is the causal chain broken (event B occurs without adequate preceding cause)?
4. Are there timeline contradictions (an event said to have "just happened" but it occurred earlier in the timeline)?
5. Does the same character give contradictory information within the same scene?
6. Does a character know information they should not (cross-scene information leak)?

## Review Standard Examples
### Correct Finding Example
{"findings":[{"severity":"critical","location":"Paragraph 5","description":"Lin Zhennan appears in this scene and speaks with the protagonist, but he was confirmed dead in Chapter 12.","suggestion":"Remove Lin Zhennan and use another living character to convey this information, or reframe the scene as a memory/flashback","snippet":"Lin Zhennan walked in from the doorway, smiling: \"Long time no see.\"","autoFixable":false}]}

### Wrong Finding Example (Do Not Report)
Do not report: The inn's courtyard is on the left in this scene, but the previous chapter described it as being on the right.
Why: This kind of minor detail inconsistency does not affect plot logic. It is a tolerable writing error and should not be reported as a review finding. Only report contradictions that materially impact the plot.

## Chapter Summaries
${summaries}

## Character States
${states}

## Review Task
Below is the generated prose to review:
${input.generatedProse.slice(0, 8000)}

Output your review findings. Return an empty array if no issues found.`

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
    })),
  };
}

async function reviewContinuityClean(
  fullNovelText: string,
  generatedProse: string,
  llm: ReturnType<typeof createLLMProvider>,
  zh: boolean
): Promise<CleanReviewResult> {
  const prompt = zh
    ? `## 审查指南
你是连贯性审查员。检查生成文字是否与原文中已建立的事实存在逻辑矛盾。

### 严重级别
- **critical** = 关键事实与原文矛盾（已死角色出现、事件链断裂）
- **major** = 信息凭空出现、角色知道不该知道的信息
- **minor** = 细节不一致但不影响情节逻辑

### 收敛判断
如果生成文字与原文在所有事实上一致，设置 converged: true。

## 原文
${fullNovelText.slice(0, 60000)}

## 生成文字
${generatedProse.slice(0, 8000)}

请输出审查发现和收敛判断。`

    : `## Review Guidelines
You are a continuity reviewer. Check the generated prose against established facts in the original text.

### Severity
- **critical** = Key facts contradict original
- **major** = Info appears from nowhere
- **minor** = Minor inconsistencies

### Convergence
Set converged: true if the prose is factually consistent with the original.

## Original
${fullNovelText.slice(0, 60000)}

## Generated Prose
${generatedProse.slice(0, 8000)}

Output your findings and convergence judgment.`;

  const result = await llm.chatWithTool<any>(
    [{ role: "user", content: prompt }],
    { name: "continuity_review_clean", description: "Review findings for continuity in clean mode", parameters: { type: "object" as const, properties: { findings: { type: "array" as const, items: { type: "object" as const, properties: { severity: { type: "string" as const, enum: ["critical", "major", "minor"] }, location: { type: "string" as const }, description: { type: "string" as const }, suggestion: { type: "string" as const }, snippet: { type: "string" as const } }, required: ["severity", "description", "suggestion"] } }, converged: { type: "boolean" as const } }, required: ["findings", "converged"] } },
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
    })),
    converged: result.converged ?? (result.findings || []).length === 0,
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
    ? `你是伏笔追踪员。追踪已埋入的伏笔在生成文字中的推进、回收情况，以及新埋的伏笔。

### 严重级别
- **critical** = 应在此场景中回收或推进的重要伏笔被完全忽略
- **major** = 伏笔回收与原埋入条件矛盾（如埋入时暗示由A角色发现，结果被B随意提了一嘴）；或回收方式过于敷衍
- **minor** = 伏笔有轻微推进但不够清晰，读者可能注意不到

### 检查清单
1. 生成文字中是否埋入了新的伏笔（描述、类型、建议回收窗口）
2. 活跃伏笔是否在生成文字中被推进或回收
3. 是否有应该在本章回收（基于建议回收窗口）但未提及的伏笔
4. 伏笔的回收方式是否与原始埋入条件匹配

## 审查标准示例
### 正确 finding 示例
{"findings":[{"severity":"major","location":"全文","description":"活跃伏笔'古玉的秘密'（第5章埋入，建议在第9-11章回收）在此场景中完全没有提及。主角经过古战场遗址时理应有线索推进。","suggestion":"在主角经过古战场时加入一段：玉牌微微发热，让他停下脚步——可以向读者暗示玉与古战场的关联","snippet":"但他只是匆匆穿过废墟，没有多看一眼。","autoFixable":true,"fixedText":"但他穿过废墟时，怀中的玉牌忽然微微一热，让他不由得停下脚步——只是一瞬，热度便消失了。他皱眉摸了摸胸口，心中泛起一丝异样。"}],"newForeshadowing":[{"type":"plot","description":"主角在密林中看到了一只三眼白鹿，鹿转头看了他一眼后消失——暗示这只鹿不寻常，可能与他日后的际遇有关","suggestedRevealWindow":"第15-18章"}]}

### 错误 finding 示例（不要报）
不报：伏笔"林青青的下落"在第3章埋入，本应在此场景回收但未涉及，然而林青青本人根本没有出场机会。
原因：如果伏笔相关角色没有出场，没有必要强行插入伏笔推进。伏笔推进需要有场景支持。没有相关角色出场或没有合适的场景空间时，不报遗漏。

## 活跃伏笔
${activeList}

## 审查任务
以下是需要审查的生成文字：
${input.generatedProse.slice(0, 8000)}

请识别：
1. 新埋的伏笔（描述、类型、建议回收窗口）
2. 已回收或推进的活跃伏笔
3. 应该回收但因缺少场景条件而合理未提及的除外
请输出你的审查发现。没有发现则返回空数组。`

    : `You are a foreshadowing tracker. Track how planted foreshadowing is advanced, resolved, or newly planted in the generated prose.

### Severity Levels
- **critical** = An important foreshadowing thread that should be advanced or resolved in this scene is completely ignored
- **major** = Foreshadowing resolution contradicts its original planting conditions (e.g., planted as discovered by character A but casually mentioned by character B); or the resolution is too perfunctory
- **minor** = Foreshadowing has slight advancement but is too subtle, readers may miss it

### Checklist
1. Is new foreshadowing planted in the generated prose (description, type, suggested reveal window)?
2. Are active foreshadowing threads advanced or resolved in the generated prose?
3. Is there foreshadowing that should be resolved in this chapter (based on suggested reveal window) but is not mentioned?
4. Does the resolution method match the original planting conditions?

## Review Standard Examples
### Correct Finding Example
{"findings":[{"severity":"major","location":"Entire text","description":"Active foreshadowing 'Secret of the Ancient Jade' (planted in Ch 5, suggested reveal Ch 9-11) is completely unmentioned in this scene. The protagonist passes through an ancient battlefield site where there should reasonably be a clue.","suggestion":"Add a moment as the protagonist passes through the ruins: the jade pendant grows warm, making him pause — hinting at a connection between the jade and the ancient battlefield","snippet":"But he simply hurried through the ruins without a second glance.","autoFixable":true,"fixedText":"But as he hurried through the ruins, the jade pendant against his chest suddenly grew warm, making him pause involuntarily — just for a moment before the heat faded. He frowned and touched his chest, a strange feeling stirring in his heart."}],"newForeshadowing":[{"type":"plot","description":"The protagonist sees a three-eyed white deer in the deep forest; the deer glances back at him once before vanishing — hinting this deer is unusual and may relate to his future encounters","suggestedRevealWindow":"Chapter 15-18"}]}

### Wrong Finding Example (Do Not Report)
Do not report: The foreshadowing "Lin Qingqing's whereabouts" planted in Chapter 3 should be resolved in this scene but is not addressed — however Lin Qingqing does not even appear in this scene.
Why: If the character related to the foreshadowing does not appear, there is no need to forcefully insert foreshadowing advancement. Foreshadowing advancement requires scene support. When the relevant character is absent or there is no suitable scene space, do not report omission.

## Active Foreshadowing
${activeList}

## Review Task
Below is the generated prose to review:
${input.generatedProse.slice(0, 8000)}

Identify:
1. Newly planted foreshadowing (description, type, suggested reveal window)
2. Active foreshadowing that has been resolved or advanced
3. Exclude threads that should be resolved but are reasonably omitted due to lack of scene opportunity
Output your review findings. Return an empty array if no issues found.`

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
      autoFixable: !!f.snippet && !!f.suggestion,
    })),
    newForeshadowing: result.newForeshadowing || [],
    revealedForeshadowing: result.revealedForeshadowing || [],
  };
}

async function reviewForeshadowingClean(
  fullNovelText: string,
  generatedProse: string,
  llm: ReturnType<typeof createLLMProvider>,
  zh: boolean
): Promise<CleanReviewResult> {
  const prompt = zh
    ? `## 审查指南
你是伏笔追踪员。检查生成文字是否推进或回收了原文中可见的情节线索。

### 严重级别
- **critical** = 原文中重要的情节线索在生成文字中被完全忽略，或产生了与原文方向明显矛盾的发展
- **major** = 原文中的伏笔在生成文字中有提及但处理方式与原文暗示的方向不一致
- **minor** = 伏笔有轻微推进但不够清晰，读者可能注意不到

### 收敛判断
如果生成文字合理地推进或回收了原文中所有可见的情节线索，设置 converged: true。
如果原文中没有明显的伏笔/线索需要在此处处理，也设置 converged: true。

## 原文
${fullNovelText.slice(0, 60000)}

## 生成文字
${generatedProse.slice(0, 8000)}

请输出审查发现和收敛判断。`

    : `## Review Guidelines
You are a foreshadowing tracker. Check if the generated prose advances or resolves plot threads visible in the original text.

### Severity
- **critical** = Important plot threads from original are completely ignored, or development contradicts original direction
- **major** = Foreshadowing is mentioned but handled inconsistently with what original implied
- **minor** = Foreshadowing advanced but too subtly, readers may miss it

### Convergence
Set converged: true if generated prose reasonably advances all visible plot threads from original.
Also set converged: true if there are no obvious threads requiring handling here.

## Original
${fullNovelText.slice(0, 60000)}

## Generated Prose
${generatedProse.slice(0, 8000)}

Output your findings and convergence judgment.`;

  const result = await llm.chatWithTool<any>(
    [{ role: "user", content: prompt }],
    { name: "foreshadowing_review_clean", description: "Review findings for foreshadowing in clean mode", parameters: { type: "object" as const, properties: { findings: { type: "array" as const, items: { type: "object" as const, properties: { severity: { type: "string" as const, enum: ["critical", "major", "minor"] }, location: { type: "string" as const }, description: { type: "string" as const }, suggestion: { type: "string" as const }, snippet: { type: "string" as const } }, required: ["severity", "description", "suggestion"] } }, converged: { type: "boolean" as const } }, required: ["findings", "converged"] } },
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
    })),
    converged: result.converged ?? (result.findings || []).length === 0,
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

  const examples = input.codex.styleProfiles.writingStyle?.examplePassages?.length
    ? `\n## 原著代表性片段\n${input.codex.styleProfiles.writingStyle.examplePassages
        .map(p => `【${p.aspect}】\n${p.text}`)
        .join("\n\n")}`
    : "";

  const prompt = zh
    ? `你是风格一致性审查员。检查生成文字是否与原著风格指纹一致。

### 严重级别
- **critical** = 严重风格断裂（如古风小说出现现代网络用语、历史背景出现当代概念）
- **major** = 明显风格不一致（句长偏离>30%、对话比剧变、AI味套话如"不知为何""仿佛""似乎"过度使用）
- **minor** = 可微调的措辞问题（个别用词可以更贴合风格）

### 检查清单
1. 句长是否偏离平均句长超过30%
2. 对话比例是否与风格指纹一致
3. 是否有AI味的公式化表达（反复出现的套话、过度使用的感叹、机械的过渡词如"然而""与此同时""另外"）
4. 句式结构是否单调重复（连续多个句子以相同方式开头或相同结构）
5. 与原著代表性片段的笔法是否一致
6. 是否存在时代错位的语言（古风中出现现代词汇或反之）
7. 开头是否以章节标题（如"# 第一章"、"第X章"）起笔——续写应自然接续，不应重新开始章节

## 审查标准示例
### 正确 finding 示例
{"findings":[{"severity":"critical","location":"第2段","description":"修仙题材古风小说中突然出现'手机铃声响了'，严重时代错位","suggestion":"删除'手机铃声'，改为符合世界观设定的事物提醒方式，如传音符或灵兽鸣叫","snippet":"突然，他的手机铃声响了，打破了密室的寂静。","autoFixable":true,"fixedText":"忽然，腰间传音符微微震颤，发出低沉的嗡鸣，打破了密室的寂静。"}]}

### 错误 finding 示例（不要报）
不报：某句长度比平均句长多出5个字的轻微波动。
原因：句长自然波动是正常写作现象，只有在持续偏离>30%时才构成风格问题。单句微调不属于审查范畴。

## 风格指纹
${styleGuide}
${examples}

## 审查任务
以下是需要审查的生成文字：
${input.generatedProse.slice(0, 8000)}

请输出你的审查发现。没有发现则返回空数组。`

    : `You are a style consistency reviewer. Check if the generated prose matches the original style fingerprint.

### Severity Levels
- **critical** = Severe style rupture (e.g., modern internet slang in a historical novel, contemporary concepts in a period setting)
- **major** = Notable style inconsistency (sentence length deviation >30%, dramatic dialogue ratio shift, AI-pattern clichés like "for some reason," "as if," "seemingly" overused)
- **minor** = Subtle wording issues (individual word choices that could better fit the style)

### Checklist
1. Does sentence length deviate from average by more than 30%?
2. Is the dialogue ratio consistent with the style fingerprint?
3. Are there AI-pattern formulaic expressions (recurring clichés, overused exclamations, mechanical transitions like "however," "meanwhile," "moreover")?
4. Are sentence structures monotonously repetitive (consecutive sentences starting or structured the same way)?
5. Does the writing style match the original example passages?
6. Is there anachronistic language (modern terms in a historical setting or vice versa)?

## Review Standard Examples
### Correct Finding Example
{"findings":[{"severity":"critical","location":"Paragraph 2","description":"In a cultivation/xianxia historical novel, 'his phone rang' suddenly appears — a severe anachronism","suggestion":"Remove 'phone ring' and replace with a setting-appropriate notification method, such as a transmission talisman or spirit beast cry","snippet":"Suddenly, his phone rang, breaking the silence of the chamber.","autoFixable":true,"fixedText":"Suddenly, the transmission talisman at his waist trembled slightly, emitting a low hum that broke the silence of the chamber."}]}

### Wrong Finding Example (Do Not Report)
Do not report: A single sentence that is 5 words longer than the average sentence length.
Why: Natural sentence length variation is normal writing. Only sustained deviation >30% constitutes a style issue. Individual sentence micro-adjustments are not in scope.

## Style Fingerprint
${styleGuide}
${examples}

## Review Task
Below is the generated prose to review:
${input.generatedProse.slice(0, 8000)}

Output your review findings. Return an empty array if no issues found.`

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
    })),
  };
}

async function reviewStyleClean(
  fullNovelText: string,
  generatedProse: string,
  llm: ReturnType<typeof createLLMProvider>,
  zh: boolean
): Promise<CleanReviewResult> {
  const prompt = zh
    ? `## 审查指南
你是风格一致性审查员。检查生成文字的写作风格是否与原文一致。

### 严重级别
- **critical** = 严重风格断裂（如古风小说出现现代网络用语、历史背景出现当代概念）
- **major** = 明显风格不一致（句长急剧变化、AI味套话如"不知为何""仿佛""似乎"过度使用、句式单调重复）
- **minor** = 可微调的措辞问题（个别用词可以更贴合风格）

### 收敛判断
如果生成文字的写作风格与原文高度一致，设置 converged: true。

## 原文风格参考
${fullNovelText.slice(0, 60000)}

## 生成文字
${generatedProse.slice(0, 8000)}

请输出审查发现和收敛判断。`

    : `## Review Guidelines
You are a style consistency reviewer. Check if the generated prose matches the writing style of the original.

### Severity
- **critical** = Severe style rupture (modern slang in historical, contemporary concepts in period setting)
- **major** = Notable inconsistency (sentence length shift, AI cliches like "for some reason" / "as if" overused, monotonous sentence structure)
- **minor** = Minor wording that could better match the style

### Convergence
Set converged: true if the writing style of the generated prose is highly consistent with the original.

## Original Style Reference
${fullNovelText.slice(0, 60000)}

## Generated Prose
${generatedProse.slice(0, 8000)}

Output your findings and convergence judgment.`;

  const result = await llm.chatWithTool<any>(
    [{ role: "user", content: prompt }],
    { name: "style_review_clean", description: "Review findings for style consistency in clean mode", parameters: { type: "object" as const, properties: { findings: { type: "array" as const, items: { type: "object" as const, properties: { severity: { type: "string" as const, enum: ["critical", "major", "minor"] }, location: { type: "string" as const }, description: { type: "string" as const }, suggestion: { type: "string" as const }, snippet: { type: "string" as const } }, required: ["severity", "description", "suggestion"] } }, converged: { type: "boolean" as const } }, required: ["findings", "converged"] } },
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
    })),
    converged: result.converged ?? (result.findings || []).length === 0,
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

### 严重级别
- **critical** = 力量体系核心规则被打破（如修仙世界出现手枪）；不可逆的世界规则被违反（如设定"无法复活"的世界中有人复活）
- **major** = 社会结构或势力关系错误描述（如等级森严的世界中平民公开顶撞皇帝且无后果）；地点描述与设定明显矛盾
- **minor** = 细节措辞不够准确但方向正确（如门派名称略微有误），可以是自动修正

### 检查清单
1. 力量体系规则是否被打破（如修仙世界中突然出现科技武器、魔法世界出现手机）
2. 社会等级结构是否被正确遵循
3. 势力/门派关系是否描述正确（敌对还是同盟）
4. 地点描述是否与世界观设定一致
5. 是否出现了设定的时代/世界中不应存在的技术或物品

## 审查标准示例
### 正确 finding 示例
{"findings":[{"severity":"critical","location":"第4段","description":"修仙题材世界观中，主角掏出手枪击退追兵。该世界观设定为古代修真体系，不存在现代火器。","suggestion":"删除手枪，改为符合世界观设定的攻击手段，如法术、法宝或飞剑","snippet":"他从怀中掏出一把手枪，对准追兵扣动扳机。","autoFixable":true,"fixedText":"他掐诀念咒，袖中飞出一道青光，直射追兵面门。"}]}

### 错误 finding 示例（不要报）
不报：主角手中的剑是青色的，但设定文档写的是"玄铁剑呈深黑色"——颜色不符。
原因：武器颜色属于视觉细节，不构成对世界观核心规则的违反。这类表面描述差异属于风格问题，不是世界观问题。只报告力量体系、社会结构、世界规则层面的实质性矛盾。

## 世界观设定
- 时代背景: ${w.timePeriod}
- 主要地点: ${w.location}
- 社会结构: ${w.socialStructure}
- 力量体系: ${w.powerSystem}
- 势力/门派: ${w.factions.join("、")}
- 世界规则: ${w.rules.join("、")}

## 审查任务
以下是需要审查的生成文字：
${input.generatedProse.slice(0, 8000)}

请输出你的审查发现。没有发现则返回空数组。`

    : `You are a world-building consistency reviewer. Check if the generated prose violates world rules.

### Severity Levels
- **critical** = Core power system rules are broken (e.g., a handgun in a cultivation world); an irreversible world rule is violated (e.g., someone resurrects in a world where resurrection is impossible)
- **major** = Social structure or faction relationships are incorrectly described (e.g., a commoner openly defies the emperor with no consequences in a strict hierarchy); location descriptions clearly contradict the setting
- **minor** = Detail wording not fully accurate but directionally correct (e.g., slightly inaccurate faction name), can be auto-fixed

### Checklist
1. Are power system rules broken (e.g., tech weapons suddenly appear in a cultivation world, phones in a magic world)?
2. Is social hierarchy correctly followed?
3. Are faction/clan relationships correctly described (hostile vs allied)?
4. Do location descriptions match the world setting?
5. Does any technology or item appear that should not exist in the era/world?

## Review Standard Examples
### Correct Finding Example
{"findings":[{"severity":"critical","location":"Paragraph 4","description":"In a cultivation/xianxia world, the protagonist pulls out a handgun to repel pursuers. The world is set as an ancient cultivation system with no modern firearms.","suggestion":"Remove the handgun and replace with a setting-appropriate attack method such as a spell, magical artifact, or flying sword","snippet":"He drew a handgun from his robes and pulled the trigger at the pursuers.","autoFixable":true,"fixedText":"He formed a hand seal and chanted — a streak of blue light shot from his sleeve, flying straight at the pursuer's face."}]}

### Wrong Finding Example (Do Not Report)
Do not report: The protagonist's sword is green, but the setting document says "the Xuan Iron Sword is deep black" — the color does not match.
Why: Weapon color is a visual detail and does not violate core world rules. Surface-level description differences are style issues, not world-building issues. Only report substantive contradictions at the level of power systems, social structures, and world rules.

## World Setting
- Time Period: ${w.timePeriod}
- Main Location: ${w.location}
- Social Structure: ${w.socialStructure}
- Power System: ${w.powerSystem}
- Factions: ${w.factions.join(", ")}
- World Rules: ${w.rules.join(", ")}

## Review Task
Below is the generated prose to review:
${input.generatedProse.slice(0, 8000)}

Output your review findings. Return an empty array if no issues found.`

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
    })),
  };
}

async function reviewWorldBuildingClean(
  fullNovelText: string,
  generatedProse: string,
  llm: ReturnType<typeof createLLMProvider>,
  zh: boolean
): Promise<CleanReviewResult> {
  const prompt = zh
    ? `## 审查指南
你是世界观一致性审查员。检查生成文字是否遵守了原文中展示的世界规则和设定。

### 严重级别
- **critical** = 力量体系核心规则被打破（如修仙世界出现手枪）；不可逆的世界规则被违反
- **major** = 社会结构或势力关系错误描述；地点描述与原文设定明显矛盾
- **minor** = 细节措辞不够准确但方向正确

### 收敛判断
如果生成文字完全遵守原文中展示的世界规则，设置 converged: true。

## 原文（世界规则参考）
${fullNovelText.slice(0, 60000)}

## 生成文字
${generatedProse.slice(0, 8000)}

请输出审查发现和收敛判断。`

    : `## Review Guidelines
You are a world-building consistency reviewer. Check if the generated prose respects the rules and mechanics of the world shown in the original text.

### Severity
- **critical** = Core power system rules broken; irreversible world rules violated
- **major** = Social structure or faction relationships incorrectly described; location contradicts setting
- **minor** = Minor wording imprecision, directionally correct

### Convergence
Set converged: true if the generated prose fully respects the world rules shown in the original.

## Original (World Rules Reference)
${fullNovelText.slice(0, 60000)}

## Generated Prose
${generatedProse.slice(0, 8000)}

Output your findings and convergence judgment.`;

  const result = await llm.chatWithTool<any>(
    [{ role: "user", content: prompt }],
    { name: "world_review_clean", description: "Review findings for world-building in clean mode", parameters: { type: "object" as const, properties: { findings: { type: "array" as const, items: { type: "object" as const, properties: { severity: { type: "string" as const, enum: ["critical", "major", "minor"] }, location: { type: "string" as const }, description: { type: "string" as const }, suggestion: { type: "string" as const }, snippet: { type: "string" as const } }, required: ["severity", "description", "suggestion"] } }, converged: { type: "boolean" as const } }, required: ["findings", "converged"] } },
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
    })),
    converged: result.converged ?? (result.findings || []).length === 0,
  };
}

async function reviewPacing(
  input: ReviewInput,
  llm: ReturnType<typeof createLLMProvider>,
  zh: boolean
): Promise<ReviewResult> {
  const prompt = zh
    ? `你是节奏审查员。检查生成文字的节奏是否符合要求的步调和冲突强度。

### 严重级别
- **critical** = 节奏与要求完全相反（快节奏战斗场景被写成慢悠悠心理描写和景物铺陈）
- **major** = 关键情节被无关内容淹没（拖沓）；或重要转折一笔带过（仓促）
- **minor** = 段落级别节奏微调（个别段落可以收紧或舒展），可以是自动修正

### 检查清单
1. 整体节奏是否符合要求（fast=紧凑短句动作密集 / medium=正常推进 / slow=从容铺陈）
2. 冲突强度爬升是否与故事节拍匹配（铺垫→爆发→收尾的节奏曲线）
3. 是否存在拖沓：关键情节被大段无关环境描写、内心独白或插叙淹没
4. 是否存在仓促：重要转折、情感高潮或决断被一笔带过，缺乏应有的重量
5. 篇章结尾是否落在了预期的情绪点上

## 审查标准示例
### 正确 finding 示例
{"findings":[{"severity":"major","location":"第3-7段","description":"节奏要求为fast（快节奏战斗），但生成文字在第3-7段用了大量篇幅描写战场环境和主角回忆，战斗本身只有寥寥数句。读者会在紧张关头失去阅读动力。","suggestion":"大幅缩减环境描写和回忆至1-2句，将核心篇幅留给战斗的动作和决策过程。把回忆内容移至战斗结束后的喘息段落","snippet":"漫天黄沙遮蔽了天空，这让他想起了十年前在边疆的那场血战——那时的他也曾面临这样的绝境，同伴一个个倒下……（后接大段环境描写）","autoFixable":false}]}

### 错误 finding 示例（不要报）
不报：中节奏场景中有一段较长的对话。
原因：对话可以推动情节、揭示角色、塑造张力。长对话不等于拖沓。只要对话内容在推进故事、揭示信息或发展角色关系，就符合中型节奏的要求。只有与当前故事节拍无关的对话才构成拖沓。

## 要求
- 节奏: ${input.codex.currentTask.pacing}
- 情感弧线: ${input.codex.currentTask.emotionalArc}
- 赌注: ${input.codex.currentTask.stakes}

## 审查任务
以下是需要审查的生成文字：
${input.generatedProse.slice(0, 8000)}

请输出你的审查发现。没有发现则返回空数组。`

    : `You are a pacing reviewer. Check if the generated prose pacing matches the required tempo and conflict intensity.

### Severity Levels
- **critical** = Pacing is the complete opposite of what is required (a fast-paced battle scene written as leisurely psychological description and scenery)
- **major** = Key plot is buried under irrelevant content (dragging); or important turning points are glossed over in a single sentence (rushing)
- **minor** = Paragraph-level pacing micro-adjustments (individual paragraphs could be tightened or expanded), can be auto-fixed

### Checklist
1. Does the overall pacing match the requirement (fast = tight sentences, action-dense / medium = steady progression / slow = unhurried development)?
2. Does the conflict escalation match the story beat (build-up → eruption → resolution curve)?
3. Is there dragging: key plot buried under lengthy irrelevant environment description, internal monologue, or flashbacks?
4. Is there rushing: important turns, emotional climaxes, or decisions glossed over without the weight they deserve?
5. Does the section end at the expected emotional point?

## Review Standard Examples
### Correct Finding Example
{"findings":[{"severity":"major","location":"Paragraphs 3-7","description":"Pacing requirement is fast (fast-paced battle), but the generated prose spends paragraphs 3-7 on environment description and the protagonist's memories, with the actual battle only getting a few lines. Readers will lose engagement at the critical moment.","suggestion":"Drastically reduce environment description and flashback to 1-2 sentences, devoting the core space to battle action and decision-making. Move the flashback to a breather after the battle ends","snippet":"Yellow sand filled the sky, reminding him of that bloody battle on the frontier ten years ago — back then he had also faced such hopeless odds, watching his comrades fall one by one... (followed by lengthy environment description)","autoFixable":false}]}

### Wrong Finding Example (Do Not Report)
Do not report: A medium-paced scene contains a long dialogue exchange.
Why: Dialogue can advance plot, reveal character, and build tension. Long dialogue does not equal dragging. As long as the dialogue content advances the story, reveals information, or develops character relationships, it fits medium pacing. Only dialogue unrelated to the current story beat constitutes dragging.

## Requirements
- Pacing: ${input.codex.currentTask.pacing}
- Emotional Arc: ${input.codex.currentTask.emotionalArc}
- Stakes: ${input.codex.currentTask.stakes}
- Stakes: ${input.codex.currentTask.stakes}

## Review Task
Below is the generated prose to review:
${input.generatedProse.slice(0, 8000)}

Output your review findings. Return an empty array if no issues found.`

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
    })),
  };
}

async function reviewPacingClean(
  fullNovelText: string,
  generatedProse: string,
  llm: ReturnType<typeof createLLMProvider>,
  zh: boolean
): Promise<CleanReviewResult> {
  const prompt = zh
    ? `## 审查指南
你是节奏审查员。检查生成文字的节奏是否自然合理。

### 严重级别
- **critical** = 节奏极其不自然（如高潮战斗场景被写成慢悠悠的景物描写和内心独白）
- **major** = 关键情节被无关内容淹没（拖沓）；或重要转折一笔带过（仓促）
- **minor** = 段落级别节奏微调（个别段落可以收紧或舒展）

### 收敛判断
如果生成文字的节奏自然、段落张弛有度，设置 converged: true。

## 原文（节奏参考）
${fullNovelText.slice(0, 60000)}

## 生成文字
${generatedProse.slice(0, 8000)}

请输出审查发现和收敛判断。`

    : `## Review Guidelines
You are a pacing reviewer. Check if the generated prose has appropriate rhythm.

### Severity
- **critical** = Extremely unnatural pacing (climax battle written as leisurely scenery and introspection)
- **major** = Key plot buried under irrelevant content (dragging); or important turning points glossed over (rushing)
- **minor** = Paragraph-level micro-adjustments

### Convergence
Set converged: true if the pacing feels natural with appropriate tension and release.

## Original (Pacing Reference)
${fullNovelText.slice(0, 60000)}

## Generated Prose
${generatedProse.slice(0, 8000)}

Output your findings and convergence judgment.`;

  const result = await llm.chatWithTool<any>(
    [{ role: "user", content: prompt }],
    { name: "pacing_review_clean", description: "Review findings for pacing in clean mode", parameters: { type: "object" as const, properties: { findings: { type: "array" as const, items: { type: "object" as const, properties: { severity: { type: "string" as const, enum: ["critical", "major", "minor"] }, location: { type: "string" as const }, description: { type: "string" as const }, suggestion: { type: "string" as const }, snippet: { type: "string" as const } }, required: ["severity", "description", "suggestion"] } }, converged: { type: "boolean" as const } }, required: ["findings", "converged"] } },
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
    })),
    converged: result.converged ?? (result.findings || []).length === 0,
  };
}

export async function runFullReviewClean(
  fullNovelText: string,
  generatedProse: string,
  onEvent?: (event: any) => void
): Promise<{ allConverged: boolean; allFindings: ReviewFinding[] }> {
  const llm = createLLMProvider();
  const zh = isChinese(generatedProse);

  const agentDefs = [
    { id: "review_char", name: "角色一致性", fn: reviewCharacterConsistencyClean },
    { id: "review_cont", name: "连贯性", fn: reviewContinuityClean },
    { id: "review_fore", name: "伏笔追踪", fn: reviewForeshadowingClean },
    { id: "review_style", name: "风格", fn: reviewStyleClean },
    { id: "review_world", name: "世界观", fn: reviewWorldBuildingClean },
    { id: "review_pace", name: "节奏", fn: reviewPacingClean },
  ];

  const results = await Promise.all(
    agentDefs.map(async (def) => {
      if (onEvent) onEvent({ type: "agent", agentId: def.id, name: def.name, status: "running" });
      const r = await def.fn(fullNovelText, generatedProse, llm, zh);
      if (onEvent) onEvent({
        type: "agent", agentId: def.id, name: def.name, status: "done",
        messages: [{ role: "assistant" as const, content: JSON.stringify({ findings: r.findings, converged: r.converged }) }],
      });
      return r;
    })
  );

  const allFindings = results.flatMap(r => r.findings);
  const allConverged = results.every(r => r.converged);

  return { allConverged, allFindings };
}

/**
 * Rewrite prose to fix all auto-fixable review findings.
 * Returns corrected prose, or original if no auto-fixable findings exist.
 */
export async function rewriteProse(
  originalProse: string,
  findings: ReviewFinding[],
  _codex: WritersCodex,
  onEvent?: (event: any) => void
): Promise<string> {
  if (findings.length === 0) {
    return originalProse;
  }

  if (onEvent) onEvent({ type: "agent", agentId: "rewrite", name: "修正", status: "running" });

  const llm = createLLMProvider();
  const zh = isChinese(originalProse);

  const findingsText = findings.map((f, i) =>
    `${i + 1}. [${f.dimension}][${f.severity}] ${f.description}\n   ${f.snippet ? `问题片段: "${f.snippet}"\n   ` : ""}修改建议: ${f.suggestion}`
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

  if (onEvent) {
    onEvent({
      type: "agent",
      agentId: "rewrite",
      name: "修正",
      status: "done",
      messages: [
        { role: "user", content: prompt },
        { role: "assistant", content: corrected },
      ],
    });
  }

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
    fixedSnippet: "",
  }));
}
