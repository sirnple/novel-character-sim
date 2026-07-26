/**
 * Coref LLM judges (pipeline Stage③ oneshot only for grey pairs):
 * - oneshot: single chatWithTool → same | diff | uncertain
 * - tool-loop helper: multi-hop co-occur (used by tests / optional tooling;
 *   production residual uncertainty is resolved by the outer character-list
 *   agent via analysis tools after the pipeline ends — not a pipeline stage)
 */

import type { LLMProvider, ToolSchema } from "@/types";
import type { MergedCharacter } from "../merge-adjacent";
import type { AnalysisWindow } from "../types";
import { agentJudgeSamePersonToolLoop } from "./agent-judge-loop";
import {
  pickRelatedNeighbors,
  type CooccurGraph,
} from "./cooccur-graph";
import {
  isDeicticPronounSurface,
  surfacesForCoref,
} from "./features";
import type { PairFeatures } from "./types";

/** Stage③ oneshot ternary verdict. */
export type CorefOneshotVerdict = "same" | "diff" | "uncertain";

export interface AgentJudgeResult {
  /** Final boolean only when decided (not for uncertain oneshot). */
  same?: boolean;
  verdict: CorefOneshotVerdict;
  reason: string;
}

const TOOL_ONESHOT: ToolSchema = {
  name: "coref_pair_judge",
  description:
    "Judge if two records are the same person. Only use verdict; never output a same boolean.",
  parameters: {
    type: "object",
    properties: {
      verdict: {
        type: "string",
        enum: ["same", "diff", "uncertain"],
        description:
          "same=同一人；diff=不是同一人；uncertain=吃不准，交给后续角色列表 agent",
      },
      reason: { type: "string", description: "brief reason" },
    },
    required: ["verdict", "reason"],
  },
};

/** Options for grounding the judge in novel text. */
export interface AgentJudgeContextOptions {
  /** Full novel text if available (preferred for global offsets). */
  fullText?: string;
  /** Analysis windows with local `text` (used when fullText missing or as fallback). */
  windows?: AnalysisWindow[];
  /** Chars of context on each side of a mention (default 200). */
  contextRadius?: number;
  /** Max mention snippets per character (default 4). */
  maxMentionsPerChar?: number;
  /**
   * When true (default), if entity has non-deictic surfaces, prefer those
   * mentions for context snippets and surface list (drop 我/你/他 noise).
   */
  stripDeicticWhenHasName?: boolean;
  /**
   * Stage-② roster for related-character cards (co-occur neighbors of A/B).
   * Required together with `cooccurGraph` when `includeRelatedCards` is true.
   */
  rosterById?: Map<string, MergedCharacter>;
  /** Window co-occur graph; used to pick shared / exclusive neighbors. */
  cooccurGraph?: CooccurGraph;
  /**
   * Inject 【相关人物】 cards = shared co-occur neighbors N(A)∩N(B) (default false).
   * Oneshot may use this; deep prefers tool-loop list_neighbors instead.
   */
  includeRelatedCards?: boolean;
  /** Max related cards (default 8). */
  maxRelatedCards?: number;
  /** Mention snippets per related card (default 1). */
  maxRelatedMentions?: number;
  /** Context radius for related-card snippets (default 120). */
  relatedContextRadius?: number;
  /**
   * Multi-turn tool-loop (default false = Stage③ oneshot).
   * Not a pipeline stage; requires rosterById + cooccurGraph.
   */
  toolLoop?: boolean;
  /** Max tool-loop rounds (default 8). */
  toolLoopMaxSteps?: number;
}

/** Parse oneshot tool result. Only `verdict` is used (ignore any leftover `same`). */
function parseOneshotVerdict(raw: {
  verdict?: string;
  reason?: string;
  /** @deprecated ignored — schema no longer has same */
  same?: boolean;
}): AgentJudgeResult {
  const reason = (raw?.reason || "").trim();
  const v = (raw?.verdict || "").toLowerCase().trim();
  if (v === "same" || v === "yes" || v === "true") {
    return { verdict: "same", same: true, reason: reason || "oneshot:same" };
  }
  if (v === "diff" || v === "different" || v === "no" || v === "false") {
    return { verdict: "diff", same: false, reason: reason || "oneshot:diff" };
  }
  if (v === "uncertain" || v === "unknown" || v === "unsure" || v === "maybe") {
    return { verdict: "uncertain", reason: reason || "oneshot:uncertain" };
  }
  // Missing / empty verdict → escalate (do not fall back to boolean `same`)
  return {
    verdict: "uncertain",
    reason: reason || "oneshot:missing_verdict→uncertain",
  };
}

export function sliceContextFromFullText(
  fullText: string,
  globalStart: number,
  globalEnd: number,
  radius: number,
): { snippet: string; markStart: number; markEnd: number } | null {
  if (
    !fullText ||
    globalStart < 0 ||
    globalStart >= fullText.length ||
    globalEnd <= globalStart
  ) {
    return null;
  }
  const from = Math.max(0, globalStart - radius);
  const to = Math.min(fullText.length, globalEnd + radius);
  const snippet = fullText.slice(from, to);
  return {
    snippet,
    markStart: globalStart - from,
    markEnd: globalEnd - from,
  };
}

/**
 * Resolve a global span to a window-local snippet with mark offsets into the snippet.
 */
export function sliceContextFromWindows(
  windows: AnalysisWindow[],
  globalStart: number,
  globalEnd: number,
  radius: number,
): { snippet: string; markStart: number; markEnd: number; windowIndex: number } | null {
  for (const w of windows) {
    if (!w.text) continue;
    if (globalStart < w.start || globalStart >= w.end) continue;
    const localStart = globalStart - w.start;
    const localEnd = Math.min(
      w.text.length,
      Math.max(localStart + 1, globalEnd - w.start),
    );
    const from = Math.max(0, localStart - radius);
    const to = Math.min(w.text.length, localEnd + radius);
    return {
      snippet: w.text.slice(from, to),
      markStart: localStart - from,
      markEnd: localEnd - from,
      windowIndex: w.index,
    };
  }
  return null;
}

function markSnippet(
  snippet: string,
  markStart: number,
  markEnd: number,
): string {
  const a = Math.max(0, Math.min(snippet.length, markStart));
  const b = Math.max(a, Math.min(snippet.length, markEnd));
  return (
    snippet.slice(0, a) +
    "【" +
    snippet.slice(a, b) +
    "】" +
    snippet.slice(b)
  );
}

function compactWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Build up to `maxN` context lines for a character's mentions. */
export function formatMentionContexts(
  c: MergedCharacter,
  opts: AgentJudgeContextOptions,
): string[] {
  const radius = opts.contextRadius ?? 200;
  const maxN = opts.maxMentionsPerChar ?? 4;
  const strip = opts.stripDeicticWhenHasName !== false;
  const corefSurfaces = new Set(surfacesForCoref(c, strip));
  const lines: string[] = [];
  let mentions = [...(c.mentions || [])]
    .filter((m) => m.offsetAnchor && typeof m.offsetAnchor.globalStart === "number")
    .sort(
      (x, y) =>
        (x.offsetAnchor!.globalStart ?? 0) - (y.offsetAnchor!.globalStart ?? 0),
    );
  // Prefer non-deictic mentions when entity has real names
  if (strip && corefSurfaces.size > 0) {
    const filtered = mentions.filter((m) =>
      corefSurfaces.has((m.surface || "").trim()),
    );
    if (filtered.length) mentions = filtered;
  }

  // Prefer diverse offsets: take evenly if many
  let picked = mentions;
  if (mentions.length > maxN) {
    if (maxN <= 1) {
      picked = mentions.slice(0, 1);
    } else {
      const step = (mentions.length - 1) / (maxN - 1);
      const idx = new Set<number>();
      for (let i = 0; i < maxN; i++) {
        idx.add(Math.round(i * step));
      }
      picked = [...idx]
        .sort((a, b) => a - b)
        .map((i) => mentions[i])
        .filter(Boolean) as typeof mentions;
    }
  }

  for (const m of picked) {
    if (!m?.offsetAnchor) continue;
    const g0 = m.offsetAnchor.globalStart;
    const g1 = m.offsetAnchor!.globalEnd ?? g0 + (m.surface?.length || 1);
    let marked = "";
    let where = "";

    if (opts.fullText) {
      const hit = sliceContextFromFullText(opts.fullText, g0, g1, radius);
      if (hit) {
        marked = markSnippet(hit.snippet, hit.markStart, hit.markEnd);
        where = `global@${g0}-${g1}`;
      }
    }
    if (!marked && opts.windows?.length) {
      const hit = sliceContextFromWindows(opts.windows, g0, g1, radius);
      if (hit) {
        marked = markSnippet(hit.snippet, hit.markStart, hit.markEnd);
        where = `win${hit.windowIndex}@${g0}-${g1}`;
      }
    }
    if (!marked) {
      // Fallback: textAnchor only
      const ta = (m.textAnchor || m.surface || "").trim();
      if (ta) {
        lines.push(`- surface=${m.surface} ${where || `@${g0}`} anchor=「${ta}」`);
      }
      continue;
    }
    lines.push(
      `- surface=${m.surface} ${where}\n  …${compactWhitespace(marked)}…`,
    );
  }

  // Mentions without offsets: still show textAnchor
  if (!lines.length) {
    for (const m of (c.mentions || []).slice(0, maxN)) {
      const ta = (m.textAnchor || m.surface || "").trim();
      if (ta) lines.push(`- surface=${m.surface} anchor=「${ta}」（无offset，仅anchor）`);
    }
  }
  return lines;
}

function fmtChar(c: MergedCharacter, stripDeicticWhenHasName: boolean): string {
  const surfaces = surfacesForCoref(c, stripDeicticWhenHasName);
  const rawAll = Array.from(
    new Set(c.mentions.map((m) => m.surface).filter(Boolean)),
  );
  const stripped =
    stripDeicticWhenHasName &&
    rawAll.some((s) => !isDeicticPronounSurface(s)) &&
    rawAll.some((s) => isDeicticPronounSurface(s));
  return [
    `id=${c.id}`,
    `surfaces={${surfaces.join("、")}}` +
      (stripped ? "（已去掉泛指代词我/你/他等）" : ""),
    `gender=${c.gender ?? "?"} age=${c.age ?? "?"}（age仅供参考，禁止用作否定同一人）`,
    `windows=[${c.windowLo}..${c.windowHi}]`,
  ].join("\n");
}

/**
 * Compact cards for **shared** co-occur neighbors of A/B (N(A)∩N(B)).
 * Not judgment targets — scene context only.
 */
export function formatRelatedCharacterCards(
  idA: string,
  idB: string,
  opts: AgentJudgeContextOptions,
): string[] {
  const graph = opts.cooccurGraph;
  const roster = opts.rosterById;
  if (!graph || !roster?.size) return [];

  const strip = opts.stripDeicticWhenHasName !== false;
  const maxTotal = opts.maxRelatedCards ?? 8;
  const picks = pickRelatedNeighbors(idA, idB, graph, { maxTotal });
  if (!picks.length) return [];

  const snippetOpts: AgentJudgeContextOptions = {
    fullText: opts.fullText,
    windows: opts.windows,
    contextRadius: opts.relatedContextRadius ?? 120,
    maxMentionsPerChar: opts.maxRelatedMentions ?? 1,
    stripDeicticWhenHasName: strip,
  };

  const lines: string[] = [
    "【相关人物】（与 A、B **都**共现过的角色，**不是**本次判决对象；用于对照场景，勿把第三人并进 A/B）",
  ];

  for (const p of picks) {
    const c = roster.get(p.id);
    if (!c) {
      lines.push(
        `- ${p.id} (共享共现 coA=${p.coA} coB=${p.coB}) （roster 缺失）`,
      );
      continue;
    }
    const surfaces = surfacesForCoref(c, strip).slice(0, 8);
    lines.push(
      `- ${c.id} [共享共现 coA=${p.coA} coB=${p.coB}] ` +
        `{${surfaces.join("、") || "?"}} ` +
        `win=[${c.windowLo}..${c.windowHi}] ` +
        `g=${c.gender ?? "?"} age=${c.age ?? "?"}`,
    );
    const snips = formatMentionContexts(c, snippetOpts);
    for (const s of snips) {
      lines.push(`  ${s.replace(/\n/g, "\n  ")}`);
    }
  }
  return lines;
}

function buildJudgePrompt(
  a: MergedCharacter,
  b: MergedCharacter,
  features: PairFeatures,
  ctxOpts: AgentJudgeContextOptions,
  mode: "oneshot" | "agent",
): string {
  const strip = ctxOpts.stripDeicticWhenHasName !== false;
  const ctxA = formatMentionContexts(a, {
    ...ctxOpts,
    stripDeicticWhenHasName: strip,
  });
  const ctxB = formatMentionContexts(b, {
    ...ctxOpts,
    stripDeicticWhenHasName: strip,
  });
  const hasCtx = ctxA.length > 0 || ctxB.length > 0;
  const related =
    mode === "oneshot" && ctxOpts.includeRelatedCards === true
      ? formatRelatedCharacterCards(a.id, b.id, {
          ...ctxOpts,
          stripDeicticWhenHasName: strip,
        })
      : [];

  const oneshotOut =
    mode === "oneshot"
      ? [
          "【本轮任务 = Stage③ oneshot】",
          "在**有把握**时选 same 或 diff；吃不准（证据冲突、仅表层相似、关系链不明）必须选 **uncertain**，",
          "不要硬猜。uncertain 会留给流水线外的角色列表 agent，用共现查询工具再判。",
          "",
          '输出 JSON：{ "verdict": "same"|"diff"|"uncertain", "reason": "一句话" }',
          "只填 verdict 与 reason，**不要**输出 same 布尔字段。",
          "（勿用 age 作否定理由；仅表层相似且无决定性证据 → 倾向 diff 或 uncertain）",
        ]
      : [
          "【本轮任务 = 工具辅助消歧】",
          "oneshot 已标 uncertain。请用工具查看**多级共现网络**与原文，再 submit_verdict。",
          "优先人物关系结构；表层装扮/物品/行为除非有决定性证据，否则倾向不同人。",
        ];

  return [
    "你是小说角色指代消解裁判。判断下面两个【人物记录】是否为同一人。",
    "优先依据【原文摘录】中的叙事与指称；特征字段仅作辅助。不要编造正文。",
    "",
    "【硬性判定原则】",
    "1. **判定优先级：先人物关系（结构），后装扮/物品/行为/外貌（表层）。**",
    "   - **优先**用结构关系：专名/稳定称谓、亲属与称谓网络、对固定他人的角色、互斥/同场两人等。",
    "   - **仅当**结构仍无法判断，才可参考装扮、物品、行为、外貌。",
    "   - 表层默认**弱证据**：无决定性证据（稀有胎记/唯一所有物/文中明说「就是之前那个」）→ 倾向非同一人。",
    "   - **禁止**「都贴贴纸/都像小鬼/都和主角共现」单独判同一人。",
    "2. **age 绝不能作为「不是同一人」的理由。**",
    "3. **surface**：sharedStrong > sharedMid > sharedWeak；专名/称谓优先于纯描述。",
    "4. 同场同时出现通常是**不同人**；neverSameWindow 单独不能否定跨窗别名。",
    "5. genderConflict=true 是强否定。",
    "6. 有专名时勿因引语代词合并；相关/共现人物不是判决对象。",
    "",
    "【人物 A】",
    fmtChar(a, strip),
    hasCtx ? "【原文摘录 A】（【】内为 mention）" : "【原文摘录 A】（无可用offset/正文）",
    ...(ctxA.length ? ctxA : ["（无）"]),
    "",
    "【人物 B】",
    fmtChar(b, strip),
    hasCtx ? "【原文摘录 B】（【】内为 mention）" : "【原文摘录 B】（无可用offset/正文）",
    ...(ctxB.length ? ctxB : ["（无）"]),
    "",
    ...(related.length ? [...related, ""] : []),
    "【规则特征】",
    `sharedSurfaces=${features.sharedSurfaces.join("、") || "（无）"}`,
    `sharedStrong(proper|nick)=${features.sharedStrongSurfaces.join("、") || "（无）"}`,
    `sharedProper=${features.sharedProperSurfaces.join("、") || "（无）"}`,
    `sharedMidSurfaces=` +
      [
        features.sharedKinshipSurfaces.length
          ? `kinship「${features.sharedKinshipSurfaces.join("、")}」`
          : "",
        features.sharedTitleSurfaces.length
          ? `title「${features.sharedTitleSurfaces.join("、")}」`
          : "",
        features.sharedDescSurfaces.length
          ? `desc「${features.sharedDescSurfaces.join("、")}」`
          : "",
      ]
        .filter(Boolean)
        .join(" ") || "（无）",
    `sharedWeakSurfaces=` +
      [
        features.sharedDeicticSurfaces.length
          ? `deictic「${features.sharedDeicticSurfaces.join("、")}」`
          : "",
        features.sharedGenericSurfaces.length
          ? `generic「${features.sharedGenericSurfaces.join("、")}」`
          : "",
      ]
        .filter(Boolean)
        .join(" ") || "（无）",
    `exclusiveStrongA=${features.exclusiveStrongA.join("、") || "（无）"}`,
    `exclusiveStrongB=${features.exclusiveStrongB.join("、") || "（无）"}`,
    `exclusiveProperA=${features.exclusiveProperA.join("、") || "（无）"}`,
    `exclusiveProperB=${features.exclusiveProperB.join("、") || "（无）"}`,
    `genderConflict=${features.genderConflict}`,
    `windowGap=${features.windowGap}` +
      (() => {
        const n = ctxOpts.windows?.length ?? 0;
        if (n < 2) return "";
        return ` r=${(features.windowGap / Math.max(1, n - 1)).toFixed(3)} nWin=${n}`;
      })(),
    `minMentionDistance=${features.minMentionDistance ?? "n/a"}`,
    `closeMentionPairCount=${features.closeMentionPairCount}`,
    `cooccurExclusivity=${features.cooccurExclusivity.toFixed(3)}` +
      (features.cooccurSparse
        ? ` (raw=${features.cooccurExclusivityRaw.toFixed(3)}, sparse×discount)`
        : ""),
    `cooccurJaccard=${features.cooccurJaccard.toFixed(3)}` +
      (features.cooccurSparse
        ? ` (raw=${features.cooccurJaccardRaw.toFixed(3)}, sparse)`
        : ""),
    `neverSameWindow=${features.neverSameWindow}`,
    `sameWindowCount=${features.sameWindowCount}`,
    `sharedNeighbors=${features.sharedNeighborCount}` +
      (features.topExclusiveCompanion
        ? ` topExclusiveCompanion=${features.topExclusiveCompanion}`
        : ""),
    "",
    ...oneshotOut,
  ].join("\n");
}

/**
 * Stage③ oneshot: ternary verdict (same | diff | uncertain).
 */
export async function agentJudgeSamePersonOneshot(
  llm: LLMProvider,
  a: MergedCharacter,
  b: MergedCharacter,
  features: PairFeatures,
  context?: AgentJudgeContextOptions,
): Promise<AgentJudgeResult> {
  const ctxOpts = context || {};
  const prompt = buildJudgePrompt(a, b, features, ctxOpts, "oneshot");
  const raw = await llm.chatWithTool<{
    verdict?: string;
    reason?: string;
  }>([{ role: "user", content: prompt }], TOOL_ONESHOT, {
    temperature: 0.1,
    maxTokens: 30_000,
  });
  return parseOneshotVerdict(raw || {});
}

/**
 * Optional tool-loop judge (multi-level co-occur). Not pipeline Stage④.
 * Production residual pairs use outer analysis agent tools instead.
 */
export async function agentJudgeSamePersonAgent(
  llm: LLMProvider,
  a: MergedCharacter,
  b: MergedCharacter,
  features: PairFeatures,
  context?: AgentJudgeContextOptions,
): Promise<AgentJudgeResult> {
  const ctxOpts = context || {};
  const strip = ctxOpts.stripDeicticWhenHasName !== false;
  if (!ctxOpts.rosterById?.size || !ctxOpts.cooccurGraph) {
    return {
      verdict: "diff",
      same: false,
      reason: "tool-loop agent: missing roster/graph (default reject)",
    };
  }
  const prompt = buildJudgePrompt(a, b, features, ctxOpts, "agent");
  const loopResult = await agentJudgeSamePersonToolLoop(llm, prompt, {
    idA: a.id,
    idB: b.id,
    charA: a,
    charB: b,
    rosterById: ctxOpts.rosterById,
    cooccurGraph: ctxOpts.cooccurGraph,
    fullText: ctxOpts.fullText,
    windows: ctxOpts.windows,
    stripDeicticWhenHasName: strip,
    maxSteps: ctxOpts.toolLoopMaxSteps ?? 8,
    formatExcerpts: (c, maxMentions) =>
      formatMentionContexts(c, {
        fullText: ctxOpts.fullText,
        windows: ctxOpts.windows,
        contextRadius: ctxOpts.contextRadius ?? 320,
        maxMentionsPerChar: maxMentions,
        stripDeicticWhenHasName: strip,
      }),
  });
  return {
    verdict: loopResult.same ? "same" : "diff",
    same: loopResult.same,
    reason: loopResult.reason,
  };
}

/**
 * @deprecated Prefer agentJudgeSamePersonOneshot (Stage③).
 * toolLoop=true → optional multi-hop helper; else oneshot (uncertain has same=undefined).
 */
export async function agentJudgeSamePerson(
  llm: LLMProvider,
  a: MergedCharacter,
  b: MergedCharacter,
  features: PairFeatures,
  context?: AgentJudgeContextOptions,
): Promise<{ same: boolean; reason: string; verdict?: CorefOneshotVerdict }> {
  if (context?.toolLoop) {
    const r = await agentJudgeSamePersonAgent(llm, a, b, features, context);
    return {
      same: Boolean(r.same),
      reason: r.reason,
      verdict: r.verdict,
    };
  }
  const r = await agentJudgeSamePersonOneshot(llm, a, b, features, context);
  return {
    same: r.verdict === "same",
    reason: r.reason,
    verdict: r.verdict,
  };
}
