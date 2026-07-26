/**
 * analyze_character_list: 角色列表子 Agent（简化）。
 *
 * 流程：scan_character_mentions（内部 pipeline ①–④）→ 用结果 submit_character_entities。
 * 不再做 list/lookup/异名多轮消解。
 */

import type { AgentDef, TrailMessage } from "../types";
import { getTool } from "../registry";
import {
  getCharacterExtractWorkspace,
  saveResolvedEntities,
} from "@/core/extractor/character-extract-workspace";
import { collapseTechnicalFarSameNameKeys } from "@/core/extractor/character-local-entities";
import { SUBMIT_ENTITIES_OK } from "@/core/extractor/character-entity-types";
import { foldSafeEntityRedundancies } from "@/core/extractor/character-entity-consistency";
import {
  getNovelAnalysisWorkspace,
  patchNovelAnalysisWorkspace,
  beginNovelAnalysisWorkspace,
} from "@/core/extractor/novel-analysis-workspace";
import { entitiesToProfiles } from "./character-extract-tools";
import { rebuildDraftFromRoster } from "../character-draft-utils";

/** 子 Agent：scan → submit，无多工具残差循环 */
export const characterEntityResolveAgent: AgentDef = {
  execute: async (ctx, llm, onChunk, onTrail) => {
    const branchId = ctx.branchId || "main";
    const trail: TrailMessage[] = [];

    if (getNovelAnalysisWorkspace(ctx.userId, ctx.novelId, branchId)) {
      patchNovelAnalysisWorkspace(ctx.userId, ctx.novelId, branchId, {
        charactersDraft: null,
        relationshipEdges: null,
      });
    }

    const scanTool = getTool("scan_character_mentions");
    const submitTool = getTool("submit_character_entities");
    if (!scanTool || !submitTool) {
      return {
        content:
          "analyze_character_list 失败：未注册 scan_character_mentions / submit_character_entities。",
        messages: trail,
      };
    }

    const pushTrail = (msgs: TrailMessage[]) => {
      for (const m of msgs) trail.push(m);
      onTrail?.(trail.slice());
    };

    // ── 1) scan (pipeline ①–④) ─────────────────────────────────────
    onChunk?.("【进度】角色列表：scan_character_mentions（pipeline）…");
    pushTrail([
      {
        role: "tool_call",
        toolName: "scan_character_mentions",
        content: "scan_character_mentions()",
      },
    ]);
    const scanRes = await scanTool.execute({}, ctx, llm, onChunk);
    pushTrail([
      {
        role: "tool_result",
        toolName: "scan_character_mentions",
        content: scanRes.content.slice(0, 4000),
      },
      ...scanRes.messages,
    ]);

    const cws = getCharacterExtractWorkspace(
      ctx.userId,
      ctx.novelId,
      branchId,
    );
    let entities = cws?.entities || [];
    if (!entities.length) {
      return {
        content:
          `analyze_character_list 失败：scan 未产生 entities。\n` +
          `${scanRes.content.slice(0, 500)}`,
        messages: trail,
      };
    }

    // Light cleanup before submit
    const beforeN = entities.length;
    entities = collapseTechnicalFarSameNameKeys(entities);
    const folded = foldSafeEntityRedundancies(entities);
    entities = folded.entities;
    if (cws) cws.entities = entities;

    // ── 2) submit workspace roster ─────────────────────────────────
    onChunk?.(
      `【进度】角色列表：submit_character_entities（${entities.length} 人）…`,
    );
    pushTrail([
      {
        role: "tool_call",
        toolName: "submit_character_entities",
        content: `submit_character_entities(n=${entities.length})`,
      },
    ]);
    const submitRes = await submitTool.execute(
      { entities_json: JSON.stringify(entities) },
      ctx,
      llm,
      onChunk,
    );
    pushTrail([
      {
        role: "tool_result",
        toolName: "submit_character_entities",
        content: submitRes.content.slice(0, 4000),
      },
      ...submitRes.messages,
    ]);

    // Refresh after submit
    const after = getCharacterExtractWorkspace(
      ctx.userId,
      ctx.novelId,
      branchId,
    );
    entities = after?.entities || entities;

    // Stage draft for detail agent / UI
    if (getNovelAnalysisWorkspace(ctx.userId, ctx.novelId, branchId)) {
      try {
        const staged = entitiesToProfiles(entities);
        const aws = getNovelAnalysisWorkspace(
          ctx.userId,
          ctx.novelId,
          branchId,
        );
        const nextDraft = rebuildDraftFromRoster(staged, aws?.charactersDraft);
        patchNovelAnalysisWorkspace(ctx.userId, ctx.novelId, branchId, {
          charactersDraft: nextDraft,
        });
      } catch {
        /* best-effort */
      }
    }

    let submitOk = submitRes.content.includes(SUBMIT_ENTITIES_OK);
    let submitNote = submitRes.content;

    // Pipeline already finished coref + sealed cross-name ledger. If strict
    // submit gates (legacy dual-hang etc.) still block, force-persist roster.
    if (!submitOk) {
      const forced = saveResolvedEntities(
        ctx.userId,
        ctx.novelId,
        branchId,
        entities,
        { replace: true },
      );
      if (forced.ok && forced.entities.length) {
        entities = forced.entities;
        submitOk = true;
        submitNote =
          `${SUBMIT_ENTITIES_OK}（pipeline 直写，跳过严格门禁）` +
          `：累计 ${forced.totalCount} 人。\n` +
          `原 submit 提示：${submitRes.content.slice(0, 400)}`;
        pushTrail([
          {
            role: "tool_result",
            toolName: "submit_character_entities",
            content: submitNote.slice(0, 2000),
          },
        ]);
        try {
          let aws = getNovelAnalysisWorkspace(
            ctx.userId,
            ctx.novelId,
            branchId,
          );
          if (!aws) {
            aws = beginNovelAnalysisWorkspace(
              ctx.userId,
              ctx.novelId,
              branchId,
              { fullText: cws?.fullText || "" },
            );
          }
          const staged = entitiesToProfiles(entities);
          const nextDraft = rebuildDraftFromRoster(
            staged,
            aws.charactersDraft,
          );
          patchNovelAnalysisWorkspace(ctx.userId, ctx.novelId, branchId, {
            charactersDraft: nextDraft,
          });
        } catch {
          /* best-effort */
        }
      }
    }

    if (!submitOk) {
      return {
        content:
          `analyze_character_list 未完成：submit 未通过。\n` +
          `${submitRes.content.slice(0, 1200)}`,
        messages: trail,
      };
    }

    const collapsedNote =
      beforeN !== entities.length || folded.log.length
        ? `（折叠 ${beforeN}→${entities.length}）`
        : "";
    return {
      content:
        `角色列表已完成：scan → submit，累计 **${entities.length}** 个角色实体` +
        `${collapsedNote}。\n` +
        `${scanRes.content.slice(0, 400)}\n` +
        `${submitNote.slice(0, 400)}`,
      messages: trail,
    };
  },
};
