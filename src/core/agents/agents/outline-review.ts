import type { AgentDef } from "../types";
import { runSubAgentToolLoop } from "../tool-loop";
import { saveFindingsLocked, getOutline } from "../intermediate-store";
import { extractJSON } from "@/lib/utils";
import { resolveAgentPrompt } from "@/core/prompts/resolve-agent-prompt";
import { branchTools } from "./branch-tools";
import { intermediateReadTools } from "./intermediate-tools";
import { foreshadowTools } from "./foreshadow-tools";
import { getStoryInfo } from "@/lib/db";

const TOOLS = [
  ...branchTools,
  ...intermediateReadTools.filter((t) => t.name === "get_outline"),
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

function parseOutlineReview(raw: string): { pass: boolean; items: any[]; ok: boolean } {
  try {
    const parsed = extractJSON<any>(raw || "");
    if (Array.isArray(parsed)) {
      const items = parsed;
      const pass = !items.some(
        (f) => f.severity === "critical" || f.severity === "major",
      );
      return { pass, items, ok: true };
    }
    if (parsed && typeof parsed === "object") {
      const items = Array.isArray(parsed.findings) ? parsed.findings : [];
      const pass =
        parsed.pass !== undefined
          ? !!parsed.pass
          : !items.some(
              (f: any) => f.severity === "critical" || f.severity === "major",
            );
      return { pass, items, ok: true };
    }
  } catch { /* fallthrough */ }
  return { pass: false, items: [], ok: false };
}

/**
 * Run outline review (LLM). Used after generate_outline and as agent review_outline.
 */
export async function runOutlineReview(
  ctx: { prompt?: string; novelId: string; branchId: string; userId: string },
  llm: Parameters<AgentDef["execute"]>[1],
  onTrail?: Parameters<AgentDef["execute"]>[3],
): Promise<OutlineReviewResult> {
  const outline = getOutline(ctx.novelId, ctx.branchId);
  if (!outline || String(outline).length < 30) {
    return {
      pass: true,
      findings: [],
      summary: "无大纲可审",
    };
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
    `\n\n## 本书类型（系统注入）\ngenre: ${genre || "（未知，默认中档）"}\nthemes: ${(info?.themes || []).join("、") || "—"}\n` +
    `请 get_outline + get_branch_world + get_branch_text 后审查。`;

  const { finalText, trail } = await runSubAgentToolLoop(
    llm,
    sys,
    uc,
    TOOLS,
    ctx as any,
    undefined,
    onTrail,
  );

  const { pass, items, ok } = parseOutlineReview(finalText || "");
  const findings = (ok ? items : [{
    severity: "major",
    description: "大纲审核输出无法解析，请重跑 review_outline",
    suggestion: "重新生成或手动检查大纲与前文衔接",
  }]).map((f: any) => ({
    dimension: "outline",
    severity: String(f.severity || "minor"),
    description: String(f.description || "").trim(),
    suggestion: String(f.suggestion || "").trim(),
  })).filter((f: any) => f.description);

  await saveFindingsLocked(ctx.novelId, ctx.branchId, findings);

  const lines = findings.slice(0, 8).map(
    (f, i) => `${i + 1}. 【${f.severity}】${f.description}${f.suggestion ? ` → ${f.suggestion}` : ""}`,
  );
  const summary =
    `大纲审核 ${pass ? "通过" : "未通过"}（${findings.length} 条）` +
    (lines.length ? "：\n" + lines.join("\n") : "。");

  // attach trail for agent card if needed
  void trail;

  return { pass: ok ? pass : false, findings, summary };
}

export const outlineReviewAgent: AgentDef = {
  execute: async (ctx, llm, _onChunk, onTrail) => {
    const result = await runOutlineReview(ctx, llm, onTrail);
    return {
      content: result.summary + "（findings 已存 dimension=outline，可用 get_findings）",
      messages: [],
    };
  },
};
