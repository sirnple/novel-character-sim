/**
 * Domain types for character analysis pipeline.
 * ① window LLM extract → ② pairwise adjacent merge in overlap → ③ co-occur (later).
 */

import type { MentionKind } from "./mention-kind";
export type { MentionKind } from "./mention-kind";
export {
  MENTION_KINDS,
  isIdentityStrongKind,
  isProperKind,
  isDeicticKind,
  resolveMentionKind,
  inferMentionKind,
  parseMentionKind,
} from "./mention-kind";

/** One name / title / pronoun / alias appearance in a window. */
export interface Mention {
  /** Exact surface as it appears (or as LLM groups it). */
  surface: string;
  /**
   * surface plus ~two words before and after (for locate + disambiguation).
   * Prefer verbatim window text snippet.
   */
  textAnchor: string;
  /**
   * Referential strength / type of this surface.
   * Set by stage-① LLM + rule fallback in normalize (always filled there).
   * Optional only for hand-built fixtures; coref resolves via resolveMentionKind.
   */
  kind?: MentionKind;
  /** Filled in stage ② locate step (optional on raw LLM output). */
  offsetAnchor?: OffsetAnchor;
}

/** Char offsets of a mention in window-local and novel-global coordinates. */
export interface OffsetAnchor {
  localStart: number;
  localEnd: number;
  globalStart: number;
  globalEnd: number;
}

/** One person after in-window coreference. */
export interface Character {
  mentions: Mention[];
  gender?: string;
  age?: string;
}

/** Sliding text window over the novel. */
export interface AnalysisWindow {
  /** 0-based window index (stable key for merge / locate). */
  index: number;
  /** Display id; same number as `index` (e.g. 窗0, 窗1). */
  label: string;
  /** Global [start, end) in full novel text. */
  start: number;
  end: number;
  text: string;
}

export interface WindowExtractResult {
  window: Pick<AnalysisWindow, "index" | "label" | "start" | "end">;
  characters: Character[];
  error?: string;
}

export interface Stage1ScanConfig {
  /** Window body size (chars). Default 6000. */
  windowChars: number;
  /** Overlap between adjacent windows (chars). Default 800. */
  overlapChars: number;
}

export const STAGE1_DEFAULT_CONFIG: Stage1ScanConfig = {
  windowChars: 6000,
  overlapChars: 800,
};
