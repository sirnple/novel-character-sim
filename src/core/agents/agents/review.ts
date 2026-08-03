import type { Agent, TrailMessage } from "../types";
import { defineAgent } from "../agent-registry";
import { runSubAgentToolLoop } from "../tool-loop";
import {
  getFindings,
  getForeshadowRealization,
  getProse,
} from "../intermediate-store";
import {
  resolveAgentPrompt,
  resolveAgentToolSchemas,
} from "@/core/prompts/resolve-agent-prompt";
import { SAVE_FINDINGS_OK } from "./intermediate-tools";
import { SAVE_FS_REALIZATION_OK } from "./foreshadow-tools";
import { getBranchProse, getStoryInfo } from "@/lib/db";
import { toolSaveSucceeded } from "../save-verify";

/** findings dimension code → system md (name comes from that file's frontmatter). */
const REVIEW_SYSTEM_FILES: Record<string, string> = {
  character: "character_consistency_review-system.md",
  continuity: "continuity_review-system.md",
  foreshadowing: "foreshadowing_review-system.md",
  style: "style_review-system.md",
  world: "world_review-system.md",
  pacing: "pacing_review-system.md",
};

/** Injected branch tip for reviews (short). get_branch_text default 30k is for writer context, not review. */
const REVIEW_BRANCH_TAIL = 4_000;
const REVIEW_PROSE_CAP = 24_000;

function buildReviewMaterialInject(
  userId: string,
  novelId: string,
  branchId: string,
): string {
  const prose = (getProse(novelId, branchId) || "").trim();
  const { text } = getBranchProse(userId, novelId, branchId);
  const tail = (text || "").slice(-REVIEW_BRANCH_TAIL);
  const parts: string[] = ["\n\n## 程序注入材料（优先直接用，减少重复 get_*）\n"];
  if (prose.length >= 20) {
    const body =
      prose.length > REVIEW_PROSE_CAP
        ? prose.slice(0, REVIEW_PROSE_CAP) +
          `\n…（正文共 ${prose.length} 字，已截断）`
        : prose;
    parts.push(`### 当前正文草稿（${prose.length} 字）\n\n${body}\n`);
  } else {
    parts.push("### 当前正文草稿\n（store 中无可用正文；可用 get_prose 再试）\n");
  }
  if (tail) {
    parts.push(
      `### 前文末尾（约 ${tail.length} 字，承接点）\n\n${tail}\n`,
    );
  } else {
    parts.push("### 前文末尾\n（本分支暂无前文）\n");
  }
  return parts.join("\n");
}

function makeReviewAgent(dimensionName: string, dimensionCode: string): Agent {
  const systemFile =
    REVIEW_SYSTEM_FILES[dimensionCode] || REVIEW_SYSTEM_FILES.character;
  return defineAgent(systemFile, (config) => {
    const name = config.name;
    return async (ctx, llm, _onChunk, onTrail) => {
      let genreHint = "";
      if (dimensionCode === "continuity" || dimensionCode === "world") {
        const info = getStoryInfo(ctx.userId, ctx.novelId);
        const genre = info?.writingStyle?.genre || "";
        const themes = info?.themes?.join("、") || "";
        genreHint =
          `\n\n## 本书类型（系统注入）\n` +
          `- genre: ${genre || "（未提取，默认中档）"}\n` +
          `- themes: ${themes || "—"}\n`;
      }

      // Style review: must fetch style via tools (do not inject full profile)
      let styleHint = "";
      if (dimensionCode === "style") {
        styleHint = ctx.selectedStyleId
          ? `\n\n## 文风对照（必须用工具）\n` +
            `用户选用 styleId=\`${ctx.selectedStyleId}\`。\n` +
            `审查前必做：**get_style(id="${ctx.selectedStyleId}")** 或 **get_style()**，再对照正文。\n`
          : `\n\n## 文风对照（必须用工具）\n` +
            `未预选风格：先 **list_styles**，再 **get_style**；优先本书来源，再对照正文。\n`;
      }

      const materialInject = buildReviewMaterialInject(
        ctx.userId,
        ctx.novelId,
        ctx.branchId,
      );

      const isFs = dimensionCode === "foreshadowing";
      const saveHint = isFs
        ? `\n\n## 落盘（必须）\n取证后**必须**调用 save_foreshadowing_realization，参数 realization 为 JSON 字符串（含 pass/findings/realized/gaps）。` +
          `不要在聊天里贴完整 JSON；程序只认 tool 成功。工具会返回人类可读摘要。\n`
        : `\n\n## 落盘（必须）\n取证后**必须**调用 save_findings：\n` +
          `- dimension: "${dimensionCode}"（只写本维）\n` +
          `- overwrite: true\n` +
          `- findings: JSON 数组字符串；有问题就写清，真正无问题才用 "[]"\n` +
          `不要在聊天里贴 JSON；程序只认 save_findings 成功。落盘成功后停止。\n`;

      const { system: sys, user: baseUc } = resolveAgentPrompt(name, "zh", {
        prompt: ctx.prompt,
        novelId: ctx.novelId,
        branchId: ctx.branchId,
        dimensionName,
        dimensionCode,
      });
      const uc =
        baseUc + materialInject + genreHint + styleHint + saveHint;
      // tools allowlist from review-*-system.md frontmatter
      const tools = resolveAgentToolSchemas(name);

      const run = (user: string) =>
        runSubAgentToolLoop(llm, sys, user, tools, ctx, undefined, onTrail, {
          maxTokens: 8192,
          temperature: 0.35,
          maxSteps: isFs ? 12 : 10,
          // Stop as soon as findings are saved — avoids extra idle LLM rounds
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
      const toolName = isFs ? "save_foreshadowing_realization" : "save_findings";
      let saved = toolSaveSucceeded(trail, toolName, marker);

      if (!saved.ok) {
        const retryUc = `${uc}

## 系统纠错
你尚未成功 ${toolName}。请立刻调用该工具提交本维结果（有问题写 findings；确无问题才 findings=[]）。`;
        const second = await run(retryUc);
        if (second.askUser) {
          return {
            content: second.finalText || "关键数据缺失，已直接询问用户。",
            messages: trail.concat(second.trail),
            askUser: second.askUser,
          };
        }
        trail = trail.concat(
          { role: "assistant", content: `（系统：请调用 ${toolName}）` } as TrailMessage,
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
export const reviewForeshadowingAgent = makeReviewAgent("伏笔追踪", "foreshadowing");
export const reviewStyleAgent = makeReviewAgent("风格一致性", "style");
export const reviewWorldAgent = makeReviewAgent("世界观", "world");
export const reviewPacingAgent = makeReviewAgent("节奏", "pacing");
