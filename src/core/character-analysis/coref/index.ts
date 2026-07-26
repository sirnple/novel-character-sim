export type {
  PairFeatures,
  PairContext,
  RuleVerdict,
  CorefRule,
  RuleRuntimeConfig,
  Stage3CorefConfig,
  PairDecisionKind,
  RuleScoreBreakdown,
  PairScoreResult,
  Stage3ResolveResult,
} from "./types";
export { STAGE3_DEFAULT_CONFIG } from "./types";
export {
  buildPairFeatures,
  normalizeGender,
  surfacesOf,
  surfacesForCoref,
  identityStrongSurfacesForCoref,
  isDeicticPronounSurface,
  surfaceKindOn,
  sharedSurfaceKind,
  isStrongSurfaceOn,
  isProperSurfaceOn,
} from "./features";
export {
  buildCooccurGraph,
  pairCooccurMetrics,
  windowIndexForOffset,
  type CooccurGraph,
  type EntityCooccurStats,
  type PairCooccurMetrics,
} from "./cooccur-graph";
export {
  ALL_COREF_RULES,
  getCorefRule,
  ruleGenderConflict,
  ruleSharedStrongSurface,
  ruleSharedWeakSurface,
  ruleExclusiveProperNames,
  ruleWindowProximity,
  ruleCloseCooccur,
  ruleCloseMentionDifferent,
  ruleSameWindowCooccur,
  ruleNarratorFar,
  ruleCooccurExclusivity,
  ruleCooccurJaccard,
} from "./rules";
export {
  resolveRuleRuntime,
  sanitizePositiveWeight,
  scorePair,
  decideByThresholds,
} from "./score";
export {
  selectGreyLlmMode,
  type GreyLlmMode,
  type GreyLlmModeResult,
} from "./grey-llm-mode";
export { UnionFind } from "./union-find";
export {
  agentJudgeSamePerson,
  formatMentionContexts,
  sliceContextFromFullText,
  sliceContextFromWindows,
  type AgentJudgeContextOptions,
} from "./agent-judge";
export {
  mergeStage3Config,
  resolveCorefWithRulesAndAgent,
  type Stage3Options,
} from "./resolve";
