# Writer's Codex — Implementation Plan

> **For agentic workers:** Follow this plan task-by-task. Each step builds on the previous one, TDD where possible, commit frequently.

**Goal:** Build a Writer's Codex system that injects 7-segment pre-writing context into the Writer Agent using the 1M context window, and runs 6 parallel review agents post-writing.

**Architecture:** Pre-writing: CodexBuilder assembles 7 segments from existing extractor data + new voice/style profiling. Post-writing: 6 independent review agents check against Codex segments, auto-fix minor issues, flag major ones.

**Tech Stack:** TypeScript, Next.js 14 App Router, existing extractors + simulation engine

---

### Task 1: Codex Data Types

**Files:**
- Create: `src/core/codex/types.ts`

Define the Codex data structures that all other modules consume.

```typescript
// ============================================================
// Writer's Codex — Data Types
// ============================================================

/** A representative spoken line from a character with emotional context */
export interface CharacterQuote {
  text: string;
  emotion: string;       // "angry", "sad", "happy", "neutral", "tense", "calm"
  context: string;       // one-line scene context
  chapterNumber: number;
}

/** Statistical style fingerprint extracted from source text */
export interface StyleFingerprint {
  avgSentenceLength: number;
  dialogueRatio: number;         // fraction of text that is dialogue (0-1)
  narrationRatio: number;        // fraction that is narration (0-1)
  commonOpeners: string[];       // top 10 sentence-starting patterns
  commonConnectors: string[];    // top transition phrases
  punctuationProfile: {
    questionMarksPer1k: number;
    exclamationPer1k: number;
    ellipsisPer1k: number;
    emDashPer1k: number;
  };
  vocabularyTier: string;        // "literary", "vernacular", "mixed", "technical"
  pacingSignature: string;       // descriptive: e.g. "short sentences during action, long during reflection"
}

/** Current state snapshot for one character */
export interface CharacterStateSnapshot {
  characterId: string;
  name: string;
  alive: boolean;
  currentLocation: string;
  currentEmotion: string;
  currentGoal: string;
  relationshipStates: Record<string, string>; // characterName → current dynamic
  lastChapterSeen: number;
}

/** A registered foreshadowing element */
export interface ForeshadowingEntry {
  id: string;
  type: "plot" | "character" | "world" | "relationship" | "mystery" | "theme";
  description: string;
  plantedChapter: number;
  plantedAt: string;              // scene/event where it was planted
  suggestedRevealWindow: string;  // e.g. "Chapter 8-12"
  revealed: boolean;
  revealedAt?: string;
  status: "pending" | "advancing" | "revealed" | "abandoned";
}

/** Chapter summary for the rolling context window */
export interface ChapterSummary {
  chapterNumber: number;
  title: string;
  summary: string;           // 200-300 chars
  keyEvents: string[];       // one-line per event
  characterChanges: Record<string, string>; // name → state change description
}

/** The full 7-segment Codex assembled before each writing session */
export interface WritersCodex {
  // Segment 1: Style Pack
  styleProfiles: {
    writingStyle: import("@/types").WritingStyle;
    fingerprint: StyleFingerprint;
    examplePassages: import("@/types").ExamplePassage[];
  };

  // Segment 2: Character Dossiers
  characterDossiers: {
    profiles: import("@/types").CharacterProfile[];
    quotes: Record<string, CharacterQuote[]>; // characterName → quotes
    currentStates: CharacterStateSnapshot[];
  };

  // Segment 3: World Bible
  worldBible: {
    timePeriod: string;
    location: string;
    socialStructure: string;
    powerSystem: string;
    factions: string[];
    rules: string[];
    atmosphere: string;
  };

  // Segment 4: Narrative Context
  narrativeContext: {
    chapterSummaries: ChapterSummary[];
    recentProse: string;       // last 3 chapters full text
    currentOutline: string;    // current chapter/scene outline
  };

  // Segment 5: Foreshadowing Ledger
  foreshadowingLedger: {
    active: ForeshadowingEntry[];
    revealed: ForeshadowingEntry[];
  };

  // Segment 6: Idea Bank
  ideaBank: {
    writingTechniques: string[];
    genreConventions: string[];
    referencePassages: { source: string; text: string }[];
    authorNotes: string;
  };

  // Segment 7: Current Task
  currentTask: {
    sceneLocation: string;
    sceneTimeOfDay: string;
    sceneWeather: string;
    sceneAtmosphere: string;
    sceneGoal: string;
    conflictType: string;
    storyBeat: string;
    stakes: string;
    pacing: "fast" | "medium" | "slow";
    targetCharacters: string[];
  };
}

/** Review finding from a post-writing check */
export interface ReviewFinding {
  dimension: "character" | "continuity" | "foreshadowing" | "style" | "world" | "pacing";
  severity: "critical" | "major" | "minor";
  location: string;        // sentence/paragraph reference
  description: string;
  suggestion: string;
  snippet?: string;
  autoFixable: boolean;
  fixedText?: string;      // if auto-fix was applied
}

/** Result of a full post-writing review pass */
export interface ReviewReport {
  findings: ReviewFinding[];
  autoFixedCount: number;
  needsHumanReview: ReviewFinding[];
  updatedStates: Partial<CharacterStateSnapshot>[];
  newForeshadowing: ForeshadowingEntry[];
  revealedForeshadowing: string[];  // ids of now-revealed entries
  newChapterSummary: ChapterSummary;
}
```

### Task 2: Character Voice Extractor

**Files:**
- Create: `src/core/codex/voice-extractor.ts`

Extract representative character quotes from the novel text by finding dialogue lines for each character.

```typescript
import type { CharacterProfile, CharacterQuote } from "./types";

/**
 * Extract representative quotes for each character from the novel text.
 * Scans for dialogue patterns (「」, "", "", etc.) and matches speakers.
 */
export function extractCharacterQuotes(
  profiles: CharacterProfile[],
  fullText: string
): Record<string, CharacterQuote[]> {
  const result: Record<string, CharacterQuote[]> = {};

  for (const profile of profiles) {
    result[profile.name] = [];
  }

  // Split text into chapter-ish chunks (by chapter headers or ~2000 char blocks)
  const chapterBlocks = splitIntoChapters(fullText);

  for (const profile of profiles) {
    const quotes: CharacterQuote[] = [];

    for (let ci = 0; ci < chapterBlocks.length; ci++) {
      const block = chapterBlocks[ci];
      if (!block.includes(profile.name)) continue;

      // Find dialogue near this character's name
      const dialogueLines = extractNearbyDialogue(block, profile.name);
      for (const line of dialogueLines) {
        if (quotes.length >= 8) break; // max 8 quotes per character
        const emotion = classifyEmotion(line.text);
        quotes.push({
          text: line.text,
          emotion,
          context: line.context,
          chapterNumber: ci + 1,
        });
      }
    }

    result[profile.name] = quotes;
  }

  return result;
}

// ---- helpers ----

function splitIntoChapters(text: string): string[] {
  const chunks = text.split(/(?:第[零一二三四五六七八九十百千万\d]+[章節节]|Chapter\s+\d+)/i);
  return chunks
    .filter(c => c.trim().length > 100)
    .reduce<string[]>((acc, c, i) => {
      if (c.length > 8000) {
        // Split long chapters into 4000-char sub-blocks
        for (let j = 0; j < c.length; j += 4000) {
          acc.push(c.slice(j, j + 4000));
        }
      } else {
        acc.push(c);
      }
      return acc;
    }, []);
}

interface DialogueLine {
  text: string;
  context: string; // surrounding paragraph
}

function extractNearbyDialogue(block: string, characterName: string): DialogueLine[] {
  const lines: DialogueLine[] = [];

  // Chinese dialogue patterns: 「...」, "...", "...", 说：... etc.
  const dialogueRegex = /「([^」]+)」|"([^"]+)"|"([^"]+)"|：([^，。！？\n]{8,80})/g;
  let match: RegExpExecArray | null;

  while ((match = dialogueRegex.exec(block)) !== null) {
    const dialogue = match[1] || match[2] || match[3] || match[4] || "";
    if (dialogue.length < 5 || dialogue.length > 200) continue;

    // Check if this dialogue is near the character's name
    const pos = match.index;
    const contextStart = Math.max(0, pos - 100);
    const contextEnd = Math.min(block.length, pos + dialogue.length + 100);
    const context = block.slice(contextStart, contextEnd);

    if (context.includes(characterName)) {
      lines.push({ text: dialogue.trim(), context: context.trim().replace(/\n/g, " ") });
    }

    if (lines.length >= 12) break; // collect candidates, then pick best 8
  }

  // Pick diverse ones (different contexts)
  return deduplicateBySimilarity(lines).slice(0, 8);
}

function classifyEmotion(text: string): string {
  if (/[！!]{2,}|怒|恨|可惡|混蛋|杀|死/.test(text)) return "angry";
  if (/[。\.]{3,}|唉|寂寞|难过|悲伤|哭|泪/.test(text)) return "sad";
  if (/[哈啊呵嘿嘻]{2,}|笑|喜|乐|开心|高兴/.test(text)) return "happy";
  if (/危险|小心|警戒|注意|谁|什么/.test(text)) return "tense";
  if (/放心|没事|好|平静|安/.test(text)) return "calm";
  return "neutral";
}

function deduplicateBySimilarity(lines: DialogueLine[]): DialogueLine[] {
  const seen = new Set<string>();
  return lines.filter(l => {
    const key = l.text.slice(0, 20);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
```

### Task 3: Style Profiler

**Files:**
- Create: `src/core/codex/style-profiler.ts`

Compute statistical style fingerprints from the source text.

```typescript
import type { StyleFingerprint } from "./types";

/**
 * Compute a statistical style fingerprint from the novel text.
 * Used by the Reviewer to check generated prose matches the original style.
 */
export function computeStyleFingerprint(text: string): StyleFingerprint {
  // Take representative samples: start, middle, end
  const samples = [
    text.slice(0, 5000),
    text.slice(Math.floor(text.length / 2) - 2500, Math.floor(text.length / 2) + 2500),
    text.slice(-5000),
  ];

  const sentences = samples.flatMap(s => splitSentences(s));

  // Average sentence length
  const avgSentenceLength = sentences.reduce((sum, s) => sum + s.length, 0) / sentences.length;

  // Dialogue ratio
  const dialogueChars = samples.reduce((sum, s) => {
    const matches = s.match(/「[^」]*」|"[^"]*"|"[^"]*"/g) || [];
    return sum + matches.reduce((s2, m) => s2 + m.length, 0);
  }, 0);
  const totalChars = samples.reduce((sum, s) => sum + s.length, 0);
  const dialogueRatio = dialogueChars / totalChars;

  // Narration ratio (everything that's not dialogue)
  const narrationRatio = 1 - dialogueRatio;

  // Common sentence openers
  const openers = sentences
    .map(s => s.slice(0, Math.min(s.length, 3)))
    .filter(o => o.length >= 2);
  const openerCount = new Map<string, number>();
  for (const o of openers) {
    openerCount.set(o, (openerCount.get(o) || 0) + 1);
  }
  const commonOpeners = [...openerCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k]) => k);

  // Common transition phrases
  const transitionPatterns = /(突然|忽然|就在此时|紧接着|与此同时|不一会儿|过了许久|转眼间|随后|接着|然后|于是|然而|但是|不过|因此|所以|因为|虽然|如果|只要)/g;
  const connectorMatches = samples.join(" ").match(transitionPatterns) || [];
  const connectorCount = new Map<string, number>();
  for (const c of connectorMatches) {
    connectorCount.set(c, (connectorCount.get(c) || 0) + 1);
  }
  const commonConnectors = [...connectorCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k]) => k);

  // Punctuation profile (per 1000 chars)
  const totalK = totalChars / 1000;
  const questionMarksPer1k = (samples.join("").match(/[？?]/g) || []).length / totalK;
  const exclamationPer1k = (samples.join("").match(/[！!]/g) || []).length / totalK;
  const ellipsisPer1k = (samples.join("").match(/[。\.]{3,}|…/g) || []).length / totalK;
  const emDashPer1k = (samples.join("").match(/[—–-]{1,2}/g) || []).length / totalK;

  // Vocabulary tier
  const vocabTier = classifyVocabTier(samples.join(""));

  // Pacing signature (descriptive)
  const pacingSignature = describePacing(sentences, avgSentenceLength);

  return {
    avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
    dialogueRatio: Math.round(dialogueRatio * 1000) / 1000,
    narrationRatio: Math.round(narrationRatio * 1000) / 1000,
    commonOpeners,
    commonConnectors,
    punctuationProfile: {
      questionMarksPer1k: Math.round(questionMarksPer1k * 10) / 10,
      exclamationPer1k: Math.round(exclamationPer1k * 10) / 10,
      ellipsisPer1k: Math.round(ellipsisPer1k * 10) / 10,
      emDashPer1k: Math.round(emDashPer1k * 10) / 10,
    },
    vocabularyTier: vocabTier,
    pacingSignature,
  };
}

function splitSentences(text: string): string[] {
  return text.split(/[。！？\.!\?\n]+/).filter(s => s.trim().length > 2);
}

function classifyVocabTier(text: string): string {
  const sample = text.slice(0, 20000);
  const literaryWords = /旖旎|氤氲|潋滟|寂寥|阑珊|缱绻|葳蕤|叆叇|潺潺|婆娑|冉冉|袅袅|蹁跹|觊觎|逡巡|倥偬|酩酊|魑魅|魍魉/g;
  const slangWords = /卧槽|牛逼|尼玛|特么|艹|靠|我去|屌/g;
  const classicalPatterns = /之乎者也|矣|焉|哉|兮|噫/g;

  const literaryCount = (sample.match(literaryWords) || []).length;
  const slangCount = (sample.match(slangWords) || []).length;
  const classicalCount = (sample.match(classicalPatterns) || []).length;

  if (classicalCount > 10) return "literary_classical";
  if (literaryCount > 15) return "literary";
  if (slangCount > 10) return "vernacular";
  return "mixed";
}

function describePacing(sentences: string[], avgLen: number): string {
  const shortRatio = sentences.filter(s => s.length < 15).length / sentences.length;
  const longRatio = sentences.filter(s => s.length > 50).length / sentences.length;

  if (shortRatio > 0.4 && avgLen < 25) return "fast — predominantly short sentences, rapid pace";
  if (longRatio > 0.3 && avgLen > 40) return "slow — many long, descriptive sentences, measured pace";
  return "varied — mix of short and long sentences, moderate pace";
}
```

### Task 4: Codex Builder

**Files:**
- Create: `src/core/codex/builder.ts`

Assemble the full 7-segment Codex from existing data + new profiling.

```typescript
import type { WritersCodex, ChapterSummary, CharacterStateSnapshot, ForeshadowingEntry } from "./types";
import type { CharacterProfile, SceneDefinition, StoryInfo, ChapterTimeline, WritingStyle } from "@/types";
import { extractCharacterQuotes } from "./voice-extractor";
import { computeStyleFingerprint } from "./style-profiler";

interface BuildCodexInput {
  characters: CharacterProfile[];
  storyInfo: StoryInfo | null;
  timeline: ChapterTimeline | null;
  lastChapterStates: import("@/types").CharacterChapterState[];
  scene: SceneDefinition;
  fullNovelText: string;
  chapterSummaries?: ChapterSummary[];
  foreshadowing?: ForeshadowingEntry[];
  recentProse?: string;    // last 3 chapters full text
  ideaBank?: WritersCodex["ideaBank"];
}

/**
 * Assemble the full Writer's Codex from all available data sources.
 * Designed to fit within a 1M token context window (~185K tokens typical).
 */
export function buildCodex(input: BuildCodexInput): WritersCodex {
  const characters = input.characters || [];
  const profile = characters[0];
  const zh = profile
    ? (profile.personality.description.match(/[一-鿿]/g) || []).length > profile.personality.description.length * 0.1
    : true;

  // Segment 1: Style Pack
  const writingStyle: WritingStyle = input.storyInfo?.writingStyle || {
    genre: "", styleDescription: "", narrativeTechniques: [], languageFeatures: "",
    pacingDescription: "", tone: "", examplePassages: [],
    contentRating: { level: "", description: "", hasExplicitContent: false },
  };
  const fingerprint = computeStyleFingerprint(input.fullNovelText);
  const examplePassages = writingStyle.examplePassages || [];

  // Segment 2: Character Dossiers
  const quotes = extractCharacterQuotes(characters, input.fullNovelText);
  const currentStates: CharacterStateSnapshot[] = characters.map(c => {
    const lastState = input.lastChapterStates?.find(s => s.name === c.name);
    const driveGoal = c.drive?.goal || "";
    return {
      characterId: c.id,
      name: c.name,
      alive: lastState?.alive !== false,
      currentLocation: lastState?.location || "未知",
      currentEmotion: "neutral",
      currentGoal: driveGoal,
      relationshipStates: buildRelationshipStateMap(c),
      lastChapterSeen: lastState?.lastSeenChapter || 0,
    };
  });

  // Segment 3: World Bible
  const ws = input.storyInfo?.worldSetting;
  const worldBible = {
    timePeriod: ws?.timePeriod || "",
    location: ws?.location || "",
    socialStructure: ws?.socialStructure || "",
    powerSystem: ws?.powerSystem || "",
    factions: ws?.factions || [],
    rules: ws?.rules || [],
    atmosphere: ws?.atmosphere || "",
  };

  // Segment 4: Narrative Context
  const chapterSummaries: ChapterSummary[] = input.chapterSummaries || (
    input.storyInfo?.chapterOutlines?.map((c, i) => ({
      chapterNumber: c.chapterNumber || i + 1,
      title: c.title || "",
      summary: c.summary || "",
      keyEvents: c.keyEvents || [],
      characterChanges: {},
    })) || []
  );
  const recentProse = input.recentProse || "";
  const currentOutline = buildSceneOutline(input.scene, characters);

  // Segment 5: Foreshadowing Ledger
  const active = (input.foreshadowing || []).filter(f => f.status !== "revealed");
  const revealed = (input.foreshadowing || []).filter(f => f.status === "revealed");

  // Segment 6: Idea Bank
  const ideaBank = input.ideaBank || {
    writingTechniques: [],
    genreConventions: [],
    referencePassages: [],
    authorNotes: "",
  };

  // Segment 7: Current Task
  const currentTask = {
    sceneLocation: input.scene.location,
    sceneTimeOfDay: input.scene.timeOfDay,
    sceneWeather: input.scene.weather,
    sceneAtmosphere: input.scene.atmosphere,
    sceneGoal: input.scene.plot?.storyBeat || "",
    conflictType: input.scene.plot?.conflictType || "",
    storyBeat: input.scene.plot?.storyBeat || "",
    stakes: input.scene.plot?.stakes || "",
    pacing: (input.scene.narrativeStyle?.targetLength === "short" ? "fast" : input.scene.narrativeStyle?.targetLength === "long" ? "slow" : "medium") as "fast" | "medium" | "slow",
    targetCharacters: input.scene.characterIds || [],
  };

  return {
    styleProfiles: { writingStyle, fingerprint, examplePassages },
    characterDossiers: { profiles: characters, quotes, currentStates },
    worldBible,
    narrativeContext: { chapterSummaries, recentProse, currentOutline },
    foreshadowingLedger: { active, revealed },
    ideaBank,
    currentTask,
  };
}

function buildRelationshipStateMap(profile: CharacterProfile): Record<string, string> {
  const map: Record<string, string> = {};
  for (const rel of profile.relationships || []) {
    map[rel.characterName] = `${rel.type} — ${rel.dynamics}`;
  }
  return map;
}

function buildSceneOutline(scene: SceneDefinition, characters: CharacterProfile[]): string {
  const charNames = (scene.characterIds || [])
    .map(id => characters.find(c => c.id === id)?.name || "")
    .filter(Boolean)
    .join("、");

  return `场景: ${scene.location}
时间: ${scene.timeOfDay}
天气: ${scene.weather}
氛围: ${scene.atmosphere}
初始情境: ${scene.initialSituation}
出场角色: ${charNames}
冲突类型: ${scene.plot?.conflictType || "未指定"}
故事节点: ${scene.plot?.storyBeat || "未指定"}
关键事件: ${scene.plot?.keyEvent || "未指定"}
赌注: ${scene.plot?.stakes || "未指定"}`;
}
```

### Task 5: Codex Renderer (Prompt Assembly)

**Files:**
- Create: `src/core/codex/renderer.ts`

Convert the structured `WritersCodex` into actual prompt text that gets injected.

```typescript
import type { WritersCodex, CharacterQuote, CharacterStateSnapshot, ForeshadowingEntry } from "./types";

/**
 * Render all 7 Codex segments into a single system prompt text block.
 * This is injected as the system message + first user message context.
 */
export function renderCodexAsPrompt(codex: WritersCodex): { systemPrompt: string; userContext: string } {
  const segments: string[] = [];

  // Segment 1: Style Pack
  segments.push(renderStylePack(codex));

  // Segment 2: Character Dossiers
  segments.push(renderCharacterDossiers(codex));

  // Segment 3: World Bible
  segments.push(renderWorldBible(codex));

  // Segment 4: Narrative Context
  segments.push(renderNarrativeContext(codex));

  // Segment 5: Foreshadowing Ledger
  segments.push(renderForeshadowingLedger(codex));

  // Segment 6: Idea Bank
  segments.push(renderIdeaBank(codex));

  // Segment 7: Current Task
  segments.push(renderCurrentTask(codex));

  // System prompt = persona + instructions
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
目标: ${codex.currentTask.sceneGoal}
冲突类型: ${codex.currentTask.conflictType}
节奏: ${codex.currentTask.pacing}
出场角色: ${codex.currentTask.targetCharacters.join("、")}
赌注: ${codex.currentTask.stakes}

请开始创作，输出小说叙事文字。`;

  return { systemPrompt, userContext };
}

function renderStylePack(codex: WritersCodex): string {
  const { writingStyle, fingerprint } = codex.styleProfiles;
  const fp = fingerprint;
  const examples = codex.styleProfiles.examplePassages
    .map(e => `【${e.aspect}】\n${e.text}`)
    .join("\n\n");

  return `## 1. 风格包

### 原著文风
- 类型: ${writingStyle.genre}
- 风格描述: ${writingStyle.styleDescription}
- 叙事手法: ${writingStyle.narrativeTechniques?.join("、") || "无"}
- 语言特点: ${writingStyle.languageFeatures}
- 节奏特点: ${writingStyle.pacingDescription}
- 基调: ${writingStyle.tone}

### 风格指纹
- 平均句长: ${fp.avgSentenceLength} 字
- 对话占比: ${Math.round(fp.dialogueRatio * 100)}%
- 叙述占比: ${Math.round(fp.narrationRatio * 100)}%
- 常用句式开头: ${fp.commonOpeners.join("、")}
- 常用转折词: ${fp.commonConnectors.join("、")}
- 标点密度（每千字）: 问号${fp.punctuationProfile.questionMarksPer1k} 感叹号${fp.punctuationProfile.exclamationPer1k}
- 词汇层级: ${fp.vocabularyTier}
- 节奏特点: ${fp.pacingSignature}

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
    const catchphrases = profile.speakingStyle?.catchphrases?.join("、") || "";

    const rels = (profile.relationships || [])
      .map(r => `${r.characterName}: ${r.type} — ${r.description}（${r.dynamics}）`)
      .join("\n  ");

    const quoteBlock = quotes.length > 0
      ? `\n### 代表性语录\n${quotes.map(q => `- [${q.emotion}] "${q.text}"`).join("\n")}`
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
  ${rels || "无已知关系"}

**世界观**: ${profile.worldview || ""}

**背景**: ${profile.background?.description || ""}${quoteBlock}${stateBlock}`);
  }

  return parts.join("\n\n");
}

function renderWorldBible(codex: WritersCodex): string {
  const { worldBible: w } = codex;
  return `## 3. 世界观百科

- 时代背景: ${w.timePeriod}
- 主要地点: ${w.location}
- 社会结构: ${w.socialStructure}
- 力量体系: ${w.powerSystem}
- 势力/门派: ${w.factions.join("、")}
- 世界规则: ${w.rules.join("、")}
- 世界观氛围: ${w.atmosphere}`;
}

function renderNarrativeContext(codex: WritersCodex): string {
  const { narrativeContext: nc } = codex;
  const summaries = nc.chapterSummaries
    .map(c => `第${c.chapterNumber}章 ${c.title}: ${c.summary}`)
    .join("\n");

  return `## 4. 前文摘要

${summaries}

### 最近前文
${nc.recentProse ? nc.recentProse.slice(-6000) : "（无前文——这是故事的开端）"}

### 当前章节大纲
${nc.currentOutline}`;
}

function renderForeshadowingLedger(codex: WritersCodex): string {
  const { foreshadowingLedger: fl } = codex;

  const activeList = fl.active.length > 0
    ? fl.active.map(f => `- [${f.type}][${f.status}] ${f.description}（第${f.plantedChapter}章埋入，建议回收: ${f.suggestedRevealWindow}）`).join("\n")
    : "（暂无活跃伏笔）";

  const revealedList = fl.revealed.length > 0
    ? fl.revealed.map(f => `- [${f.type}] ${f.description}（第${f.plantedChapter}章埋入 → ${f.revealedAt || "已回收"}）`).join("\n")
    : "";

  return `## 5. 伏笔账本

### 待回收伏笔
${activeList}${revealedList ? `\n\n### 已回收伏笔\n${revealedList}` : ""}`;
}

function renderIdeaBank(codex: WritersCodex): string {
  const { ideaBank: ib } = codex;

  const techniques = ib.writingTechniques.length > 0
    ? ib.writingTechniques.map(t => `- ${t}`).join("\n")
    : "（暂无）";

  const conventions = ib.genreConventions.length > 0
    ? ib.genreConventions.map(c => `- ${c}`).join("\n")
    : "（暂无）";

  const refs = ib.referencePassages.length > 0
    ? ib.referencePassages.map(r => `【${r.source}】\n${r.text}`).join("\n\n")
    : "";

  const notes = ib.authorNotes || "（暂无）";

  return `## 6. 灵感库

### 写作技巧参考
${techniques}

### 类型惯例
${conventions}${refs ? `\n\n### 参考片段\n${refs}` : ""}

### 作者笔记
${notes}`;
}

function renderCurrentTask(codex: WritersCodex): string {
  const { currentTask: ct } = codex;
  return `## 7. 当前任务

- 场景地点: ${ct.sceneLocation}
- 时间: ${ct.sceneTimeOfDay}
- 天气: ${ct.sceneWeather}
- 氛围: ${ct.sceneAtmosphere}
- 场景目标: ${ct.sceneGoal}
- 冲突类型: ${ct.conflictType}
- 故事节点: ${ct.storyBeat}
- 赌注: ${ct.stakes}
- 节奏: ${ct.pacing}
- 出场角色: ${ct.targetCharacters.join("、")}`;
}
```

### Task 6: Codex Updater

**Files:**
- Create: `src/core/codex/updater.ts`

Update Codex state after a chapter is written.

```typescript
import type { WritersCodex, ReviewReport, ChapterSummary, CharacterStateSnapshot, ForeshadowingEntry } from "./types";
import type { CharacterProfile } from "@/types";

/**
 * Apply review findings and generated prose to update the Codex for the next chapter.
 */
export function updateCodexAfterChapter(
  codex: WritersCodex,
  review: ReviewReport,
  chapterNumber: number,
  chapterTitle: string,
): WritersCodex {
  const next = structuredClone(codex);

  // Update character states from review findings
  for (const stateUpdate of review.updatedStates) {
    const idx = next.characterDossiers.currentStates.findIndex(
      s => s.characterId === stateUpdate.characterId
    );
    if (idx >= 0) {
      next.characterDossiers.currentStates[idx] = {
        ...next.characterDossiers.currentStates[idx],
        ...stateUpdate,
        lastChapterSeen: chapterNumber,
      } as CharacterStateSnapshot;
    }
  }

  // Add new foreshadowing entries
  next.foreshadowingLedger.active.push(...review.newForeshadowing);

  // Mark revealed foreshadowing
  for (const id of review.revealedForeshadowing) {
    const entry = next.foreshadowingLedger.active.find(e => e.id === id);
    if (entry) {
      entry.status = "revealed";
      entry.revealedAt = `第${chapterNumber}章`;
      next.foreshadowingLedger.revealed.push(entry);
    }
  }
  next.foreshadowingLedger.active = next.foreshadowingLedger.active.filter(
    e => e.status !== "revealed"
  );

  // Add new chapter summary
  next.narrativeContext.chapterSummaries.push(review.newChapterSummary);

  // Rolling truncation: keep last 10 chapter summaries, older ones get compressed
  if (next.narrativeContext.chapterSummaries.length > 10) {
    const oldSummaries = next.narrativeContext.chapterSummaries.slice(0, -10);
    const compressed = compressOldSummaries(oldSummaries);
    next.narrativeContext.chapterSummaries = [
      { chapterNumber: 0, title: "前情提要", summary: compressed, keyEvents: [], characterChanges: {} },
      ...next.narrativeContext.chapterSummaries.slice(-10),
    ];
  }

  // Update idea bank — preserve author notes, accumulate techniques from reviews
  // (no-op for now — manual updates only)

  return next;
}

function compressOldSummaries(summaries: ChapterSummary[]): string {
  return summaries
    .map(c => `第${c.chapterNumber}章: ${c.summary.slice(0, 100)}`)
    .join(" | ");
}
```

### Task 7: Review Orchestrator

**Files:**
- Create: `src/core/codex/review-orchestrator.ts`

Run all 6 review agents in parallel and merge results.

```typescript
import type { WritersCodex, ReviewReport, ReviewFinding } from "./types";
import type { CharacterProfile, SceneDefinition, StoryInfo } from "@/types";
import { createLLMProvider } from "@/core/llm/factory";
import { isChinese } from "@/lib/utils";

interface ReviewInput {
  generatedProse: string;
  codex: WritersCodex;
  chapterNumber: number;
}

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
  const allFindings = results.flatMap(r => r.findings);
  const autoFixed = allFindings.filter(f => f.autoFixable);
  const needsHuman = allFindings.filter(f => !f.autoFixable && (f.severity === "critical" || f.severity === "major"));

  // Apply auto-fixes to the prose
  let fixedProse = input.generatedProse;
  for (const finding of autoFixed) {
    if (finding.fixedText && finding.snippet) {
      fixedProse = fixedProse.replace(finding.snippet, finding.fixedText);
    }
  }

  // Count unique auto-fixed findings
  const autoFixedCount = autoFixed.length;

  // Extract state updates from findings
  const updatedStates = results.flatMap(r => r.stateUpdates || []);
  const newForeshadowing = results.flatMap(r => r.newForeshadowing || []);
  const revealedForeshadowing = results.flatMap(r => r.revealedForeshadowing || []);
  const newChapterSummary = results[0]?.chapterSummary || {
    chapterNumber: input.chapterNumber,
    title: "",
    summary: input.generatedProse.slice(0, 200),
    keyEvents: [],
    characterChanges: {},
  };

  return {
    findings: allFindings,
    autoFixedCount,
    needsHumanReview: needsHuman,
    updatedStates,
    newForeshadowing,
    revealedForeshadowing,
    newChapterSummary,
  };
}

// ---- Individual Review Functions ----

const REVIEW_SCHEMA = {
  name: "review_findings",
  description: "Review findings for generated prose",
  parameters: {
    type: "object",
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            severity: { type: "string", enum: ["critical", "major", "minor"] },
            location: { type: "string" },
            description: { type: "string" },
            suggestion: { type: "string" },
            snippet: { type: "string" },
            autoFixable: { type: "boolean" },
            fixedText: { type: "string" },
          },
          required: ["severity", "description", "suggestion"],
        },
      },
      summary: { type: "string" },
    },
    required: ["findings", "summary"],
  },
};

async function reviewCharacterConsistency(
  input: ReviewInput, llm: ReturnType<typeof createLLMProvider>, zh: boolean
): Promise<{ findings: ReviewFinding[]; stateUpdates: any[] }> {
  const characters = input.codex.characterDossiers;
  const charContext = characters.profiles.map(p => {
    const state = characters.currentStates.find(s => s.characterId === p.id);
    const quotes = characters.quotes[p.name] || [];
    return `【${p.name}】性格: ${p.personality.traits.join("、")}。说话风格: ${p.speakingStyle.description}。口头禅: ${p.speakingStyle.catchphrases.join("、")}。当前状态: ${state ? `${state.currentLocation}, ${state.currentEmotion}, 目标:${state.currentGoal}` : "未知"}。语录: ${quotes.slice(0, 3).map(q => `[${q.emotion}]"${q.text}"`).join(" | ")}`;
  }).join("\n\n");

  const prompt = zh
    ? `你是角色一致性审查员。对照角色设定，检查生成文字中是否有角色行为/语言偏离设定。\n\n## 角色设定\n${charContext}\n\n## 生成文字\n${input.generatedProse.slice(0, 8000)}\n\n注意：角色可以在压力下做反常行为，前提是有场景铺垫。只报告明显的、无铺垫的断裂。`
    : `You are a character consistency reviewer. Check the generated prose against character profiles for behavior/speech drift.`;

  const result = await llm.chatWithTool<any>(
    [{ role: "user", content: prompt }],
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
    stateUpdates: [],
  };
}

async function reviewContinuity(
  input: ReviewInput, llm: ReturnType<typeof createLLMProvider>, zh: boolean
): Promise<{ findings: ReviewFinding[]; stateUpdates: any[] }> {
  const summaries = input.codex.narrativeContext.chapterSummaries
    .map(c => `第${c.chapterNumber}章: ${c.summary}`).join("\n");
  const states = input.codex.characterDossiers.currentStates
    .map(s => `${s.name}: alive=${s.alive}, loc=${s.currentLocation}`).join("\n");

  const prompt = zh
    ? `你是连贯性审查员。检查生成文字的逻辑矛盾和事实错误。\n\n## 已知前文摘要\n${summaries}\n\n## 角色当前状态\n${states}\n\n## 生成文字\n${input.generatedProse.slice(0, 8000)}\n\n检查: 已死角色是否说话? 物体凭空出现? 因果链断裂? 时间线矛盾?`
    : `You are a continuity reviewer. Check for logical contradictions in the generated prose vs established facts.`;

  const result = await llm.chatWithTool<any>(
    [{ role: "user", content: prompt }],
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
    stateUpdates: [],
  };
}

async function reviewForeshadowing(
  input: ReviewInput, llm: ReturnType<typeof createLLMProvider>, zh: boolean
): Promise<{ findings: ReviewFinding[]; newForeshadowing: any[]; revealedForeshadowing: string[] }> {
  const active = input.codex.foreshadowingLedger.active;
  if (active.length === 0) {
    return { findings: [], newForeshadowing: [], revealedForeshadowing: [] };
  }

  const activeList = active.map(f =>
    `[${f.type}] ${f.description} (第${f.plantedChapter}章埋入, 建议回收: ${f.suggestedRevealWindow})`
  ).join("\n");

  const prompt = zh
    ? `你是伏笔追踪员。检查生成文字中是否有伏笔被推进或回收。\n\n## 活跃伏笔\n${activeList}\n\n## 生成文字\n${input.generatedProse.slice(0, 8000)}\n\n请识别: 1)新埋的伏笔 2)已回收的伏笔(给id) 3)应该回收但未提及的伏笔。`
    : `You are a foreshadowing tracker. Check if any active foreshadowing is advanced or resolved in the generated prose.`;

  const result = await llm.chatWithTool<any>(
    [{ role: "user", content: prompt }],
    {
      ...REVIEW_SCHEMA,
      name: "foreshadowing_review",
      parameters: {
        ...REVIEW_SCHEMA.parameters,
        properties: {
          ...REVIEW_SCHEMA.parameters.properties,
          newForeshadowing: { type: "array", items: { type: "object" } },
          revealedForeshadowing: { type: "array", items: { type: "string" } },
        },
      },
    },
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
      autoFixable: false,
    })),
    newForeshadowing: result.newForeshadowing || [],
    revealedForeshadowing: result.revealedForeshadowing || [],
  };
}

async function reviewStyle(
  input: ReviewInput, llm: ReturnType<typeof createLLMProvider>, zh: boolean
): Promise<{ findings: ReviewFinding[] }> {
  const fp = input.codex.styleProfiles.fingerprint;
  const styleGuide = `
- 类型: ${input.codex.styleProfiles.writingStyle?.genre || ""}
- 平均句长: ${fp.avgSentenceLength} 字
- 对话占比: ${Math.round(fp.dialogueRatio * 100)}%
- 常用句式开头: ${fp.commonOpeners.join("、")}
- 常用转折词: ${fp.commonConnectors.join("、")}
- 词汇层级: ${fp.vocabularyTier}
- 节奏特点: ${fp.pacingSignature}`;

  const prompt = zh
    ? `你是风格一致性审查员。检查生成文字是否与原著风格指纹一致。\n\n## 风格指纹\n${styleGuide}\n\n## 生成文字\n${input.generatedProse.slice(0, 8000)}\n\n检查: 句长是否偏离? 对话比例是否合理? 是否有AI味的公式化表达? 句式是否单调重复?`
    : `You are a style consistency reviewer. Check if the generated prose matches the original writing style fingerprint.`;

  const result = await llm.chatWithTool<any>(
    [{ role: "user", content: prompt }],
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
  input: ReviewInput, llm: ReturnType<typeof createLLMProvider>, zh: boolean
): Promise<{ findings: ReviewFinding[] }> {
  const w = input.codex.worldBible;

  const prompt = zh
    ? `你是世界观一致性审查员。检查生成文字是否违反了世界观设定。\n\n## 世界观设定\n- 力量体系: ${w.powerSystem}\n- 世界规则: ${w.rules.join("、")}\n- 社会结构: ${w.socialStructure}\n- 势力/门派: ${w.factions.join("、")}\n\n## 生成文字\n${input.generatedProse.slice(0, 8000)}\n\n检查: 力量体系规则是否被打破? 社会结构和势力关系是否正确? 地点描述是否与设定矛盾?`
    : `You are a world-building consistency reviewer. Check if the generated prose violates established world rules.`;

  const result = await llm.chatWithTool<any>(
    [{ role: "user", content: prompt }],
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
  input: ReviewInput, llm: ReturnType<typeof createLLMProvider>, zh: boolean
): Promise<{ findings: ReviewFinding[] }> {
  const prompt = zh
    ? `你是节奏审查员。检查生成文字是否符合要求的节奏和冲突强度。\n\n## 要求\n- 节奏: ${input.codex.currentTask.pacing}\n- 冲突类型: ${input.codex.currentTask.conflictType}\n- 故事节点: ${input.codex.currentTask.storyBeat}\n\n## 生成文字\n${input.generatedProse.slice(0, 8000)}\n\n检查: 节奏是否与要求一致? 冲突强度是否合适? 是否拖沓或过于仓促?`
    : `You are a pacing reviewer. Check if the generated prose pacing matches requirements.`;

  const result = await llm.chatWithTool<any>(
    [{ role: "user", content: prompt }],
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
```

### Task 8: Integrate into Simulation Engine

**Files:**
- Modify: `src/core/simulation/engine.ts`

Wire the Codex builder, renderer, and review orchestrator into the existing simulation engine.

Key integration points:
1. Before writing: call `buildCodex()` → `renderCodexAsPrompt()` → inject into writer
2. After writing: call `runFullReview()` → `updateCodexAfterChapter()` for next round
3. Store Codex in simulation state for persistence across rounds

### Task 9: DB Persistence for Codex

**Files:**
- Modify: `src/lib/db.ts`

Add `codex_data` table to persist Codex state across sessions.

```sql
CREATE TABLE IF NOT EXISTS codex_data (
  novel_id TEXT NOT NULL,
  data TEXT NOT NULL,  -- serialized WritersCodex JSON
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (novel_id)
);
```

Add `saveCodex()`, `getCodex()`, `deleteCodex()` CRUD functions.

### Task 10: Admin UI for Codex Management

**Files:**
- Create: `src/components/admin/codex-viewer.tsx`

Add a Codex viewer/editor tab to the admin page where authors can:
- View all 7 segments in read-only mode
- Edit the idea bank (writing techniques, reference passages, author notes)
- Manually add/update foreshadowing entries
- View the latest review report

### Task 11: Types Registration

**Files:**
- Modify: `src/types/index.ts`

Add `WritersCodex`, `ReviewReport`, `ReviewFinding`, `CodexData` etc. to the shared types. This ensures the frontend can consume these types via the API.

---

## Build & Verify Order

After each task, run:
```bash
npm run build
```

After all tasks:
```bash
npm run dev
# Open http://localhost:3000/admin
# Load a novel → verify Codex is built
# Run a simulation → verify Codex is injected
# Check review report after simulation completes
```
