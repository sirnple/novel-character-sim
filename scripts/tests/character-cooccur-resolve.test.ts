/**
 * Residual co-occur coref: candidates A/B/C, hard rules, scoring, thresholds
 */
import assert from "node:assert/strict";
import {
  applyHardRules,
  buildEntityUnitStats,
  generateCorefCandidates,
  resolveResidualCooccurProgram,
  scorePair,
  type EntityUnitStats,
} from "../../src/core/extractor/character-cooccur-resolve";
import { resolveCharacterCorefConfig } from "../../src/lib/character-coref-config";
import type { ResolvedEntity } from "../../src/core/extractor/character-entity-types";

const cfg = resolveCharacterCorefConfig();

function ent(
  name: string,
  aliases: string[],
  units: number[],
  extra?: Partial<ResolvedEntity> & { gender?: string; age?: string },
): ResolvedEntity {
  return {
    name,
    aliases,
    surfaces: [name, ...aliases],
    anchors: units.map((u) => ({
      offset: u * 1000,
      unitIndex: u,
      unitLabel: `窗${u + 1}`,
      surface: name,
    })),
    role: "supporting",
    ...(extra || {}),
  };
}

// ── hard: same unit reject ──────────────────────────────────────────
{
  const a = ent("林风", [], [1, 2]);
  const b = ent("无名", [], [2, 3]);
  const stats = buildEntityUnitStats([a, b]);
  const h = applyHardRules(a, b, stats[0], stats[1], cfg);
  assert.equal(h.decision, "reject");
  assert.match(h.reason, /同块/);
}

// ── hard: ≥2 shared aliases merge ───────────────────────────────────
{
  const a = ent("唐兰嫣", ["战女王", "队长"], [0]);
  const b = ent("某某", ["战女王", "队长"], [5]);
  const stats = buildEntityUnitStats([a, b]);
  const h = applyHardRules(a, b, stats[0], stats[1], cfg);
  assert.equal(h.decision, "merge");
  assert.ok(h.sharedAliases.length >= 2);
}

// ── hard: same full name merge ──────────────────────────────────────
{
  const a = ent("姜璎玑", ["阿姨"], [0]);
  const b = ent("姜璎玑", ["魔都女王"], [8]);
  const stats = buildEntityUnitStats([a, b]);
  const h = applyHardRules(a, b, stats[0], stats[1], cfg);
  assert.equal(h.decision, "merge");
}

// ── hard: gender conflict ───────────────────────────────────────────
{
  const a = ent("甲", [], [0], { gender: "男" });
  const b = ent("乙", [], [5], { gender: "女" });
  const stats = buildEntityUnitStats([a, b]);
  const h = applyHardRules(a, b, stats[0], stats[1], cfg);
  assert.equal(h.decision, "reject");
}

// ── channel C: shared 1 alias enters candidates ─────────────────────
{
  const entities = [
    ent("璎玑阿姨", ["魔都女王"], [0]),
    ent("姜璎玑", ["魔都女王"], [20]), // far; no common friend
  ];
  const stats = buildEntityUnitStats(entities);
  const cands = generateCorefCandidates(entities, stats, cfg);
  assert.ok(
    cands.some((c) => c.source === "alias" || c.source === "both"),
    `expected alias candidate, got ${JSON.stringify(cands)}`,
  );
  // far gap should NOT drop alias channel
  assert.ok(cands.length >= 1);
}

// ── channel B: far cooccur pruned ───────────────────────────────────
{
  // A and B share companion X but A and B are far apart
  // X with A in unit 0, X with B in unit 20 → A,B candidates via X
  // gap between A span and B span = 20 > 10 → prune if only cooccur
  const entities = [
    ent("林风", [], [0]),
    ent("无名", [], [20]),
    ent("血屠", [], [0, 20]),
  ];
  const stats = buildEntityUnitStats(entities);
  const cands = generateCorefCandidates(entities, stats, {
    ...cfg,
    chunkGapMax: 10,
  });
  // 林风-无名 share companion 血屠 but gap 20 → pruned
  const lfWn = cands.find(
    (c) =>
      (entities[c.i].name === "林风" && entities[c.j].name === "无名") ||
      (entities[c.j].name === "林风" && entities[c.i].name === "无名"),
  );
  assert.equal(lfWn, undefined, "far cooccur pair should be pruned");
}

// ── channel A: near shared companion kept ───────────────────────────
{
  const entities = [
    ent("林风", [], [0, 1]),
    ent("无名", [], [2, 3]),
    ent("血屠", [], [0, 1, 2, 3]),
  ];
  // 林风 and 无名 never same unit → hard ok
  // both with 血屠; gap small
  const stats = buildEntityUnitStats(entities);
  const cands = generateCorefCandidates(entities, stats, cfg);
  const pair = cands.find(
    (c) =>
      (entities[c.i].name === "林风" && entities[c.j].name === "无名") ||
      (entities[c.j].name === "林风" && entities[c.i].name === "无名"),
  );
  assert.ok(pair, "near shared-companion pair should exist");
  assert.ok(pair!.source === "cooccur" || pair!.source === "both");
}

// ── scoring: exclusive high can auto-merge ──────────────────────────
{
  // 林风 and 无名 each only appear with 血屠 (strong exclusive)
  const entities = [
    ent("林风", [], [0, 1, 2, 3, 4]),
    ent("无名", [], [5, 6, 7, 8, 9]),
    ent("血屠", [], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
  ];
  const stats = buildEntityUnitStats(entities);
  const sc = scorePair(entities, stats, 0, 1, cfg);
  // exclusive = min(5/5, 5/5) = 1.0 → 0.5 contribution; jaccard high; temporal may penalize
  assert.ok(sc.sExclusive >= 0.9, `sExclusive=${sc.sExclusive}`);
  // with temporal low overlap (spans 0-4 vs 5-9), penalty -0.2
  // raw = 0.5*1 + 0.3*J - 0.2; J for neighbors: both only have 血屠 → inter=1 union=1 → 1
  // raw = 0.5 + 0.3 - 0.2 = 0.6 → grey not auto unless we lower temporal
  assert.ok(sc.score >= 0.45, `score=${sc.score}`);
}

// ── sparse jaccard discount ─────────────────────────────────────────
{
  // each appears once, same companion → raw J=1 but discounted
  const entities = [
    ent("甲", [], [0]),
    ent("乙", [], [1]),
    ent("丙", [], [0, 1]),
  ];
  const stats = buildEntityUnitStats(entities);
  const sc = scorePair(entities, stats, 0, 1, cfg);
  assert.ok(sc.sJ0 >= 0.99, `sJ0=${sc.sJ0}`);
  assert.ok(sc.sJ <= sc.sJ0 * 0.5 + 1e-9, `sJ should be discounted, got ${sc.sJ}`);
}

// ── program: hard merge 2 aliases ───────────────────────────────────
{
  const entities = [
    ent("唐兰嫣", ["战女王", "队长"], [0]),
    ent("队长影", ["战女王", "队长"], [8]),
    ent("路人甲", [], [1]),
  ];
  const { entities: out, log } = resolveResidualCooccurProgram(entities, {
    config: cfg,
  });
  assert.ok(out.length < entities.length, `merged ${entities.length}→${out.length}`);
  assert.ok(log.decisions.some((d) => d.route === "hard_merge"));
  const names = out.map((e) => e.name);
  // one of the two should absorb the other
  const merged = out.find(
    (e) =>
      e.aliases.includes("战女王") ||
      e.name === "唐兰嫣" ||
      e.name === "队长影",
  );
  assert.ok(merged);
  assert.ok(
    (merged!.aliases || []).includes("战女王") ||
      merged!.name === "唐兰嫣" ||
      merged!.name === "队长影",
  );
  assert.ok(names.includes("路人甲"));
}

// ── program: same unit never merges ─────────────────────────────────
{
  const entities = [
    ent("甲", ["共称"], [0, 1]),
    ent("乙", ["共称", "另称"], [0, 2]), // 2 shared aliases but same unit 0 → reject first
  ];
  // Wait: hard rule same unit is checked BEFORE alias merge — reject
  const { entities: out, log } = resolveResidualCooccurProgram(entities, {
    config: cfg,
  });
  assert.equal(out.length, 2);
  assert.ok(log.decisions.some((d) => d.route === "hard_reject"));
}

// ── program: single alias far → grey_alias_force not merge ──────────
{
  const entities = [
    ent("璎玑阿姨", ["魔都女王"], [0]),
    ent("姜璎玑", ["魔都女王"], [25]),
  ];
  const { entities: out, log } = resolveResidualCooccurProgram(entities, {
    config: cfg,
  });
  assert.equal(out.length, 2, "single alias must not hard-merge");
  assert.ok(
    log.decisions.some(
      (d) => d.route === "grey_alias_force" || d.route === "grey",
    ),
    `expected grey_alias_force, got ${log.decisions.map((d) => d.route).join(",")}`,
  );
}

// ── config override: aliasHardMergeMin=1 hard merges single alias ───
{
  const entities = [
    ent("璎玑阿姨", ["魔都女王"], [0]),
    ent("姜璎玑", ["魔都女王"], [25]),
  ];
  const { entities: out, log } = resolveResidualCooccurProgram(entities, {
    config: { ...cfg, aliasHardMergeMin: 1 },
  });
  assert.equal(out.length, 1);
  assert.ok(log.decisions.some((d) => d.route === "hard_merge"));
}

console.log("character-cooccur-resolve.test.ts: ok");
