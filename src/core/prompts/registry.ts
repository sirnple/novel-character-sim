// ============================================================
// Prompt Registry — agents manageable in Admin (each has md defaults)
// ============================================================

export interface AgentPromptMeta {
  agentId: string;
  name: string;
  description: string;
  category: "extraction" | "simulation" | "writing" | "review" | "master";
  variables: string[];
  bilingual: boolean;
}

/**
 * Active agents registered with metadata.
 * Must stay in sync with AGENT_PROMPT_FILES in agent-prompt-map.ts.
 */
export const AGENT_REGISTRY: AgentPromptMeta[] = [
  // ---- Master ----
  {
    agentId: "master",
    name: "主编（主 Agent）",
    description: "调度子 agent、与用户确认流程；不写正文、不审正文",
    category: "master",
    variables: ["novelId", "branchId"],
    bilingual: false,
  },

  // ---- Extraction ----
  {
    agentId: "character_list",
    name: "角色列表提取 (Pass 1)",
    description: "从小说节选中识别所有具名角色，提取名字、别名、角色定位",
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
    description: "提取情节摘要、主线、章节概要、世界观设定（不含文风）",
    category: "extraction",
    variables: ["novelContext"],
    bilingual: true,
  },
  {
    agentId: "timeline",
    name: "时间线事件提取",
    description: "逐章提取关键事件、涉及角色和事件结果",
    category: "extraction",
    variables: ["chapterTitle", "truncated"],
    bilingual: true,
  },
  {
    agentId: "timeline_states",
    name: "时间线章末状态",
    description: "提取每章结束时出场角色的状态（alive/location/delta）",
    category: "extraction",
    variables: ["chapterTitle", "truncated", "knownNames", "prevStateDesc"],
    bilingual: true,
  },
  {
    agentId: "style_extract",
    name: "风格提取",
    description: "提取文风指纹写入风格库：说明、手法、节奏、范例片段、内容尺度",
    category: "extraction",
    variables: ["title", "novelContext"],
    bilingual: true,
  },
  {
    agentId: "idea_extract",
    name: "点子提取",
    description: "从节选抽象出与本书解耦的可迁移续写点子（禁用具体角色名/专有名词）",
    category: "extraction",
    variables: ["title", "novelContext"],
    bilingual: true,
  },

  // ---- Outline ----
  {
    agentId: "outline_writer",
    name: "大纲 Agent",
    description: "为续写设计大纲；可选用点子库；最终输出大纲正文",
    category: "simulation",
    variables: ["prompt", "novelId", "branchId", "selectionInstruction"],
    bilingual: false,
  },

  // ---- Writer ----
  {
    agentId: "writer_create",
    name: "写手 · 创作",
    description: "MODE:create — 根据大纲写正文并 save_prose",
    category: "writing",
    variables: ["prompt", "novelId", "branchId"],
    bilingual: false,
  },
  {
    agentId: "writer_rewrite",
    name: "写手 · 改写",
    description: "MODE:rewrite — 按 findings 改正文并 save_prose",
    category: "writing",
    variables: ["prompt", "novelId", "branchId"],
    bilingual: false,
  },

  // ---- Review ----
  {
    agentId: "character_consistency_review",
    name: "角色一致性审查",
    description: "对照角色设定检查说话风格、性格行为、关系动态",
    category: "review",
    variables: ["prompt", "novelId", "branchId", "dimensionName", "dimensionCode"],
    bilingual: false,
  },
  {
    agentId: "continuity_review",
    name: "连贯与逻辑审查",
    description: "事实/时间线 + 本体逻辑（梦与现实等）；按小说类型调节松紧",
    category: "review",
    variables: ["prompt", "novelId", "branchId", "dimensionName", "dimensionCode"],
    bilingual: false,
  },
  {
    agentId: "foreshadowing_review",
    name: "伏笔追踪审查",
    description: "识别新伏笔、推进与回收",
    category: "review",
    variables: ["prompt", "novelId", "branchId", "dimensionName", "dimensionCode"],
    bilingual: false,
  },
  {
    agentId: "style_review",
    name: "风格一致性审查",
    description: "对照文风检查句式、AI 味、对话比例",
    category: "review",
    variables: ["prompt", "novelId", "branchId", "dimensionName", "dimensionCode"],
    bilingual: false,
  },
  {
    agentId: "world_review",
    name: "世界观审查",
    description: "检查力量体系、势力、地点是否越界",
    category: "review",
    variables: ["prompt", "novelId", "branchId", "dimensionName", "dimensionCode"],
    bilingual: false,
  },
  {
    agentId: "pacing_review",
    name: "节奏审查",
    description: "检查节奏与冲突强度是否匹配",
    category: "review",
    variables: ["prompt", "novelId", "branchId", "dimensionName", "dimensionCode"],
    bilingual: false,
  },
];

export function getAgentMeta(agentId: string): AgentPromptMeta | undefined {
  return AGENT_REGISTRY.find((a) => a.agentId === agentId);
}

export function getAgentsByCategory(): Record<string, AgentPromptMeta[]> {
  const groups: Record<string, AgentPromptMeta[]> = {
    master: [],
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
