// ============================================================
// Shared Types for Novel Character Agent Simulation System
// ============================================================

// --- Character Profile ---

export interface CharacterProfile {
  id: string;
  name: string;
  aliases: string[];
  personality: {
    traits: string[];
    description: string;
  };
  behavior: {
    patterns: string[];
    habits: string[];
  };
  worldview: string;
  values: string[];
  speakingStyle: string;
  background: string;
  relationships: Relationship[];
}

export interface Relationship {
  characterId: string;
  characterName: string;
  type: string; // e.g., "friend", "enemy", "family", "lover", "rival"
  description: string;
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
  writingStyle: WritingStyle;  // Original novel's writing style
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

// --- LLM Provider ---

export type LLMProviderType = "claude" | "openai" | "deepseek";

export interface LLMProviderConfig {
  type: LLMProviderType;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

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
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

// --- App Config ---

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
      model: string;
      baseURL: string;
    };
    maxTokens: number;
    temperature: number;
  };
}
