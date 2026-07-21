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
    agentId: "novel_analysis",
    name: "全书分析主 Agent",
    description:
      "只组织：①章法 ②角色 ③故事∥时间线∥文风∥点子。User 由程序/对话注入，无 user 模板。",
    category: "extraction",
    variables: [],
    bilingual: true,
  },
  {
    agentId: "story_world",
    name: "故事与世界分析",
    description: "子 Agent：故事信息与世界观，submit_story_world",
    category: "extraction",
    variables: ["prompt", "novelId", "branchId"],
    bilingual: false,
  },
  {
    agentId: "character_names_unit",
    name: "分段角色指称扫描",
    description:
      "按章/窗找出所有人物指称（姓名/外号/亲属与描述指代，不限有正式姓名；不做全局消解）",
    category: "extraction",
    variables: ["unitLabel", "unitText"],
    bilingual: true,
  },
  {
    agentId: "character_roster_gate",
    name: "角色名单 LLM 筛选",
    description:
      "根据角色信息卡（提及次数/角色/简介等）由模型决定保留谁，无死板频次/亲属规则",
    category: "extraction",
    variables: ["candidatesJson", "textLength", "unitCount", "candidateCount"],
    bilingual: false,
  },
  {
    agentId: "analyze_character_list",
    name: "分析角色列表",
    description: "子 Agent：自行决定扫名/归并；submit 实体名单。指代是内部手段",
    category: "extraction",
    variables: ["prompt", "novelId", "branchId", "surfaceCount", "unitCount"],
    bilingual: true,
  },
  {
    agentId: "character_roster",
    name: "分析角色列表（旧 id）",
    description: "别名 → analyze_character_list",
    category: "extraction",
    variables: ["prompt", "novelId", "branchId", "surfaceCount", "unitCount"],
    bilingual: true,
  },
  {
    agentId: "character_entity_resolve",
    name: "分析角色列表（旧 id）",
    description: "别名 → analyze_character_list",
    category: "extraction",
    variables: ["prompt", "novelId", "branchId", "surfaceCount", "unitCount"],
    bilingual: true,
  },
  {
    agentId: "character_list",
    name: "角色列表提取 (Pass 1·旧)",
    description: "旧 chatWithTool 路径，主分析请用 analyze_character_list",
    category: "extraction",
    variables: ["novelContext", "frequencyRoster"],
    bilingual: true,
  },
  {
    agentId: "character_detail",
    name: "角色详情提取 (旧函数)",
    description: "chatWithTool 路径；Agent 请用 character_detail_agent",
    category: "extraction",
    variables: ["characterName", "characterBrief", "characterRole", "novelContext"],
    bilingual: true,
  },
  {
    agentId: "character_detail_agent",
    name: "角色详情分析 Agent",
    description: "子 Agent：submit_character_detail 写人设",
    category: "extraction",
    variables: ["prompt", "novelId", "branchId"],
    bilingual: false,
  },
  {
    agentId: "character_relationships",
    name: "角色关系网分析",
    description: "子 Agent：有向关系 submit_character_relationships",
    category: "extraction",
    variables: ["prompt", "novelId", "branchId"],
    bilingual: false,
  },
  {
    agentId: "relationships",
    name: "关系网络提取 (旧)",
    description: "旧函数路径；主分析请用 character_relationships",
    category: "extraction",
    variables: ["characterNames", "novelContext"],
    bilingual: true,
  },
  {
    agentId: "timeline_analysis",
    name: "时间线分析",
    description: "子 Agent：依赖章法单元，submit_timeline_events",
    category: "extraction",
    variables: ["prompt", "novelId", "branchId"],
    bilingual: false,
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
    name: "时间线事件提取 (旧函数)",
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
    description: "提取文笔写入文笔库（可跨书嫁接）：说明、手法、节奏、范例片段、内容尺度；不含形态章法",
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
    agentId: "outline_review",
    name: "大纲审核",
    description: "写正文前审核大纲：承接、出场合法性、类型逻辑、伏笔",
    category: "review",
    variables: ["prompt", "novelId", "branchId"],
    bilingual: false,
  },
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
