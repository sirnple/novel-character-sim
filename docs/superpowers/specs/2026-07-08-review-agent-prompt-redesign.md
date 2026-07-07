# Review Agent Prompt Redesign

**Date:** 2026-07-08
**Status:** draft

## Problem

All 6 review agents have thin prompts — the Chinese version has a few checklist items, the English version is a single sentence. None of them understand the chapter's purpose, the scene context, or the author's intent. They operate in a vacuum.

## Goal

Give every agent a shared understanding of "what this chapter is trying to do" (system prompt) plus domain-specific guidance with detailed criteria and few-shot examples (user prompt).

## Design

### 1. Shared System Prompt

All 6 agents receive the same system prompt. Constructed once, reused for all.

```
你是小说《<novelTitle>》的审查编辑。你正在审查第<chapterNumber>章的生成文字。

## 本章写作目标
- 场景目标/章节目标：<sceneGoal | chapterGoal>
- 情感弧线：<emotionalArc>
- 预期结尾：<sceneEnding | chapterEnding>
- 情节节拍：
<beats — each as: 节拍N：description [出场：chars] [氛围：mood]>
- 节奏要求：<pacing>

## 作者设定的场景
- 地点：<location>
- 时间：<timeOfDay>
- 天气：<weather>
- 氛围：<atmosphere>
- 初始情境：<initialSituation>

## 前文上下文（承接点前的原文）
<last 2000 chars of fullNovelOutput, or "这是第一章，无前文">

## 出场角色当前状态
<for each character in scene:
  - name: currentLocation, currentEmotion, currentGoal
>

## 叙事要求
- 视角：<pointOfView>
- 基调：<tone>
- 目标篇幅：<targetLength>
```

**Implementation:** A `buildSharedReviewSystemPrompt()` function in `review-orchestrator.ts` that takes the outline, scene definition, character states, and existing prose, and returns the system prompt string.

### 2. Per-Agent User Prompt Structure

Each agent's user prompt follows this template:

```
## 审查指南
<role description, dimension definition>
<severity criteria — what is critical/major/minor for this dimension>
<specific checklist items>

## 审查标准示例
### 正确 finding 示例
<1-2 examples of what SHOULD be reported, in the REVIEW_SCHEMA JSON shape>

### 错误 finding 示例（不要报）
<1 example of a borderline case that should NOT be reported, with reason>

## 领域上下文
<dimension-specific data: character dossiers, chapter summaries, style fingerprint, world bible, foreshadowing ledger, etc.>

## 审查任务
以下是需要审查的生成文字：
<prose.slice(0, 8000)>

请输出你的审查发现。没有发现则返回空数组。
```

### 3. Per-Agent Specifics

#### 3a. Character Consistency

**领域上下文:**
- 每个出场角色的完整档案片段：性格特征、说话风格、口头禅、驱动力（目标、恐惧、底线）
- 每个角色的前 3 条语录（如有）

**Severity 定义:**
```
critical = 角色行为与其核心人格彻底矛盾（如一个胆小的角色突然主动挑衅强者），且场景没有铺垫这种变化
major = 角色的说话风格明显偏离设定（如口头禅消失、句式突然改变），但行为大致合理
minor = 措辞微调问题（如用语偏向但仍在角色可接受范围内）
```

**检查清单:**
1. 角色的行为是否符合其性格特征和驱动力
2. 角色的对话是否匹配其说话风格和口头禅
3. 角色是否在未铺垫的情况下做了与其恐惧/底线冲突的事
4. 角色的决策是否与其核心目标一致

**Few-shot — 正确示例:**
```json
{
  "findings": [{
    "severity": "major",
    "location": "第3段",
    "description": "张小凡说'没问题，我来承担'，但他的人设是极度缺乏自信、遇事退缩。此处没有铺垫他为什么会突然变得有担当。",
    "suggestion": "改为他犹豫片刻后低声说'我试试'，或者在前文加入他被师父训话后决定改变的铺垫",
    "snippet": "张小凡点点头：\"没问题，我来承担。\"",
    "autoFixable": true,
    "fixedText": "张小凡低下头，犹豫了好一会儿，才低声道：\"我...我试试。\""
  }]
}
```

**Few-shot — 错误示例:**
```
不报：角色在极度愤怒时说了一句不符合日常风格的重话。
原因：角色在强烈情绪下可以暂时偏离常态，这是合理的戏剧表达，不是角色断裂。
```

#### 3b. Continuity

**领域上下文:**
- 所有前文章节摘要（每章 1-2 句话）
- 角色存活状态 + 当前位置

**Severity 定义:**
```
critical = 已死亡的角色出现；关键事实与已建立的事件链矛盾；前文明确否定的事件在此章被当作事实
major = 物品或信息凭空出现（前文未提及）；角色知道了他不应该知道的信息
minor = 细节不一致但不对情节逻辑产生影响（如一个配角两章前的衣服颜色不对）
```

**检查清单:**
1. 已死亡或已离开场景的角色是否又出现并说话/行动
2. 物体、设定或信息是否凭空出现（前文完全未提及）
3. 因果链是否断裂（事件B发生了但缺乏必要的前因）
4. 时间线是否矛盾（提到某事件发生的时间与实际不符）
5. 同一角色是否在同一场景说出矛盾的信息
6. 角色是否知道他们不应该知道的信息

**Few-shot — 正确示例:**
```json
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
```

**Few-shot — 错误示例:**
```
不报：一个客栈的布局描写，大堂在左、厨房在右。与前文"进了客栈右手边是大堂"不完全一致。
原因：这种空间方位细节不属于事实矛盾。除非影响了情节（如角色因为方位错误走错房间引发关键剧情），否则不应报告。
```

#### 3c. Foreshadowing

**领域上下文:**
- 活跃伏笔列表：类型、描述、埋入章节、建议回收窗口
- 如无活跃伏笔，简化提示（当前已有 early return，不改）

**Severity 定义:**
```
critical = 一个应该在此场景中回收或推进的重要伏笔被完全忽略
major = 伏笔在回收时与原埋入条件明显矛盾
minor = 伏笔有轻微推进但不够清晰
```

**检查清单:**
1. 新埋的伏笔：描述、类型、建议回收窗口
2. 已有活跃伏笔是否被推进或回收
3. 应该在此章节回收的伏笔是否被忽略
4. 伏笔回收是否与原设定一致

**autoFixable 改为:** `f.severity !== "critical"` （伏笔也可以 auto-fix，只有 critical 需要人工确认）

**Few-shot — 正确示例:**
```json
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
```

**Few-shot — 错误示例:**
```
不报：活跃伏笔列表里有"主角的身世之谜"，但本章主角没有出场。
原因：主角不在场的章节中不涉及该伏笔是正常的。只报在当前出场角色身上应该推进但未推进的伏笔。
```

#### 3d. Style

**领域上下文:**
- 风格指纹：句长、对话比、常用句式开头、常用转折词、词汇层级、节奏特征
- 原著风格描述（genre、styleDescription、narrativeTechniques、languageFeatures）
- 2-3 个原著代表性片段（examplePassages）

**Severity 定义（保持现有）:**
```
critical = 严重风格断裂（如古风小说突然出现现代网络用语）
major = 明显的风格不一致（如句长突然翻倍、对话比剧变）
minor = 可微调的措辞问题
```

**检查清单:**
1. 句长是否与指纹偏离超过 30%
2. 对话占比是否合理
3. 是否有 AI 味的公式化表达（反复出现的套话、机械过渡词、"不知为何"等万能表达）
4. 句式是否单调重复
5. 与原著代表性片段的笔法是否一致
6. 是否出现了不符合原著时代的用语

**Few-shot — 正确示例:**
```json
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
```

**Few-shot — 错误示例:**
```
不报：生成文字的句长略短于原著平均（18字 vs 22字）。
原因：minor 程度的句长波动属于正常的写作变化。除非句长偏离超过30%或导致节奏明显异常，否则不报。
```

#### 3e. World Building

**领域上下文:**
- 世界观圣经的完整展开（不只是字段名）：时代背景描述、社会等级具体规则、力量体系规则细节、各势力关系说明、世界具体规则列表
- 应展开为可读的自然语言段落，而非只列字段值

**Severity 定义:**
```
critical = 力量体系核心规则被打破；不可逆的世界规则被违反
major = 社会结构或势力关系被错误描述；地点特征与设定矛盾
minor = 世界观相关的细节措辞不够准确但整体方向正确
```

**检查清单:**
1. 力量/魔法/修炼体系的核心规则是否被打破
2. 社会等级和权力关系是否正确
3. 势力/门派之间的立场和关系是否正确
4. 地点描述是否与世界观设定一致
5. 是否出现了世界观中不存在的技术、物品或概念

**Few-shot — 正确示例:**
```json
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
```

**Few-shot — 错误示例:**
```
不报：修真门派中主角的佩剑颜色与设定文件中描述不一致。
原因：装备外观颜色不属于世界观规则，属于美术细节。只有涉及核心规则（如修炼体系、势力关系）的违反才需要报告。
```

#### 3f. Pacing

**领域上下文:**
- 当前任务：节奏要求、冲突类型、故事节点、赌注
- 场景大纲中的预期情感弧线和结尾

**Severity 定义:**
```
critical = 节奏与要求完全相反（要求快节奏的追逐战被写成慢悠悠的心理描写）
major = 关键情节节点被无关内容淹没（拖沓），或重要转折一笔带过（仓促）
minor = 段落级别的节奏微调建议
```

**检查清单:**
1. 整体节奏是否与要求的 pacing 一致
2. 冲突的强度递进是否与故事节点匹配
3. 是否有拖沓：关键情节被大量无关描写或对话稀释
4. 是否有仓促：重要情感转折或动作场景缺少应有的展开
5. 场景结尾是否达到了预期的情感落点

**Few-shot — 正确示例:**
```json
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
```

**Few-shot — 错误示例:**
```
不报：一个要求medium节奏的场景中，有一段较长的对话。
原因：对话可以推进情节和角色发展，不等于拖沓。只有对情节推进或角色发展没有贡献的纯粹填充分会构成节奏问题。
```

### 4. Implementation

**File:** `src/core/codex/review-orchestrator.ts`

All changes are within this file.

#### New function: `buildSharedReviewSystemPrompt()`

Takes: `novelTitle: string`, `chapterNumber: number`, `outline: SceneOutline | null`, `scene: SceneDefinition`, `characterStates: CharacterChapterState[]`, `previousProse: string`, `writingStyle: WritingStyle | null`

Returns: the shared system prompt string (bilingual, using `isChinese()`).

#### Modified functions: all 6 `reviewXxx()` functions

Each function is updated to:
1. Accept the shared system prompt as a parameter
2. Build its domain-specific user prompt (guidelines + few-shot + domain data + task)
3. Send `[{ role: "system", content: sharedPrompt }, { role: "user", content: domainPrompt }]` to LLM

#### Caller: `runFullReview()`

1. Call `buildSharedReviewSystemPrompt()` once
2. Pass `sharedSystemPrompt` to each review function
3. Each review function builds its own user prompt

### 5. Files Changed

| File | Change |
|------|--------|
| `src/core/codex/review-orchestrator.ts` | Add `buildSharedReviewSystemPrompt()`, rewrite all 6 agent prompts |

### 6. Out of Scope

- Changing the number of review agents (stays at 6)
- Changing the REVIEW_SCHEMA output format
- Changing the `runFullReview()` orchestration (parallel Promise.all stays)
- Changing the rewrite pipeline (untouched)
- Making the shared prompt context-aware of foreshadowing ledger (each agent only gets relevant domain data)
