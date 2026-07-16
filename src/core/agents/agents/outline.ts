import type { AgentDef } from "../types";
import { resolveAgentPrompt } from "@/core/prompts/resolve-agent-prompt";
import { runSubAgentToolLoop } from "../tool-loop";
import { saveOutline, saveForeshadowPlan, getForeshadowPlan } from "../intermediate-store";
import { branchTools } from "./branch-tools";
import { intermediateReadTools } from "./intermediate-tools";
import { libraryTools } from "./library-tools";
import { foreshadowTools } from "./foreshadow-tools";
import { getIdea, getForeshadowingLedger } from "@/lib/db";
import { formatLedgerForPrompt, type ForeshadowingPlan } from "@/core/foreshadowing/types";
import { extractJSON } from "@/lib/utils";

// Outline: branch context + idea library + foreshadow ledger/plan
const TOOLS = [
  ...branchTools,
  ...intermediateReadTools.filter(t => t.name === "get_outline"),
  ...libraryTools.filter(t => t.name === "list_ideas" || t.name === "get_ideas"),
  ...foreshadowTools.filter(t =>
    t.name === "get_foreshadowing_ledger" || t.name === "save_foreshadowing_plan",
  ),
].map(t => ({
  name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown>,
}));

function tryExtractPlan(text: string, novelId: string, branchId: string): ForeshadowingPlan | null {
  // Prefer fenced block ```foreshadow_plan ... ``` or last JSON with plant/reveal keys
  const fence = text.match(/```(?:foreshadow_plan|json)?\s*([\s\S]*?)```/gi);
  const candidates = fence ? fence.map(f => f.replace(/```(?:foreshadow_plan|json)?/i, "").replace(/```$/, "").trim()) : [];
  candidates.push(text);
  for (const c of candidates) {
    try {
      const parsed = extractJSON<any>(c);
      if (!parsed || typeof parsed !== "object") continue;
      const body = parsed.foreshadowingPlan || parsed.foreshadow_plan || parsed;
      if (!Array.isArray(body.plant) && !Array.isArray(body.reveal) && !Array.isArray(body.advance)) {
        continue;
      }
      return {
        novelId,
        branchId,
        createdAt: new Date().toISOString(),
        source: "outline",
        plant: Array.isArray(body.plant) ? body.plant : [],
        advance: Array.isArray(body.advance) ? body.advance : [],
        reveal: Array.isArray(body.reveal) ? body.reveal : [],
        abandon: Array.isArray(body.abandon) ? body.abandon : [],
        rationale: body.rationale || "",
      };
    } catch { /* try next */ }
  }
  return null;
}

export const outlineAgent: AgentDef = {
  execute: async (ctx, llm, onChunk, onTrail) => {
    let ideaBlock = "";
    const selected = (ctx.selectedIdeaIds || []).slice(0, 3);
    if (selected.length > 0) {
      const ideas = selected.map(id => getIdea(ctx.userId, id)).filter(Boolean);
      if (ideas.length) {
        ideaBlock =
          "\n\n## 用户已选定的点子（必须融入大纲，最多 3 条）\n" +
          ideas.map((i, n) => `${n + 1}. 【${i!.title}】${i!.content}`).join("\n");
      }
    } else if (ctx.autoPickIdeas) {
      ideaBlock =
        "\n\n## 点子库\n用户未预选点子。你可调用 list_ideas / get_ideas 自行挑选最多 3 条并融入大纲。";
    }

    // system = outline-system.md + outline-agent-contract.md (via map systemExtra)
    const { system: sys, user: baseUser } = resolveAgentPrompt("outline_writer", "zh", {
      prompt: ctx.prompt,
      novelId: ctx.novelId,
      branchId: ctx.branchId,
      selectionInstruction: "",
    });

    const ledger = getForeshadowingLedger(ctx.userId, ctx.novelId, ctx.branchId);
    const ledgerBlock =
      "\n\n## 当前分支活跃伏笔账本\n" +
      formatLedgerForPrompt(ledger) +
      "\n\n## 伏笔 plan（必须）\n" +
      "你可先 get_foreshadowing_ledger 核对。大纲正文写完后，必须用 save_foreshadowing_plan 保存本轮意图，" +
      "或在文末附 ```foreshadow_plan\\n{JSON}\\n```，字段：plant[], advance[{id,how}], reveal[{id,how}], abandon[{id,reason}], rationale。\n" +
      "plant 项含 description,type,importance,mustResolve,suggestedRevealWindow。\n" +
      "注意：plan 只是意图；用户 Accept 时按正文实际落实（realized）记账，不会盲信 plan。";

    const uc = baseUser + ideaBlock + ledgerBlock;

    const { finalText, trail } = await runSubAgentToolLoop(llm, sys, uc, TOOLS, ctx, onChunk, onTrail);

    // Recover body: final turn, else longest assistant trail (pre-tool outline is common)
    let outlineBody = (finalText || "").trim();
    if (outlineBody.length < 50) {
      for (const m of trail) {
        if (m.role === "assistant" && typeof m.content === "string" && m.content.trim().length > outlineBody.length) {
          outlineBody = m.content.trim();
        }
      }
    }
    // Drop pure foreshadow_plan fence if that was the only "long" blob
    if (outlineBody.length < 50 || (/^\s*\{/.test(outlineBody) && outlineBody.includes('"plant"') && outlineBody.length < 800 && !outlineBody.includes("情节点"))) {
      return {
        content: "大纲生成失败：产出为空或过短，请重试 generate_outline。",
        messages: trail,
      };
    }

    // 由 execute 层强制把大纲存进 store —— 不依赖 LLM 主动调 save_outline
    saveOutline(ctx.novelId, ctx.branchId, outlineBody);

    // Prefer plan saved via tool; else parse from text; else empty plan
    let p = getForeshadowPlan(ctx.novelId, ctx.branchId);
    if (!p) {
      p = tryExtractPlan(outlineBody + "\n" + (finalText || ""), ctx.novelId, ctx.branchId) || {
        novelId: ctx.novelId,
        branchId: ctx.branchId,
        createdAt: new Date().toISOString(),
        source: "outline",
        plant: [],
        advance: [],
        reveal: [],
        abandon: [],
        rationale: "大纲未产出结构化 plan（空 plan）",
      };
      saveForeshadowPlan(ctx.novelId, ctx.branchId, p);
    }

    // 大纲审核由 chat 路由在 generate_outline 之后单独开一张 tool 卡跑 review_outline
    return {
      content:
        `大纲已生成（已存储）。伏笔 plan: plant=${p.plant?.length || 0} reveal=${p.reveal?.length || 0}。` +
        `主 agent 可用 get_outline 获取。系统将自动调用 review_outline 审核大纲。`,
      messages: trail,
    };
  },
};
