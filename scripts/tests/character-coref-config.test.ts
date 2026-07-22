/**
 * Character coref config resolve + clamp invariants
 */
import assert from "node:assert/strict";
import {
  CHARACTER_COREF_DEFAULTS,
  resolveCharacterCorefConfig,
} from "../../src/lib/character-coref-config";

{
  const c = resolveCharacterCorefConfig();
  assert.equal(c.windowChars, CHARACTER_COREF_DEFAULTS.windowChars);
  assert.equal(c.overlapChars, CHARACTER_COREF_DEFAULTS.overlapChars);
  assert.equal(c.autoMergeThreshold, 0.85);
  assert.equal(c.greyLowThreshold, 0.45);
  assert.equal(c.weightExclusive, 0.5);
  assert.equal(c.weightJaccard, 0.3);
  assert.equal(c.chunkGapMax, 10);
  assert.equal(c.aliasHardMergeMin, 2);
  assert.equal(c.hardRejectSameUnit, true);
}

// partial overrides
{
  const c = resolveCharacterCorefConfig({
    windowChars: 4000,
    overlapChars: 500,
    autoMergeThreshold: 0.9,
    weightExclusive: 0.6,
  });
  assert.equal(c.windowChars, 4000);
  assert.equal(c.overlapChars, 500);
  assert.equal(c.autoMergeThreshold, 0.9);
  assert.equal(c.weightExclusive, 0.6);
  assert.equal(c.greyLowThreshold, 0.45);
}

// settings slice (runtime-settings shape)
{
  const c = resolveCharacterCorefConfig(undefined, {
    corefWindowChars: 3000,
    corefOverlapChars: 400,
    corefGreyLowThreshold: 0.5,
    corefHardRejectSameUnit: false,
  });
  assert.equal(c.windowChars, 3000);
  assert.equal(c.overlapChars, 400);
  assert.equal(c.greyLowThreshold, 0.5);
  assert.equal(c.hardRejectSameUnit, false);
}

// call partial wins over settings
{
  const c = resolveCharacterCorefConfig(
    { windowChars: 1111 },
    { corefWindowChars: 9999 },
  );
  assert.equal(c.windowChars, 1111);
}

// greyLow >= autoMerge → clamp grey band open
{
  const c = resolveCharacterCorefConfig({
    autoMergeThreshold: 0.7,
    greyLowThreshold: 0.75,
  });
  assert.ok(c.greyLowThreshold < c.autoMergeThreshold);
  assert.ok(Math.abs(c.greyLowThreshold - (0.7 - 0.05)) < 1e-9);
}

// overlap cannot exceed window - 100
{
  const c = resolveCharacterCorefConfig({
    windowChars: 1000,
    overlapChars: 9999,
  });
  assert.equal(c.overlapChars, 900);
}

// temporal penalties clamp to ≤0
{
  const c = resolveCharacterCorefConfig({
    temporalPenaltyLow: 0.5,
    temporalPenaltyMid: 0.1,
  });
  assert.equal(c.temporalPenaltyLow, 0);
  assert.equal(c.temporalPenaltyMid, 0);
}

// weights / thresholds clamp to [0,1]
{
  const c = resolveCharacterCorefConfig({
    weightExclusive: 2,
    weightJaccard: -1,
    autoMergeThreshold: 1.5,
  });
  assert.equal(c.weightExclusive, 1);
  assert.equal(c.weightJaccard, 0);
  assert.equal(c.autoMergeThreshold, 1);
}

console.log("character-coref-config.test.ts: ok");
