import type { AgentDef, TrailMessage } from "../types";
import { runSubAgentToolLoop } from "../tool-loop";
import { getProse } from "../intermediate-store";
import { renderPrompt } from "@/core/prompts/renderer";
import { branchTools } from "./branch-tools";
import { intermediateReadTools, saveProseTool } from "./intermediate-tools";
import {
  looksLikeFindingsNotProse,
  looksLikeRevisionPlanNotProse,
  SAVE_PROSE_OK_PREFIX,
  SAVE_PROSE_REJECT_PREFIX,
} from "../prose-guard";

function schemas(
  names: string[],
  extra: { name: string; description: string; parameters: Record<string, unknown> }[] = [],
) {
  const fromBranch = branchTools
    .filter(t => names.includes(t.name))
    .map(t => ({ name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown> }));
  const fromInter = intermediateReadTools
    .filter(t => names.includes(t.name))
    .map(t => ({ name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown> }));
  return [...fromBranch, ...fromInter, ...extra];
}

const SAVE_SCHEMA = {
  name: saveProseTool.name,
  description: saveProseTool.description,
  parameters: saveProseTool.parameters as Record<string, unknown>,
};

/** Create: outline + branch + save_prose */
const CREATE_TOOLS = [
  ...schemas([
    "get_outline",
    "get_branch_text",
    "get_branch_characters",
    "get_branch_timeline",
    "get_branch_world",
  ]),
  SAVE_SCHEMA,
];

/** Rewrite: prose + findings + save_prose */
const REWRITE_TOOLS = [
  ...schemas(["get_prose", "get_findings", "get_branch_text"]),
  SAVE_SCHEMA,
];

/** Did the agent successfully call save_prose? (tool_result in trail) */
function findSaveProseOutcome(trail: TrailMessage[]): {
  called: boolean;
  accepted: boolean;
  rejected: boolean;
  detail: string;
} {
  const results = trail.filter(m => m.role === "tool_result" && m.toolName === "save_prose");
  if (results.length === 0) {
    return { called: false, accepted: false, rejected: false, detail: "" };
  }
  const last = results[results.length - 1];
  const detail = last.content || "";
  const accepted = detail.includes(SAVE_PROSE_OK_PREFIX);
  const rejected = detail.includes(SAVE_PROSE_REJECT_PREFIX);
  return { called: true, accepted, rejected, detail };
}

export const writerAgent: AgentDef = {
  execute: async (ctx, llm, onChunk, onTrail) => {
    const isRewrite = ctx.prompt.includes("[MODE:rewrite]");
    const existingProse = getProse(ctx.novelId, ctx.branchId) || "";

    // Preflight store (agent still loads via tools for a visible trail)
    if (isRewrite) {
      if (!existingProse || existingProse.length < 50) {
        return {
          content: "修改失败：store 中没有可改的正文。请先 [MODE:create] 完成 write_prose。",
          messages: [],
        };
      }
      if (looksLikeFindingsNotProse(existingProse) || looksLikeRevisionPlanNotProse(existingProse)) {
        return {
          content: "修改失败：store 中的「正文」无效（像清单或修改计划）。请重新 [MODE:create] 后再 rewrite。",
          messages: [],
        };
      }
    }

    const sys = isRewrite
      ? renderPrompt("writer-rewrite-system.md", {})
      : renderPrompt("writer-create-system.md", {});
    const tools = isRewrite ? REWRITE_TOOLS : CREATE_TOOLS;

    const uc = renderPrompt(
      isRewrite ? "writer-rewrite-user.md" : "writer-create-user.md",
      { prompt: ctx.prompt, novelId: ctx.novelId, branchId: ctx.branchId },
    );

    const run = (user: string) =>
      runSubAgentToolLoop(
        llm, sys, user, tools, ctx, onChunk, onTrail,
        { maxTokens: isRewrite ? 8192 : 6144, temperature: isRewrite ? 0.4 : 0.5 },
      );

    let { trail } = await run(uc);
    let outcome = findSaveProseOutcome(trail);

    // One retry if agent forgot save or content was rejected
    if (!outcome.accepted) {
      const why = !outcome.called
        ? "你没有调用 save_prose"
        : outcome.rejected
          ? `save_prose 被拒绝：${outcome.detail}`
          : "save_prose 未成功";
      console.warn(`[writer] save verify failed: ${why}; retrying`);

      const retryUc = `${uc}

## 系统纠错
${why}。
请重新按步骤取数（如需），然后**必须**调用 save_prose，content 为完整小说叙事正文。
禁止只输出修改计划或闲聊而不 save。`;

      const second = await run(retryUc);
      trail = trail.concat(
        { role: "assistant", content: `（系统：${why}，已要求重新 save_prose）` } as TrailMessage,
        ...second.trail.filter(m => m.role !== "system"),
      );
      outcome = findSaveProseOutcome(trail);
    }

    // Verify only — never auto-save here
    if (!outcome.accepted) {
      const proseNow = getProse(ctx.novelId, ctx.branchId);
      const hint = !outcome.called
        ? "agent 未调用 save_prose"
        : outcome.rejected
          ? `save_prose 被拒绝（${outcome.detail}）`
          : "save_prose 未成功";
      return {
        content: isRewrite
          ? `正文修改失败：${hint}；已保留原正文。`
          : `正文生成失败：${hint}。`,
        messages: trail,
      };
    }

    const saved = getProse(ctx.novelId, ctx.branchId) || "";
    console.log(`[writer] verified save_prose ${ctx.novelId}/${ctx.branchId} len=${saved.length} rewrite=${isRewrite}`);

    return {
      content: isRewrite
        ? `正文已按审查意见修改（agent 已 save_prose，${saved.length} 字）。主 agent 勿取正文。`
        : `正文已创建（agent 已 save_prose，${saved.length} 字）。主 agent 勿取正文。`,
      messages: trail,
    };
  },
};
