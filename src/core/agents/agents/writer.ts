import type { AgentDef, TrailMessage } from "../types";
import { runSubAgentToolLoop } from "../tool-loop";
import { getProse } from "../intermediate-store";
import { resolveAgentPrompt } from "@/core/prompts/resolve-agent-prompt";
import { branchTools } from "./branch-tools";
import { intermediateReadTools, saveProseTool } from "./intermediate-tools";
import { foreshadowTools } from "./foreshadow-tools";
import { getStyle } from "@/lib/db";
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

const FS_READ = foreshadowTools
  .filter(t =>
    t.name === "get_foreshadowing_ledger" ||
    t.name === "get_foreshadowing_plan",
  )
  .map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters as Record<string, unknown>,
  }));

/** Create: outline + branch + form + foreshadow + save_prose */
const CREATE_TOOLS = [
  ...schemas([
    "get_outline",
    "get_branch_text",
    "get_branch_characters",
    "get_branch_timeline",
    "get_branch_world",
    "get_branch_meta",
    "get_novel_form",
  ]),
  ...FS_READ,
  SAVE_SCHEMA,
];

/** Rewrite: prose + findings + form + save_prose */
const REWRITE_TOOLS = [
  ...schemas(["get_prose", "get_findings", "get_branch_text", "get_novel_form"]),
  ...FS_READ,
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
          content: "修改失败：store 中没有可改的正文。",
          messages: [],
          askUser: {
            question: "写手无法获取待改正文草稿，是否继续？",
            options: ["先写正文再改", "取消", "仍要继续（不推荐）"],
            missKind: "prose",
            toolName: "get_prose",
          },
        };
      }
      if (looksLikeFindingsNotProse(existingProse) || looksLikeRevisionPlanNotProse(existingProse)) {
        return {
          content: "修改失败：store 中的「正文」无效（像清单或修改计划）。",
          messages: [],
          askUser: {
            question: "待改正文无效（不像叙事正文），是否重新创作？",
            options: ["重新 MODE:create 写作", "取消"],
            missKind: "prose",
          },
        };
      }
    }

    const agentId = isRewrite ? "writer_rewrite" : "writer_create";
    const { system: sys, user: baseUser } = resolveAgentPrompt(agentId, "zh", {
      prompt: ctx.prompt,
      novelId: ctx.novelId,
      branchId: ctx.branchId,
    });
    const tools = isRewrite ? REWRITE_TOOLS : CREATE_TOOLS;

    let styleBlock = "";
    if (ctx.selectedStyleId) {
      const st = getStyle(ctx.userId, ctx.selectedStyleId);
      if (st) {
        const s = st.style;
        styleBlock =
          `\n\n## 选用风格：${st.name}\n` +
          `${st.description || s.styleDescription || ""}\n` +
          `类型：${s.genre || ""} · 基调：${s.tone || ""}\n` +
          `语言：${s.languageFeatures || ""}\n` +
          `节奏：${s.pacingDescription || ""}\n` +
          `手法：${(s.narrativeTechniques || []).join("、")}\n` +
          (s.examplePassages?.length
            ? `范例：\n${s.examplePassages.map(p => `【${p.aspect}】${(p.text || "").slice(0, 300)}`).join("\n")}\n`
            : "") +
          `请严格模仿上述文风写作。`;
      }
    }

    const uc = baseUser + styleBlock;

    const run = (user: string) =>
      runSubAgentToolLoop(
        llm, sys, user, tools, ctx, onChunk, onTrail,
        { maxTokens: isRewrite ? 8192 : 6144, temperature: isRewrite ? 0.4 : 0.5 },
      );

    let loop = await run(uc);
    if (loop.askUser) {
      return {
        content: loop.finalText || "关键数据缺失，已请求用户确认。",
        messages: loop.trail,
        askUser: loop.askUser,
      };
    }
    let { trail } = loop;
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
      if (second.askUser) {
        return {
          content: second.finalText || "关键数据缺失，已请求用户确认。",
          messages: trail.concat(second.trail),
          askUser: second.askUser,
        };
      }
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
