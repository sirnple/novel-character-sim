import type { TrailMessage } from "../types";
import { defineAgent } from "../agent-registry";
import { runSubAgentToolLoop } from "../tool-loop";
import {
  getFindings,
  getForeshadowRealization,
} from "../intermediate-store";
import {
  resolveAgentPrompt,
  resolveAgentToolSchemas,
} from "@/core/prompts/resolve-agent-prompt";
import { writeTargetUserPrompt } from "../write-target";
import { SAVE_FINDINGS_OK } from "./intermediate-tools";
import { SAVE_FS_REALIZATION_OK } from "./foreshadow-tools";
import { getStoryInfo } from "@/lib/db";
import { toolSaveSucceeded } from "../save-verify";

/** findings dimension code → system md (name comes from that file's frontmatter). */
const REVIEW_SYSTEM_FILES: Record<string, string> = {
  character: "character_consistency_review-system.md",
  continuity: "continuity_review-system.md",
  foreshadowing: "foreshadowing_review-system.md",
  style: "style_review-system.md",
  world: "world_review-system.md",
  pacing: "pacing_review-system.md",
  ai_taste: "ai_review-system.md",
};

function makeReviewAgent(dimensionName: string, dimensionCode: string) {
  const systemFile =
    REVIEW_SYSTEM_FILES[dimensionCode] || REVIEW_SYSTEM_FILES.character;
  return defineAgent(systemFile, (config) => {
    const name = config.name;
    return async (ctx, llm, _onChunk, onTrail) => {
      // User message: novelId/branchId only. Prose/branch text via get_prose / get_branch_*.
      let genreHint = "";
      if (dimensionCode === "continuity" || dimensionCode === "world") {
        const info = getStoryInfo(ctx.userId, ctx.novelId);
        const genre = info?.writingStyle?.genre || "";
        const themes = info?.themes?.join("、") || "";
        genreHint =
          `\n\n## 本书类型\n` +
          `- genre: ${genre || "（未提取，默认中档）"}\n` +
          `- themes: ${themes || "—"}\n`;
      }

      let styleHint = "";
      if (dimensionCode === "style") {
        styleHint = ctx.selectedStyleId
          ? `\n\n## 选用文风\nstyleId=\`${ctx.selectedStyleId}\`（用 get_style 取全文）\n`
          : "";
      }

      const isFs = dimensionCode === "foreshadowing";
      const { system: sys } = resolveAgentPrompt(name, "zh", {
        novelId: ctx.novelId,
        branchId: ctx.branchId,
        dimensionName,
        dimensionCode,
      });
      const uc =
        writeTargetUserPrompt(ctx.novelId, ctx.branchId) +
        genreHint +
        styleHint;
      const tools = resolveAgentToolSchemas(name);

      const run = (user: string) =>
        runSubAgentToolLoop(llm, sys, user, tools, ctx, undefined, onTrail, {
          maxTokens: 8192,
          temperature: 0.35,
          maxSteps: isFs ? 12 : 10,
          stopOnToolSuccess: isFs
            ? {
                toolName: "save_foreshadowing_realization",
                okMarker: SAVE_FS_REALIZATION_OK,
              }
            : {
                toolName: "save_findings",
                okMarker: SAVE_FINDINGS_OK,
              },
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
      const marker = isFs ? SAVE_FS_REALIZATION_OK : SAVE_FINDINGS_OK;
      const toolName = isFs
        ? "save_foreshadowing_realization"
        : "save_findings";
      let saved = toolSaveSucceeded(trail, toolName, marker);

      if (!saved.ok) {
        const retryUc = `${uc}

## 系统纠错
你尚未成功 ${toolName}。请先 get_prose（及本维所需 get_branch_*），再调用 ${toolName}。`;
        const second = await run(retryUc);
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
            content: `（系统：请调用 ${toolName}）`,
          } as TrailMessage,
          ...second.trail.filter((m) => m.role !== "system"),
        );
        saved = toolSaveSucceeded(trail, toolName, marker);
      }

      if (!saved.ok) {
        return {
          content: `${dimensionName}: 失败——未成功 ${toolName}。`,
          messages: trail,
        };
      }

      if (isFs) {
        const r = getForeshadowRealization(ctx.novelId, ctx.branchId);
        const n = r?.findings?.length || 0;
        return {
          content:
            `伏笔追踪: pass=${r?.pass ?? "?"}，findings=${n}（已 save_foreshadowing_realization）。` +
            `主 agent 可用 get_findings。Accept 后按 realized 落定账本。`,
          messages: trail,
        };
      }

      const all = getFindings(ctx.novelId, ctx.branchId).filter(
        (f) => f.dimension === dimensionCode,
      );
      return {
        content: `${dimensionName}: ${all.length} findings（已 save_findings）。主 agent 可用 get_findings。`,
        messages: trail,
      };
    };
  });
}

export const reviewCharacterAgent = makeReviewAgent("角色一致性", "character");
export const reviewContinuityAgent = makeReviewAgent("连贯与逻辑", "continuity");
export const reviewForeshadowingAgent = makeReviewAgent(
  "伏笔追踪",
  "foreshadowing",
);
export const reviewStyleAgent = makeReviewAgent("风格一致性", "style");
export const reviewWorldAgent = makeReviewAgent("世界观", "world");
export const reviewPacingAgent = makeReviewAgent("节奏", "pacing");
export const reviewAiTasteAgent = makeReviewAgent("AI生成痕迹", "ai_taste");
