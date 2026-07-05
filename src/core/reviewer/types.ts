// === Reviewer Types ===

export interface ReviewIssue {
  severity: "critical" | "major" | "minor";
  category: "continuity" | "character" | "literary";
  location: string;       // "段落3", "第2段对话", etc.
  description: string;
  suggestion: string;     // 建议如何修改
  snippet?: string;       // 原文中有问题的片段
}

export interface ReviewResult {
  pass: boolean;
  issues: ReviewIssue[];
  summary: string;        // 总体评审一句话
}

export interface ReviewInput {
  /** The draft prose to review */
  draft: string;
  /** Timeline context for continuity checks */
  timelineEvents: string;
  /** Character states for consistency checks */
  characterStates: string;
  /** Writing style context for literary review */
  writingStyle: string;
}
