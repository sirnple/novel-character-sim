/**
 * Deep coref judge: multi-turn tool loop (chatWithTools).
 * Agent pulls neighbors / excerpts / raw text; ends with submit_verdict.
 */

import { extractJSON } from "@/lib/utils";
import type {
  AssistantMessage,
  LLMMessage,
  LLMProvider,
  ToolMessage,
  ToolSchema,
} from "@/types";
import type { MergedCharacter } from "../merge-adjacent";
import type { AnalysisWindow } from "../types";
import type { CooccurGraph } from "./cooccur-graph";
import { surfacesForCoref } from "./features";

const SUBMIT_TOOL = "submit_verdict";

export const COREF_JUDGE_TOOLS: ToolSchema[] = [
  {
    name: "list_neighbors",
    description:
      "查看共现网络（窗级，可多级）。" +
      "用 side=A|B|shared 查判决对象；或用 id=任一角色 id 展开该节点邻居（二跳/多跳：先 list A，再 list id=邻居）。" +
      "单边/他节点邻居只助关系结构，禁止「邻居像→A/B 同一人」。",
    parameters: {
      type: "object",
      properties: {
        side: {
          type: "string",
          enum: ["A", "B", "shared"],
          description: "A/B 单边或 shared；与 id 二选一",
        },
        id: {
          type: "string",
          description: "任意角色 id（或 A/B）— 展开该节点一跳邻居，用于多级网络",
        },
        hops: {
          type: "number",
          description: "展开层数 1 或 2（默认 1）。2=含邻居的邻居（摘要）",
        },
        limit: {
          type: "number",
          description: "每层最多条数，默认 8",
        },
      },
      required: [],
    },
  },
  {
    name: "get_character",
    description:
      "查看花名册中任一角色摘要（id、surfaces、windows、gender/age）。id 可为 A/B 或 list_neighbors 返回的 id。",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "角色 id，或字面量 A / B（判决对象）",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "get_excerpts",
    description: "拉取某角色在正文中的 mention 摘录（【】标出 surface）。",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "角色 id 或 A/B" },
        maxMentions: {
          type: "number",
          description: "最多几条摘录，默认 4",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "lookup_text",
    description: "按全局字符 offset 读原文片段（确认关系/是否同场）。",
    parameters: {
      type: "object",
      properties: {
        globalStart: {
          type: "number",
          description: "全局起点 offset",
        },
        radius: {
          type: "number",
          description: "左右各取多少字，默认 200",
        },
      },
      required: ["globalStart"],
    },
  },
  {
    name: SUBMIT_TOOL,
    description:
      "提交最终判决。确认后结束。优先依据人物关系结构；表层装扮/物品/行为除非有决定性证据，否则倾向 same=false。",
    parameters: {
      type: "object",
      properties: {
        same: {
          type: "boolean",
          description: "true=同一人，false=不是同一人",
        },
        reason: {
          type: "string",
          description: "一句话理由（须点明结构关系或决定性证据）",
        },
      },
      required: ["same", "reason"],
    },
  },
];

export interface CorefJudgeLoopContext {
  idA: string;
  idB: string;
  charA: MergedCharacter;
  charB: MergedCharacter;
  rosterById: Map<string, MergedCharacter>;
  cooccurGraph: CooccurGraph;
  fullText?: string;
  windows?: AnalysisWindow[];
  stripDeicticWhenHasName?: boolean;
  maxSteps?: number;
  /** Build mention excerpt lines (provided by agent-judge to avoid circular imports). */
  formatExcerpts: (c: MergedCharacter, maxMentions: number) => string[];
}

function resolveId(
  raw: string,
  ctx: CorefJudgeLoopContext,
): string | null {
  const t = (raw || "").trim();
  if (!t) return null;
  if (t === "A" || t === "a" || t === ctx.idA) return ctx.idA;
  if (t === "B" || t === "b" || t === ctx.idB) return ctx.idB;
  if (ctx.rosterById.has(t)) return t;
  return null;
}

function cardLine(
  c: MergedCharacter,
  strip: boolean,
  extra?: string,
): string {
  const ss = surfacesForCoref(c, strip).slice(0, 12);
  return (
    `id=${c.id} surfaces={${ss.join("、") || "?"}} ` +
    `win=[${c.windowLo}..${c.windowHi}] g=${c.gender ?? "?"} age=${c.age ?? "?"}` +
    (extra ? ` ${extra}` : "")
  );
}

function listSideNeighbors(
  id: string,
  graph: CooccurGraph,
  excludeId: string,
  limit: number,
): Array<{ id: string; co: number }> {
  const st = graph.byId.get(id);
  if (!st) return [];
  const rows: Array<{ id: string; co: number }> = [];
  st.coWith.forEach((co, nid) => {
    if (nid === excludeId) return;
    rows.push({ id: nid, co });
  });
  rows.sort((a, b) => b.co - a.co);
  return rows.slice(0, limit);
}

function listShared(
  idA: string,
  idB: string,
  graph: CooccurGraph,
  limit: number,
): Array<{ id: string; coA: number; coB: number }> {
  const sa = graph.byId.get(idA);
  const sb = graph.byId.get(idB);
  if (!sa || !sb) return [];
  const out: Array<{ id: string; coA: number; coB: number }> = [];
  sa.coWith.forEach((coA, nid) => {
    if (nid === idB) return;
    if (!sb.coWith.has(nid)) return;
    out.push({ id: nid, coA, coB: sb.coWith.get(nid) || 0 });
  });
  out.sort(
    (a, b) =>
      Math.min(b.coA, b.coB) - Math.min(a.coA, a.coB) ||
      b.coA + b.coB - (a.coA + a.coB),
  );
  return out.slice(0, limit);
}

export function executeCorefJudgeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: CorefJudgeLoopContext,
): { content: string; verdict?: { same: boolean; reason: string } } {
  const strip = ctx.stripDeicticWhenHasName !== false;
  const limit = Math.max(1, Math.min(16, Number(args.limit) || 8));

  if (name === "list_neighbors") {
    const hops = Math.max(1, Math.min(2, Number(args.hops) || 1));
    const idArg = args.id != null ? String(args.id) : "";
    const sideArg = args.side != null ? String(args.side) : "";

    if (idArg) {
      const focus = resolveId(idArg, ctx);
      if (!focus) return { content: `未知 id=${idArg}` };
      const rows = listSideNeighbors(
        focus,
        ctx.cooccurGraph,
        /* exclude self only */ focus,
        limit,
      );
      if (!rows.length) {
        return { content: `id=${focus} 一跳邻居：（无）` };
      }
      const lines1 = rows.map((r) => {
        const c = ctx.rosterById.get(r.id);
        const mark =
          r.id === ctx.idA ? " [=A]" : r.id === ctx.idB ? " [=B]" : "";
        const head = c
          ? cardLine(c, strip, `co=${r.co}${mark}`)
          : `${r.id} co=${r.co}${mark}`;
        return `- ${head}`;
      });
      let content =
        `【节点 ${focus} 的一跳共现】（多级网络；只助关系）\n` + lines1.join("\n");
      if (hops >= 2) {
        const hop2Lines: string[] = [];
        const seen = new Set(rows.map((r) => r.id));
        seen.add(focus);
        for (const r of rows.slice(0, Math.min(5, rows.length))) {
          const nested = listSideNeighbors(
            r.id,
            ctx.cooccurGraph,
            r.id,
            Math.min(4, limit),
          ).filter((n) => !seen.has(n.id));
          for (const n of nested.slice(0, 3)) {
            seen.add(n.id);
            const c = ctx.rosterById.get(n.id);
            const mark =
              n.id === ctx.idA ? " [=A]" : n.id === ctx.idB ? " [=B]" : "";
            hop2Lines.push(
              `- via ${r.id} → ` +
                (c
                  ? cardLine(c, strip, `co=${n.co}${mark}`)
                  : `${n.id} co=${n.co}${mark}`),
            );
          }
        }
        if (hop2Lines.length) {
          content +=
            "\n【二跳摘要】\n" + hop2Lines.slice(0, 16).join("\n");
        }
      }
      return { content };
    }

    const side = sideArg || "shared";
    if (side === "shared") {
      const rows = listShared(ctx.idA, ctx.idB, ctx.cooccurGraph, limit);
      if (!rows.length) {
        return {
          content:
            "shared 邻居：（无）— 请 list_neighbors side=A/B 或 list_neighbors id=… 做多级展开。",
        };
      }
      const lines = rows.map((r) => {
        const c = ctx.rosterById.get(r.id);
        const head = c
          ? cardLine(c, strip, `coA=${r.coA} coB=${r.coB}`)
          : `${r.id} coA=${r.coA} coB=${r.coB}`;
        return `- ${head}`;
      });
      let content =
        "【共同共现 shared】（不可仅因共现同一人就合并 A/B）\n" +
        lines.join("\n");
      if (hops >= 2) {
        content +=
          "\n（提示：对上表 id 调用 list_neighbors id=<id> hops=1 继续展开）";
      }
      return { content };
    }
    const focus = side === "B" ? ctx.idB : ctx.idA;
    const other = side === "B" ? ctx.idA : ctx.idB;
    const rows = listSideNeighbors(focus, ctx.cooccurGraph, other, limit);
    if (!rows.length) {
      return { content: `${side} 侧邻居：（无）` };
    }
    const lines = rows.map((r) => {
      const c = ctx.rosterById.get(r.id);
      const head = c
        ? cardLine(c, strip, `co=${r.co}`)
        : `${r.id} co=${r.co}`;
      return `- ${head}`;
    });
    let content =
      `【${side} 侧共现一跳】（禁止「邻居相似→A/B 同一人」）\n` +
      lines.join("\n");
    if (hops >= 2) {
      const hop2: string[] = [];
      const seen = new Set(rows.map((r) => r.id));
      seen.add(focus);
      seen.add(other);
      for (const r of rows.slice(0, 5)) {
        for (const n of listSideNeighbors(
          r.id,
          ctx.cooccurGraph,
          r.id,
          4,
        ).filter((x) => !seen.has(x.id))) {
          seen.add(n.id);
          const c = ctx.rosterById.get(n.id);
          hop2.push(
            `- ${side}→${r.id}→` +
              (c ? cardLine(c, strip, `co=${n.co}`) : `${n.id} co=${n.co}`),
          );
        }
      }
      if (hop2.length) {
        content += "\n【二跳摘要】\n" + hop2.slice(0, 16).join("\n");
      }
    }
    return { content };
  }

  if (name === "get_character") {
    const id = resolveId(String(args.id || ""), ctx);
    if (!id) {
      return { content: `未知 id=${args.id}` };
    }
    const c = ctx.rosterById.get(id);
    if (!c) return { content: `roster 无 ${id}` };
    const label =
      id === ctx.idA ? "（判决对象 A）" : id === ctx.idB ? "（判决对象 B）" : "";
    return { content: cardLine(c, strip) + " " + label };
  }

  if (name === "get_excerpts") {
    const id = resolveId(String(args.id || ""), ctx);
    if (!id) return { content: `未知 id=${args.id}` };
    const c = ctx.rosterById.get(id);
    if (!c) return { content: `roster 无 ${id}` };
    const maxN = Math.max(1, Math.min(8, Number(args.maxMentions) || 4));
    const lines = ctx.formatExcerpts(c, maxN);
    if (!lines.length) return { content: `${id} 无可用摘录` };
    return {
      content: `【摘录 ${id}】\n` + lines.join("\n"),
    };
  }

  if (name === "lookup_text") {
    const g0 = Number(args.globalStart);
    const radius = Math.max(40, Math.min(600, Number(args.radius) || 200));
    if (!Number.isFinite(g0) || !ctx.fullText) {
      return { content: "lookup_text 需要 fullText 与合法 globalStart" };
    }
    const from = Math.max(0, Math.floor(g0) - radius);
    const to = Math.min(ctx.fullText.length, Math.floor(g0) + radius);
    const snip = ctx.fullText.slice(from, to).replace(/\s+/g, " ").trim();
    return {
      content: `global@${Math.floor(g0)} radius=${radius}\n…${snip}…`,
    };
  }

  if (name === SUBMIT_TOOL) {
    const same = Boolean(args.same);
    const reason = String(args.reason || "").trim() || (same ? "same" : "diff");
    return {
      content: `已记录 verdict same=${same}`,
      verdict: { same, reason },
    };
  }

  return { content: `未知工具 ${name}` };
}

/**
 * Multi-turn tool loop until submit_verdict or maxSteps.
 */
export async function agentJudgeSamePersonToolLoop(
  llm: LLMProvider,
  userPrompt: string,
  loopCtx: CorefJudgeLoopContext,
): Promise<{ same: boolean; reason: string; steps: number }> {
  const maxSteps = loopCtx.maxSteps ?? 8;
  const conversation: LLMMessage[] = [
    {
      role: "user",
      content:
        userPrompt +
        "\n\n" +
        "【工具使用】Stage④ agent：查**多级共现网络**与原文。建议：\n" +
        "1) list_neighbors side=A|B|shared；需要二跳则 list_neighbors id=<邻居id> hops=1|2；\n" +
        "2) get_character / get_excerpts / lookup_text 验证关系；\n" +
        "3) 必须 submit_verdict(same, reason) 结束。\n",
    },
  ];

  let steps = 0;
  for (let round = 0; round < maxSteps; round++) {
    steps = round + 1;
    const pending: Array<{
      id: string;
      name: string;
      args: Record<string, unknown>;
    }> = [];
    let stepText = "";

    const stream = llm.chatWithTools(conversation, COREF_JUDGE_TOOLS, {
      temperature: 0.1,
      maxTokens: 4096,
    });

    for await (const ev of stream) {
      if (ev.type === "text_delta") stepText += ev.text || "";
      else if (ev.type === "tool_use") {
        pending.push({
          id: ev.id,
          name: ev.name,
          args: (ev.args || {}) as Record<string, unknown>,
        });
      }
    }

    if (!pending.length) {
      // Fallback: parse final JSON from text
      const text = stepText.trim();
      if (text) {
        try {
          const parsed = extractJSON<{ same?: boolean; reason?: string }>(text);
          if (typeof parsed?.same === "boolean") {
            return {
              same: parsed.same,
              reason:
                (parsed.reason || "").trim() ||
                (parsed.same ? "agent:same" : "agent:diff"),
              steps,
            };
          }
        } catch {
          /* fall through */
        }
      }
      // Force one more user nudge then fail closed
      if (round < maxSteps - 1) {
        conversation.push({
          role: "user",
          content:
            "请调用 submit_verdict 提交 same 与 reason，不要只输出文字。",
        });
        continue;
      }
      return {
        same: false,
        reason: "tool-loop: no submit_verdict (default reject)",
        steps,
      };
    }

    conversation.push({
      role: "assistant",
      content: stepText.trim() || null,
      tool_calls: pending.map((p) => ({
        id: p.id,
        type: "function" as const,
        function: {
          name: p.name,
          arguments: JSON.stringify(p.args || {}),
        },
      })),
    } as AssistantMessage);

    for (const p of pending) {
      const result = executeCorefJudgeTool(p.name, p.args || {}, loopCtx);
      conversation.push({
        role: "tool",
        tool_call_id: p.id,
        content: result.content,
      } as ToolMessage);
      if (result.verdict) {
        return {
          same: result.verdict.same,
          reason: `[tool-loop steps=${steps}] ${result.verdict.reason}`,
          steps,
        };
      }
    }
  }

  return {
    same: false,
    reason: "tool-loop: max steps without submit (default reject)",
    steps,
  };
}

