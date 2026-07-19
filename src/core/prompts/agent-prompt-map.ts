/**
 * Maps admin/runtime agentId → markdown files under src/core/prompts/.
 * System defaults always come from these files (unless Admin overrides in DB).
 */

export interface AgentPromptFiles {
  /** Primary system prompt md (zh, or only language) */
  system: string;
  /** Optional second system fragment concatenated after system */
  systemExtra?: string;
  /** English system md when bilingual */
  systemEn?: string;
  systemExtraEn?: string;
  /** Optional user message template */
  user?: string;
  userEn?: string;
}

export const AGENT_PROMPT_FILES: Record<string, AgentPromptFiles> = {
  // ---- Master ----
  master: {
    system: "master-system.md",
  },

  // ---- Extraction / novel analysis ----
  novel_analysis: {
    system: "novel-analysis-master-system.md",
    systemEn: "novel-analysis-master-system.en.md",
    user: "novel-analysis-master-user.md",
    userEn: "novel-analysis-master-user.en.md",
    // vars: prompt, novelId, branchId, modules, forceRefresh
  },
  // Domain agents — canonical verb-object ids (+ noun aliases for Admin/history)
  analyze_form: {
    system: "form-analysis-system.md",
    user: "form-analysis-user.md",
  },
  analyze_story_world: {
    system: "story-world-system.md",
    user: "story-world-user.md",
  },
  story_world: {
    system: "story-world-system.md",
    user: "story-world-user.md",
  },
  character_names_unit: {
    system: "character-names-unit-system.md",
    systemEn: "character-names-unit-system.en.md",
  },
  character_roster_gate: {
    system: "character-roster-gate-system.md",
  },
  analyze_character_list: {
    system: "character-entity-resolve-system.md",
    systemEn: "character-entity-resolve-system.en.md",
    user: "character-entity-resolve-user.md",
    userEn: "character-entity-resolve-user.en.md",
  },
  resolve_character_roster: {
    system: "character-entity-resolve-system.md",
    systemEn: "character-entity-resolve-system.en.md",
    user: "character-entity-resolve-user.md",
    userEn: "character-entity-resolve-user.en.md",
  },
  character_roster: {
    system: "character-entity-resolve-system.md",
    systemEn: "character-entity-resolve-system.en.md",
    user: "character-entity-resolve-user.md",
    userEn: "character-entity-resolve-user.en.md",
  },
  character_entity_resolve: {
    system: "character-entity-resolve-system.md",
    systemEn: "character-entity-resolve-system.en.md",
    user: "character-entity-resolve-user.md",
    userEn: "character-entity-resolve-user.en.md",
  },
  character_list: {
    system: "character-list-system.md",
    systemEn: "character-list-system.en.md",
  },
  extract_character_detail: {
    system: "character-detail-agent-system.md",
    user: "character-detail-agent-user.md",
  },
  character_detail: {
    system: "character-detail-system.md",
    systemEn: "character-detail-system.en.md",
  },
  character_detail_agent: {
    system: "character-detail-agent-system.md",
    user: "character-detail-agent-user.md",
  },
  extract_character_relationships: {
    system: "character-relationships-system.md",
    user: "character-relationships-user.md",
  },
  character_relationships: {
    system: "character-relationships-system.md",
    user: "character-relationships-user.md",
  },
  relationships: {
    system: "relationships-system.md",
    systemEn: "relationships-system.en.md",
  },
  analyze_timeline: {
    system: "timeline-analysis-system.md",
    user: "timeline-analysis-user.md",
  },
  timeline_analysis: {
    system: "timeline-analysis-system.md",
    user: "timeline-analysis-user.md",
  },
  chapter_end_states: {
    system: "chapter-end-states-system.md",
    systemEn: "chapter-end-states-system.en.md",
  },
  story_info: {
    system: "story-info-system.md",
    systemEn: "story-info-system.en.md",
  },
  timeline: {
    system: "timeline-system.md",
    systemEn: "timeline-system.en.md",
  },
  timeline_states: {
    system: "timeline-states-system.md",
    systemEn: "timeline-states-system.en.md",
  },
  extract_style: {
    system: "style-extract-agent-system.md",
    user: "style-extract-agent-user.md",
  },
  style_extract: {
    system: "style-extract-system.md",
    systemEn: "style-extract-system.en.md",
    user: "style-extract-user.md",
    userEn: "style-extract-user.en.md",
  },
  style_extract_agent: {
    system: "style-extract-agent-system.md",
    user: "style-extract-agent-user.md",
  },
  extract_ideas: {
    system: "idea-extract-agent-system.md",
    user: "idea-extract-agent-user.md",
  },
  idea_extract: {
    system: "idea-extract-system.md",
    systemEn: "idea-extract-system.en.md",
    user: "idea-extract-user.md",
    userEn: "idea-extract-user.en.md",
  },
  idea_extract_agent: {
    system: "idea-extract-agent-system.md",
    user: "idea-extract-agent-user.md",
  },

  // ---- Outline (agent framework) ----
  outline_writer: {
    system: "outline-system.md",
    systemExtra: "outline-agent-contract.md",
    user: "outline-agent-user.md",
  },

  // ---- Writer modes ----
  writer_create: {
    system: "writer-create-system.md",
    user: "writer-create-user.md",
  },
  writer_rewrite: {
    system: "writer-rewrite-system.md",
    user: "writer-rewrite-user.md",
  },

  outline_review: {
    system: "review-outline-system.md",
    user: "review-user.md",
  },

  // ---- Review (one system md per dimension) ----
  character_consistency_review: {
    system: "review-character-system.md",
    user: "review-user.md",
  },
  continuity_review: {
    system: "review-continuity-system.md",
    user: "review-user.md",
  },
  foreshadowing_review: {
    system: "review-foreshadowing-system.md",
    user: "review-user.md",
  },
  style_review: {
    system: "review-style-system.md",
    user: "review-user.md",
  },
  world_review: {
    system: "review-world-system.md",
    user: "review-user.md",
  },
  pacing_review: {
    system: "review-pacing-system.md",
    user: "review-user.md",
  },
};

export function getAgentPromptFiles(agentId: string): AgentPromptFiles | undefined {
  return AGENT_PROMPT_FILES[agentId];
}
