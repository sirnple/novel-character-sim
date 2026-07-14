import type { AgentDef } from "../types";
import { runSubAgentToolLoop } from "../tool-loop";
import { saveFindings } from "../intermediate-store";
import { extractJSON } from "@/lib/utils";
import { branchTools } from "./branch-tools";
import { intermediateTools } from "./intermediate-tools";

const TOOLS = [...branchTools, ...intermediateTools].map(t => ({
  name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown>,
}));

function makeReviewAgent(dimensionName: string, dimensionCode: string, guideline: string): AgentDef {
  return {
    execute: async (ctx, llm) => {
      const sys = `${guideline}

## 输出契约
1. 调 get_prose 工具取当前正文。
2. 必要时调 get_branch_text 工具取原文比对（审 character/continuity/world 必读）。
3. 直接输出 JSON 数组汇总问题：[{severity, description, suggestion}, ...]。无问题输出 []。
4. 你不需要调用 save_findings——你的 JSON 产出会被执行层自动解析并存储。`;

      const uc = `${ctx.prompt}\n\n## 当前绑定分支\nnovelId=${ctx.novelId}, branchId=${ctx.branchId}\n\n请审查 get_prose 取到的正文，按维度 "${dimensionName}" 给出 findings。输出应为纯 JSON 数组。`;

      const { finalText, trail } = await runSubAgentToolLoop(llm, sys, uc, TOOLS, ctx);

      let parsed: any[] = [];
      try { parsed = extractJSON<any[]>(finalText || "[]"); if (!Array.isArray(parsed)) parsed = []; } catch { parsed = []; }

      saveFindings(ctx.novelId, ctx.branchId, parsed.map(f => ({
        dimension: dimensionCode,
        severity: String(f.severity || "minor"),
        description: String(f.description || ""),
        suggestion: String(f.suggestion || ""),
      })));

      return {
        content: `${dimensionName}: ${parsed.length} findings，已存储。主 agent 可用 get_findings 获取。`,
        messages: trail,
      };
    },
  };
}

export const reviewCharacterAgent = makeReviewAgent("角色一致性", "character", "你是角色一致性审查员。对照原文角色性格/说话方式，检查生成正文是否有偏离。");
export const reviewContinuityAgent = makeReviewAgent("连贯性", "continuity", "你是连贯性审查员。检查生成正文是否与原文事实矛盾。");
export const reviewForeshadowingAgent = makeReviewAgent("伏笔", "foreshadowing", "你是伏笔追踪审查员。检查伏笔是否被合理推进或回收。");
export const reviewStyleAgent = makeReviewAgent("风格", "style", "你是风格审查员。检查正文是否维持原文文风。");
export const reviewWorldAgent = makeReviewAgent("世界观", "world", "你是世界观审查员。检查正文是否与原文世界观一致。");
export const reviewPacingAgent = makeReviewAgent("节奏", "pacing", "你是节奏审查员。检查正文叙事节奏是否合理。");