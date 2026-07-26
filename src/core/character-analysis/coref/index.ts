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
  UncertainCorefPair,
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
  pickRelatedNeighbors,
  windowIndexForOffset,
  type CooccurGraph,
  type EntityCooccurStats,
  type PairCooccurMetrics,
  type RelatedNeighborPick,
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
  agentJudgeSamePersonOneshot,
  agentJudgeSamePersonAgent,
  formatMentionContexts,
  formatRelatedCharacterCards,
  sliceContextFromFullText,
  sliceContextFromWindows,
  type AgentJudgeContextOptions,
  type AgentJudgeResult,
  type CorefOneshotVerdict,
} from "./agent-judge";
export {
  agentJudgeSamePersonToolLoop,
  COREF_JUDGE_TOOLS,
  executeCorefJudgeTool,
  type CorefJudgeLoopContext,
} from "./agent-judge-loop";
export {
  mergeStage3Config,
  resolveCorefWithRulesAndAgent,
  type Stage3Options,
} from "./resolve";
