import type { Agent, TrailMessage } from "../types";
import { defineAgent } from "../agent-registry";
import { runSubAgentToolLoop } from "../tool-loop";
import {
  formatFindingsReadable,
  getFindings,
  getProse,
  saveProse,
} from "../intermediate-store";
import {
  resolveAgentPrompt,
  resolveAgentToolSchemas,
} from "@/core/prompts/resolve-agent-prompt";
import { writeTargetUserPrompt } from "../write-target";
import {
  looksLikeFindingsNotProse,
  looksLikeRevisionPlanNotProse,
  validateProseContent,
  SAVE_PROSE_OK_PREFIX,
  SAVE_PROSE_REJECT_PREFIX,
} from "../prose-guard";

/** Did the agent successfully call save_prose? (tool_result in trail) */
function findSaveProseOutcome(trail: TrailMessage[]): {
  called: boolean;
  accepted: boolean;
  rejected: boolean;
  detail: string;
} {
  const results = trail.filter(
    (m) => m.role === "tool_result" && m.toolName === "save_prose",
  );
  if (results.length === 0) {
    return { called: false, accepted: false, rejected: false, detail: "" };
  }
  const last = results[results.length - 1];
  const detail = last.content || "";
  const accepted = detail.includes(SAVE_PROSE_OK_PREFIX);
  const rejected = detail.includes(SAVE_PROSE_REJECT_PREFIX);
  return { called: true, accepted, rejected, detail };
}

/**
 * Recover when the model wrote full prose in the chat turn but never called save_prose.
 * (Common failure: "准备开始写" then long narrative as final text.)
 */
function tryRecoverProseFromTrail(
  trail: TrailMessage[],
  novelId: string,
  branchId: string,
  isRewrite: boolean,
): { ok: boolean; len: number; note: string } {
  const candidates: string[] = [];
  for (let i = trail.length - 1; i >= 0; i--) {
    const m = trail[i];
    if (m.role === "assistant" && m.content && m.content.length >= 80) {
      candidates.push(m.content);
    }
    if (candidates.length >= 4) break;
  }
  // Prefer longest assistant blob
  candidates.sort((a, b) => b.length - a.length);
  const previous = getProse(novelId, branchId);
  const previousProse =
    isRewrite &&
    previous &&
    previous.length > 500 &&
    !looksLikeFindingsNotProse(previous)
      ? previous
      : undefined;

  for (const raw of candidates) {
    // Skip pure meta chatter
    if (
      /准备开始写|现在开始写|我先获取|已获取大纲|接下来写作/.test(raw) &&
      raw.length < 200
    ) {
      continue;
    }
    const check = validateProseContent(raw, { minLen: 80, previousProse });
    if (!check.ok) continue;
    saveProse(novelId, branchId, check.prose);
    console.warn(
      `[writer] recovered prose from assistant text (${check.prose.length} chars) — model skipped save_prose`,
    );
    return {
      ok: true,
      len: check.prose.length,
      note: `程序从聊天正文兜底 save_prose（${check.prose.length} 字；模型未调工具）`,
    };
  }
  return { ok: false, len: 0, note: "" };
}

/** Shared write loop; one Agent per system md (create vs rewrite). */
function makeWriterAgent(systemFile: string): Agent {
  return defineAgent(systemFile, (config) => {
    const name = config.name;
    /** Mode is agent identity only — no [MODE:*] prompt tags. */
    const isRewrite = config.name === "rewriter";
    return async (ctx, llm, onChunk, onTrail) => {
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
      if (
        looksLikeFindingsNotProse(existingProse) ||
        looksLikeRevisionPlanNotProse(existingProse)
      ) {
        return {
          content: "修改失败：store 中的「正文」无效（像清单或修改计划）。",
          messages: [],
          askUser: {
            question: "待改正文无效（不像叙事正文），是否重新创作？",
            options: ["重新用 writer 创作", "取消"],
            missKind: "prose",
          },
        };
      }
    }

    // User message = session binding only; how-to is in system md
    const { system: sys } = resolveAgentPrompt(name, "zh", {
      novelId: ctx.novelId,
      branchId: ctx.branchId,
    });
    const tools = resolveAgentToolSchemas(name);

    // UI-selected style id (not master prose) — tool still fetches full profile
    const styleHint = ctx.selectedStyleId
      ? `\n\n## 选用文风\nstyleId=\`${ctx.selectedStyleId}\`（用 get_style 取全文）\n`
      : "";

    // Rewrite: findings snapshot from store (agent also has get_findings)
    let findingsHint = "";
    if (isRewrite) {
      const findings = getFindings(ctx.novelId, ctx.branchId);
      findingsHint =
        `\n\n## 审查问题快照\n` +
        (findings.length
          ? formatFindingsReadable(findings)
          : "（store 暂无 findings——请 get_findings）") +
        "\n";
    }

    const uc =
      writeTargetUserPrompt(ctx.novelId, ctx.branchId) +
      styleHint +
      findingsHint;

    const run = (user: string) =>
      runSubAgentToolLoop(llm, sys, user, tools, ctx, onChunk, onTrail, {
        // Long prose in tool JSON needs headroom (provider may cap lower)
        maxTokens: 100_000,
        temperature: isRewrite ? 0.4 : 0.5,
        maxSteps: 12,
        stopOnToolSuccess: {
          toolName: "save_prose",
          okMarker: SAVE_PROSE_OK_PREFIX,
          minStoredChars: 80,
        },
      });

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

    // Up to 2 forced retries if agent forgot save or content was rejected
    for (let attempt = 0; attempt < 2 && !outcome.accepted; attempt++) {
      const why = !outcome.called
        ? "你没有调用 save_prose"
        : outcome.rejected
          ? `save_prose 被拒绝：${outcome.detail}`
          : "save_prose 未成功";
      console.warn(`[writer] save verify failed (try ${attempt + 1}): ${why}`);

      const retryUc = `${uc}

## 系统纠错（第 ${attempt + 1} 次）
${why}。
**现在立刻调用 save_prose**，content 为完整小说叙事正文（不要再只取工具或旁白）。
若你已在心里写好正文，直接 save_prose，不要再说「准备开始写」。
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
        {
          role: "assistant",
          content: `（系统：${why}，已要求重新 save_prose）`,
        } as TrailMessage,
        ...second.trail.filter((m) => m.role !== "system"),
      );
      outcome = findSaveProseOutcome(trail);
    }

    // Recovery: prose written as assistant final text without tool call
    if (!outcome.accepted) {
      const recovered = tryRecoverProseFromTrail(
        trail,
        ctx.novelId,
        ctx.branchId,
        isRewrite,
      );
      if (recovered.ok) {
        trail = trail.concat({
          role: "tool_result",
          toolName: "save_prose",
          content: `${SAVE_PROSE_OK_PREFIX}（${recovered.len} 字）。${recovered.note}`,
        } as TrailMessage);
        outcome = { called: true, accepted: true, rejected: false, detail: recovered.note };
      }
    }

    if (!outcome.accepted) {
      const proseNow = getProse(ctx.novelId, ctx.branchId);
      const hint = !outcome.called
        ? "agent 未调用 save_prose（可能只说了「准备开始写」却未落盘）"
        : outcome.rejected
          ? `save_prose 被拒绝（${outcome.detail}）`
          : "save_prose 未成功";
      return {
        content: isRewrite
          ? `正文修改失败：${hint}；已保留原正文。主 agent 应再拉 rewriter。`
          : `正文生成失败：${hint}。主 agent 应再拉 writer。`,
        messages: trail,
      };
    }

    const saved = getProse(ctx.novelId, ctx.branchId) || "";
    console.log(
      `[writer] verified save_prose ${ctx.novelId}/${ctx.branchId} len=${saved.length} rewrite=${isRewrite}`,
    );

    return {
      content: isRewrite
        ? `正文已按审查意见修改（agent 已 save_prose，${saved.length} 字）。主 agent 勿取正文。`
        : `正文已创建（agent 已 save_prose，${saved.length} 字）。主 agent 勿取正文。`,
      messages: trail,
    };
  };
  });
}

export const writerCreateAgent = makeWriterAgent("writer_create-system.md");
export const writerRewriteAgent = makeWriterAgent("writer_rewrite-system.md");
/** @deprecated use writerCreateAgent / writerRewriteAgent */
export const writerAgent = writerCreateAgent;
