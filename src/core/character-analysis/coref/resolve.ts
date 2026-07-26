/**
 * Stage ③ coref:
 *  - rules hard auto_merge / auto_reject
 *  - grey → oneshot LLM (same | diff | uncertain)
 *  - uncertain pairs stay separate and are listed for the outer analysis agent
 *  - same-surface residual still uses oneshot (uncertain stays separate)
 *
 * Multi-hop co-occur tool-loop is NOT a pipeline stage — the character-list
 * agent calls query tools after the pipeline returns.
 */

import type { LLMProvider } from "@/types";
import type { MergedCharacter } from "../merge-adjacent";
import { mergeTwoMergedCharacters } from "../merge-adjacent";
import type { AnalysisWindow } from "../types";
import { agentJudgeSamePersonOneshot } from "./agent-judge";
import { buildCooccurGraph } from "./cooccur-graph";
import {
  buildPairFeatures,
  identityStrongSurfacesForCoref,
  surfacesForCoref,
} from "./features";
import { ALL_COREF_RULES } from "./rules";
import { decideByThresholds, scorePair } from "./score";
import type {
  PairContext,
  PairScoreResult,
  Stage3CorefConfig,
  Stage3ResolveResult,
  UncertainCorefPair,
} from "./types";
import { STAGE3_DEFAULT_CONFIG } from "./types";
import { UnionFind } from "./union-find";

export function mergeStage3Config(
  partial?: Partial<Stage3CorefConfig>,
): Stage3CorefConfig {
  return {
    ...STAGE3_DEFAULT_CONFIG,
    ...partial,
    rules: {
      ...STAGE3_DEFAULT_CONFIG.rules,
      ...(partial?.rules || {}),
    },
  };
}

function* unorderedPairs<T>(items: T[]): Generator<[T, T, number, number]> {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      yield [items[i]!, items[j]!, i, j];
    }
  }
}

function pairKey(idA: string, idB: string): string {
  return idA < idB ? `${idA}\0${idB}` : `${idB}\0${idA}`;
}

/** Residual pass: only identity-strong shared surfaces (kind proper|nick). */
function sharedIdentitySurfacesBetween(
  a: MergedCharacter,
  b: MergedCharacter,
  stripDeicticWhenHasName: boolean,
): string[] {
  const sa = new Set(identityStrongSurfacesForCoref(a, stripDeicticWhenHasName));
  const out: string[] = [];
  for (const s of identityStrongSurfacesForCoref(b, stripDeicticWhenHasName)) {
    if (sa.has(s)) out.push(s);
  }
  return out;
}

function rebuildFromUnion(
  characters: MergedCharacter[],
  uf: UnionFind,
): MergedCharacter[] {
  const groups = new Map<string, MergedCharacter[]>();
  for (const c of characters) {
    const root = uf.find(c.id);
    const list = groups.get(root) || [];
    list.push(c);
    groups.set(root, list);
  }
  const out: MergedCharacter[] = [];
  for (const [, members] of groups) {
    if (members.length === 1) {
      out.push(members[0]!);
      continue;
    }
    const rootId = members[0]!.id;
    let acc = members[0]!;
    for (let i = 1; i < members.length; i++) {
      acc = mergeTwoMergedCharacters(acc, members[i]!, rootId);
    }
    out.push(acc);
  }
  return out;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

export interface Stage3Options {
  config?: Partial<Stage3CorefConfig>;
  llm?: LLMProvider | null;
  agentConcurrency?: number;
  fullText?: string;
  agentContextRadius?: number;
  /**
   * Fired when a pair finishes (not when it starts). Under concurrency,
   * `completed` is the finish order count (1..total); `index` is queue slot.
   */
  onAgentPair?: (info: {
    /** 0-based index in the current judge queue */
    index: number;
    /** How many pairs have finished so far (monotone under concurrency) */
    completed: number;
    /** Total pairs in this stage3 LLM phase (grey + residual when known) */
    total: number;
    idA: string;
    idB: string;
    score: number;
    phase?: "grey" | "same_surface";
    llmMode?: "oneshot" | "deep";
  }) => void;
}

/**
 * Stage ③: rules + oneshot LLM on grey. Uncertain pairs are recorded, not
 * merged; the outer character-list agent resolves them with tools later.
 */
export async function resolveCorefWithRulesAndAgent(
  characters: MergedCharacter[],
  windows: AnalysisWindow[],
  options: Stage3Options = {},
): Promise<Stage3ResolveResult> {
  const config = mergeStage3Config(options.config);
  const fullTextLength =
    windows.length > 0
      ? Math.max(...windows.map((w) => w.end))
      : 0;

  const scored: PairScoreResult[] = [];
  const scoredByKey = new Map<string, PairScoreResult>();
  const uf = new UnionFind();
  for (const c of characters) uf.add(c.id);

  const graph = buildCooccurGraph(characters, windows);
  const agentQueue: PairScoreResult[] = [];

  for (const [a, b] of unorderedPairs(characters)) {
    const features = buildPairFeatures(a, b, config, graph);
    const ctx: PairContext = {
      a,
      b,
      features,
      windows,
      fullTextLength,
      config,
    };
    const base = scorePair(ctx, ALL_COREF_RULES);
    const decision = decideByThresholds(base, config, features);
    const row: PairScoreResult = { ...base, decision };
    if (decision === "agent") {
      row.llmMode = "oneshot";
      row.llmModeReason = "stage3 oneshot (same|diff|uncertain)";
    }
    scored.push(row);
    scoredByKey.set(pairKey(a.id, b.id), row);

    if (decision === "auto_merge") {
      uf.union(a.id, b.id);
    } else if (decision === "agent") {
      agentQueue.push(row);
    }
  }

  let agentMerge = 0;
  let agentReject = 0;
  let agentSkipped = 0;
  let agentOneshot = 0;
  let agentUncertain = 0;
  const warnAt = config.agentMaxPairs;
  if (
    config.agentEnabled &&
    warnAt > 0 &&
    agentQueue.length > warnAt
  ) {
    console.warn(
      `[stage3] grey pairs=${agentQueue.length} exceeds advisory ` +
        `agentMaxPairs=${warnAt} (all oneshot; uncertain left for outer agent)`,
    );
  }

  const toJudge = config.agentEnabled ? agentQueue : [];
  if (!config.agentEnabled) {
    for (const row of agentQueue) {
      row.decision = "agent_skipped";
      agentSkipped++;
    }
  } else if (toJudge.length) {
    agentOneshot = toJudge.length;
    console.log(
      `[stage3] oneshot pairs=${toJudge.length} (uncertain → outer agent, not pipeline stage)`,
    );
  }

  const llm = options.llm;
  const agentConcurrency = Math.max(
    1,
    Math.min(
      32,
      options.agentConcurrency ?? config.agentConcurrency ?? 6,
    ),
  );
  const byId = new Map(characters.map((c) => [c.id, c]));
  const strip = config.stripDeicticWhenHasName !== false;

  type AgentOutcome = { row: PairScoreResult; merge: boolean };

  /** Finished-pair count across concurrent workers (not queue index). */
  let pairsCompleted = 0;
  /** Updated when residual pass size is known. */
  let pairsTotal = toJudge.length;

  async function judgeOneshot(
    row: PairScoreResult,
    index: number,
    phase: "grey" | "same_surface",
  ): Promise<AgentOutcome> {
    const a = byId.get(row.idA);
    const b = byId.get(row.idB);
    row.llmMode = "oneshot";
    const emitDone = () => {
      const completed = ++pairsCompleted;
      options.onAgentPair?.({
        index,
        completed,
        total: pairsTotal,
        idA: row.idA,
        idB: row.idB,
        score: row.score,
        phase,
        llmMode: "oneshot",
      });
    };
    if (!llm || !a || !b) {
      row.decision = "agent_skipped";
      row.agentReason = !llm ? "no llm" : "missing character";
      emitDone();
      return { row, merge: false };
    }
    try {
      const features = buildPairFeatures(a, b, config, graph);
      const ans = await agentJudgeSamePersonOneshot(llm, a, b, features, {
        fullText: options.fullText,
        windows,
        contextRadius: options.agentContextRadius ?? 200,
        maxMentionsPerChar: 4,
        stripDeicticWhenHasName: strip,
        rosterById: byId,
        cooccurGraph: graph,
        includeRelatedCards: true,
        maxRelatedCards: 4,
        maxRelatedMentions: 1,
        relatedContextRadius: 100,
      });
      const tag =
        phase === "same_surface"
          ? "[same_surface|oneshot] "
          : "[stage3|oneshot] ";
      if (ans.verdict === "uncertain") {
        // Leave entities separate; outer analysis agent resolves later
        row.decision = "agent_uncertain";
        row.agentReason = tag + (ans.reason || "uncertain");
        row.llmModeReason = "oneshot uncertain → outer agent";
        emitDone();
        return { row, merge: false };
      }
      row.agentAnswer = ans.verdict === "same";
      row.agentReason = tag + (ans.reason || "");
      if (ans.verdict === "same") {
        row.decision = "agent_merge";
        emitDone();
        return { row, merge: true };
      }
      row.decision = "agent_reject";
      emitDone();
      return { row, merge: false };
    } catch (e) {
      row.decision = "agent_skipped";
      row.agentReason =
        tagCatch(phase) + (e instanceof Error ? e.message : String(e));
      emitDone();
      return { row, merge: false };
    }
  }

  function tagCatch(phase: "grey" | "same_surface"): string {
    return phase === "same_surface"
      ? "[same_surface|oneshot] "
      : "[stage3|oneshot] ";
  }

  const oneshotOutcomes = await mapPool(toJudge, agentConcurrency, (row, i) =>
    judgeOneshot(row, i, "grey"),
  );

  for (const o of oneshotOutcomes) {
    if (!o) continue;
    if (o.row.decision === "agent_merge") {
      agentMerge++;
      if (o.merge) uf.union(o.row.idA, o.row.idB);
    } else if (o.row.decision === "agent_reject") {
      agentReject++;
    } else if (o.row.decision === "agent_uncertain") {
      agentUncertain++;
    } else if (o.row.decision === "agent_skipped") {
      agentSkipped++;
    }
  }

  // Same-surface residual: oneshot only; uncertain stays separate
  let sameSurfacePass = 0;
  let sameSurfaceMerge = 0;
  let sameSurfaceReject = 0;

  if (config.agentEnabled && config.sameSurfaceAgentPass && llm) {
    const residual: PairScoreResult[] = [];
    for (const [a, b] of unorderedPairs(characters)) {
      if (uf.find(a.id) === uf.find(b.id)) continue;
      const shared = sharedIdentitySurfacesBetween(a, b, strip);
      if (!shared.length) continue;

      let row = scoredByKey.get(pairKey(a.id, b.id));
      if (!row) {
        const features = buildPairFeatures(a, b, config, graph);
        const base = scorePair(
          {
            a,
            b,
            features,
            windows,
            fullTextLength,
            config,
          },
          ALL_COREF_RULES,
        );
        row = { ...base, decision: "agent" };
        scored.push(row);
        scoredByKey.set(pairKey(a.id, b.id), row);
      }
      if (
        row.decision === "auto_merge" ||
        row.decision === "agent_merge"
      ) {
        continue;
      }
      residual.push(row);
    }

    if (residual.length) {
      console.warn(
        `[stage3] same-surface residual: ${residual.length} pair(s) → oneshot`,
      );
    }
    sameSurfacePass = residual.length;
    agentOneshot += residual.length;
    // Extend total so progress stays monotone across grey + residual
    pairsTotal = pairsCompleted + residual.length;

    const resOneshot = await mapPool(
      residual,
      agentConcurrency,
      (row, i) => judgeOneshot(row, i, "same_surface"),
    );
    for (const o of resOneshot) {
      if (!o) continue;
      if (o.row.decision === "agent_merge") {
        sameSurfaceMerge++;
        if (o.merge) uf.union(o.row.idA, o.row.idB);
      } else if (o.row.decision === "agent_reject") {
        sameSurfaceReject++;
      } else if (o.row.decision === "agent_uncertain") {
        agentUncertain++;
      }
    }
  }

  const merged = rebuildFromUnion(characters, uf);
  agentMerge = scored.filter((s) => s.decision === "agent_merge").length;
  agentReject = scored.filter((s) => s.decision === "agent_reject").length;
  agentSkipped = scored.filter((s) => s.decision === "agent_skipped").length;
  agentUncertain = scored.filter(
    (s) => s.decision === "agent_uncertain",
  ).length;

  const uncertainPairs: UncertainCorefPair[] = [];
  for (const s of scored) {
    if (s.decision !== "agent_uncertain") continue;
    const a = byId.get(s.idA);
    const b = byId.get(s.idB);
    // After UF merge, ids may still exist on pre-merge characters
    uncertainPairs.push({
      idA: s.idA,
      idB: s.idB,
      score: s.score,
      reason: s.agentReason || "uncertain",
      surfacesA: a ? surfacesForCoref(a, strip) : [],
      surfacesB: b ? surfacesForCoref(b, strip) : [],
    });
  }

  const stats = {
    autoMerge: scored.filter((s) => s.decision === "auto_merge").length,
    autoReject: scored.filter((s) => s.decision === "auto_reject").length,
    agent: agentQueue.length,
    agentMerge,
    agentReject,
    agentSkipped,
    agentOneshot,
    agentDeep: 0,
    agentUncertain,
    sameSurfacePass,
    sameSurfaceMerge,
    sameSurfaceReject,
  };

  if (uncertainPairs.length) {
    console.log(
      `[stage3] uncertain pairs=${uncertainPairs.length} (for outer character-list agent)`,
    );
  }

  return {
    config,
    inputCount: characters.length,
    characters: merged,
    pairCount: scored.length,
    scored,
    uncertainPairs,
    stats,
  };
}

