import type {
  CorefRule,
  PairContext,
  PairFeatures,
  PairScoreResult,
  RuleScoreBreakdown,
  Stage3CorefConfig,
} from "./types";
import { ALL_COREF_RULES } from "./rules";

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Weight must be a positive finite number; otherwise fall back. */
export function sanitizePositiveWeight(
  weight: number | undefined,
  fallback: number,
): number {
  const fb =
    Number.isFinite(fallback) && fallback > 0 ? fallback : 1;
  if (weight == null || !Number.isFinite(weight) || weight <= 0) {
    return fb;
  }
  return weight;
}

export function resolveRuleRuntime(
  rule: CorefRule,
  config: Stage3CorefConfig,
): { enabled: boolean; weight: number } {
  const over = config.rules[rule.id];
  return {
    enabled: over?.enabled ?? rule.defaultEnabled,
    weight: sanitizePositiveWeight(over?.weight, rule.defaultWeight),
  };
}

/**
 * Run all enabled rules; hard reject > hard merge > soft score thresholds.
 */
export function scorePair(
  ctx: PairContext,
  rules: CorefRule[] = ALL_COREF_RULES,
): Omit<PairScoreResult, "decision" | "agentAnswer" | "agentReason"> {
  const breakdown: RuleScoreBreakdown[] = [];
  let hard: "merge" | "reject" | null = null;
  let acc = ctx.config.prior;

  for (const rule of rules) {
    const { enabled, weight } = resolveRuleRuntime(rule, ctx.config);
    if (!enabled) {
      breakdown.push({
        ruleId: rule.id,
        enabled: false,
        weight,
        delta: 0,
        weighted: 0,
        reason: "disabled",
      });
      continue;
    }
    const verdict = rule.evaluate(ctx);
    if (!verdict) continue;
    const weighted = weight * verdict.delta;
    acc += weighted;
    breakdown.push({
      ruleId: rule.id,
      enabled: true,
      weight,
      delta: verdict.delta,
      weighted,
      hard: verdict.hard,
      reason: verdict.reason,
    });
    if (verdict.hard === "reject") hard = "reject";
    else if (verdict.hard === "merge" && hard !== "reject") hard = "merge";
  }

  return {
    idA: ctx.a.id,
    idB: ctx.b.id,
    score: clamp01(acc),
    hard,
    breakdown,
  };
}

export function decideByThresholds(
  scored: Omit<PairScoreResult, "decision" | "agentAnswer" | "agentReason">,
  config: Stage3CorefConfig,
  features?: PairFeatures | null,
): PairScoreResult["decision"] {
  if (scored.hard === "reject") return "auto_reject";
  if (scored.hard === "merge") return "auto_merge";
  if (scored.score >= config.autoMergeThreshold) {
    // Kind gate: soft auto_merge needs identity-strong share (proper|nick)
    if (
      config.requireSharedStrongForAutoMerge !== false &&
      features &&
      features.sharedStrongSurfaces.length === 0
    ) {
      // Still high score → grey agent, not silent merge (g4 co-occur glue)
      if (scored.score <= config.autoRejectThreshold) return "auto_reject";
      return "agent";
    }
    return "auto_merge";
  }
  if (scored.score <= config.autoRejectThreshold) return "auto_reject";
  return "agent";
}
