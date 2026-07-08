# Review Agent Prompt Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite all 6 review agent prompts with shared system context, detailed severity guidelines, and few-shot examples.

**Architecture:** A new `buildSharedReviewSystemPrompt()` function produces a bilingual system prompt from scene/outline/character/context data. This is passed to `runFullReview()` via a new field on `ReviewInput`, then forwarded to each agent. Each agent's user prompt is rewritten with domain-specific guidelines, severity definitions, checklists, and few-shot examples.

**Tech Stack:** TypeScript, LLM (via factory)

---

### Task 1: Add `buildSharedReviewSystemPrompt()` + wire into pipeline

**Files:**
- Modify: `src/core/codex/review-orchestrator.ts`
- Modify: `src/core/simulation/engine.ts`

- [ ] **Step 1: Add `SharedReviewContext` interface and `buildSharedReviewSystemPrompt()`**

In `src/core/codex/review-orchestrator.ts`, add before the `ReviewInput` interface (after line 8):

```typescript
export interface SharedReviewContext {
  novelTitle: string;
  chapterNumber: number;
  outline: import("@/types").SceneOutline | null;
  scene: import("@/types").SceneDefinition;
  previousProse: string;
  characterStates: { name: string; currentLocation: string; currentEmotion: string; currentGoal: string }[];
  narrativeStyle: { pointOfView: string; tone: string; targetLength: string };
}
```

Then add after the imports and before `ReviewInput`:

```typescript
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
```

- [ ] **Step 2: Add `sharedSystemPrompt` to `ReviewInput`**

Change the `ReviewInput` interface (line 10-14) from:

```typescript
interface ReviewInput {
  generatedProse: string;
  codex: WritersCodex;
  chapterNumber: number;
}
```

to:

```typescript
interface ReviewInput {
  generatedProse: string;
  codex: WritersCodex;
  chapterNumber: number;
  sharedSystemPrompt: string;
}
```

- [ ] **Step 3: Update each review function to use `sharedSystemPrompt`**

Each of the 6 review functions currently sends `[{ role: "user", content: prompt }]`. Change each to send `[{ role: "system", content: input.sharedSystemPrompt }, { role: "user", content: prompt }]`.

For example, in `reviewCharacterConsistency` (line 149-150), change:

```typescript
  const result = await llm.chatWithTool<any>(
    [{ role: "user", content: prompt }],
    { ...REVIEW_SCHEMA, name: "character_review" },
    { temperature: 0.2, maxTokens: 4096 }
  );
```

to:

```typescript
  const result = await llm.chatWithTool<any>(
    [
      { role: "system", content: input.sharedSystemPrompt },
      { role: "user", content: prompt }
    ],
    { ...REVIEW_SCHEMA, name: "character_review" },
    { temperature: 0.2, maxTokens: 4096 }
  );
```

Do the same for all 6 review functions: `reviewContinuity` (line 204), `reviewForeshadowing` (line 283), `reviewStyle` (line 343), `reviewWorldBuilding` (line 392), `reviewPacing` (line 436).

- [ ] **Step 4: Fix foreshadowing autoFixable**

In `reviewForeshadowing`, change line 297 from:

```typescript
              autoFixable: false,
```

to:

```typescript
              autoFixable: f.severity !== "critical" && !!f.fixedText,
```

- [ ] **Step 5: Build shared prompt in engine and pass to runFullReview**

In `src/core/simulation/engine.ts`, add the import:

```typescript
import { runFullReview, rewriteProse, generateAnnotations, buildSharedReviewSystemPrompt } from "@/core/codex/review-orchestrator";
```

Then in the `run()` method, before calling `runFullReview` (around line 229-234), build the shared prompt and add it to the input:

```typescript
          const chapterNumber = (this.state.rounds?.length || 0) + 1;
          const charStates = (this.codex.characterDossiers?.currentStates || []).map((s: any) => ({
            name: s.name || "",
            currentLocation: s.currentLocation || "未知",
            currentEmotion: s.currentEmotion || "未知",
            currentGoal: s.currentGoal || "未知",
          }));
          const sharedSystemPrompt = buildSharedReviewSystemPrompt({
            novelTitle: this.state.novelTitle,
            chapterNumber,
            outline,
            scene: this.state.scene,
            previousProse: this.state.fullNovelOutput || "",
            characterStates: charStates,
            narrativeStyle: {
              pointOfView: this.state.scene.narrativeStyle.pointOfView,
              tone: this.state.scene.narrativeStyle.tone,
              targetLength: this.state.scene.narrativeStyle.targetLength,
            },
          });
          const review = await runFullReview({
            generatedProse: prose,
            codex: this.codex,
            chapterNumber,
            sharedSystemPrompt,
          });
```

- [ ] **Step 6: Verify build**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/core/codex/review-orchestrator.ts src/core/simulation/engine.ts
git commit -m "feat: add shared system prompt for all review agents"
```

---

### Task 2: Rewrite all 6 agent user prompts

**Files:**
- Modify: `src/core/codex/review-orchestrator.ts`

This task replaces the user prompt in each of the 6 review functions with detailed guidelines, severity definitions, checklists, and few-shot examples.

- [ ] **Step 1: Rewrite `reviewCharacterConsistency` prompt (lines 132-147)**

Replace the prompt construction block:

```typescript
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
```

with:

```typescript
  const prompt = zh
    ? `## 审查指南
你是角色一致性审查员。你的工作是检查生成文字中角色的行为和对话是否与他们的性格设定一致。

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
{
  "findings": [{
    "severity": "major",
    "location": "第3段",
    "description": "张小凡说'没问题，我来承担'，但他的人设是极度缺乏自信、遇事退缩。此处没有铺垫他为什么会突然变得有担当。",
    "suggestion": "改为他犹豫片刻后低声说'我试试'，或者在前文加入他被师父训话后决定改变的铺垫",
    "snippet": "张小凡点点头：\\"没问题，我来承担。\\"",
    "autoFixable": true,
    "fixedText": "张小凡低下头，犹豫了好一会儿，才低声道：\\"我...我试试。\\""
  }]
}

### 错误 finding 示例（不要报）
不报：角色在极度愤怒时说了一句不符合日常风格的重话。
原因：角色在强烈情绪下可以暂时偏离常态，这是合理的戏剧表达，不是角色断裂。

## 角色设定
${charContext}

## 审查任务
以下是需要审查的生成文字：
${input.generatedProse.slice(0, 8000)}

请输出你的审查发现。没有发现则返回空数组。`

    : `## Review Guidelines
You are a character consistency reviewer. Check the generated prose against character profiles for behavior/speech drift.

### Severity
- **critical** = Character acts completely contrary to core personality with no scene setup for the change
- **major** = Speaking style noticeably deviates from profile (catchphrases missing, sentence pattern shifts), or drive-related inconsistency
- **minor** = Word choice could be refined but stays within acceptable range; auto-fixable

### Checklist
1. Does the character's behavior match their personality and drive?
2. Does their dialogue match their speaking style and catchphrases?
3. Do they act against their fear/bottom line without scene setup?
4. Are their decisions consistent with their core goal?
5. Does their reaction under pressure match their described pattern?

### Notes
- Characters under extreme emotion may temporarily deviate; scene setup justifies exceptions
- Characters can grow and change if driven by prior events, not out of nowhere
- Only report clear, un-setup breaks

## Example — Correct Finding
{
  "findings": [{
    "severity": "major",
    "location": "Paragraph 3",
    "description": "Zhang says 'No problem, I'll handle it' but he is established as deeply insecure and avoidant. No setup for this sudden confidence.",
    "suggestion": "Change to him hesitating then whispering 'I'll try', or add setup earlier",
    "snippet": "Zhang nodded: \\"No problem, I'll handle it.\\"",
    "autoFixable": true,
    "fixedText": "Zhang lowered his head, hesitated for a long moment, then whispered: \\"I... I'll try.\\""
  }]
}

## Example — Do NOT Report
Do not report: Character says something harsher than usual when furious.
Reason: Strong emotions can temporarily shift behavior — this is dramatic expression, not character break.

## Characters
${charContext}

## Task
Review the following generated prose:
${input.generatedProse.slice(0, 8000)}

Output your findings. Return empty array if nothing to report.`;
```

- [ ] **Step 2: Rewrite `reviewContinuity` prompt (lines 181-201)**

Replace the prompt construction block:

```typescript
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
```

with:

```typescript
  const prompt = zh
    ? `## 审查指南
你是连贯性审查员。你的工作是检查生成文字是否与前文已建立的事实存在逻辑矛盾。

### 严重级别
- **critical** = 已死亡的角色出现并行动；关键事实与已建立的事件链矛盾；前文明确否定的事件被当作事实
- **major** = 物品或信息凭空出现（前文完全未提及）；角色知道了他不应该知道的信息；因果链断裂
- **minor** = 细节不一致但不对情节逻辑产生实质性影响

### 检查清单
1. 已死亡或已离开场景的角色是否又出现并说话/行动
2. 物体、设定或信息是否凭空出现（前文完全未提及）
3. 因果链是否断裂（事件B发生了但缺乏必要的前因）
4. 时间线是否矛盾（提到某事件发生的时间与实际不符）
5. 同一角色是否在同一场景说出矛盾的信息
6. 角色是否知道他们不应该知道的信息

## 审查标准示例
### 正确 finding 示例
{
  "findings": [{
    "severity": "critical",
    "location": "第5段",
    "description": "角色王五出现在场景中并说了话，但他在第3章已被确认死亡（坠崖）。",
    "suggestion": "移除王五，或改为其他角色。如有特殊原因需要复活，需在前文铺垫",
    "snippet": "王五从门外走进来，笑道：...",
    "autoFixable": true,
    "fixedText": "李七从门外走进来，笑道：..."
  }]
}

### 错误 finding 示例（不要报）
不报：一个客栈的布局描写，大堂在左、厨房在右。与前文"进了客栈右手边是大堂"不完全一致。
原因：这种空间方位细节不属于事实矛盾。除非影响了情节（如角色因为方位错误走错房间引发关键剧情），否则不应报告。

## 已知前文摘要
${summaries}

## 角色存活/位置状态
${states}

## 审查任务
以下是需要审查的生成文字：
${input.generatedProse.slice(0, 8000)}

请输出你的审查发现。没有发现则返回空数组。`

    : `## Review Guidelines
You are a continuity reviewer. Check for logical contradictions between generated prose and established facts.

### Severity
- **critical** = Dead character appears and acts; key facts contradict established event chain; previously negated fact treated as true
- **major** = Object/info appears from nowhere (never mentioned before); character knows info they shouldn't; broken causality
- **minor** = Minor detail inconsistency that doesn't affect plot logic

### Checklist
1. Do dead or departed characters reappear and speak/act?
2. Do objects, settings, or info appear from nowhere?
3. Is there a broken causality chain (Event B happens without necessary setup)?
4. Are there timeline contradictions?
5. Does a character say contradictory things in the same scene?
6. Does a character know info they shouldn't?

## Example — Correct Finding
{
  "findings": [{
    "severity": "critical",
    "location": "Paragraph 5",
    "description": "Wang Wu appears and speaks in this scene, but he was confirmed dead (fell off cliff) in Chapter 3.",
    "suggestion": "Remove Wang Wu or replace with another character",
    "snippet": "Wang Wu walked in from the door, laughing: ...",
    "autoFixable": true,
    "fixedText": "Li Qi walked in from the door, laughing: ..."
  }]
}

## Example — Do NOT Report
Do not report: Inn layout detail (hall left, kitchen right) slightly inconsistent with earlier "hall on the right side."
Reason: Spatial orientation trivia is not a plot-relevant fact. Only report if it affects the story.

## Chapter Summaries
${summaries}

## Character Alive/Location Status
${states}

## Task
Review the following generated prose:
${input.generatedProse.slice(0, 8000)}

Output your findings. Return empty array if nothing to report.`;
```

- [ ] **Step 3: Rewrite `reviewForeshadowing` prompt (lines 241-254)**

Replace the prompt construction block:

```typescript
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
```

with:

```typescript
  const prompt = zh
    ? `## 审查指南
你是伏笔追踪员。你的工作是追踪本章中伏笔的推进、回收和新埋。

### 严重级别
- **critical** = 一个应该在此场景中回收或推进的重要伏笔被完全忽略
- **major** = 伏笔在回收时与原埋入条件明显矛盾；或回收方式过于敷衍
- **minor** = 伏笔有轻微推进但不够清晰

### 检查清单
1. 新埋的伏笔：描述、类型、建议回收窗口
2. 已有活跃伏笔是否被推进或回收
3. 应该在此章节回收的伏笔是否被忽略
4. 伏笔回收是否与原设定一致

## 审查标准示例
### 正确 finding 示例
{
  "findings": [{
    "severity": "major",
    "location": "全文",
    "description": "活跃伏笔'师父的真实身份'应该在此章师徒对峙情节中有所推进，但生成文字未提及。",
    "suggestion": "在师徒对话中加入暗示师父身份可疑的细节，或师父的一句意味深长的话",
    "snippet": "",
    "autoFixable": true,
    "fixedText": ""
  }],
  "newForeshadowing": [{
    "type": "身份",
    "description": "师父袖口隐约露出一个与皇宫禁卫相同的纹身",
    "suggestedRevealWindow": "第12-15章"
  }]
}

### 错误 finding 示例（不要报）
不报：活跃伏笔列表里有"主角的身世之谜"，但本章主角没有出场。
原因：主角不在场的章节中不涉及该伏笔是正常的。只报在当前出场角色身上应该推进但未推进的伏笔。

## 活跃伏笔
${activeList}

## 审查任务
以下是需要审查的生成文字：
${input.generatedProse.slice(0, 8000)}

请输出你的审查发现和新的伏笔。没有发现则返回空数组。`

    : `## Review Guidelines
You are a foreshadowing tracker. Track foreshadowing advancement, resolution, and new plants in this chapter.

### Severity
- **critical** = Important foreshadowing that should be advanced/resolved in this scene is completely ignored
- **major** = Resolution contradicts original planting conditions; or resolved too superficially
- **minor** = Slight advancement but not clear enough

### Checklist
1. New foreshadowing planted: description, type, suggested reveal window
2. Are existing active foreshadowings being advanced or resolved?
3. Is any foreshadowing that should resolve in this chapter being ignored?
4. Does the resolution match the original planting?

## Example — Correct Finding
{
  "findings": [{
    "severity": "major",
    "location": "全文",
    "description": "Active foreshadowing 'Master's true identity' should advance in this confrontation scene, but prose doesn't address it.",
    "suggestion": "Add a hinting detail in the dialogue, or a meaningful line from the master",
    "snippet": "",
    "autoFixable": true,
    "fixedText": ""
  }],
  "newForeshadowing": [{
    "type": "identity",
    "description": "A palace guard tattoo faintly visible on the master's sleeve",
    "suggestedRevealWindow": "Chapters 12-15"
  }]
}

## Example — Do NOT Report
Do not report: Active foreshadowing 'protagonist's origin mystery' is not addressed, but the protagonist is not in this chapter.
Reason: Foreshadowing tied to absent characters shouldn't advance in their absence. Only flag foreshadowing that SHOULD advance with the characters present.

## Active Foreshadowing
${activeList}

## Task
Review the following generated prose:
${input.generatedProse.slice(0, 8000)}

Output your findings and new foreshadowing. Return empty array if nothing to report.`;
```

- [ ] **Step 4: Rewrite `reviewStyle` prompt (lines 321-340)**

Replace the prompt construction block:

```typescript
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
```

with:

```typescript
  const examples = input.codex.styleProfiles.writingStyle?.examplePassages?.length
    ? `\n## 原著代表性片段\n${input.codex.styleProfiles.writingStyle.examplePassages
        .map(p => `【${p.aspect}】\n${p.text}`)
        .join("\n\n")}`
    : "";

  const prompt = zh
    ? `## 审查指南
你是风格一致性审查员。你的工作是检查生成文字是否与原著风格指纹一致。

### 严重级别
- **critical** = 严重风格断裂（如古风小说突然出现现代网络用语；科幻小说出现文言文腔调）
- **major** = 明显的风格不一致（句长偏离30%以上、对话比例剧变、AI味的公式化套话）
- **minor** = 可微调的措辞问题

### 检查清单
1. 句长是否与指纹偏离超过30%
2. 对话占比是否合理
3. 是否有AI味的公式化表达（反复出现的套话、"不知为何"等万能表达、机械的过渡词如"与此同时""就这样"）
4. 句式是否单调重复（连续多个句子以相同结构开头）
5. 与原著代表性片段的笔法是否一致
6. 是否出现了不符合原著时代的用语

## 审查标准示例
### 正确 finding 示例
{
  "findings": [{
    "severity": "critical",
    "location": "第2段",
    "description": "古风小说中出现'他顿时感觉整个人都不好了'——这是现代网络用语，严重破坏年代感。",
    "suggestion": "改为符合古代语境的表达",
    "snippet": "他顿时感觉整个人都不好了。",
    "autoFixable": true,
    "fixedText": "他心中一沉，面色发白，竟不知如何是好。"
  }]
}

### 错误 finding 示例（不要报）
不报：生成文字的句长略短于原著平均（18字 vs 22字）。
原因：minor 程度的句长波动属于正常的写作变化。除非句长偏离超过30%或导致节奏明显异常，否则不报。

## 风格指纹
${styleGuide}${examples}

## 审查任务
以下是需要审查的生成文字：
${input.generatedProse.slice(0, 8000)}

请输出你的审查发现。没有发现则返回空数组。`

    : `## Review Guidelines
You are a style consistency reviewer. Check if the generated prose matches the original style fingerprint.

### Severity
- **critical** = Severe style break (anachronistic language, genre mismatch)
- **major** = Noticeable inconsistency (sentence length off by >30%, dialogue ratio shift, AI-pattern clichés)
- **minor** = Subtle wording refinement

### Checklist
1. Sentence length deviation >30% from fingerprint?
2. Dialogue ratio reasonable?
3. AI-pattern formulaic expressions (repeated clichés, mechanical transitions)?
4. Monotonous sentence structures?
5. Consistent with original example passages?
6. Anachronistic language?

## Example — Correct Finding
{
  "findings": [{
    "severity": "critical",
    "location": "Paragraph 2",
    "description": "Modern internet slang appears in a historical fantasy setting.",
    "suggestion": "Replace with period-appropriate expression",
    "snippet": "He suddenly felt like his whole life was a joke.",
    "autoFixable": true,
    "fixedText": "His heart sank, his face paled, and he found himself utterly at a loss."
  }]
}

## Example — Do NOT Report
Do not report: Average sentence length slightly below fingerprint (18 chars vs 22).
Reason: Minor length variation is normal. Only flag if off by >30% or rhythm is clearly disrupted.

## Style Fingerprint
${styleGuide}${examples}

## Task
Review the following generated prose:
${input.generatedProse.slice(0, 8000)}

Output your findings. Return empty array if nothing to report.`;
```

- [ ] **Step 5: Rewrite `reviewWorldBuilding` prompt (lines 370-389)**

Replace the prompt construction block:

```typescript
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
```

with:

```typescript
  const prompt = zh
    ? `## 审查指南
你是世界观一致性审查员。你的工作是检查生成文字是否违反了已建立的世界观规则。

### 严重级别
- **critical** = 力量体系核心规则被打破；不可逆的世界规则被违反
- **major** = 社会结构或势力关系被错误描述；地点特征与设定明显矛盾
- **minor** = 世界观相关的细节措辞不够准确但整体方向正确

### 检查清单
1. 力量/魔法/修炼体系的核心规则是否被打破
2. 社会等级和权力关系是否正确
3. 势力/门派之间的立场和关系是否正确
4. 地点描述是否与世界观设定一致
5. 是否出现了世界观中不存在的技术、物品或概念

## 审查标准示例
### 正确 finding 示例
{
  "findings": [{
    "severity": "critical",
    "location": "第4段",
    "description": "修仙世界中主角使用了手枪。该世界观的力量体系已明确为灵气修炼，未设定有火器存在。",
    "suggestion": "改为使用法术或法器类似效果的描写",
    "snippet": "他从怀中掏出一把手枪，对准了妖兽。",
    "autoFixable": true,
    "fixedText": "他双手结印，指尖凝聚出一道刺目的灵光，对准了妖兽。"
  }]
}

### 错误 finding 示例（不要报）
不报：修真门派中主角的佩剑颜色与设定文件中描述不一致。
原因：装备外观颜色不属于世界观规则，属于美术细节。只有涉及核心规则（如修炼体系、势力关系）的违反才需要报告。

## 世界观设定
- 时代背景：${w.timePeriod}
- 主要地点：${w.location}
- 社会结构：${w.socialStructure}
- 力量体系：${w.powerSystem}
- 势力/门派：${w.factions.join("、")}
- 世界规则：${w.rules.join("、")}

## 审查任务
以下是需要审查的生成文字：
${input.generatedProse.slice(0, 8000)}

请输出你的审查发现。没有发现则返回空数组。`

    : `## Review Guidelines
You are a world-building consistency reviewer. Check if the generated prose violates established world rules.

### Severity
- **critical** = Core power system rule broken; irreversible world law violated
- **major** = Social structure or faction relationship incorrectly depicted; location contradicts setting
- **minor** = World-building detail slightly inaccurate but direction is correct

### Checklist
1. Is the core power/magic/cultivation system violated?
2. Are social hierarchy and power dynamics correct?
3. Are faction/guild relationships and stances correct?
4. Do location descriptions match the world setting?
5. Does anything appear that doesn't exist in this world?

## Example — Correct Finding
{
  "findings": [{
    "severity": "critical",
    "location": "Paragraph 4",
    "description": "Protagonist uses a handgun in a cultivation world. The power system is established as qi-based cultivation with no firearms.",
    "suggestion": "Replace with spell/artifact equivalent",
    "snippet": "He drew a handgun from his robes and aimed at the beast.",
    "autoFixable": true,
    "fixedText": "He formed hand seals, a blinding spiritual light condensing at his fingertips as he aimed at the beast."
  }]
}

## Example — Do NOT Report
Do not report: Character's sword color differs from the setting document.
Reason: Equipment color is cosmetic detail, not a world rule. Only flag violations of core systems and faction relationships.

## World Setting
- Time Period: ${w.timePeriod}
- Location: ${w.location}
- Social Structure: ${w.socialStructure}
- Power System: ${w.powerSystem}
- Factions: ${w.factions.join(", ")}
- Rules: ${w.rules.join(", ")}

## Task
Review the following generated prose:
${input.generatedProse.slice(0, 8000)}

Output your findings. Return empty array if nothing to report.`;
```

- [ ] **Step 6: Rewrite `reviewPacing` prompt (lines 417-433)**

Replace the prompt construction block:

```typescript
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
```

with:

```typescript
  const prompt = zh
    ? `## 审查指南
你是节奏审查员。你的工作是检查生成文字是否符合要求的节奏和冲突强度。

### 严重级别
- **critical** = 节奏与要求完全相反（要求快节奏的战斗被写成慢悠悠的心理描写）
- **major** = 关键情节节点被无关内容淹没（拖沓），或重要转折一笔带过（仓促）
- **minor** = 段落级别的节奏微调建议

### 检查清单
1. 整体节奏是否与要求的 pacing 一致
2. 冲突的强度递进是否与故事节点匹配
3. 是否有拖沓：关键情节被大量无关描写或对话稀释
4. 是否有仓促：重要情感转折或动作场景缺少应有的展开
5. 场景结尾是否达到了预期的情感落点

## 审查标准示例
### 正确 finding 示例
{
  "findings": [{
    "severity": "major",
    "location": "第3-5段",
    "description": "要求是fast节奏的战斗场景，但第3-5段用了大量篇幅描写周围环境和回忆，导致紧张感消失。",
    "suggestion": "压缩环境描写到1-2句，将回忆留到战斗结束后再展开",
    "snippet": "周围的树林静谧幽深，让他想起了十年前那个秋天...（略200字）",
    "autoFixable": false
  }]
}

### 错误 finding 示例（不要报）
不报：一个要求medium节奏的场景中，有一段较长的对话。
原因：对话可以推进情节和角色发展，不等于拖沓。只有对情节推进或角色发展没有贡献的纯粹填充分会构成节奏问题。

## 场景要求
- 节奏：${input.codex.currentTask.pacing}
- 冲突类型：${input.codex.currentTask.conflictType}
- 故事节点：${input.codex.currentTask.storyBeat}
- 赌注：${input.codex.currentTask.stakes}

## 审查任务
以下是需要审查的生成文字：
${input.generatedProse.slice(0, 8000)}

请输出你的审查发现。没有发现则返回空数组。`

    : `## Review Guidelines
You are a pacing reviewer. Check if the generated prose pacing matches requirements.

### Severity
- **critical** = Pacing is opposite of requirement (fast fight scene written as slow introspection)
- **major** = Key plot points buried under irrelevant content (dragging), or important turns glossed over (rushed)
- **minor** = Paragraph-level pacing refinement

### Checklist
1. Does overall pacing match the required pacing setting?
2. Does conflict intensity escalation match the story beat?
3. Is there dragging — key plot diluted by unrelated description/dialogue?
4. Is there rushing — important emotional turns or action scenes lack needed development?
5. Does the scene end at the expected emotional landing point?

## Example — Correct Finding
{
  "findings": [{
    "severity": "major",
    "location": "Paragraphs 3-5",
    "description": "Scene requires fast-paced combat but paragraphs 3-5 spend significant length on environment description and flashback, losing tension.",
    "suggestion": "Compress environment to 1-2 lines; save the flashback for after the fight",
    "snippet": "The surrounding forest was serene and deep, reminding him of that autumn ten years ago... (~200 chars)",
    "autoFixable": false
  }]
}

## Example — Do NOT Report
Do not report: A medium-paced scene has a long dialogue exchange.
Reason: Dialogue can advance plot and character. It's only a pacing issue if the dialogue contributes nothing to plot or character development.

## Requirements
- Pacing: ${input.codex.currentTask.pacing}
- Conflict: ${input.codex.currentTask.conflictType}
- Beat: ${input.codex.currentTask.storyBeat}
- Stakes: ${input.codex.currentTask.stakes}

## Task
Review the following generated prose:
${input.generatedProse.slice(0, 8000)}

Output your findings. Return empty array if nothing to report.`;
```

- [ ] **Step 7: Verify build**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/core/codex/review-orchestrator.ts
git commit -m "feat: rewrite all 6 review agent prompts with guidelines and few-shot examples"
```

---

### Post-Implementation Verification

- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] The shared system prompt is bilingual and populated with actual scene/outline data
- [ ] Each agent's user prompt contains: guidelines, severity definitions, checklist, correct example, wrong example
- [ ] English and Chinese prompts are equally detailed (no more one-sentence English prompts)
- [ ] Foreshadowing autoFixable is no longer always `false`
