/**
 * Stage ③: score all pairs with rules → auto merge/reject → agent grey zone
 * → same-surface residual agent pass (兜底).
 */

import type { LLMProvider } from "@/types";
import type { MergedCharacter } from "../merge-adjacent";
import { mergeTwoMergedCharacters } from "../merge-adjacent";
import type { AnalysisWindow } from "../types";
import { agentJudgeSamePerson } from "./agent-judge";
import { buildCooccurGraph } from "./cooccur-graph";
import {
  buildPairFeatures,
  identityStrongSurfacesForCoref,
  isStrongSurfaceOn,
} from "./features";
import { ALL_COREF_RULES } from "./rules";
import { decideByThresholds, scorePair } from "./score";
import type {
  PairContext,
  PairScoreResult,
  Stage3CorefConfig,
  Stage3ResolveResult,
} from "./types";
import { selectGreyLlmMode } from "./grey-llm-mode";
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
  const setB = new Set(
    identityStrongSurfacesForCoref(b, stripDeicticWhenHasName),
  );
  return identityStrongSurfacesForCoref(a, stripDeicticWhenHasName).filter(
    (s) => setB.has(s) && isStrongSurfaceOn(a, s) && isStrongSurfaceOn(b, s),
  );
}

function rebuildFromUnion(
  characters: MergedCharacter[],
  uf: UnionFind,
): MergedCharacter[] {
  const groups = new Map<string, MergedCharacter[]>();
  for (const c of characters) {
    const root = uf.find(c.id);
    const arr = groups.get(root) || [];
    arr.push(c);
    groups.set(root, arr);
  }
  const out: MergedCharacter[] = [];
  let n = 0;
  for (const [, members] of groups) {
    let acc = members[0]!;
    for (let i = 1; i < members.length; i++) {
      acc = mergeTwoMergedCharacters(acc, members[i]!, acc.id);
    }
    out.push({
      ...acc,
      id: `g${n++}`,
    });
  }
  return out;
}

export interface Stage3Options {
  config?: Partial<Stage3CorefConfig>;
  llm?: LLMProvider | null;
  /** Override agent concurrency (else config.agentConcurrency). */
  agentConcurrency?: number;
  /**
   * Full novel text for agent context snippets (preferred).
   * If omitted, window.text is used via offset→window mapping.
   */
  fullText?: string;
  /** Chars of novel context each side of a mention for agent (default 200). */
  agentContextRadius?: number;
  /** Optional progress hook for agent pairs */
  onAgentPair?: (info: {
    index: number;
    total: number;
    idA: string;
    idB: string;
    score: number;
    phase?: "grey" | "same_surface";
    llmMode?: "oneshot" | "deep";
  }) => void;
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

/**
 * Run stage ③ coref on stage-② characters.
 * Grey-zone agent judgments run with bounded parallelism (agentConcurrency).
 * No hard cap on agent pair count — only a soft warning via agentMaxPairs.
 * After grey pass: residual pairs that still share a surface are forced to agent.
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
      const route = selectGreyLlmMode(base.score, config, features);
      row.llmMode = route.mode;
      row.llmModeReason = route.reason;
    }
    scored.push(row);
    scoredByKey.set(pairKey(a.id, b.id), row);

    if (decision === "auto_merge") {
      uf.union(a.id, b.id);
    } else if (decision === "agent") {
      agentQueue.push(row);
    }
  }

  // Agent grey zone — no hard cap; agentMaxPairs is warn-only
  let agentMerge = 0;
  let agentReject = 0;
  let agentSkipped = 0;
  let agentOneshot = 0;
  let agentDeep = 0;
  const warnAt = config.agentMaxPairs;
  if (
    config.agentEnabled &&
    warnAt > 0 &&
    agentQueue.length > warnAt
  ) {
    console.warn(
      `[stage3] grey-zone agent pairs=${agentQueue.length} exceeds advisory ` +
        `agentMaxPairs=${warnAt} (no cap — all pairs will be judged)`,
    );
  }

  const toJudge = config.agentEnabled ? agentQueue : [];
  if (!config.agentEnabled) {
    for (const row of agentQueue) {
      row.decision = "agent_skipped";
      agentSkipped++;
    }
  } else {
    for (const row of toJudge) {
      if (row.llmMode === "deep") agentDeep++;
      else agentOneshot++;
    }
    if (toJudge.length) {
      console.log(
        `[stage3] grey LLM route oneshot=${agentOneshot} deep=${agentDeep} ` +
          `(σ_r=${config.greySigmaReject} σ_m=${config.greySigmaMerge} τ=${config.greyEdgeTau})`,
      );
    }
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

  type AgentOutcome = {
    row: PairScoreResult;
    merge: boolean;
  };

  async function judgeOne(
    row: PairScoreResult,
    index: number,
    total: number,
    phase: "grey" | "same_surface",
  ): Promise<AgentOutcome> {
    const a = byId.get(row.idA);
    const b = byId.get(row.idB);
    const mode = row.llmMode ?? "oneshot";
    options.onAgentPair?.({
      index,
      total,
      idA: row.idA,
      idB: row.idB,
      score: row.score,
      phase,
      llmMode: mode,
    });
    if (!llm || !a || !b) {
      row.decision = "agent_skipped";
      row.agentReason = !llm ? "no llm" : "missing character";
      return { row, merge: false };
    }
    try {
      const features = buildPairFeatures(a, b, config, graph);
      // deep: richer context for now; multi-turn tools land next
      const deep = mode === "deep" || phase === "same_surface";
      const ans = await agentJudgeSamePerson(llm, a, b, features, {
        fullText: options.fullText,
        windows,
        contextRadius: deep
          ? Math.max(options.agentContextRadius ?? 200, 320)
          : options.agentContextRadius ?? 200,
        maxMentionsPerChar: deep ? 6 : 4,
        stripDeicticWhenHasName: config.stripDeicticWhenHasName !== false,
      });
      row.agentAnswer = ans.same;
      const tags: string[] = [];
      if (phase === "same_surface") tags.push("same_surface");
      tags.push(deep ? "deep" : "oneshot");
      if (row.llmModeReason) tags.push(row.llmModeReason);
      const tag = tags.length ? `[${tags.join("|")}] ` : "";
      row.agentReason = tag + (ans.reason || "");
      if (ans.same) {
        row.decision = "agent_merge";
        return { row, merge: true };
      }
      row.decision = "agent_reject";
      return { row, merge: false };
    } catch (e) {
      row.decision = "agent_skipped";
      row.agentReason =
        (phase === "same_surface" ? "[same_surface] " : "") +
        (e instanceof Error ? e.message : String(e));
      return { row, merge: false };
    }
  }

  const outcomes = await mapPool(toJudge, agentConcurrency, (row, i) =>
    judgeOne(row, i, toJudge.length, "grey"),
  );

  for (const o of outcomes) {
    if (!o) continue;
    if (o.row.decision === "agent_merge") {
      agentMerge++;
      if (o.merge) uf.union(o.row.idA, o.row.idB);
    } else if (o.row.decision === "agent_reject") {
      agentReject++;
    } else if (o.row.decision === "agent_skipped") {
      agentSkipped++;
    }
  }

  // ── Same-surface residual pass (兜底) ─────────────────────────────
  // After grey agent, UF-disjoint pairs that still share ≥1 **identity-strong**
  // surface (proper|personal_nick) are forced to agent — not deictic/generic.
  let sameSurfacePass = 0;
  let sameSurfaceMerge = 0;
  let sameSurfaceReject = 0;

  if (config.agentEnabled && config.sameSurfaceAgentPass && llm) {
    const residual: PairScoreResult[] = [];
    for (const [a, b] of unorderedPairs(characters)) {
      if (uf.find(a.id) === uf.find(b.id)) continue;
      const shared = sharedIdentitySurfacesBetween(
        a,
        b,
        config.stripDeicticWhenHasName !== false,
      );
      if (!shared.length) continue;

      let row = scoredByKey.get(pairKey(a.id, b.id));
      if (!row) {
        // Should not happen — every pair was scored; create a stub
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
      // Skip only if already merged in this run (should not reach here)
      if (row.decision === "auto_merge" || row.decision === "agent_merge") {
        continue;
      }
      residual.push(row);
    }

    if (residual.length) {
      console.warn(
        `[stage3] same-surface residual pass: ${residual.length} pair(s) ` +
          `still share surface(s) and are not merged — forcing agent`,
      );
    }
    sameSurfacePass = residual.length;

    for (const row of residual) {
      row.llmMode = "deep";
      row.llmModeReason = row.llmModeReason || "same_surface residual → deep";
    }

    const resOutcomes = await mapPool(
      residual,
      agentConcurrency,
      (row, i) => judgeOne(row, i, residual.length, "same_surface"),
    );

    for (const o of resOutcomes) {
      if (!o) continue;
      if (o.row.decision === "agent_merge") {
        sameSurfaceMerge++;
        if (o.merge) uf.union(o.row.idA, o.row.idB);
      } else if (o.row.decision === "agent_reject") {
        sameSurfaceReject++;
      }
    }
  }

  const merged = rebuildFromUnion(characters, uf);
  // Recount agent outcomes from final decisions (residual may flip grey rejects)
  agentMerge = scored.filter((s) => s.decision === "agent_merge").length;
  agentReject = scored.filter((s) => s.decision === "agent_reject").length;
  agentSkipped = scored.filter((s) => s.decision === "agent_skipped").length;
  const stats = {
    autoMerge: scored.filter((s) => s.decision === "auto_merge").length,
    autoReject: scored.filter((s) => s.decision === "auto_reject").length,
    agent: agentQueue.length,
    agentMerge,
    agentReject,
    agentSkipped,
    agentOneshot,
    agentDeep,
    sameSurfacePass,
    sameSurfaceMerge,
    sameSurfaceReject,
  };

  return {
    config,
    inputCount: characters.length,
    characters: merged,
    pairCount: scored.length,
    scored,
    stats,
  };
}
