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

  // ---- Extraction ----
  character_list: {
    system: "character-list-system.md",
    systemEn: "character-list-system.en.md",
  },
  character_detail: {
    system: "character-detail-system.md",
    systemEn: "character-detail-system.en.md",
  },
  relationships: {
    system: "relationships-system.md",
    systemEn: "relationships-system.en.md",
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
  style_extract: {
    system: "style-extract-system.md",
    systemEn: "style-extract-system.en.md",
    user: "style-extract-user.md",
    userEn: "style-extract-user.en.md",
  },
  idea_extract: {
    system: "idea-extract-system.md",
    systemEn: "idea-extract-system.en.md",
    user: "idea-extract-user.md",
    userEn: "idea-extract-user.en.md",
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
