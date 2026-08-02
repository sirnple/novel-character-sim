import type { TrailMessage } from "../types";
import { defineAgent } from "../agent-registry";
import {
  resolveAgentPrompt,
  resolveAgentToolSchemas,
} from "@/core/prompts/resolve-agent-prompt";
import { runSubAgentToolLoop } from "../tool-loop";
import {
  getOutline,
  getForeshadowPlan,
  beginOutlineRound,
  saveOutline,
} from "../intermediate-store";
import { SAVE_OUTLINE_OK } from "./intermediate-tools";
import { SAVE_FS_PLAN_OK } from "./foreshadow-tools";
import { getIdea, getForeshadowingLedger } from "@/lib/db";
import { formatLedgerForPrompt } from "@/core/foreshadowing/types";
import { toolSaveSucceeded } from "../save-verify";

/** Prefer store truth: trail marker can be lost if tool JSON was recovered late. */
function outlineInStore(novelId: string, branchId: string): boolean {
  const o = getOutline(novelId, branchId);
  return !!(o && String(o).trim().length >= 50);
}

function planInStore(novelId: string, branchId: string): boolean {
  const p = getForeshadowPlan(novelId, branchId);
  return !!(
    p &&
    (p.plant?.length || p.reveal?.length || p.advance?.length || p.rationale)
  );
}

/**
 * Detect rewrite / fix-from-review (not first draft).
 * Prefer explicit mode markers; avoid loose words like bare "findings".
 */
export function isOutlineRewritePrompt(prompt: string): boolean {
  const p = String(prompt || "");
  if (/【任务模式:\s*create】|\[MODE:\s*create\]/i.test(p)) return false;
  if (
    /【任务模式:\s*rewrite】|\[MODE:\s*rewrite_outline\]|【系统强制改写大纲】/i.test(
      p,
    )
  ) {
    return true;
  }
  // Explicit human/master rewrite intents only
  return /改写大纲|修改大纲|重写大纲|系统强制改写|按审核意见修改大纲|大纲审核未通过/.test(
    p,
  );
}

/** Recover outline from chat text when model dumped structure without save_outline. */
function tryRecoverOutlineFromText(
  text: string,
  novelId: string,
  branchId: string,
): boolean {
  const t = String(text || "").trim();
  if (t.length < 80) return false;
  const outlineLike =
    /第.?[一二三四五六七八九十\d]+|场景|冲突|高潮|结尾|开端|发展|节奏|章|节|转折|人物|目标/.test(
      t,
    ) || t.split("\n").filter((l) => l.trim()).length >= 4;
  if (!outlineLike) return false;
  if (/准备开始|正在获取|我先调用|系统纠错/.test(t) && t.length < 200) return false;
  saveOutline(novelId, branchId, t);
  console.warn(
    `[outline] recovered outline from assistant text (${t.length} chars)`,
  );
  return true;
}

export const outlineAgent = defineAgent("outline_writer-system.md", (config) => {
  const name = config.name;
  return async (ctx, llm, onChunk, onTrail) => {
    const isRewrite = isOutlineRewritePrompt(ctx.prompt);
    // Snapshot before round start (rewrite must see previous draft)
    const prevOutline = getOutline(ctx.novelId, ctx.branchId);
    const prevPlan = getForeshadowPlan(ctx.novelId, ctx.branchId);
    const prevLen = prevOutline ? String(prevOutline).trim().length : 0;

    beginOutlineRound(ctx.novelId, ctx.branchId, {
      keepOutline: isRewrite && prevLen >= 50,
    });

    // Create: strip get_outline so the model cannot "probe" empty store
    const allTools = resolveAgentToolSchemas(name);
    const TOOLS = isRewrite
      ? allTools
      : allTools.filter((t) => t.name !== "get_outline");

    let ideaBlock = "";
    // On rewrite, don't re-pick ideas unless task asks — focus on findings
    if (!isRewrite) {
      const selected = (ctx.selectedIdeaIds || []).slice(0, 3);
      if (selected.length > 0) {
        const ideas = selected
          .map((id) => getIdea(ctx.userId, id))
          .filter(Boolean);
        if (ideas.length) {
          ideaBlock =
            "\n\n## 用户已选定的点子（必须融入大纲，最多 3 条）\n" +
            ideas
              .map((i, n) => `${n + 1}. 【${i!.title}】${i!.content}`)
              .join("\n");
        }
      } else if (ctx.autoPickIdeas) {
        ideaBlock =
          "\n\n## 点子库\n用户未预选点子。你可调用 list_ideas / get_ideas 自行挑选最多 3 条并融入大纲。";
      }
    }

    const { system: sys, user: baseUser } = resolveAgentPrompt(name, "zh", {
        prompt: ctx.prompt,
        novelId: ctx.novelId,
        branchId: ctx.branchId,
        selectionInstruction: "",
      },
    );

    const ledger = getForeshadowingLedger(
      ctx.userId,
      ctx.novelId,
      ctx.branchId,
    );

    const modeHeader = isRewrite
      ? "【任务模式:rewrite】\n本轮是**改写已有大纲**，不是新写。\n"
      : "【任务模式:create】\n本轮是**新写大纲**。**禁止**调用 get_outline（本轮工具列表也不含它）。\n";

    let rewriteBlock = "";
    if (isRewrite) {
      const draft =
        prevLen >= 50
          ? String(prevOutline)
          : "（store 中无上一稿大纲：可 get_outline；若仍空则按 findings + 前文重建，并注明无上一稿）";
      rewriteBlock =
        "\n\n## 改写说明\n" +
        "1. 以下「上一稿」已注入；可再 get_outline 核对\n" +
        "2. 对照 findings 只改点名问题；保留仍成立的情节/角色/时空\n" +
        "3. save_outline 提交完整改写稿 + save_foreshadowing_plan\n\n" +
        `### 上一稿大纲（${prevLen} 字）\n` +
        "```\n" +
        draft.slice(0, 12000) +
        (draft.length > 12000 ? "\n…(已截断，完整版请 get_outline)\n" : "\n") +
        "```\n";
      if (prevPlan) {
        rewriteBlock +=
          "\n### 上一稿伏笔 plan（可参考后更新）\n" +
          JSON.stringify(prevPlan).slice(0, 2000) +
          "\n";
      }
    }
    console.log(
      `[outline] mode=${isRewrite ? "rewrite" : "create"} keepOutline=${isRewrite && prevLen >= 50} prevLen=${prevLen} tools=${TOOLS.map((t) => t.name).join(",")}`,
    );

    const ledgerBlock =
      "\n\n## 当前分支活跃伏笔账本\n" +
      formatLedgerForPrompt(ledger) +
      "\n\n## 落盘（必须用工具，程序只认 tool）\n" +
      (isRewrite
        ? "1. 按上一稿 + findings 改 → **save_outline**（完整改写稿）\n" +
          "2. **save_foreshadowing_plan**\n" +
          "3. 不要只写「修改说明」；save 的 content 必须是完整大纲正文\n"
        : "1. **不要** get_outline\n" +
          "2. 取语境后 **save_outline**（完整大纲正文）\n" +
          "3. **save_foreshadowing_plan**，plan=JSON 字符串 {plant,advance,reveal,abandon,rationale}\n" +
          "4. 不要指望聊天区最终回复被程序当大纲；未 save 即失败\n") +
      "成功后可简短确认，无需再贴全文。";

    const taskBlock =
      "\n\n## 本次任务\n" + String(ctx.prompt || "请为续写设计大纲。");

    const uc =
      modeHeader +
      (baseUser || "请为续写设计大纲。") +
      taskBlock +
      rewriteBlock +
      ideaBlock +
      ledgerBlock;

    const run = (user: string, maxSteps = 12) =>
      runSubAgentToolLoop(llm, sys, user, TOOLS, ctx, onChunk, onTrail, {
        maxTokens: 8192,
        temperature: isRewrite ? 0.35 : 0.4,
        maxSteps,
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
    let outlineOk =
      toolSaveSucceeded(trail, "save_outline", SAVE_OUTLINE_OK).ok ||
      outlineInStore(ctx.novelId, ctx.branchId);
    let planOk =
      toolSaveSucceeded(trail, "save_foreshadowing_plan", SAVE_FS_PLAN_OK).ok ||
      planInStore(ctx.novelId, ctx.branchId);

    // If rewrite only got trail save but store still old+same — still ok if saved
    if (
      !outlineOk &&
      tryRecoverOutlineFromText(loop.finalText, ctx.novelId, ctx.branchId)
    ) {
      outlineOk = true;
      trail = trail.concat({
        role: "tool_result",
        toolName: "save_outline",
        content: `${SAVE_OUTLINE_OK}（从聊天正文兜底）`,
      } as TrailMessage);
    }

    if (!outlineOk || !planOk) {
      const missing = [
        !outlineOk ? "save_outline" : "",
        !planOk ? "save_foreshadowing_plan" : "",
      ]
        .filter(Boolean)
        .join("、");
      console.warn(
        `[outline] missing saves: ${missing}; focused retry (no re-fetch)`,
      );

      const draftHint = outlineInStore(ctx.novelId, ctx.branchId)
        ? "大纲已在 store；只需补 save_foreshadowing_plan。"
        : isRewrite && prevLen >= 50
          ? `改写模式：请基于下列上一稿按 findings 修改后 save_outline：\n---\n${String(prevOutline).slice(0, 6000)}\n---`
          : loop.finalText && loop.finalText.length > 80
            ? `若你上轮已写好大纲，请把下列草稿原样 save_outline：\n---\n${loop.finalText.slice(0, 6000)}\n---`
            : "请根据已知语境直接 save_outline（完整大纲正文）+ save_foreshadowing_plan。";

      const retryUc = `## 系统纠错（只补保存，不要再 get_branch_*）
你尚未成功调用：${missing}。
${isRewrite ? "这是改写任务：不要从零新写；在上一稿上改 findings。\n" : ""}
${draftHint}

硬性要求：
1. 立刻调用缺失工具，不要旁白、不要再取数。
2. save_outline content = 完整结构文（≥100 字）。
3. save_foreshadowing_plan plan = JSON 字符串。`;

      const second = await run(retryUc, 6);
      if (second.askUser) {
        return {
          content: second.finalText || "关键数据缺失，已直接询问用户。",
          messages: trail.concat(second.trail),
          askUser: second.askUser,
        };
      }
      trail = trail.concat(
        {
          role: "assistant",
          content: `（系统：请补全 ${missing}）`,
        } as TrailMessage,
        ...second.trail.filter((m) => m.role !== "system"),
      );
      if (
        !outlineInStore(ctx.novelId, ctx.branchId) &&
        tryRecoverOutlineFromText(second.finalText, ctx.novelId, ctx.branchId)
      ) {
        trail = trail.concat({
          role: "tool_result",
          toolName: "save_outline",
          content: `${SAVE_OUTLINE_OK}（从重试聊天正文兜底）`,
        } as TrailMessage);
      }
      outlineOk =
        toolSaveSucceeded(trail, "save_outline", SAVE_OUTLINE_OK).ok ||
        outlineInStore(ctx.novelId, ctx.branchId);
      planOk =
        toolSaveSucceeded(trail, "save_foreshadowing_plan", SAVE_FS_PLAN_OK)
          .ok || planInStore(ctx.novelId, ctx.branchId);
    }

    const saved = getOutline(ctx.novelId, ctx.branchId);
    const plan = getForeshadowPlan(ctx.novelId, ctx.branchId);
    if (!saved || String(saved).length < 50) {
      return {
        content: `大纲生成失败：未成功 save_outline（${
          toolSaveSucceeded(trail, "save_outline", SAVE_OUTLINE_OK).detail ||
          "未调用或参数解析失败"
        }）。`,
        messages: trail,
      };
    }

    const len = String(saved).length;
    const p = plan;
    return {
      content:
        (isRewrite ? "大纲已按审核意见改写并 save_outline" : "大纲已生成并 save_outline") +
        `（${len} 字）。` +
        `伏笔 plan: plant=${p?.plant?.length ?? 0} reveal=${p?.reveal?.length ?? 0}` +
        (planOk ? "（已 save_foreshadowing_plan）" : "（plan 未存，可再调）") +
        `。主 agent 用 get_outline 取可读全文。系统将自动 review_outline。`,
      messages: trail,
    };
  };
});
