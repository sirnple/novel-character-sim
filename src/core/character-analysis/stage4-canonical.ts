/**
 * Stage ④: pick a **canonicalName** from each entity's surfaces for roster submit.
 * Pipeline ends here. Uncertain same-person pairs are NOT resolved in this stage —
 * the outer character-list agent may use co-occur query tools after the pipeline.
 *
 * Implementation lives in `stage5-canonical.ts` (legacy filename); re-exported here.
 */

export {
  selectCanonicalName,
  selectCanonicalNameWithOptionalLlm,
  uniqueProperSurfaces,
  isRuleConfidentCanonical,
  applyStage5CanonicalNames,
  applyStage5CanonicalNamesWithLlm,
  applyStage4CanonicalNames,
  applyStage4CanonicalNamesWithLlm,
  scoreSurfaceAsCanonical,
  type CanonicalPick,
  type SurfaceScoreRow,
} from "./stage5-canonical";
