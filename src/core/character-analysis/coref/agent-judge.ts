/**
 * LLM agent: judge whether two characters are the same person.
 * Prompt includes structured features + local novel context around mentions.
 */

import type { LLMProvider, ToolSchema } from "@/types";
import type { MergedCharacter } from "../merge-adjacent";
import type { AnalysisWindow } from "../types";
import {
  isDeicticPronounSurface,
  surfacesForCoref,
} from "./features";
import type { PairFeatures } from "./types";

const TOOL: ToolSchema = {
  name: "coref_pair_judge",
  description: "Whether two character records refer to the same person",
  parameters: {
    type: "object",
    properties: {
      same: { type: "boolean", description: "true if same person" },
      reason: { type: "string", description: "brief reason" },
    },
    required: ["same"],
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
    const step = (mentions.length - 1) / (maxN - 1);
    const idx = new Set<number>();
    for (let i = 0; i < maxN; i++) {
      idx.add(Math.round(i * step));
    }
    picked = [...idx].sort((a, b) => a - b).map((i) => mentions[i]!);
  }

  for (const m of picked) {
    const g0 = m.offsetAnchor!.globalStart;
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

export async function agentJudgeSamePerson(
  llm: LLMProvider,
  a: MergedCharacter,
  b: MergedCharacter,
  features: PairFeatures,
  context?: AgentJudgeContextOptions,
): Promise<{ same: boolean; reason: string }> {
  const ctxOpts = context || {};
  const strip = ctxOpts.stripDeicticWhenHasName !== false;
  const ctxA = formatMentionContexts(a, { ...ctxOpts, stripDeicticWhenHasName: strip });
  const ctxB = formatMentionContexts(b, { ...ctxOpts, stripDeicticWhenHasName: strip });
  const hasCtx = ctxA.length > 0 || ctxB.length > 0;

  const prompt = [
    "你是小说角色指代消解裁判。判断下面两个【人物记录】是否为同一人。",
    "优先依据【原文摘录】中的叙事与指称；特征字段仅作辅助。不要编造正文。",
    "",
    "【硬性判定原则】",
    "1. **age（年龄/少年/青年/中年/老年/小孩等）绝不能作为「不是同一人」的理由。**",
    "   小说里人物会成长；不同窗口的 age 只是当时片段的粗标注，可从少年长到老年。",
    "   reason 里禁止写「年龄不同/年龄冲突/女孩vs少年」之类作为否定依据。",
    "2. **shared_weak_surfaces / surface 相似度：双方有相同或高度相似的 surface（含弱称谓、描述、头衔等）时，倾向于同一人。**",
    "   对照特征里的 sharedWeak / sharedSurfaces 与双方 surface 列表；也看摘录中的叫法是否像同一指称。",
    "   （共享 proper/nick 见 sharedStrong，是更强的同一人信号。）",
    "3. **是否「同时出现过」不能单靠 sameWindowCount（及字距等程序统计）。**",
    "   还须看【原文摘录】：摘录中 A、B 的称呼/专名同时出现，也算同时出现过。",
    "   同时出现本身不单独决定是否同一人，须结合原则2的 surface 相似度与上下文综合判断。",
    "4. neverSameWindow=true 只表示程序统计上两边 mention 未落在同一分析窗；跨窗别名合并仍常见，单独不能否定同一人。",
    "5. genderConflict=true（明确男 vs 女）是强否定信号。",
    "6. 阅读摘录中的【】标记处即该 mention 在原文中的位置；结合前后文判断是否同一指称对象。",
    "7. 有专名/称谓时，列表中已去掉「我/你/他」等泛指；勿因引语里的代词把两人判成同一人。",
    "8. 仅当双方 surfaces 只剩代词时，才靠「我/他」+ 原文判断是否同一叙述者。",
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
    "【规则特征】",
    `sharedSurfaces=${features.sharedSurfaces.join("、") || "（无）"}`,
    `sharedStrong(proper|nick)=${features.sharedStrongSurfaces.join("、") || "（无）"}`,
    `sharedProper=${features.sharedProperSurfaces.join("、") || "（无）"}`,
    `sharedWeakSurfaces=` +
      [
        features.sharedDeicticSurfaces.length
          ? `deictic「${features.sharedDeicticSurfaces.join("、")}」`
          : "",
        features.sharedGenericSurfaces.length
          ? `generic「${features.sharedGenericSurfaces.join("、")}」`
          : "",
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
    `sharedNeighbors=${features.sharedNeighborCount}`,
    "",
    "输出 JSON：{ \"same\": true/false, \"reason\": \"一句话（须能对应摘录或特征；不得以 age 为否定理由）\" }",
  ].join("\n");

  const raw = await llm.chatWithTool<{ same?: boolean; reason?: string }>(
    [{ role: "user", content: prompt }],
    TOOL,
    { temperature: 0.1, maxTokens: 30_000 },
  );
  return {
    same: Boolean(raw?.same),
    reason: (raw?.reason || "").trim() || (raw?.same ? "agent:same" : "agent:diff"),
  };
}
