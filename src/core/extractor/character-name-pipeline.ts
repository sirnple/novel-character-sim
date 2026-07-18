/**
 * Spec scheme C: low surface gate → soft cluster → cluster frequency gate.
 * No fixed top-K as primary policy.
 */

import {
  aggregateUnitHits,
  defaultMentionThreshold,
  filterByMentionFrequency,
  formatFrequencyRosterForPrompt,
  type NameAggregate,
  type UnitNameHit,
  type MentionThreshold,
} from "./character-name-aggregate";
import {
  softClusterAggregates,
  clusterToAggregateShape,
  type NameCluster,
} from "./character-name-cluster";

export interface PipelineResult {
  surfaces: NameAggregate[];
  afterSurfaceGate: NameAggregate[];
  clusters: NameCluster[];
  kept: NameAggregate[];
  surfaceThreshold: MentionThreshold;
  clusterThreshold: MentionThreshold;
  thresholdRaised: boolean;
  rosterPrompt: string;
}

/** Stage-1: very low bar to drop pure one-offs */
export function surfaceStageThreshold(unitCount: number): MentionThreshold {
  if (unitCount <= 2) return { minMentions: 1, minUnits: 1 };
  return { minMentions: 1, minUnits: 1 };
}

/**
 * Full frequency pipeline from per-unit hits.
 * unitIndexBySurface improves cluster unitHits when provided.
 */
export function runNameFrequencyPipeline(
  unitHits: UnitNameHit[][],
  opts: {
    textLength: number;
    unitCount: number;
    softMaxClusters?: number;
    unitIndexBySurface?: Map<string, Set<number>>;
  },
): PipelineResult {
  const surfaces = aggregateUnitHits(unitHits);
  const s1 = surfaceStageThreshold(opts.unitCount);

  // Stage-1: drop only pure zero (aggregate already min 1); optionally drop single-unit single-mention on long books
  let afterSurfaceGate = surfaces.filter((a) => {
    if (a.mentions < s1.minMentions || a.unitHits < s1.minUnits) return false;
    if (opts.textLength >= 150_000 && a.mentions === 1 && a.unitHits === 1) {
      return false; // pure one-off on medium+ books
    }
    return true;
  });

  const clusters = softClusterAggregates(afterSurfaceGate, opts.unitIndexBySurface);
  const asAgg = clusters.map(clusterToAggregateShape);

  const gated = filterByMentionFrequency(asAgg, {
    textLength: opts.textLength,
    unitCount: opts.unitCount,
    softMaxNames: opts.softMaxClusters ?? 120,
  });

  return {
    surfaces,
    afterSurfaceGate,
    clusters,
    kept: gated.kept,
    surfaceThreshold: s1,
    clusterThreshold: gated.threshold,
    thresholdRaised: gated.thresholdRaised,
    rosterPrompt: formatFrequencyRosterForPrompt(gated.kept),
  };
}

export { defaultMentionThreshold, formatFrequencyRosterForPrompt };
