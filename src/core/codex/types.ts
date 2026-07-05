// ============================================================
// Writer's Codex — Data Types
// ============================================================

import type { CharacterProfile, SceneDefinition, StoryInfo, WritingStyle, ExamplePassage, ChapterTimeline, CharacterChapterState } from "@/types";

// ============================================================
// Style Profiling
// ============================================================

export interface CharacterQuote {
  text: string;
  emotion: "angry" | "sad" | "happy" | "neutral" | "tense" | "calm";
  context: string;
  chapterNumber: number;
}

export interface StyleFingerprint {
  avgSentenceLength: number;
  dialogueRatio: number;
  narrationRatio: number;
  commonOpeners: string[];
  commonConnectors: string[];
  punctuationProfile: {
    questionMarksPer1k: number;
    exclamationPer1k: number;
    ellipsisPer1k: number;
    emDashPer1k: number;
  };
  vocabularyTier: "literary_classical" | "literary" | "vernacular" | "mixed";
  pacingSignature: string;
}

// ============================================================
// Character State
// ============================================================

export interface CharacterStateSnapshot {
  characterId: string;
  name: string;
  alive: boolean;
  currentLocation: string;
  currentEmotion: string;
  currentGoal: string;
  relationshipStates: Record<string, string>;
  lastChapterSeen: number;
}

// ============================================================
// Foreshadowing
// ============================================================

export interface ForeshadowingEntry {
  id: string;
  type: "plot" | "character" | "world" | "relationship" | "mystery" | "theme";
  description: string;
  plantedChapter: number;
  plantedAt: string;
  suggestedRevealWindow: string;
  revealed: boolean;
  revealedAt?: string;
  status: "pending" | "advancing" | "revealed" | "abandoned";
}

// ============================================================
// Narrative Context
// ============================================================

export interface ChapterSummary {
  chapterNumber: number;
  title: string;
  summary: string;
  keyEvents: string[];
  characterChanges: Record<string, string>;
}

// ============================================================
// Idea Bank
// ============================================================

export interface IdeaBank {
  writingTechniques: string[];
  genreConventions: string[];
  referencePassages: { source: string; text: string }[];
  authorNotes: string;
}

// ============================================================
// The Full Codex
// ============================================================

export interface WritersCodex {
  styleProfiles: {
    writingStyle: WritingStyle;
    fingerprint: StyleFingerprint;
    examplePassages: ExamplePassage[];
  };
  characterDossiers: {
    profiles: CharacterProfile[];
    quotes: Record<string, CharacterQuote[]>;
    currentStates: CharacterStateSnapshot[];
  };
  worldBible: {
    timePeriod: string;
    location: string;
    socialStructure: string;
    powerSystem: string;
    factions: string[];
    rules: string[];
    atmosphere: string;
  };
  narrativeContext: {
    chapterSummaries: ChapterSummary[];
    recentProse: string;
    currentOutline: string;
  };
  foreshadowingLedger: {
    active: ForeshadowingEntry[];
    revealed: ForeshadowingEntry[];
  };
  ideaBank: IdeaBank;
  currentTask: {
    sceneLocation: string;
    sceneTimeOfDay: string;
    sceneWeather: string;
    sceneAtmosphere: string;
    sceneGoal: string;
    conflictType: string;
    storyBeat: string;
    stakes: string;
    pacing: "fast" | "medium" | "slow";
    targetCharacters: string[];
  };
}

// ============================================================
// Review System
// ============================================================

export interface ReviewFinding {
  dimension: "character" | "continuity" | "foreshadowing" | "style" | "world" | "pacing";
  severity: "critical" | "major" | "minor";
  location: string;
  description: string;
  suggestion: string;
  snippet?: string;
  autoFixable: boolean;
  fixedText?: string;
}

export interface ReviewReport {
  findings: ReviewFinding[];
  autoFixedCount: number;
  needsHumanReview: ReviewFinding[];
  updatedStates: Partial<CharacterStateSnapshot>[];
  newForeshadowing: ForeshadowingEntry[];
  revealedForeshadowing: string[];
  newChapterSummary: ChapterSummary;
}
