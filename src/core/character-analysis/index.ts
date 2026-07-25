export type {
  AnalysisWindow,
  Character,
  Mention,
  OffsetAnchor,
  Stage1ScanConfig,
  WindowExtractResult,
} from "./types";
export { STAGE1_DEFAULT_CONFIG } from "./types";
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
  type LocatedMention,
  type LocatedCharacter,
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
  mentionIdentityKey,
  canMergeInOverlap,
  junctionOverlap,
  mergeSegmentPair,
  hierarchicalPairMerge,
  mergeAdjacentWindowCharacters,
  type MergedCharacter,
  type Segment,
  type PairMergeTrace,
} from "./merge-adjacent";
export * from "./coref";
export {
  runCharacterAnalysisPipeline,
  type CharacterAnalysisPipelineOptions,
  type CharacterAnalysisPipelineResult,
} from "./pipeline";
export {
  selectCanonicalName,
  selectCanonicalNameWithOptionalLlm,
  applyStage4CanonicalNames,
  applyStage4CanonicalNamesWithLlm,
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
