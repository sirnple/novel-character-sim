/**
 * UI display names for tools & sub-agents.
 * Code / API still use English snake_case ids; only presentation is Chinese.
 */

/** Tools registered for write + analysis agents */
export const TOOL_LABELS: Record<string, string> = {
  // Master / control
  agent: "调用子 Agent",
  ask_question: "向你提问",
  run_reviews: "六维审查（并行）",
  accept_continuation: "接受续写",
  finish_novel_analysis: "完成分析",

  // Intermediate store
  get_outline: "获取大纲",
  get_prose: "获取正文",
  get_findings: "获取审查发现",
  save_outline: "保存大纲",
  save_prose: "保存正文",
  save_findings: "保存审查发现",
  clear_findings: "清空审查发现",

  // Branch / book
  get_branch_text: "获取分支前文",
  get_branch_characters: "获取角色",
  get_branch_timeline: "获取时间线",
  get_branch_world: "获取世界观",
  get_branch_meta: "获取分支信息",
  get_novel_form: "获取目录/章法",
  get_novel_context: "获取原文",
  get_characters: "获取角色",
  get_timeline: "获取时间线",
  get_codex: "获取创作法典",
  get_world_bible: "获取世界观",

  // Foreshadow
  get_foreshadowing_ledger: "获取伏笔账本",
  get_foreshadowing_plan: "获取伏笔计划",
  save_foreshadowing_plan: "保存伏笔计划",
  get_foreshadowing_realization: "获取伏笔落实",
  save_foreshadowing_realization: "保存伏笔落实",

  // Style / ideas library
  list_styles: "列文笔库",
  get_style: "获取文笔",
  list_ideas: "列点子库",
  get_ideas: "获取点子",

  // Analysis context
  get_current_novel: "当前小说",
  get_current_branch: "当前分支",
  get_analysis_context: "分析上下文",
  get_analysis_status: "分析状态",
  get_novel_excerpt: "小说节选",
  get_text_slice: "读文本片段",
  list_text_units: "列出章节单元",
  get_unit_text: "读单元正文",
  get_kept_roster: "角色名单摘要",
  get_relationship_type_catalog: "关系类型目录",

  // Form
  run_form_analysis: "章法一键(兼容)",
  scan_chapter_catalog: "扫描章节目录",
  build_form_draft: "建章法草稿",
  list_form_catalog: "分页列目录",
  apply_catalog_tracks: "修正章节轨",
  set_form_narrative: "写入形态字段",
  enrich_form_draft: "LLM补全章法(旧)",
  submit_form: "提交章法",

  // Character pipeline
  scan_character_mentions: "角色列表流水线",
  list_local_entities: "局部实体列表",
  list_cross_name_candidates: "异名怀疑列表",
  list_near_alias_candidates: "近别名候选",
  resolve_cross_name_pair: "异名对表态",
  list_uncovered_surfaces: "未覆盖称呼",
  list_surface_candidates: "列出称呼候选",
  lookup_surface: "查称呼上下文",
  lookup_offset: "按位置读文",
  submit_character_entities: "提交角色实体",
  list_coref_uncertain_pairs: "指代未定对",
  list_cooccur_neighbors: "共现邻居",
  resolve_coref_uncertain_pair: "指代对表态",
  submit_character_detail: "提交角色详情",
  submit_character_relationships: "提交角色关系",

  // Domain submits
  submit_story_world: "提交故事世界",
  submit_timeline_events: "提交时间线",
  submit_style: "提交文风",
  submit_ideas: "提交点子",

  // Write sub-agents
  generate_outline: "大纲 Agent",
  write_prose: "写手 Agent",
  review_outline: "大纲审核",
  review_character: "角色审查",
  review_continuity: "连贯与逻辑审查",
  review_foreshadowing: "伏笔审查",
  review_style: "风格审查",
  review_world: "世界观审查",
  review_pacing: "节奏审查",

  // Analysis sub-agents (verb-object)
  novel_analysis: "全书分析主编",
  analyze_form: "分析章法",
  analyze_story_world: "分析故事世界",
  analyze_character_list: "分析角色列表",
  extract_character_detail: "抽取角色详情",
  extract_character_relationships: "抽取角色关系",
  analyze_timeline: "分析时间线",
  extract_style: "抽取文风",
  extract_ideas: "抽取点子",

  // Legacy aliases
  story_world: "分析故事世界",
  form_analysis: "分析章法",
  resolve_character_roster: "分析角色列表",
  character_roster: "分析角色列表",
  character_entity_resolve: "分析角色列表",
  character_detail: "抽取角色详情",
  character_detail_agent: "抽取角色详情",
  character_relationships: "抽取角色关系",
  timeline_analysis: "分析时间线",
  style_extract: "抽取文风",
  style_extract_agent: "抽取文风",
  idea_extract: "抽取点子",
  idea_extract_agent: "抽取点子",
  outline_writer: "大纲 Agent",
  writer_create: "写手 Agent",
  writer_rewrite: "写手·改写",
  style_review: "风格审查",
  character_consistency_review: "角色审查",
  continuity_review: "连贯与逻辑审查",
  foreshadowing_review: "伏笔审查",
  world_review: "世界观审查",
  pacing_review: "节奏审查",
};

/**
 * Chinese label for a tool or agent id.
 * Never returns bare English for known ids; unknown → 「工具·name」.
 */
export function toolLabel(name?: string | null): string {
  if (!name) return "工具";
  const key = String(name).trim();
  if (TOOL_LABELS[key]) return TOOL_LABELS[key];
  // snake_case → rough Chinese prefix so UI never looks bilingual-random
  return `工具·${key}`;
}

/** Alias for sub-agent display */
export function agentLabel(name?: string | null): string {
  return toolLabel(name);
}
