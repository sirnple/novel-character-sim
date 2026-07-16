import type { AgentDef, TrailMessage } from "../types";
import { resolveAgentPrompt } from "@/core/prompts/resolve-agent-prompt";
import { runSubAgentToolLoop } from "../tool-loop";
import { getOutline, getForeshadowPlan, beginOutlineRound } from "../intermediate-store";
import { branchTools } from "./branch-tools";
import { intermediateTools, intermediateReadTools, SAVE_OUTLINE_OK } from "./intermediate-tools";
import { libraryTools } from "./library-tools";
import { foreshadowTools, SAVE_FS_PLAN_OK } from "./foreshadow-tools";
import { getIdea, getForeshadowingLedger } from "@/lib/db";
import { formatLedgerForPrompt } from "@/core/foreshadowing/types";
import { toolSaveSucceeded } from "../save-verify";

const TOOLS = [
  ...branchTools,
  ...intermediateReadTools.filter((t) => t.name === "get_outline"),
  ...intermediateTools.filter((t) => t.name === "save_outline"),
  ...libraryTools.filter((t) => t.name === "list_ideas" || t.name === "get_ideas"),
  ...foreshadowTools.filter(
    (t) =>
      t.name === "get_foreshadowing_ledger" || t.name === "save_foreshadowing_plan",
  ),
].map((t) => ({
  name: t.name,
  description: t.description,
  parameters: t.parameters as Record<string, unknown>,
}));

export const outlineAgent: AgentDef = {
  execute: async (ctx, llm, onChunk, onTrail) => {
    beginOutlineRound(ctx.novelId, ctx.branchId);

    let ideaBlock = "";
    const selected = (ctx.selectedIdeaIds || []).slice(0, 3);
    if (selected.length > 0) {
      const ideas = selected.map((id) => getIdea(ctx.userId, id)).filter(Boolean);
      if (ideas.length) {
        ideaBlock =
          "\n\n## 用户已选定的点子（必须融入大纲，最多 3 条）\n" +
          ideas.map((i, n) => `${n + 1}. 【${i!.title}】${i!.content}`).join("\n");
      }
    } else if (ctx.autoPickIdeas) {
      ideaBlock =
        "\n\n## 点子库\n用户未预选点子。你可调用 list_ideas / get_ideas 自行挑选最多 3 条并融入大纲。";
    }

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
      "\n\n## 落盘（必须用工具，程序只认 tool）\n" +
      "1. 取语境后，**必须** `save_outline`，content=完整大纲正文（给人看的结构文，不是 JSON）\n" +
      "2. **必须** `save_foreshadowing_plan`，plan=JSON 字符串 {plant,advance,reveal,abandon,rationale}\n" +
      "3. 不要指望聊天区最终回复被程序当大纲；未 save 即失败\n" +
      "4. 成功后可简短确认，无需再贴全文";

    const uc = baseUser + ideaBlock + ledgerBlock;

    const run = (user: string) =>
      runSubAgentToolLoop(llm, sys, user, TOOLS, ctx, onChunk, onTrail, {
        maxTokens: 6144,
        temperature: 0.4,
      });

    let loop = await run(uc);
    if (loop.askUser) {
      return {
        content: loop.finalText || "关键数据缺失，已直接询问用户。",
        messages: loop.trail,
        askUser: loop.askUser,
      };
    }
    let { trail } = loop;
    let outlineOk = toolSaveSucceeded(trail, "save_outline", SAVE_OUTLINE_OK);
    let planOk = toolSaveSucceeded(trail, "save_foreshadowing_plan", SAVE_FS_PLAN_OK);

    if (!outlineOk.ok || !planOk.ok) {
      const missing = [
        !outlineOk.ok ? "save_outline" : "",
        !planOk.ok ? "save_foreshadowing_plan" : "",
      ]
        .filter(Boolean)
        .join("、");
      console.warn(`[outline] missing saves: ${missing}; retrying`);
      const retryUc = `${uc}

## 系统纠错
你尚未成功调用：${missing}。
请立刻调用缺失的 save 工具。大纲正文只通过 save_outline 提交；伏笔意图只通过 save_foreshadowing_plan 提交。`;
      const second = await run(retryUc);
      if (second.askUser) {
        return {
          content: second.finalText || "关键数据缺失，已直接询问用户。",
          messages: trail.concat(second.trail),
          askUser: second.askUser,
        };
      }
      trail = trail.concat(
        { role: "assistant", content: `（系统：请补全 ${missing}）` } as TrailMessage,
        ...second.trail.filter((m) => m.role !== "system"),
      );
      outlineOk = toolSaveSucceeded(trail, "save_outline", SAVE_OUTLINE_OK);
      planOk = toolSaveSucceeded(trail, "save_foreshadowing_plan", SAVE_FS_PLAN_OK);
    }

    const saved = getOutline(ctx.novelId, ctx.branchId);
    const plan = getForeshadowPlan(ctx.novelId, ctx.branchId);
    if (!outlineOk.ok || !saved || String(saved).length < 50) {
      return {
        content: `大纲生成失败：未成功 save_outline（${outlineOk.detail || "未调用"}）。`,
        messages: trail,
      };
    }

    const len = String(saved).length;
    const p = plan;
    return {
      content:
        `大纲已生成并 save_outline（${len} 字）。` +
        `伏笔 plan: plant=${p?.plant?.length ?? 0} reveal=${p?.reveal?.length ?? 0}` +
        (planOk.ok ? "（已 save_foreshadowing_plan）" : "（plan 未存，可再调）") +
        `。主 agent 用 get_outline 取可读全文。系统将自动 review_outline。`,
      messages: trail,
    };
  },
};
