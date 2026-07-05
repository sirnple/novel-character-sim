// ============================================================
// Codex Renderer — Convert structured Codex into LLM prompt text
// ============================================================

import type { WritersCodex, CharacterQuote, CharacterStateSnapshot } from "./types";

/**
 * Render all 7 Codex segments into system prompt + user context text.
 * The system prompt is designed to be the system message;
 * the user context is the first user message containing the specific task.
 */
export function renderCodexAsPrompt(codex: WritersCodex): { systemPrompt: string; userContext: string } {
  const segments: string[] = [];

  segments.push(renderStylePack(codex));
  segments.push(renderCharacterDossiers(codex));
  segments.push(renderWorldBible(codex));
  segments.push(renderNarrativeContext(codex));
  segments.push(renderForeshadowingLedger(codex));
  segments.push(renderIdeaBank(codex));

  const systemPrompt = `你是这部小说的创作者。以下是你需要了解的完整创作素材。请严格按照素材中的设定进行创作，保持角色一致性、风格一致性和世界观一致性。

${segments.join("\n\n---\n\n")}

## 创作指令
- 完全保持角色性格、说话风格和行为模式
- 严格遵循世界观规则和设定
- 注意已埋下的伏笔，适时推进或回收
- 叙事风格必须与原著风格指纹一致
- 如果素材中有矛盾之处，以"角色卷宗"和"世界观百科"为准`;

  const userContext = `## 本轮创作任务
场景: ${codex.currentTask.sceneLocation}
时间: ${codex.currentTask.sceneTimeOfDay}
天气: ${codex.currentTask.sceneWeather}
氛围: ${codex.currentTask.sceneAtmosphere}
目标: ${codex.currentTask.sceneGoal}
冲突类型: ${codex.currentTask.conflictType}
节奏: ${codex.currentTask.pacing}
出场角色: ${codex.currentTask.targetCharacters.join("、")}
赌注: ${codex.currentTask.stakes}

请开始创作，输出小说叙事文字。不要用JSON包裹。`;

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
