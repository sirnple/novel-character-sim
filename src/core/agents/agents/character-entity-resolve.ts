/**
 * analyze_character_list: 角色列表分析子 Agent。
 * Owns name-scan (always force re-scan on entry) + list/coref tools + submit.
 * Form analysis must NOT seed character catalog.
 */

import type { AgentDef, TrailMessage } from "../types";
import { resolveAgentPrompt } from "@/core/prompts/resolve-agent-prompt";
import { runSubAgentToolLoop } from "../tool-loop";
import { toolSaveSucceeded } from "../save-verify";
import { getTool } from "../registry";
import { characterExtractTools } from "./character-extract-tools";
import { getCharacterExtractWorkspace } from "@/core/extractor/character-extract-workspace";
import { SUBMIT_ENTITIES_OK } from "@/core/extractor/character-entity-types";
import { analysisTargetUserPrompt } from "./make-loop-agent";
import type { LLMProvider } from "@/types";

const TOOLS = characterExtractTools.map((t) => ({
  name: t.name,
  description: t.description,
  parameters: t.parameters as Record<string, unknown>,
}));

/** Program name-scan if workspace empty; returns full tool text for trail (never blank). */
async function ensureNameScanIfNeeded(
  ctx: { userId: string; novelId: string; branchId: string },
  llm: LLMProvider,
  forceRefresh = false,
): Promise<{ ok: boolean; detail: string }> {
  const scan = getTool("ensure_name_scan");
  if (!scan) {
    return { ok: false, detail: "ensure_name_scan 工具未注册" };
  }
  try {
    // Always call the tool so trail shows the same rich summary as a real tool_result
    const r = await scan.execute(
      { forceRefresh },
      {
        userId: ctx.userId,
        novelId: ctx.novelId,
        branchId: ctx.branchId || "main",
      },
      llm,
    );
    let content = typeof r.content === "string" ? r.content.trim() : String(r.content ?? "").trim();
    const ws = getCharacterExtractWorkspace(ctx.userId, ctx.novelId, ctx.branchId);
    const n = ws?.catalog?.stats?.length || 0;
    if (!content) {
      // Fallback if tool ever returns empty — still show counts so UI is not blank
      const top = (ws?.catalog?.stats || []).slice(0, 15).map((s) => s.surface);
      content =
        n > 0
          ? `扫名完成：${n} 个候选\n` + top.map((s, i) => `${i + 1}. ${s}`).join("\n")
          : "扫名完成但候选为 0（请检查正文是否加载）";
    }
    if (!n) {
      return { ok: false, detail: content || "扫名后仍无候选" };
    }
    return { ok: true, detail: content };
  } catch (e) {
    return { ok: false, detail: "扫名失败: " + (e as Error).message };
  }
}

function forceRefreshArgs(force: boolean): string {
  return JSON.stringify({ forceRefresh: force }, null, 2);
}

export const characterEntityResolveAgent: AgentDef = {
  execute: async (ctx, llm, onChunk, onTrail) => {
    // Character-list analysis always re-scans: this domain owns name scan (not form).
    // forceRefresh=true so we never reuse a stale catalog from a previous run.
    const forceScan = true;
    const scan = await ensureNameScanIfNeeded(
      {
        userId: ctx.userId,
        novelId: ctx.novelId,
        branchId: ctx.branchId || "main",
      },
      llm,
      forceScan,
    );
    const scanTrail: TrailMessage[] = [
      {
        role: "tool_call",
        toolName: "ensure_name_scan",
        content: forceRefreshArgs(forceScan),
      },
      {
        role: "tool_result",
        toolName: "ensure_name_scan",
        content: scan.detail || "（扫名无文本返回 — 异常）",
      },
    ];
    onTrail?.([...scanTrail]);

    if (!scan.ok) {
      return {
        content: `角色列表分析失败：${scan.detail}`,
        messages: scanTrail,
      };
    }

    const ws = getCharacterExtractWorkspace(ctx.userId, ctx.novelId, ctx.branchId);
    if (!ws) {
      return {
        content: "角色列表分析失败：无候选工作区。",
        messages: scanTrail,
      };
    }
    // Clear previous entity list so this run must submit fresh
    ws.entities = null;

    const { system: sys, user: templateUser } = resolveAgentPrompt(
      "analyze_character_list",
      "zh",
      {
        novelId: ctx.novelId,
        branchId: ctx.branchId || "main",
        prompt: "",
        surfaceCount: String(ws.surfaceCount),
        unitCount: String(ws.unitCount),
      },
    );

    // User: only novel/branch. How-to + must-submit live in system prompt.
    const uc =
      (templateUser && templateUser.trim()) ||
      analysisTargetUserPrompt(ctx.novelId, ctx.branchId || "main");

    const run = (user: string) =>
      runSubAgentToolLoop(
        llm,
        sys,
        user,
        TOOLS,
        ctx,
        onChunk,
        (messages) => onTrail?.([...scanTrail, ...messages]),
        {
          maxTokens: 8192,
          temperature: 0.25,
          maxSteps: 24,
        },
      );

    let loop = await run(uc);
    let trail = [...scanTrail, ...loop.trail];
    let saved = toolSaveSucceeded(trail, "submit_character_entities", SUBMIT_ENTITIES_OK);

    // Like writer missing save_prose
    if (!saved.ok) {
      console.warn(
        `[analyze_character_list] missing submit; retrying (${saved.detail || "未调用"})`,
      );
      const retryUc = `${uc}\n\n（系统）你尚未成功调用 submit_character_entities。请立即调用该工具存储结果。`;
      const second = await run(retryUc);
      trail = trail.concat(
        { role: "assistant", content: "（系统：请调用 submit_character_entities）" } as TrailMessage,
        ...second.trail.filter((m) => m.role !== "system"),
      );
      saved = toolSaveSucceeded(trail, "submit_character_entities", SUBMIT_ENTITIES_OK);
    }

    const entities = getCharacterExtractWorkspace(
      ctx.userId,
      ctx.novelId,
      ctx.branchId,
    )?.entities;

    if (!saved.ok || !entities?.length) {
      return {
        content: `角色列表分析失败：未成功 submit_character_entities（${saved.detail || "未调用"}）。`,
        messages: trail,
      };
    }

    return {
      content: `角色列表已完成：${entities.length} 个角色实体已提交。`,
      messages: trail,
    };
  },
};
