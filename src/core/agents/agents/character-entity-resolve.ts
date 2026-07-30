/**
 * analyze_character_list: 角色列表子 Agent。
 *
 * 1) scan_character_mentions → 内部 pipeline ①窗扫 → ②overlap → ③oneshot → ④canonicalName
 *    （pipeline 到此结束；oneshot 标 uncertain 的对保持未合并）
 * 2) 若有 uncertain 对：agent 用查询工具辅助判断并 resolve
 * 3) submit_character_entities
 */

import type { AgentDef, TrailMessage, ToolDefinition } from "../types";
import type { ToolSchema } from "@/types";
import { getTool } from "../registry";
import {
  getCharacterExtractWorkspace,
  saveResolvedEntities,
} from "@/core/character-analysis/runtime/character-extract-workspace";
import { collapseTechnicalFarSameNameKeys } from "@/core/character-analysis/runtime/character-local-entities";
import { SUBMIT_ENTITIES_OK } from "@/core/character-analysis/runtime/character-entity-types";
import { foldSafeEntityRedundancies } from "@/core/character-analysis/runtime/character-entity-consistency";
import {
  getNovelAnalysisWorkspace,
  patchNovelAnalysisWorkspace,
  beginNovelAnalysisWorkspace,
} from "@/core/extractor/novel-analysis-workspace";
import { entitiesToProfiles } from "./character-extract-tools";
import { rebuildDraftFromRoster } from "../character-draft-utils";
import { runSubAgentToolLoop } from "../tool-loop";
import {
  analysisDomainTools,
} from "./analysis-tools";
import { characterExtractTools } from "./character-extract-tools";

const UNCERTAIN_TOOL_NAMES = [
  "list_coref_uncertain_pairs",
  "list_cooccur_neighbors",
  "resolve_coref_uncertain_pair",
  "lookup_offset",
  "get_text_slice",
  "get_novel_excerpt",
] as const;

function pickTools(names: readonly string[]): ToolDefinition[] {
  const pool = new Map<string, ToolDefinition>();
  for (const t of [...analysisDomainTools, ...characterExtractTools]) {
    pool.set(t.name, t);
  }
  return names
    .map((n) => pool.get(n) || (getTool(n) as ToolDefinition | undefined))
    .filter(Boolean) as ToolDefinition[];
}

function toSchemas(tools: ToolDefinition[]): ToolSchema[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters as Record<string, unknown>,
  }));
}

/**
 * When Stage③ oneshot left uncertain pairs, let the agent query co-occur /
 * excerpts and call resolve_coref_uncertain_pair. Remaining pairs stay separate.
 */
async function resolveUncertainPairsWithAgent(
  ctx: Parameters<AgentDef["execute"]>[0],
  llm: Parameters<AgentDef["execute"]>[1],
  onChunk: Parameters<AgentDef["execute"]>[2],
  onTrail: Parameters<AgentDef["execute"]>[3],
  trail: TrailMessage[],
  pairCount: number,
): Promise<void> {
  const tools = pickTools(UNCERTAIN_TOOL_NAMES);
  if (!tools.length) {
    onChunk?.(
      `【进度】角色列表 · uncertain ${pairCount} 对（无查询工具，保持分列）`,
    );
    return;
  }
  const system = [
    "你是角色名单消歧助手。程序流水线 ①–④ 已完成；Stage③ oneshot 留下若干 uncertain 对（可能是同一人、也可能不是）。",
    "用工具辅助判断后调用 resolve_coref_uncertain_pair：",
    "- list_coref_uncertain_pairs：查看待判对",
    "- list_cooccur_neighbors(id, hops=1|2)：查共现网络（勿因邻居相似直接合并）",
    "- lookup_offset / get_text_slice：必要时读原文",
    "- resolve_coref_uncertain_pair(idA,idB,verdict=merge|distinct,reason)",
    "有把握才 merge；吃不准可 keep distinct 或跳过（分列提交即可）。",
    "不要调用 scan_character_mentions。不要 submit。全部处理完或无法再判时停止。",
  ].join("\n");
  const user =
    `novelId=${ctx.novelId}\nbranchId=${ctx.branchId || "main"}\n` +
    `当前 uncertain 约 ${pairCount} 对。请 list_coref_uncertain_pairs 后逐对处理。`;

  onChunk?.(
    `【进度】角色列表 · agent 消歧 uncertain ${pairCount} 对`,
  );
  const maxSteps = Math.min(28, Math.max(8, pairCount * 3 + 4));
  const loop = await runSubAgentToolLoop(
    llm,
    system,
    user,
    toSchemas(tools),
    ctx,
    onChunk,
    (msgs) => {
      // Append uncertain-loop trail for UI
      onTrail?.(trail.concat(msgs));
    },
    {
      maxTokens: 4096,
      temperature: 0.2,
      maxSteps,
    },
  );
  for (const m of loop.trail) {
    if (m.role === "system") continue;
    trail.push(m);
  }
  onTrail?.(trail.slice());
}

/** 子 Agent：scan → (uncertain 工具消歧) → submit */
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
    // Program-driven workflow (not free-form chat): emit short status lines so
    // the UI is not only tool_call cards. Model CoT is never streamed here.
    pushTrail([
      {
        role: "assistant",
        content:
          "开始角色名单流水线：①窗扫 → ②overlap → ③oneshot 消解 → ④canonicalName（程序编排，非自由对话）。",
      },
    ]);
    onChunk?.(
      "【进度】角色列表 0/100（0%）· ①–④流水线 · scan_character_mentions",
    );
    pushTrail([
      {
        role: "tool_call",
        toolName: "scan_character_mentions",
        content: "调用「角色列表流水线」scan_character_mentions",
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

    let cws = getCharacterExtractWorkspace(
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

    // ── 2) outer agent tools for oneshot uncertain pairs ───────────
    const uncertainN = cws?.corefUncertainPairs?.length ?? 0;
    if (uncertainN > 0) {
      pushTrail([
        {
          role: "assistant",
          content:
            `流水线留下 ${uncertainN} 对 oneshot uncertain，开始用共现/原文工具消歧（此段会有模型回合；无 uncertain 时整段跳过）。`,
        },
      ]);
      await resolveUncertainPairsWithAgent(
        ctx,
        llm,
        onChunk,
        onTrail,
        trail,
        uncertainN,
      );
      cws = getCharacterExtractWorkspace(ctx.userId, ctx.novelId, branchId);
      entities = cws?.entities || entities;
    } else {
      pushTrail([
        {
          role: "assistant",
          content: `指代 oneshot 无未定对；实体 ${entities.length} 个，准备提交名单。`,
        },
      ]);
    }

    // Light cleanup before submit
    const beforeN = entities.length;
    entities = collapseTechnicalFarSameNameKeys(entities);
    const folded = foldSafeEntityRedundancies(entities);
    entities = folded.entities;
    if (cws) cws.entities = entities;

    // ── 3) submit workspace roster ─────────────────────────────────
    onChunk?.(
      `【进度】角色列表 100/100（100%）· 提交名单 · submit ${entities.length} 人`,
    );
    pushTrail([
      {
        role: "assistant",
        content: `提交名单 ${entities.length} 人到工作区（尚未落库；需 finish / 确认保存）。`,
      },
      {
        role: "tool_call",
        toolName: "submit_character_entities",
        content: `提交角色实体（${entities.length} 人）`,
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

    const after = getCharacterExtractWorkspace(
      ctx.userId,
      ctx.novelId,
      branchId,
    );
    entities = after?.entities || entities;

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
    // submit gates still block, force-persist roster.
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

    const leftUnc =
      getCharacterExtractWorkspace(ctx.userId, ctx.novelId, branchId)
        ?.corefUncertainPairs?.length ?? 0;
    const collapsedNote =
      beforeN !== entities.length || folded.log.length
        ? `（折叠 ${beforeN}→${entities.length}）`
        : "";
    const uncNote =
      uncertainN > 0
        ? `；oneshot uncertain ${uncertainN} 对，剩余未决 ${leftUnc}`
        : "";
    return {
      content:
        `角色列表已完成：scan →` +
        (uncertainN > 0 ? " agent消歧 →" : "") +
        ` submit，累计 **${entities.length}** 个角色实体` +
        `${collapsedNote}${uncNote}。\n` +
        `${scanRes.content.slice(0, 400)}\n` +
        `${submitNote.slice(0, 400)}`,
      messages: trail,
    };
  },
};

