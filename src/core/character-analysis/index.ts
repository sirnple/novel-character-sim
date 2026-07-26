export type {
  AnalysisWindow,
  Character,
  Mention,
  MentionKind,
  OffsetAnchor,
  Stage1ScanConfig,
  WindowExtractResult,
} from "./types";
export {
  STAGE1_DEFAULT_CONFIG,
  MENTION_KINDS,
  isIdentityStrongKind,
  isProperKind,
  isDeicticKind,
  resolveMentionKind,
  inferMentionKind,
  parseMentionKind,
} from "./types";
export {
  preferMentionKind,
  kindOfSurfaceOnCharacter,
} from "./mention-kind";
export {
  buildAnalysisWindows,
  overlapRange,
  windowOverlapZones,
  splitWindowByOverlap,
} from "./windows";
export { formatWindowBodyForPrompt } from "./prompt";
export { EXTRACT_WINDOW_CHARACTERS_SCHEMA } from "./schema";
export {
  loadExtractWindowPromptTemplate,
  renderExtractWindowPrompt,
  extractWindowPromptPath,
} from "./prompt";
export { charactersFromLlmWire } from "./normalize";
export { extractCharactersInWindow } from "./extract-window";
export { runStage1WindowScan } from "./stage1-scan";
export {
  locateMentionInWindow,
  locateCharactersInWindow,
  offsetInRange,
  indexOfFrom,
  indexOfAllowingNewlines,
  indexOfFuzzy,
  findSpan,
  findAllSurfaceHits,
  pickSurfaceByAnchorOverlap,
  lcsLength,
  stripNewlines,
  type LocatedMention,
  type LocatedCharacter,
  type LocateMatchMode,
  type LocateSpan,
} from "./locate-mentions";
export {
  normalizeMentionSurface,
  characterSurfaces,
  charactersShareMention,
  sharedMentionSurfaces,
  mergeTwoCharacters,
  mergeTwoMergedCharacters,
  sharedSurfacesInOverlap,
  sharedIdenticalMentionsInOverlap,
  classifySharedIdenticalInOverlap,
  meetsMergeEvidenceThresholds,
  mergeEvidenceTierOfKind,
  isMergeEvidenceMention,
  strongSurfacesOf,
  sharedStrongSurfacesAnywhere,
  mentionIdentityKey,
  canMergeInOverlap,
  junctionOverlap,
  mergeSegmentPair,
  hierarchicalPairMerge,
  mergeAdjacentWindowCharacters,
  MERGE_EVIDENCE_MIN,
  type MergedCharacter,
  type Segment,
  type PairMergeTrace,
  type MergeEvidenceTier,
  type MergeEvidenceTierKind,
} from "./merge-adjacent";
export * from "./coref";
export {
  runCharacterAnalysisPipeline,
  type CharacterAnalysisPipelineOptions,
  type CharacterAnalysisPipelineResult,
} from "./pipeline";
export {
  formatCharacterPipelineProgress,
  overallPctForStage,
  CHARACTER_PIPELINE_STAGE_BANDS,
  type CharacterPipelineStageId,
  type CharacterPipelineProgressEvent,
} from "./progress";
export {
  selectCanonicalName,
  selectCanonicalNameWithOptionalLlm,
  uniqueProperSurfaces,
  isRuleConfidentCanonical,
  applyStage4CanonicalNames,
  applyStage4CanonicalNamesWithLlm,
  applyStage5CanonicalNames,
  applyStage5CanonicalNamesWithLlm,
  scoreSurfaceAsCanonical,
  type CanonicalPick,
  type SurfaceScoreRow,
} from "./stage4-canonical";
export {
  analysisWindowsToTextUnits,
  pickPrimaryAndAliases,
  mergedCharacterToResolvedEntity,
  stage1ToLocalEntities,
  pipelineResultToExtractSeed,
  sealCrossNameLedgerFromEntities,
} from "./to-extract-workspace";
