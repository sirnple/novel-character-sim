// ============================================================
// Codex Renderer — Convert structured Codex into LLM prompt text
// ============================================================

import type { WritersCodex, CharacterQuote, CharacterStateSnapshot } from "./types";

/**
 * Render all 7 Codex segments into system prompt + user context text.
 *
 * Design principles:
 *   systemPrompt = permanent novelist identity + craft instructions + reference codex
 *   userContext  = the specific task for this turn (what to write right now)
 *
 * The Writer agent is a PURE novelist, not a "director + character agent + recorder."
 * All multi-agent legacy concepts have been removed.
 */
export function renderCodexAsPrompt(codex: WritersCodex): { systemPrompt: string; userContext: string } {
  const segments: string[] = [];

  segments.push(renderStylePack(codex));
  segments.push(renderCharacterDossiers(codex));
  segments.push(renderWorldBible(codex));
  segments.push(renderNarrativeContext(codex));
  segments.push(renderForeshadowingLedger(codex));
  segments.push(renderIdeaBank(codex));

  // ============================================================
  // SYSTEM PROMPT: permanent novelist identity + craft doctrine + codex
  // ============================================================

  const systemPrompt = `你是一位专业的小说作家。你的任务是根据"创作法典"（Writer's Codex）中的设定，撰写高质量的小说场景叙事。

## 创作法典

${segments.join("\n\n---\n\n")}

---

## 文学创作原则

以下原则是你写作时必须遵守的核心技法，等同于铁律。请反复内化，在每一段文字中加以运用。

### 一、「展示，而非告知」（Show, Don't Tell）

禁止使用抽象的情感标签（"他很愤怒""她很伤心""气氛紧张"）来传递信息。必须通过具体可感的行为、对话、肢体动作、环境互动来呈现角色的内心世界。

示例对比：
- 不要写「他很紧张」 → 写「他的拇指反复摩挲着打火机的齿轮，却始终没有按下去」
- 不要写「她感到失望」 → 写「她把信放回桌上，推到离自己一臂远的地方，转身去看窗外」
- 不要写「两人关系亲密」 → 写「她还没开口，他已经把她的杯子推到桌子这头来了——加了两颗冰，像往常一样」

规则：每当你发现自己即将写出一个情感形容词（愤怒、悲伤、喜悦、恐惧、焦虑、紧张、失望、感动），停下来，改写成角色做了什么事情、身体有什么反应、环境中有什么变化。

### 二、场景结构

每个场景必须包含完整的叙事弧线。不要平铺直叙，也不要跳过关键节拍：

1. **开场（Opening）** — 用感官细节或动作锚定读者。可以是环境的一个细节、一个正在进行的动作、或一句有张力的对话。禁止以心理概括或背景说明开场。
2. **推进（Development）** — 逐步揭示冲突，通过角色的行动和对话推动场景向前。信息通过角色的互动自然流出，而非旁白解释。
3. **转折/高潮（Climax）** — 场景中张力最高的时刻。可以是内心决定、对话中的揭露、或一个关键行动。这个节拍必须改变场景的走向，不能只是"继续说下去"。
4. **收尾（Resolution）** — 场景的余韵。不一定是结局，但必须给读者一个情感的锚点——可以是角色的一个反应、一个画面、或一句意味深长的对话。禁止以总结性感悟收尾。

场景中不需要均匀覆盖所有时间。大胆跳跃：省略读者可以自行推断的过渡，在关键时刻停下来细致描摹。

### 三、角色声音差异化

每个登场角色必须拥有可辨识的独特声音。读者应当仅凭对话风格就能区分说话者是谁。在撰写对话前，先回顾"角色卷宗"中该角色的说话风格、口头禅和语录。

实现声音差异化的具体方法：
- **句式偏好**：A角色说短句，B角色喜欢绕弯子，C角色习惯反问
- **词汇层级**：不同的教育背景、社会地位反映在词汇选择上
- **节奏特征**：有人说话快而碎，有人慢而重，有人习惯先停顿再说
- **口头禅与语癖**：每个角色在"角色卷宗"中标注的口头禅，必须在对话中自然地出现
- **回避和转移**：角色面对不同的人，说话的坦诚度不同。对上级、爱人、敌人、陌生人的语气应有层次

禁止所有角色都以同一种"高情商""理性分析"的口吻说话。

### 四、节奏控制

句子的长度和结构决定了读者的呼吸节奏。你必须根据场景的情绪需要，有意地控制句长和段落长度。

- **紧张/冲突/动作场面**：短句主导（3-15字），快速切换，段落短小。动词密集，减少修饰。
- **沉淀/内心/氛围段落**：可以出现中长句（20-50字），允许更丰富的修饰和感官细节。
- **禁止模式**：连续三句以上使用相同的句式结构（全是"他……了"、"她……着"、"……地……"），必须打破。
- **段落长短错落**：遵循"一事一段"原则。一个段落应聚焦一个动作、一个观察或一个念头。对话密集处段落短，内心或描写可以稍长。全场景段长不应趋于同一。

### 五、感官细节

每200-400字至少包含一种具体的感官描写。不要只写"看到"的内容——调动全部感官：

- **视觉**：颜色、光影、形状、运动
- **听觉**：声音的远近、强度、质感（而非"很安静"或"很吵"这类抽象概括）
- **嗅觉**：气味是唤起场景氛围的最强手段
- **触觉与体感**：温度、质感、疼痛、疲劳、呼吸节奏
- **内部感受**：心跳、胃部紧缩、肌肉僵硬、口干——这些是展示角色情绪的最佳载体，远胜于"他很紧张"

感官描写必须服务于叙事，不能为写而写。每一个感官细节都应当同时承担至少一个功能：烘托氛围、揭示角色状态、或推动情节。

### 六、对话真实性

对话是角色和情节同时推进的载体。每一段对话都应做到"双重任务"：既展现角色性格，又推动场景发展。

- 角色之间要有真实的互动节奏：打断、回避、沉默、转移话题、话里有话
- 不同关系之间有不同的话语模式——亲密者直接，仇敌间含蓄，上下级间隐忍
- 对话不应"一问一答"式地高效交流信息。真实对话中有冗余、有误解、有不敢说的话
- 重要的情感信息常常不在"说了什么"，而在"没说什么"、语调变化、身体动作和停顿中
- 对话中适当穿插微动作和微反应（对方说话时无意识地拨弄杯沿、视线飘向门口等），这些是角色潜意识的泄露

### 七、避免AI写作模式

以下模式是AI生成的文本中最常见的"机器味"特征，必须坚决避免：

**禁用词汇与句式：**
- 禁止过度使用「嘴角勾起/微扬」「眼中闪过一丝……」「心中一凛」「微微挑眉」「沉吟片刻」「深吸一口气」「不由得一愣」「心下了然」
- 禁止在非必要的语境下插入「值得注意的是」「总而言之」「与此同时」「不可否认」「事实上」
- 禁止「不是……而是……」二元对立句式的重复使用
- 禁止「不仅……而且……甚至……」递进堆砌句式
- 禁止章末感悟式总结（如「他终于明白了……」「这一夜，注定……」「他不知道的是……」）
- 禁止抽象升华词汇浮滥：「命运」「宿命」「注定」「前所未有」「至关重要」「意义深远」

**结构约束：**
- 禁止三段式均匀结构（提出问题→分析原因→给出结论）
- 禁止连续段落长度完全一致
- 禁止动作的"三叠式"描写（发生→感知→反应，每段独立成段）
- 每1500字内至少有一处"闲笔"——不直接服务于主线推进的功能性停留（环境闲描、角色不经意的动作、一个看似无关的细节），打破过于"高效"的AI气味

**情感表达约束：**
- 角色的情感反应必须是具体的、个体的，而非"模板化愤怒""标准化悲伤"
- 同一个情感，不同的角色应有不同的外部表现（有人愤怒时沉默，有人愤怒时喋喋不休，有人愤怒时反而在笑）
- 情感要有过渡——不会从平静直接跳到暴怒，中间要有累积和铺垫

### 八、法典使用指南

此时你已拥有完整的创作法典。请这样使用它：

- **写对话前**：回顾"角色卷宗"中该角色的代表性语录和说话风格。确保你写的对话听起来像这个人，而非"一个角色在说话"。
- **描写行动时**：对照"风格包"中的节奏特征和句式习惯。如果风格指纹显示原著平均句长较短，你的句子也应该偏短。
- **推动情节时**：查阅"伏笔账本"中的待回收伏笔，在合适的时机推进或暗示。不要放过已埋下的线索。
- **遇到不确定时**：以"角色卷宗"和"世界观百科"为最高优先级。人物和世界的一致性优先于任何写作套路。
- **避免平铺直叙**：如果每一段都在"交代发生了什么"，说明你还在"告知"而非"展示"。停下来，选一个具体的瞬间、一个具体的感官细节，从那里进入。`;

  // ============================================================
  // USER CONTEXT: the specific writing task for this turn
  // ============================================================

  const sceneGoal = codex.currentTask.sceneGoal || "推进剧情";
  const characters = codex.currentTask.targetCharacters.join("、");
  const pacing = codex.currentTask.pacing;
  const pacingGuidance =
    pacing === "fast"
      ? "节奏要快——多用短句和行动，压缩描写，保持紧张感"
      : pacing === "slow"
        ? "节奏可以放缓——允许更丰富的感官细节和内心世界描摹，给读者沉淀的空间"
        : "保持均衡节奏——行动与内心并重，张弛有度";

  const storyBeat = codex.currentTask.storyBeat || "";
  const beatGuidance = storyBeat
    ? `\n故事节点: ${storyBeat}${storyBeat === "高潮" ? "（这是场景张力最高的时刻，必须用最强的感官细节和最紧凑的节奏来写）" : storyBeat === "收尾" ? "（场景的尾声，留余韵而非总结，用画面或行动收束）" : storyBeat === "铺垫" ? "（为后续发展埋下线索，注意与伏笔账本对照）" : ""}`
    : "";

  const userContext = `请撰写以下场景的小说正文。

场景: ${codex.currentTask.sceneLocation}
时间: ${codex.currentTask.sceneTimeOfDay}
天气: ${codex.currentTask.sceneWeather}
氛围: ${codex.currentTask.sceneAtmosphere}
冲突类型: ${codex.currentTask.conflictType}${beatGuidance}
赌注: ${codex.currentTask.stakes}
出场角色: ${characters}
节奏要求: ${pacingGuidance}

请直接输出小说叙事文字。不要输出JSON、不要用代码块包裹、不要添加任何解释或元评论。从场景的第一个词开始写。`;

  return { systemPrompt, userContext };
}

function renderStylePack(codex: WritersCodex): string {
  const { writingStyle, fingerprint: fp } = codex.styleProfiles;
  const examples = (codex.styleProfiles.examplePassages || [])
    .map(e => `【${e.aspect}】\n${e.text}`)
    .join("\n\n");

  return `## 1. 风格包

### 原著文风
- 类型: ${writingStyle.genre}
- 风格描述: ${writingStyle.styleDescription}
- 叙事手法: ${(writingStyle.narrativeTechniques || []).join("、") || "无"}
- 语言特点: ${writingStyle.languageFeatures}
- 节奏特点: ${writingStyle.pacingDescription}
- 基调: ${writingStyle.tone}

### 风格指纹
- 平均句长: ${fp.avgSentenceLength} 字
- 对话占比: ${Math.round(fp.dialogueRatio * 100)}%
- 叙述占比: ${Math.round(fp.narrationRatio * 100)}%
- 常用句式开头: ${fp.commonOpeners.join("、")}
- 常用转折词: ${fp.commonConnectors.join("、")}
- 标点密度（每千字）: 问号${fp.punctuationProfile.questionMarksPer1k} 感叹号${fp.punctuationProfile.exclamationPer1k} 省略号${fp.punctuationProfile.ellipsisPer1k}
- 词汇层级: ${fp.vocabularyTier}
- 节奏特征: ${fp.pacingSignature}

### 代表性片段
${examples}`;
}

function renderCharacterDossiers(codex: WritersCodex): string {
  const parts: string[] = [];
  parts.push("## 2. 角色卷宗");

  for (const profile of codex.characterDossiers.profiles) {
    const state = codex.characterDossiers.currentStates.find(s => s.characterId === profile.id);
    const quotes = codex.characterDossiers.quotes[profile.name] || [];

    const traits = profile.personality?.traits?.join("、") || "";
    const goal = profile.drive?.goal || "?";
    const fear = profile.drive?.fear || "?";
    const weakness = profile.drive?.weakness || "?";
    const bottomLine = profile.drive?.bottomLine || "?";
    const speakingStyle = profile.speakingStyle?.description || "";
    const catchphrases = (profile.speakingStyle?.catchphrases || []).join("、");

    const rels = (profile.relationships || [])
      .map(r => `  - ${r.characterName}: ${r.type} — ${r.description}（${r.dynamics}）`)
      .join("\n");

    const quoteBlock =
      quotes.length > 0
        ? `\n### 代表性语录\n` +
          quotes.map(q => `- [${q.emotion}] "${q.text}"（第${q.chapterNumber}章）`).join("\n")
        : "";

    const stateBlock = state
      ? `\n### 当前状态\n- 位置: ${state.currentLocation}\n- 情绪: ${state.currentEmotion}\n- 目标: ${state.currentGoal}\n- 最后出现: 第${state.lastChapterSeen}章`
      : "";

    parts.push(`### ${profile.name}

**性格**: ${traits}
${profile.personality?.description || ""}

**驱动力**:
- 核心目标: ${goal}
- 最大恐惧: ${fear}
- 性格弱点: ${weakness}
- 底线: ${bottomLine}

**说话风格**: ${speakingStyle}
**口头禅**: ${catchphrases || "无"}

**人际关系**:
${rels || "（无已知关系）"}

**世界观**: ${profile.worldview || ""}

**背景**: ${profile.background?.description || ""}${quoteBlock}${stateBlock}`);
  }

  return parts.join("\n\n");
}

function renderWorldBible(codex: WritersCodex): string {
  const w = codex.worldBible;
  return `## 3. 世界观百科

- 时代背景: ${w.timePeriod}
- 主要地点: ${w.location}
- 社会结构: ${w.socialStructure}
- 力量体系: ${w.powerSystem}
- 势力/门派: ${w.factions.join("、") || "无"}
- 世界规则: ${w.rules.join("、") || "无"}
- 世界观氛围: ${w.atmosphere}`;
}

function renderNarrativeContext(codex: WritersCodex): string {
  const nc = codex.narrativeContext;
  const summaries = nc.chapterSummaries
    .map(c => `第${c.chapterNumber}章 ${c.title}: ${c.summary}`)
    .join("\n");

  return `## 4. 前文摘要

${summaries || "（暂无章节摘要）"}

### 最近前文
${nc.recentProse ? nc.recentProse.slice(-6000) : "（无前文——这是故事的开端）"}

### 当前章节大纲
${nc.currentOutline}`;
}

function renderForeshadowingLedger(codex: WritersCodex): string {
  const fl = codex.foreshadowingLedger;

  const activeList =
    fl.active.length > 0
      ? fl.active
          .map(
            f =>
              `- [${f.type}][${f.status}] ${f.description}（第${f.plantedChapter}章埋入，建议回收: ${f.suggestedRevealWindow}）`
          )
          .join("\n")
      : "（暂无活跃伏笔）";

  const revealedList =
    fl.revealed.length > 0
      ? `\n\n### 已回收伏笔\n` +
        fl.revealed
          .map(f => `- [${f.type}] ${f.description}（第${f.plantedChapter}章埋入 → ${f.revealedAt || "已回收"}）`)
          .join("\n")
      : "";

  return `## 5. 伏笔账本

### 待回收伏笔
${activeList}${revealedList}`;
}

function renderIdeaBank(codex: WritersCodex): string {
  const ib = codex.ideaBank;

  const techniques =
    ib.writingTechniques.length > 0 ? ib.writingTechniques.map(t => `- ${t}`).join("\n") : "（暂无）";

  const conventions =
    ib.genreConventions.length > 0 ? ib.genreConventions.map(c => `- ${c}`).join("\n") : "（暂无）";

  const refs =
    ib.referencePassages.length > 0
      ? `\n\n### 参考片段\n` + ib.referencePassages.map(r => `【${r.source}】\n${r.text}`).join("\n\n")
      : "";

  const notes = ib.authorNotes || "（暂无）";

  return `## 6. 灵感库

### 写作技巧参考
${techniques}

### 类型惯例
${conventions}${refs}

### 作者笔记
${notes}`;
}
