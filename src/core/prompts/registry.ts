// ============================================================
// Prompt Registry — manage all LLM agent prompts
// ============================================================

export interface AgentPromptMeta {
  agentId: string;
  name: string;
  description: string;
  category: "extraction" | "simulation" | "review";
  variables: string[];
  bilingual: boolean; // has both zh and en versions
}

/**
 * All 13 agents registered with metadata.
 * Actual prompt text stays in the source files by default;
 * only user-edited prompts are stored in the DB.
 */
export const AGENT_REGISTRY: AgentPromptMeta[] = [
  // ---- Extraction ----
  {
    agentId: "character_list",
    name: "角色列表提取 (Pass 1)",
    description: "从小说中识别所有有名有姓的角色，提取名字、别名、角色定位",
    category: "extraction",
    variables: ["novelContext"],
    bilingual: true,
  },
  {
    agentId: "character_detail",
    name: "角色详情提取 (Pass 2)",
    description: "对单个角色进行深度剖析：性格、驱动力、行为模式、说话风格等",
    category: "extraction",
    variables: ["characterName", "characterBrief", "characterRole", "novelContext"],
    bilingual: true,
  },
  {
    agentId: "relationships",
    name: "关系网络提取 (Pass 3)",
    description: "分析角色之间的关系网络（类型、动态、历史）",
    category: "extraction",
    variables: ["characterNames", "novelContext"],
    bilingual: true,
  },
  {
    agentId: "chapter_end_states",
    name: "末章状态提取",
    description: "提取所有角色在小说完结时的最终状态快照",
    category: "extraction",
    variables: ["recentText", "knownNames"],
    bilingual: true,
  },
  {
    agentId: "story_info",
    name: "故事信息提取",
    description: "提取情节摘要、主线、章节概要、世界观设定、文风特点",
    category: "extraction",
    variables: ["novelContext"],
    bilingual: true,
  },
  {
    agentId: "timeline",
    name: "时间线提取",
    description: "提取小说的章节时间线和事件序列",
    category: "extraction",
    variables: ["chapterTitle", "truncated"],
    bilingual: true,
  },

  // ---- Simulation ----
  {
    agentId: "outline_writer",
    name: "剧本大纲编写器",
    description: "导演在场景开始前编写完整剧本大纲：节拍、情感弧线、结局",
    category: "simulation",
    variables: ["sceneLocation", "sceneTimeOfDay", "sceneWeather", "sceneAtmosphere", "sceneInitialSituation", "sceneConflictType", "sceneStoryBeat", "sceneStakes", "charSummaries", "previousProse"],
    bilingual: true,
  },
  {
    agentId: "director",
    name: "导演/调度者",
    description: "每轮调度：选择焦点角色、情绪基调、节奏、冲突强度",
    category: "simulation",
    variables: ["characterDescriptions", "sceneLocation", "sceneTimeOfDay", "sceneWeather", "sceneAtmosphere", "sceneInitialSituation", "sceneNarrativeStyle", "outlineContext", "plotContext", "historyContext", "roundNumber"],
    bilingual: true,
  },
  {
    agentId: "character_agent",
    name: "角色扮演代理",
    description: "角色以第一人称参与即兴场景，产出对话、动作、内心想法",
    category: "simulation",
    variables: ["profile (name, aliases, appearance, personality, drive, behavior, worldview, values, speakingStyle, background, relationships)", "sceneDescription", "channelContext", "othersText", "historyText", "reactionHint"],
    bilingual: true,
  },
  {
    agentId: "recorder",
    name: "记录者/叙事者",
    description: "将导演调度和角色对话编织成优美的小说叙事文字",
    category: "simulation",
    variables: ["sceneNarrativeStyle", "writingStyle (genre, styleDescription, narrativeTechniques, languageFeatures, pacingDescription, tone, examplePassages, contentRating)", "roundNumber", "channelReport", "previousProse", "directorGuide"],
    bilingual: true,
  },

  // ---- Review ----
  {
    agentId: "continuity_reviewer",
    name: "连贯性审查员",
    description: "检查生成文字的逻辑断裂和事实错误：角色状态、因果链、时间线",
    category: "review",
    variables: ["draft", "timelineEvents", "characterStates"],
    bilingual: false,
  },
  {
    agentId: "character_reviewer",
    name: "角色一致性审查员",
    description: "检查角色行为、语言、动机是否符合角色设定",
    category: "review",
    variables: ["draft", "characterStates"],
    bilingual: false,
  },
  {
    agentId: "literary_reviewer",
    name: "文学品质审查员",
    description: "评价写作技艺：节奏、感官细节、对话质量、句式变化、展示vs讲述",
    category: "review",
    variables: ["draft", "writingStyle"],
    bilingual: false,
  },
];

export function getAgentMeta(agentId: string): AgentPromptMeta | undefined {
  return AGENT_REGISTRY.find((a) => a.agentId === agentId);
}

export function getAgentsByCategory(): Record<string, AgentPromptMeta[]> {
  const groups: Record<string, AgentPromptMeta[]> = {
    extraction: [],
    simulation: [],
    review: [],
  };
  for (const agent of AGENT_REGISTRY) {
    groups[agent.category].push(agent);
  }
  return groups;
}
