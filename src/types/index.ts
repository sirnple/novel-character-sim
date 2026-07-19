// ============================================================
// Shared Types for Novel Character Agent Simulation System
// ============================================================

// --- Character Profile ---

export interface Appearance {
  summary: string; // 综合外貌描述
}

export interface Personality {
  traits: string[];
  description: string;
  decisionStyle: string;    // 决策风格（冲动/谨慎/感性/理性）
  underPressure: string;    // 压力下的反应
}

export interface Drive {
  goal: string;             // 核心目标/追求
  motivation: string;       // 为什么要追求这个目标
  fear: string;             // 最大的恐惧
  weakness: string;         // 性格弱点
  bottomLine: string;       // 底线/绝不做什么
  secret: string;           // 隐藏的秘密
}

export interface Behavior {
  patterns: string[];       // 行为模式
  habits: string[];         // 习惯与癖好
  attitudeToAuthority: string; // 对权威的态度
}

export interface VoiceConfig {
  description: string;  // Voice Design 描述（如"温柔甜美的年轻女声"）
}

export interface SpeakingStyleDetail {
  description: string;          // 整体说话风格描述
  catchphrases: string[];       // 口头禅/语气词
  sentenceStyle: string;        // 句式特点（短促/长篇/反问/陈述）
  vocabulary: string;           // 词汇水平（粗俗/文雅/专业）
  emotionalExpression: string;  // 不同情绪下的表达方式
}

export interface BackgroundDetail {
  origin: string;               // 出身/家庭/阶层/成长地
  keyEvents: string[];          // 改变人生的 2-3 个转折点
  description: string;          // 整体背景描述
}

/**
 * Dyad symmetry (social / narrative):
 * - unidirectional: only owner→other is evidenced (e.g. secret crush, one-sided hatred)
 * - bidirectional: mutual same-kind bond (friendship, sworn brothers, marriage-as-pair)
 * - asymmetric: both directions matter but types/feelings differ (A controls B; B resents A)
 */
export type RelationshipSymmetry =
  | "unidirectional"
  | "bidirectional"
  | "asymmetric";

export type RelationshipValence =
  | "positive"
  | "negative"
  | "ambivalent"
  | "instrumental"
  | "neutral";

export type RelationshipVisibility =
  | "public"
  | "private"
  | "hidden"
  | "mixed";

/**
 * Directed edge FROM the owning CharacterProfile TO characterName.
 * Never store a mirrored copy with the same type unless the reverse is actually evidenced.
 */
export interface Relationship {
  characterId: string;
  characterName: string;
  /** Type of this directed link (owner → other). See relationship-types.ts */
  type: string;
  /**
   * How the dyad orients. Default for legacy data: bidirectional
   * (old pipeline mirrored edges both ways).
   */
  symmetry?: RelationshipSymmetry;
  /** When asymmetric (or explicit reverse), type of other → owner */
  reverseType?: string;
  /** Owner's affective stance toward the other */
  valence?: RelationshipValence;
  /** Whether the bond is open knowledge in the story world */
  visibility?: RelationshipVisibility;
  /** From owner POV: what this person is to me now */
  description: string;
  /** Shared or owner-biased history of the bond */
  history: string;
  /** Power / leverage / dependency from owner POV */
  dynamics: string;
}

/** Occurrence position in novel text (character roster / detail focus). */
export interface CharacterMentionAnchor {
  offset: number;
  unitIndex?: number;
  unitLabel?: string;
  surface?: string;
}

export interface CharacterProfile {
  id: string;
  name: string;
  aliases: string[];
  appearance: Appearance;
  personality: Personality;
  drive: Drive;
  behavior: Behavior;
  worldview: string;
  values: string[];
  speakingStyle: SpeakingStyleDetail;
  voice: VoiceConfig;
  background: BackgroundDetail;
  relationships: Relationship[];
  /**
   * Where this person appears (from scan + coref). Prefer lookup by these
   * anchors for detail/coref — same name at different offsets may be another person.
   */
  mentionAnchors?: CharacterMentionAnchor[];
}

// --- Structured Novel Input (folder upload) ---

export interface StructuredNovelInput {
  /** Main novel text — concatenated from all chapter files */
  mainText: string;
  /** Category → file contents (keyed by folder name) */
  categorized: Record<string, FileEntry[]>;
  /** Flat list of all files found */
  allFiles: FileEntry[];
  /** Detected structure categories */
  structure: {
    outlines: string[];      // 大纲 files
    characters: string[];    // 人物/角色 draft files
    settings: string[];      // 设定/世界观 files
    chapters: string[];      // 章节 text files
    storylines: string[];    // 故事线 files
    other: string[];         // uncategorized
  };
}

export interface FileEntry {
  name: string;
  path: string;  // relative path within the folder
  content: string;
  category: string; // which subfolder group it belongs to
}

// --- Timeline ---

export interface TimelineEvent {
  id: string;
  sequence: number;
  chapterNumber: number;
  title: string;
  description: string;
  involvedCharacters: string[];
  outcomes: string[];
  charactersChanged: Record<string, string>;
  precedingEvent: string | null;
}

export interface ChapterTimeline {
  novelId: string;
  /** Branch this timeline belongs to (IF isolation). Defaults to main when omitted. */
  branchId?: string;
  totalChapters: number;
  chapters: ChapterSnapshot[];
}

export interface ChapterSnapshot {
  chapterNumber: number;
  title: string;
  events: TimelineEvent[];
  characterStates: CharacterChapterState[];
}

export interface CharacterChapterState {
  characterId: string;
  name: string;
  lastSeenChapter: number;
  alive: boolean;
  location: string;
  delta: string;
}

// --- Novel ---

export interface NovelChunk {
  index: number;
  content: string;
  isFirst: boolean;
  isLast: boolean;
}

export interface ParsedNovel {
  title: string;
  fullText: string;
  chunks: NovelChunk[];
  totalLength: number;
}

// --- Story & World Extraction ---

export interface StoryInfo {
  title: string;
  plotSummary: string;        // Overall plot summary
  mainStoryline: string;      // Main storyline arc
  subPlots: string[];         // Sub-plots
  chapterOutlines: ChapterOutline[];
  worldSetting: WorldSetting;
  backgroundInfo: string;     // General background/context
  themes: string[];           // Themes of the novel
  /** Filled by style extract module (not story extract). May be empty until style is run. */
  writingStyle: WritingStyle;
}

export interface WritingStyle {
  genre: string;
  styleDescription: string;
  narrativeTechniques: string[];
  languageFeatures: string;
  pacingDescription: string;
  tone: string;
  /** 3-5 representative passages that showcase the writing style */
  examplePassages: ExamplePassage[];
  /** Original novel's content level for adult/explicit content */
  contentRating: ContentRating;
}

/** Global style library entry (user-scoped, cross-novel reusable). */
export interface StyleLibraryEntry {
  id: string;
  name: string;
  description: string;
  /** Reuses WritingStyle shape when extracted from a novel. */
  style: WritingStyle;
  source: "extracted" | "manual";
  /** Novel this entry was extracted from; empty if manual-only. */
  sourceNovelId: string;
  sourceNovelTitle: string;
  createdAt?: string;
}

/** Preset idea tags */
export type IdeaTag =
  | "设定"
  | "剧情"
  | "角色"
  | "冲突"
  | "伏笔"
  | "氛围"
  | "对白"
  | string;

/** Global idea bank entry (user-scoped, cross-novel reusable). */
export interface IdeaLibraryEntry {
  id: string;
  title: string;
  content: string;
  tags: IdeaTag[];
  source: "extracted" | "manual";
  sourceNovelId: string;
  sourceNovelTitle: string;
  createdAt?: string;
}

/** Modular analysis modules (user-facing name: 分析). */
export type ExtractModule =
  | "story"
  | "characters"
  | "timeline"
  | "style"
  | "ideas"
  | "form";

/**
 * Analysis modules ↔ product concepts (user-facing):
 * - story / characters / form / timeline → 本书资料（原著契约的肉/骨/进度）
 * - style → 文笔库（可跨书嫁接的语言肌理；≠ 形态章法）
 * - ideas → 点子库（可跨书选用的火花；默认非正典）
 */
export const EXTRACT_MODULES: { id: ExtractModule; label: string; hint: string }[] = [
  { id: "story", label: "故事/世界观", hint: "本书：情节摘要、主线、世界观（契约·肉）" },
  { id: "characters", label: "角色", hint: "本书：角色档案与关系（契约·肉）" },
  { id: "form", label: "目录/章法", hint: "本书：提取目录（适应第N章、【书名】一、等格式）；章法细节后台存储供续写" },
  { id: "style", label: "文笔", hint: "写入文笔库：句式/语气/范文，可嫁接到其他书（契约·肌理）" },
  { id: "ideas", label: "点子", hint: "写入点子库：可迁移续写火花（非正典，选用）" },
  { id: "timeline", label: "时间线", hint: "本书/分支：按章或段的事件进度（较慢，异步后台）" },
];

/** All analysis modules — product default is one-click full run (no user checkboxes). */
export const ALL_ANALYSIS_MODULES: ExtractModule[] = [
  "story",
  "characters",
  "form",
  "style",
  "ideas",
  "timeline",
];

/**
 * @deprecated Prefer ALL_ANALYSIS_MODULES. Kept as alias for callers.
 * Ops may later reintroduce partial selection; until then UI always runs all.
 */
export const DEFAULT_ANALYSIS_MODULES: ExtractModule[] = ALL_ANALYSIS_MODULES;

// --- Form / chaptering (novel-level bone) ---

export type NovelFormType =
  | "web_novel"
  | "trad_novel"
  | "novella"
  | "short_story"
  | "essay_prose"
  | "epistolary"
  | "script_like"
  | "mixed"
  | "unknown";

export type UnitPresence = "present" | "absent" | "weak";

export interface ChapterTitleStyle {
  enabled: boolean;
  /** Confidence 0–1; below threshold → treat as disabled (conservative). */
  confidence: number;
  numbering:
    | "arabic_di_n_zhang"
    | "chinese_di_n_zhang"
    | "volume_chapter"
    | "none"
    | "other";
  titlePattern: string;
  separator: string;
  samples: string[];
  chapterEndTendency?: "cliffhanger" | "closure" | "mixed" | "unknown";
  avgChapterLengthChars?: number;
}

export interface NovelFormProfile {
  novelId: string;
  formType: NovelFormType;
  unitHierarchy: {
    volume: UnitPresence;
    chapter: UnitPresence;
    section: UnitPresence;
  };
  chaptering: ChapterTitleStyle;
  narrativeArchitecture: {
    primaryTemplate:
      | "three_act"
      | "episodic"
      | "multi_plot"
      | "chronicle"
      | "quest"
      | "slice_of_life"
      | "loose"
      | "unknown";
    genreHints: string[];
    evidenceNotes: string;
    povScheme: string;
    timeScheme: "linear" | "nonlinear" | "mixed" | "unknown";
  };
  /** Short executable rules for outline/writer agents. */
  continuationRules: string[];
  updatedAt?: string;
}

// --- Branch chapter progress (branch-level) ---

export type ChapterBoundary = "open" | "closed";

export interface ChapterCatalogEntry {
  id: string;
  number?: number;
  title: string;
  startOffset: number;
  endOffset?: number;
  /** How this entry was produced */
  source: "regex" | "llm_patch" | "accept" | "manual";
}

export interface BranchChapterMeta {
  novelId: string;
  branchId: string;
  /** open = mid-chapter; closed = ready for new chapter title */
  chapterBoundary: ChapterBoundary;
  openChapter?: { number?: number; title?: string; startedAtOffset: number };
  lastClosedChapter?: { number?: number; title?: string; endOffset: number };
  chapters: ChapterCatalogEntry[];
  updatedAt?: string;
}

/** Unified narrative unit for timeline (chapter | window | scene | …). */
export type NarrativeUnitKind =
  | "chapter"
  | "window"
  | "scene"
  | "date_marker"
  | "anchor";

export interface NarrativeUnit {
  unitId: string;
  unitKind: NarrativeUnitKind;
  startOffset: number;
  endOffset: number;
  label: string;
}

export interface ContentRating {
  /** e.g., "无", "轻度暧昧", "情色描写", "露骨色情" */
  level: string;
  /** Description of how adult content is handled in the original */
  description: string;
  /** Whether the original contains explicit scenes */
  hasExplicitContent: boolean;
}

export interface ExamplePassage {
  /** What this passage demonstrates */
  aspect: string;  // e.g., "战斗描写", "对话", "心理描写", "场景渲染"
  /** The actual text excerpt (200-500 chars) */
  text: string;
}

export interface ChapterOutline {
  chapterNumber: number;
  title: string;
  summary: string;
  keyEvents: string[];
}

export interface WorldSetting {
  timePeriod: string;         // e.g., "古代", "现代", "未来", "异世界"
  location: string;           // Main location/setting
  socialStructure: string;    // Social hierarchy/system
  powerSystem: string;        // Magic/cultivation/technology system if any
  factions: string[];         // Organizations, sects, nations
  rules: string[];            // World-specific rules/laws
  atmosphere: string;         // General atmosphere of the world
}

// --- Scene Outline (导演剧本大纲) ---

export interface SceneBeat {
  beatNumber: number;         // 节拍序号 1,2,3...
  description: string;        // 这个节拍发生什么
  activeCharacters: string[]; // 涉及的角色名
  mood: string;               // 情绪/氛围
}

export interface SceneOutline {
  sceneTitle?: string;
  chapterTitle?: string;
  sceneGoal?: string;
  chapterGoal?: string;
  estimatedWordCount?: number;
  estimatedChapters?: number;
  timeSpan?: string;
  seasonAndTime?: string;
  locations?: string[];
  focusCharacters?: {
    name: string;
    reason: string;
  }[];
  beats?: SceneBeat[];
  plotPoints?: {
    sequence: number;
    description: string;
    involvedCharacters: string[];
    mood: string;
  }[];
  characterThreads?: {
    characterName: string;
    development: string;
  }[];
  newForeshadowing?: {
    description: string;
    type: string;
    suggestedRevealWindow?: string;
  }[];
  foreshadowingToReveal?: string[];
  emotionalArc: string;
  sceneEnding?: string;
  chapterEnding?: string;
  estimatedRounds?: number;
  pacing?: string;
}

// --- Scene ---

export type SimulationMode = "director" | "free";

export interface SceneDefinition {
  location: string;
  timeOfDay: string;
  weather: string;
  atmosphere: string;
  initialSituation: string;
  characterIds: string[];
  narrativeStyle: NarrativeStyle;
  plot: ScenePlot;
  mode: SimulationMode; // 导演模式 vs 自由对话模式
}

export interface ScenePlot {
  conflictType: string;       // e.g., "内心挣扎", "人物对峙", "意外发现", "追逐战斗"
  storyBeat: string;         // e.g., "铺垫", "转折", "高潮", "收尾"
  emotionalArc: string;      // e.g., "紧张→爆发→缓和"
  keyEvent: string;          // The key thing that happens
  stakes: string;            // What's at stake for the characters
}

export interface NarrativeStyle {
  pointOfView: "first-person" | "third-person-close" | "third-person-omniscient";
  tone: string;
  targetLength: "short" | "medium" | "long";
  followOriginalStyle: boolean; // Whether to follow the original novel's writing style
}

// --- Channel-Based Simulation ---

export type ChannelType = "public" | "private";

export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  participants: string[]; // character IDs who can send/receive on this channel
}

export interface ChannelMessage {
  id: string;
  fromCharacterId: string;
  fromCharacterName: string;
  channelId: string;
  dialogue: string;
  actions: string;
  innerThoughts: string;
  timestamp: number;
}

export interface SimulationRound {
  roundNumber: number;
  directorAction: string; // Director's scene advancement (empty in free mode)
  channelMessages: ChannelMessage[]; // All messages across all channels this round
  characterResponses: CharacterResponse[]; // Flattened for UI compatibility
  proseOutput: string; // Recorder's narrative prose for this round
}

export interface CharacterResponse {
  characterId: string;
  characterName: string;
  dialogue: string;
  actions: string;
  innerThoughts: string;
}

export type SimulationStatus = "idle" | "running" | "paused" | "completed" | "error";

export interface SimulationState {
  id: string;
  status: SimulationStatus;
  novelTitle: string;
  characters: CharacterProfile[];
  scene: SceneDefinition;
  rounds: SimulationRound[];
  fullNovelOutput: string;
  createdAt: string;
}

import type { StreamEvent } from "@/core/agents/types";

// --- LLM Provider ---

export type LLMProviderType = "claude" | "openai" | "deepseek" | "opencode-go";

export interface LLMProviderConfig {
  type: LLMProviderType;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface SystemMessage {
  role: "system";
  content: string;
}

export interface UserMessage {
  role: "user";
  content: string | any[];
}

export interface AssistantMessage {
  role: "assistant";
  content: string | any[] | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
}

export interface ToolMessage {
  role: "tool";
  content: string;
  tool_call_id: string;
}

export type LLMMessage = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

export interface LLMProvider {
  chat(
    messages: LLMMessage[],
    options?: { model?: string; maxTokens?: number; temperature?: number }
  ): Promise<string>;

  chatWithTool<T>(
    messages: LLMMessage[],
    toolSchema: ToolSchema,
    options?: { model?: string; maxTokens?: number; temperature?: number }
  ): Promise<T>;

  chatStream(
    messages: LLMMessage[],
    onChunk: (text: string) => void,
    options?: { model?: string; maxTokens?: number; temperature?: number }
  ): Promise<string>;

  chatWithTools(
    messages: LLMMessage[],
    tools: ToolSchema[],
    options?: { model?: string; maxTokens?: number; temperature?: number }
  ): AsyncGenerator<StreamEvent>;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

// --- App Config ---

/** Which product path is calling the LLM (model routing). */
export type LLMUsageRole = "analysis" | "write";

export interface AppConfig {
  llm: {
    provider: LLMProviderType;
    claude: {
      apiKey: string;
      model: string;
    };
    openai: {
      apiKey: string;
      model: string;
    };
    deepseek: {
      apiKey: string;
      /** Default / fallback model id */
      model: string;
      /** Extract / form / timeline / title parse */
      analysisModel: string;
      /** Agent 续写 / simulation / review */
      writeModel: string;
      baseURL: string;
    };
    /**
     * OpenCode Go gateway — https://opencode.ai/docs/zh-cn/go/
     * Keys/models: LLM_API_KEY / LLM_ANALYSIS_MODEL / LLM_WRITE_MODEL (see config.ts).
     */
    opencodeGo: {
      apiKey: string;
      /** OpenAI-compatible base (`…/zen/go/v1`) */
      baseURL: string;
      analysisModel: string;
      writeModel: string;
    };
    maxTokens: number;
    temperature: number;
  };
}

export type CreationMode = "main" | "branch" | "free";

export interface Draft {
  id: string;
  novelId: string;
  title: string;
  content: string;
  parentOffset: number;
  createdAt: string;
  updatedAt: string;
}

export interface Branch {
  id: string;
  novelId: string;
  name: string;
  parentOffset: number;
  /** Full body — only present when explicitly loaded (not on list APIs). */
  text?: string;
  /** length(text); list APIs always set this. */
  charCount?: number;
  createdAt: string;
  updatedAt: string;
}
