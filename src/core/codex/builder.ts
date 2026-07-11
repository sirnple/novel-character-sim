// ============================================================
// Codex Builder — Assemble the full 7-segment Writer's Codex
// ============================================================

import type { WritersCodex, ChapterSummary, CharacterStateSnapshot, ForeshadowingEntry, IdeaBank } from "./types";
import type { CharacterProfile, SceneDefinition, StoryInfo, ChapterTimeline, WritingStyle, CharacterChapterState } from "@/types";
import { extractCharacterQuotes } from "./voice-extractor";
import { computeStyleFingerprint } from "./style-profiler";

export interface BuildCodexInput {
  characters: CharacterProfile[];
  storyInfo: StoryInfo | null;
  timeline: ChapterTimeline | null;
  lastChapterStates: CharacterChapterState[];
  scene: SceneDefinition;
  fullNovelText: string;
  chapterSummaries?: ChapterSummary[];
  foreshadowing?: ForeshadowingEntry[];
  recentProse?: string;
  ideaBank?: IdeaBank;
}

/**
 * Assemble the full Writer's Codex from all available data sources.
 * Designed to fit within a 1M token context window (~185K tokens typical).
 */
export function buildCodex(input: BuildCodexInput): WritersCodex {
  const characters = input.characters || [];
  const profile = characters[0];
  const zh = profile
    ? ((profile.personality?.description || "").match(/[一-鿿]/g) || []).length >
      (profile.personality?.description || "").length * 0.1
    : true;

  // Segment 1: Style Pack
  const writingStyle: WritingStyle = input.storyInfo?.writingStyle || {
    genre: "",
    styleDescription: "",
    narrativeTechniques: [],
    languageFeatures: "",
    pacingDescription: "",
    tone: "",
    examplePassages: [],
    contentRating: { level: "", description: "", hasExplicitContent: false },
  };
  const fingerprint = computeStyleFingerprint(input.fullNovelText);
  const examplePassages = writingStyle.examplePassages || [];

  // Segment 2: Character Dossiers
  const quotes = extractCharacterQuotes(characters, input.fullNovelText);
  const currentStates: CharacterStateSnapshot[] = characters.map(c => {
    const lastState = input.lastChapterStates?.find(s => s.name === c.name);
    return {
      characterId: c.id,
      name: c.name,
      alive: lastState?.alive !== false,
      currentLocation: lastState?.location || "未知",
      currentEmotion: "neutral",
      currentGoal: c.drive?.goal || "",
      relationshipStates: buildRelationshipStateMap(c),
      lastChapterSeen: lastState?.lastSeenChapter || 0,
    };
  });

  // Segment 3: World Bible
  const ws = input.storyInfo?.worldSetting;
  const worldBible = {
    timePeriod: ws?.timePeriod || "",
    location: ws?.location || "",
    socialStructure: ws?.socialStructure || "",
    powerSystem: ws?.powerSystem || "",
    factions: ws?.factions || [],
    rules: ws?.rules || [],
    atmosphere: ws?.atmosphere || "",
  };

  // Segment 4: Narrative Context
  const chapterSummaries: ChapterSummary[] =
    input.chapterSummaries ||
    (input.storyInfo?.chapterOutlines?.map((c, i) => ({
      chapterNumber: c.chapterNumber || i + 1,
      title: c.title || "",
      summary: c.summary || "",
      keyEvents: c.keyEvents || [],
      characterChanges: {},
    })) ||
      []);
  const recentProse = input.recentProse || "";

  // Segment 7: Current Task (filled by engine from outline)
  const currentTask = {
    sceneGoal: "",
    emotionalArc: "",
    stakes: "",
    pacing: "medium" as "fast" | "medium" | "slow",
    targetCharacters: [] as string[],
    estimatedWordCount: 0,
    estimatedChapters: 0,
    outlines: [] as any[],
  };
  const active = (input.foreshadowing || []).filter(f => f.status !== "revealed");
  const revealed = (input.foreshadowing || []).filter(f => f.status === "revealed");

  // Segment 6: Idea Bank
  const ideaBank = input.ideaBank || {
    writingTechniques: [],
    genreConventions: [],
    referencePassages: [],
    authorNotes: "",
  };

  return {
    styleProfiles: { writingStyle, fingerprint, examplePassages },
    characterDossiers: { profiles: characters, quotes, currentStates },
    worldBible,
    narrativeContext: { chapterSummaries, recentProse },
    foreshadowingLedger: { active, revealed },
    ideaBank,
    currentTask,
  };
}

function buildRelationshipStateMap(profile: CharacterProfile): Record<string, string> {
  const map: Record<string, string> = {};
  for (const rel of profile.relationships || []) {
    map[rel.characterName] = `${rel.type} — ${rel.dynamics}`;
  }
  return map;
}

function buildSceneOutline(scene: SceneDefinition, characters: CharacterProfile[]): string {
  const charNames = (scene.characterIds || [])
    .map(id => characters.find(c => c.id === id)?.name || "")
    .filter(Boolean)
    .join("、");

  return `场景: ${scene.location}
时间: ${scene.timeOfDay}
天气: ${scene.weather}
氛围: ${scene.atmosphere}
初始情境: ${scene.initialSituation}
出场角色: ${charNames}
冲突类型: ${scene.plot?.conflictType || "未指定"}
故事节点: ${scene.plot?.storyBeat || "未指定"}
关键事件: ${scene.plot?.keyEvent || "未指定"}
赌注: ${scene.plot?.stakes || "未指定"}`;
}
