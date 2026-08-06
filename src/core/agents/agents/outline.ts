import type { Agent, TrailMessage } from "../types";
import { defineAgent } from "../agent-registry";
import {
  resolveAgentPrompt,
  resolveAgentToolSchemas,
} from "@/core/prompts/resolve-agent-prompt";
import { writeTargetUserPrompt } from "../write-target";
import { runSubAgentToolLoop } from "../tool-loop";
import {
  getOutline,
  getForeshadowPlan,
  beginOutlineRound,
  saveOutline,
} from "../intermediate-store";
import { SAVE_OUTLINE_OK } from "./intermediate-tools";
import { SAVE_FS_PLAN_OK } from "./foreshadow-tools";
import { getIdea } from "@/lib/db";
import { toolSaveSucceeded } from "../save-verify";
import { markIdeasPending, getUsedIdeaIds } from "../intermediate-store";

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

/** Shared outline loop; one Agent per system md (create vs rewrite). */
function makeOutlineAgent(systemFile: string): Agent {
  return defineAgent(systemFile, (config) => {
    const name = config.name;
    const isRewrite = config.name === "outline_rewriter";
    return async (ctx, llm, onChunk, onTrail) => {
      // Snapshot before round start (rewrite keepOutline so get_outline still works)
      const prevOutline = getOutline(ctx.novelId, ctx.branchId);
      const prevLen = prevOutline ? String(prevOutline).trim().length : 0;

      beginOutlineRound(ctx.novelId, ctx.branchId, {
        keepOutline: isRewrite && prevLen >= 50,
      });

      const TOOLS = resolveAgentToolSchemas(name);

      let ideaBlock = "";
      let selectedIdeaIdsForMark: string[] = [];
      // On rewrite, don't re-pick ideas unless task asks — focus on findings
      if (!isRewrite) {
        const used = new Set(getUsedIdeaIds(ctx.novelId, ctx.branchId));
        const selected = (ctx.selectedIdeaIds || [])
          .slice(0, 3)
          .filter((id) => !used.has(id));
        if (selected.length > 0) {
          const ideas = selected
            .map((id) => getIdea(ctx.userId, id))
            .filter(Boolean);
          if (ideas.length) {
            selectedIdeaIdsForMark = ideas.map((i) => i!.id);
            ideaBlock =
              "\n\n## 用户已选定的点子（必须融入大纲，最多 3 条；已排除本分支用过的）\n" +
              ideas
                .map((i, n) => {
                  const fromThis =
                    !!ctx.novelId && i!.sourceNovelId === ctx.novelId;
                  const src = fromThis
                    ? "本书·慎用"
                    : i!.sourceNovelTitle || i!.sourceNovelId || "跨书/手工";
                  return `${n + 1}. 【${i!.title}】（${src}）${i!.content}`;
                })
                .join("\n");
          }
        } else if (ctx.autoPickIdeas) {
          ideaBlock =
            "\n\n## 点子库\n" +
            "可选：list_ideas（默认**非本书**、排除已用）→ get_ideas 最多 3 条。\n" +
            "若非本书库为空或已用尽：**直接自行创作**续写灵感，基于分支人物/冲突/伏笔推进；" +
            "不要 scope=book 复述原文，无库不是失败。";
        } else {
          // 未开 autoPick：也不依赖库，默认自创
          ideaBlock =
            "\n\n## 点子\n未预选点子库条目。请**自行设计**本轮剧情推进（接前文），无需强行 list_ideas。";
        }
      }

      // User message = session binding only; outline/findings via tools (get_outline / get_findings)
      const { system: sys } = resolveAgentPrompt(name, "zh", {
        novelId: ctx.novelId,
        branchId: ctx.branchId,
      });

      console.log(
        `[outline] agent=${name} keepOutline=${isRewrite && prevLen >= 50} prevLen=${prevLen} tools=${TOOLS.map((t) => t.name).join(",")}`,
      );

      const uc =
        writeTargetUserPrompt(ctx.novelId, ctx.branchId) + ideaBlock;

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
        toolSaveSucceeded(trail, "save_foreshadowing_plan", SAVE_FS_PLAN_OK)
          .ok || planInStore(ctx.novelId, ctx.branchId);

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
          : isRewrite
            ? "改写：先 get_outline + get_findings，再按 findings 改完整稿 save_outline + save_foreshadowing_plan。"
            : loop.finalText && loop.finalText.length > 80
              ? `若你上轮已写好大纲，请把下列草稿原样 save_outline：\n---\n${loop.finalText.slice(0, 6000)}\n---`
              : "请根据已知语境直接 save_outline（完整大纲正文）+ save_foreshadowing_plan。";

        const retryUc = `## 系统纠错
你尚未成功调用：${missing}。
${isRewrite ? "改写任务：用 get_outline / get_findings 取数，不要从零新写。\n" : ""}
${draftHint}

硬性要求：
1. 立刻调用缺失工具。
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

      // Stage idea candidates only — mark used on accept_continuation, not here
      if (!isRewrite && selectedIdeaIdsForMark.length) {
        markIdeasPending(ctx.novelId, ctx.branchId, selectedIdeaIdsForMark);
      }

      const len = String(saved).length;
      const p = plan;
      return {
        content:
          (isRewrite
            ? "大纲已按审核意见改写并 save_outline"
            : "大纲已生成并 save_outline") +
          `（${len} 字）。` +
          `伏笔 plan: plant=${p?.plant?.length ?? 0} reveal=${p?.reveal?.length ?? 0}` +
          (planOk ? "（已 save_foreshadowing_plan）" : "（plan 未存，可再调）") +
          `。主 agent 用 get_outline 取可读全文。系统将自动 outline_reviewer。`,
        messages: trail,
      };
    };
  });
}

export const outlineCreateAgent = makeOutlineAgent("outline_creator.md");
export const outlineRewriteAgent = makeOutlineAgent("outline_rewriter.md");
/** @deprecated use outlineCreateAgent */
export const outlineAgent = outlineCreateAgent;
