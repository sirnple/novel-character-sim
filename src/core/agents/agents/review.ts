import type { AgentDef } from "../types";
import { runSubAgentToolLoop } from "../tool-loop";
import { branchTools } from "./branch-tools";
import { extractJSON } from "@/lib/utils";

const BRANCH_TOOL_SCHEMAS = branchTools.map(t => ({
  name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown>,
}));

function makeReviewAgent(dimension: string, guideline: string): AgentDef {
  return {
    execute: async (ctx, llm) => {
      const sys = `${guideline}\n\n当前审查的分支为 novelId=${ctx.novelId}, branchId=${ctx.branchId}。如需原文或角色档案，调 get_branch_* 工具自取（参数同上）。`;
      const uc = `附在被审的内容下方，请审校：\n\n${ctx.prompt}\n\n审查完成后用 JSON 返回 findings 与 converged，无需其他文本。`;
      const { finalText, trail } = await runSubAgentToolLoop(llm, sys, uc, BRANCH_TOOL_SCHEMAS, ctx);
      const collected = finalText;
      let findings = [] as { dimension: string; severity: string; description: string; suggestion: string }[];
      let converged = true;
      try {
        const parsed = extractJSON<{ findings: any[]; converged: boolean }>(collected || "{}");
        converged = parsed.converged ?? parsed.findings.length === 0;
        findings = parsed.findings.map(f => ({
          dimension, severity: f.severity, description: f.description, suggestion: f.suggestion || "",
        }));
      } catch {
        converged = false;
        findings = [{ dimension, severity: "major", description: collected.slice(0, 500), suggestion: "" }];
      }
      const result = { converged, findings };
      return { content: JSON.stringify(result), messages: trail };
    },
  };
}

export const reviewCharacterAgent = makeReviewAgent("角色一致性", "你是角色一致性审查员。对照原文中角色的性格和说话方式，检查生成文字中是否有角色行为/语言偏离设定。");
export const reviewContinuityAgent = makeReviewAgent("连贯性", "你是连贯性审查员。检查生成文字是否与原文已建立的事实存在逻辑矛盾。");
export const reviewForeshadowingAgent = makeReviewAgent("伏笔", "你是伏笔追踪审查员。检查伏笔是否被合理推进或回收。");
export const reviewStyleAgent = makeReviewAgent("风格", "你是风格审查员。检查生成文字是否保持原文文风。");
export const reviewWorldAgent = makeReviewAgent("世界观", "你是世界观审查员。检查生成文字是否与原文世界观一致。");
export const reviewPacingAgent = makeReviewAgent("节奏", "你是节奏审查员。检查生成文字的叙事节奏是否合理。");
