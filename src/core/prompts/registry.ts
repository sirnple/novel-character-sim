// ============================================================
// Prompt Registry — manage all LLM agent prompts
// ============================================================

export interface AgentPromptMeta {
  agentId: string;
  name: string;
  description: string;
  category: "extraction" | "simulation" | "writing" | "review";
  variables: string[];
  bilingual: boolean;
}

/**
 * Active agents registered with metadata.
 * Only agents that are actually called at runtime should be listed here.
 * Dead code agents (director, character_agent, recorder, old reviewers) removed.
 */
export const AGENT_REGISTRY: AgentPromptMeta[] = [
  // ---- Extraction (6 agents) ----
  {
    agentId: "character_list",
    name: "角色列表提取 (Pass 1)",
    description: "从小说中识别所有具名角色，提取名字、别名、角色定位",
    category: "extraction",
    variables: ["novelContext"],
    bilingual: true,
  },
  {
    agentId: "character_detail",
    name: "角色详情提取 (Pass 2)",
    description: "对单个角色深度剖析：性格、驱动力、行为模式、说话风格等 8 个维度",
    category: "extraction",
    variables: ["characterName", "characterBrief", "characterRole", "novelContext"],
    bilingual: true,
  },
  {
    agentId: "relationships",
    name: "关系网络提取 (Pass 3)",
    description: "分析角色之间的关系网络：类型、动态、历史、权力关系",
    category: "extraction",
    variables: ["characterNames", "novelContext"],
    bilingual: true,
  },
  {
    agentId: "chapter_end_states",
    name: "末章状态提取",
    description: "提取所有角色在小说最新内容中的当前状态快照",
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
    description: "逐章提取关键事件、涉及角色和事件结果",
    category: "extraction",
    variables: ["chapterTitle", "truncated"],
    bilingual: true,
  },

  // ---- Simulation (1 agent) ----
  {
    agentId: "outline_writer",
    name: "剧本大纲编写器",
    description: "在 Writer 创作前编写场景剧本大纲：节拍、情感弧线、结局",
    category: "simulation",
    variables: ["continueFromLabel", "continueFromChapter", "chapterSummaries",
      "charSummaries", "worldTimePeriod", "worldLocation", "worldPowerSystem",
      "activeForeshadowing", "authorNotes", "previousProse"],
    bilingual: true,
  },

  // ---- Writing (1 agent, uses full Codex) ----
  {
    agentId: "writer",
    name: "小说作家",
    description: "根据完整创作法典（风格包 + 角色卷宗 + 世界观 + 前文 + 伏笔 + 灵感库）撰写场景叙事。使用 Codex Renderer 组装系统提示词",
    category: "writing",
    variables: ["codex (全 7 段创作法典: styleProfiles, characterDossiers, worldBible, narrativeContext, foreshadowingLedger, ideaBank, currentTask)"],
    bilingual: true,
  },

  // ---- Review (6 agents, run in parallel via Codex review-orchestrator) ----
  {
    agentId: "character_consistency_review",
    name: "角色一致性审查",
    description: "对照角色卷宗检查：说话风格漂移、性格行为偏差、关系动态错误",
    category: "review",
    variables: ["characterDossiers", "generatedProse"],
    bilingual: false,
  },
  {
    agentId: "continuity_review",
    name: "连贯性审查",
    description: "检查逻辑矛盾：因果链断裂、物体凭空出现、已死角色说话、时间线错乱",
    category: "review",
    variables: ["chapterSummaries", "characterStates", "generatedProse"],
    bilingual: false,
  },
  {
    agentId: "foreshadowing_review",
    name: "伏笔追踪审查",
    description: "识别新埋伏笔、标记已回收伏笔、警告到达回收窗口的伏笔",
    category: "review",
    variables: ["foreshadowingLedger", "generatedProse"],
    bilingual: false,
  },
  {
    agentId: "style_review",
    name: "风格一致性审查",
    description: "对照风格指纹检查：句长偏离、AI味表达、句式单调、对话比例异常",
    category: "review",
    variables: ["styleProfiles", "generatedProse"],
    bilingual: false,
  },
  {
    agentId: "world_review",
    name: "世界观审查",
    description: "检查力量体系规则是否被打破、社会结构/势力关系是否正确、地点矛盾",
    category: "review",
    variables: ["worldBible", "generatedProse"],
    bilingual: false,
  },
  {
    agentId: "pacing_review",
    name: "节奏审查",
    description: "检查节奏是否符合要求、冲突强度是否匹配故事节点、是否拖沓或仓促",
    category: "review",
    variables: ["currentTask", "generatedProse"],
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
    writing: [],
    review: [],
  };
  for (const agent of AGENT_REGISTRY) {
    if (groups[agent.category]) {
      groups[agent.category].push(agent);
    }
  }
  return groups;
}
