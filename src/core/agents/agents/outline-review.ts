import type { Agent, TrailMessage } from "../types";
import { defineAgent } from "../agent-registry";
import { runSubAgentToolLoop } from "../tool-loop";
import { getFindings, getOutline } from "../intermediate-store";
import {
  resolveAgentPrompt,
  resolveAgentToolSchemas,
} from "@/core/prompts/resolve-agent-prompt";
import { writeTargetUserPrompt } from "../write-target";
import { SAVE_FINDINGS_OK } from "./intermediate-tools";
import { getStoryInfo } from "@/lib/db";
import { toolSaveSucceeded } from "../save-verify";
import { evaluateReviewPass, formatReviewPassLine } from "../review-pass";

export { outlineReviewFailedFromFindings } from "../review-pass";

export interface OutlineReviewResult {
  pass: boolean;
  findings: Array<{
    severity: string;
    description: string;
    suggestion: string;
    dimension: string;
  }>;
  summary: string;
  askUser?: import("../types").AskUserRequest;
}

/**
 * Run outline review via agent tools (save_findings).
 * @param agentName frontmatter name — pass from Agent.config.name
 */
export async function runOutlineReview(
  ctx: { prompt?: string; novelId: string; branchId: string; userId: string },
  llm: Parameters<Agent["execute"]>[1],
  onTrail?: Parameters<Agent["execute"]>[3],
  agentName?: string,
): Promise<OutlineReviewResult> {
  const name = agentName || outlineReviewAgent.config.name;
  const outline = getOutline(ctx.novelId, ctx.branchId);
  if (!outline || String(outline).length < 30) {
    return { pass: true, findings: [], summary: "无大纲可审（请先 outline_creator / save_outline）" };
  }

  const info = getStoryInfo(ctx.userId, ctx.novelId);
  const genre = info?.writingStyle?.genre || "";
  // User message = session binding only; how-to in system md
  const { system: sys } = resolveAgentPrompt(name, "zh", {
    novelId: ctx.novelId,
    branchId: ctx.branchId,
  });
  const uc =
    writeTargetUserPrompt(ctx.novelId, ctx.branchId) +
    `\n\n## 本书类型\ngenre: ${genre || "（未知）"}\nthemes: ${(info?.themes || []).join("、") || "—"}\n`;

  // tools allowlist from system md frontmatter
  const TOOLS = resolveAgentToolSchemas(name);
  const run = (user: string) =>
    runSubAgentToolLoop(llm, sys, user, TOOLS, ctx as any, undefined, onTrail, {
      maxTokens: 4096,
      temperature: 0.2,
    });

  let loop = await run(uc);
  if (loop.askUser) {
    return {
      pass: false,
      findings: [],
      summary: loop.finalText || "大纲审核因关键数据缺失已询问用户",
      askUser: loop.askUser,
    };
  }
  let { trail } = loop;
  let saved = toolSaveSucceeded(trail, "save_findings", SAVE_FINDINGS_OK);
  if (!saved.ok) {
    const second = await run(
      uc +
        `\n\n## 系统纠错\n请立刻 save_findings，dimension=outline，findings 为 JSON 数组。`,
    );
    if (second.askUser) {
      return {
        pass: false,
        findings: [],
        summary: second.finalText || "大纲审核因关键数据缺失已询问用户",
        askUser: second.askUser,
      };
    }
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

  const verdict = evaluateReviewPass(findings);
  const pass = verdict.pass;
  const lines = findings
    .slice(0, 8)
    .map(
      (f, i) =>
        `${i + 1}. 【${f.severity}】${f.description}${f.suggestion ? ` → ${f.suggestion}` : ""}`,
    );
  const marker = pass ? "【大纲审核通过】" : "【大纲审核未通过】";
  const gateLine = formatReviewPassLine(verdict).replace("【审查", "【大纲审核");
  const summary =
    `${marker} 大纲审核 ${pass ? "通过" : "未通过"}（${findings.length} 条，已 save_findings）\n` +
    gateLine +
    (lines.length ? "：\n" + lines.join("\n") : "。") +
    (pass
      ? ""
      : "\n→ 主 agent：**必须**再调 outline_rewriter 按上述意见改写大纲，禁止隐瞒问题直接写正文。");

  return { pass, findings, summary };
}

export const outlineReviewAgent = defineAgent(
  "outline_review-system.md",
  (config) => {
    const name = config.name;
    return async (ctx, llm, _onChunk, onTrail) => {
      const result = await runOutlineReview(ctx, llm, onTrail, name);
      return {
        content:
          result.summary +
          "（主 agent 可用 get_findings 查看 outline 维；未通过时先改大纲再写正文）",
        messages: [],
        askUser: result.askUser,
      };
    };
  },
);

