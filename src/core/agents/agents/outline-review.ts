import type { AgentDef, TrailMessage } from "../types";
import { runSubAgentToolLoop } from "../tool-loop";
import { getFindings, getOutline } from "../intermediate-store";
import { resolveAgentPrompt } from "@/core/prompts/resolve-agent-prompt";
import { branchTools } from "./branch-tools";
import { intermediateReadTools, intermediateTools, SAVE_FINDINGS_OK } from "./intermediate-tools";
import { foreshadowTools } from "./foreshadow-tools";
import { getStoryInfo } from "@/lib/db";
import { toolSaveSucceeded } from "../save-verify";

const TOOLS = [
  ...branchTools,
  ...intermediateReadTools.filter((t) => t.name === "get_outline"),
  ...intermediateTools.filter((t) => t.name === "save_findings"),
  ...foreshadowTools.filter((t) => t.name === "get_foreshadowing_ledger"),
].map((t) => ({
  name: t.name,
  description: t.description,
  parameters: t.parameters as Record<string, unknown>,
}));

export interface OutlineReviewResult {
  pass: boolean;
  findings: Array<{
    severity: string;
    description: string;
    suggestion: string;
    dimension: string;
  }>;
  summary: string;
}

/**
 * Run outline review via agent tools (save_findings). Used as agent review_outline.
 */
export async function runOutlineReview(
  ctx: { prompt?: string; novelId: string; branchId: string; userId: string },
  llm: Parameters<AgentDef["execute"]>[1],
  onTrail?: Parameters<AgentDef["execute"]>[3],
): Promise<OutlineReviewResult> {
  const outline = getOutline(ctx.novelId, ctx.branchId);
  if (!outline || String(outline).length < 30) {
    return { pass: true, findings: [], summary: "无大纲可审（请先 generate_outline / save_outline）" };
  }

  const info = getStoryInfo(ctx.userId, ctx.novelId);
  const genre = info?.writingStyle?.genre || "";
  const { system: sys, user: baseUser } = resolveAgentPrompt("outline_review", "zh", {
    prompt: ctx.prompt || "请审核本轮续写大纲。",
    novelId: ctx.novelId,
    branchId: ctx.branchId,
  });
  const uc =
    baseUser +
    `\n\n## 本书类型\ngenre: ${genre || "（未知）"}\nthemes: ${(info?.themes || []).join("、") || "—"}\n` +
    `\n## 落盘（必须）\n` +
    `取证后调用 save_findings：dimension="outline"，findings=JSON 数组字符串（无问题 "[]"）。\n` +
    `不要在聊天贴完整 JSON。程序只认 save_findings。\n`;

  const run = (user: string) =>
    runSubAgentToolLoop(llm, sys, user, TOOLS, ctx as any, undefined, onTrail, {
      maxTokens: 4096,
      temperature: 0.2,
    });

  let { trail } = await run(uc);
  let saved = toolSaveSucceeded(trail, "save_findings", SAVE_FINDINGS_OK);
  if (!saved.ok) {
    const second = await run(
      uc +
        `\n\n## 系统纠错\n请立刻 save_findings，dimension=outline，findings 为 JSON 数组。`,
    );
    trail = trail.concat(
      { role: "assistant", content: "（系统：请 save_findings）" } as TrailMessage,
      ...second.trail.filter((m) => m.role !== "system"),
    );
    saved = toolSaveSucceeded(trail, "save_findings", SAVE_FINDINGS_OK);
  }

  const findings = getFindings(ctx.novelId, ctx.branchId).filter((f) => f.dimension === "outline");
  if (!saved.ok) {
    return {
      pass: false,
      findings: [
        {
          dimension: "outline",
          severity: "major",
          description: "大纲审核未成功 save_findings",
          suggestion: "重跑 review_outline",
        },
      ],
      summary: "大纲审核失败：未 save_findings",
    };
  }

  const pass = !findings.some((f) => f.severity === "critical" || f.severity === "major");
  const lines = findings
    .slice(0, 8)
    .map(
      (f, i) =>
        `${i + 1}. 【${f.severity}】${f.description}${f.suggestion ? ` → ${f.suggestion}` : ""}`,
    );
  const summary =
    `大纲审核 ${pass ? "通过" : "未通过"}（${findings.length} 条，已 save_findings）` +
    (lines.length ? "：\n" + lines.join("\n") : "。");

  return { pass, findings, summary };
}

export const outlineReviewAgent: AgentDef = {
  execute: async (ctx, llm, _onChunk, onTrail) => {
    const result = await runOutlineReview(ctx, llm, onTrail);
    return {
      content: result.summary + "（主 agent 可用 get_findings 查看 outline 维）",
      messages: [],
    };
  },
};
