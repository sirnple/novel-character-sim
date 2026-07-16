import type { AgentDef, TrailMessage } from "../types";
import { runSubAgentToolLoop } from "../tool-loop";
import { getFindings, getForeshadowRealization } from "../intermediate-store";
import { resolveAgentPrompt } from "@/core/prompts/resolve-agent-prompt";
import { branchTools } from "./branch-tools";
import { intermediateReadTools, intermediateTools, SAVE_FINDINGS_OK } from "./intermediate-tools";
import { foreshadowTools, SAVE_FS_REALIZATION_OK } from "./foreshadow-tools";
import { getStoryInfo } from "@/lib/db";
import { toolSaveSucceeded } from "../save-verify";

const READ_TOOLS = [
  ...branchTools,
  ...intermediateReadTools.filter((t) => t.name === "get_prose"),
].map((t) => ({
  name: t.name,
  description: t.description,
  parameters: t.parameters as Record<string, unknown>,
}));

const SAVE_FINDINGS_TOOL = intermediateTools
  .filter((t) => t.name === "save_findings")
  .map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters as Record<string, unknown>,
  }));

const REVIEW_TOOLS = [...READ_TOOLS, ...SAVE_FINDINGS_TOOL];

const FORESHADOW_TOOLS = [
  ...READ_TOOLS,
  ...foreshadowTools
    .filter(
      (t) =>
        t.name === "get_foreshadowing_ledger" ||
        t.name === "get_foreshadowing_plan" ||
        t.name === "save_foreshadowing_realization",
    )
    .map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters as Record<string, unknown>,
    })),
];

const REVIEW_AGENT_IDS: Record<string, string> = {
  character: "character_consistency_review",
  continuity: "continuity_review",
  foreshadowing: "foreshadowing_review",
  style: "style_review",
  world: "world_review",
  pacing: "pacing_review",
};

function makeReviewAgent(dimensionName: string, dimensionCode: string): AgentDef {
  return {
    execute: async (ctx, llm, _onChunk, onTrail) => {
      const agentId = REVIEW_AGENT_IDS[dimensionCode] || "character_consistency_review";
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

      const isFs = dimensionCode === "foreshadowing";
      const saveHint = isFs
        ? `\n\n## 落盘（必须）\n取证后**必须**调用 save_foreshadowing_realization，参数 realization 为 JSON 字符串（含 pass/findings/realized/gaps）。` +
          `不要在聊天里贴完整 JSON；程序只认 tool 成功。工具会返回人类可读摘要。\n`
        : `\n\n## 落盘（必须）\n取证后**必须**调用 save_findings：\n` +
          `- dimension: "${dimensionCode}"\n` +
          `- findings: JSON 数组字符串，无问题用 "[]"\n` +
          `不要在聊天里贴 JSON；程序只认 save_findings 成功。\n`;

      const { system: sys, user: baseUc } = resolveAgentPrompt(agentId, "zh", {
        prompt: ctx.prompt,
        novelId: ctx.novelId,
        branchId: ctx.branchId,
        dimensionName,
        dimensionCode,
      });
      const uc = baseUc + genreHint + saveHint;
      const tools = isFs ? FORESHADOW_TOOLS : REVIEW_TOOLS;

      const run = (user: string) =>
        runSubAgentToolLoop(llm, sys, user, tools, ctx, undefined, onTrail, {
          maxTokens: 4096,
          temperature: 0.2,
        });

      let { trail } = await run(uc);
      const marker = isFs ? SAVE_FS_REALIZATION_OK : SAVE_FINDINGS_OK;
      const toolName = isFs ? "save_foreshadowing_realization" : "save_findings";
      let saved = toolSaveSucceeded(trail, toolName, marker);

      if (!saved.ok) {
        const retryUc = `${uc}

## 系统纠错
你尚未成功 ${toolName}。请立刻调用该工具提交本维结果（无问题也要 findings=[] 或对应空结构）。`;
        const second = await run(retryUc);
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

      const all = getFindings(ctx.novelId, ctx.branchId).filter((f) => f.dimension === dimensionCode);
      return {
        content: `${dimensionName}: ${all.length} findings（已 save_findings）。主 agent 可用 get_findings。`,
        messages: trail,
      };
    },
  };
}

export const reviewCharacterAgent = makeReviewAgent("角色一致性", "character");
export const reviewContinuityAgent = makeReviewAgent("连贯与逻辑", "continuity");
export const reviewForeshadowingAgent = makeReviewAgent("伏笔追踪", "foreshadowing");
export const reviewStyleAgent = makeReviewAgent("风格一致性", "style");
export const reviewWorldAgent = makeReviewAgent("世界观", "world");
export const reviewPacingAgent = makeReviewAgent("节奏", "pacing");
