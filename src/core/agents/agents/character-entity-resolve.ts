/**
 * analyze_character_list: 角色列表子 Agent。
 * 由 Agent 自行调用 scan_character_mentions → list/lookup → submit_character_entities。
 * 程序不预跑扫描（禁止入口直接 ensure/scan）。
 */

import type { AgentDef, ToolDefinition } from "../types";
import { makeLoopAgent } from "./make-loop-agent";
import { characterExtractTools } from "./character-extract-tools";
import { analysisDomainTools } from "./analysis-tools";
import { getCharacterExtractWorkspace } from "@/core/extractor/character-extract-workspace";
import {
  collapseTechnicalFarSameNameKeys,
  seedGlobalEntitiesFromLocal,
} from "@/core/extractor/character-local-entities";
import { SUBMIT_ENTITIES_OK } from "@/core/extractor/character-entity-types";
import { listRelationPrimaryNames } from "@/core/extractor/character-entity-coverage";
import {
  foldSafeEntityRedundancies,
  formatDualHangBlockForSubmit,
  listBlockingConsistencyIssues,
} from "@/core/extractor/character-entity-consistency";
import {
  formatUnresolvedCrossNameBlock,
  listUnresolvedCrossNamePairs,
} from "@/core/extractor/character-cross-name";
import { ensureCrossNameCandidates } from "@/core/extractor/character-extract-workspace";
import {
  getNovelAnalysisWorkspace,
  patchNovelAnalysisWorkspace,
} from "@/core/extractor/novel-analysis-workspace";
import { entitiesToProfiles } from "./character-extract-tools";
import { rebuildDraftFromRoster } from "../character-draft-utils";

function pick(names: string[], pool: ToolDefinition[]): ToolDefinition[] {
  const byName = new Map(pool.map((t) => [t.name, t]));
  return names.map((n) => byName.get(n)).filter(Boolean) as ToolDefinition[];
}

const pool: ToolDefinition[] = (() => {
  const m = new Map<string, ToolDefinition>();
  for (const t of [...analysisDomainTools, ...characterExtractTools]) {
    if (!m.has(t.name)) m.set(t.name, t);
  }
  return Array.from(m.values());
})();

const characterListLoop = makeLoopAgent({
  agentId: "analyze_character_list",
  tools: pick(
    [
      "scan_character_mentions",
      "list_local_entities",
      "list_cross_name_candidates",
      "list_near_alias_candidates",
      "resolve_cross_name_pair",
      "list_uncovered_surfaces",
      "list_surface_candidates",
      "lookup_surface",
      "lookup_offset",
      "submit_character_entities",
    ],
    pool,
  ),
  submitTool: "submit_character_entities",
  okMarker: SUBMIT_ENTITIES_OK,
  // Long books: local list + multi-batch merge/split + dual-primary cleanup
  maxSteps: 72,
  temperature: 0.25,
  maxTokens: 8192,
});

/** 子 Agent：工具循环由模型调度；成功后校验 workspace 实体 */
export const characterEntityResolveAgent: AgentDef = {
  execute: async (ctx, llm, onChunk, onTrail) => {
    // Re-seed from local entities: program near same-name coref (D=5), not
    // stale submit. Far same-name + different names remain for this agent.
    const branchId = ctx.branchId || "main";
    const existing = getCharacterExtractWorkspace(
      ctx.userId,
      ctx.novelId,
      branchId,
    );
    if (existing?.localEntities?.length) {
      existing.entities = seedGlobalEntitiesFromLocal(existing.localEntities);
    }
    if (getNovelAnalysisWorkspace(ctx.userId, ctx.novelId, branchId)) {
      patchNovelAnalysisWorkspace(ctx.userId, ctx.novelId, branchId, {
        charactersDraft: null,
        relationshipEdges: null,
      });
    }

    const result = await characterListLoop.execute(ctx, llm, onChunk, onTrail);

    const cws = getCharacterExtractWorkspace(
      ctx.userId,
      ctx.novelId,
      ctx.branchId || "main",
    );
    let entities = cws?.entities;

    if (!entities?.length) {
      return {
        content:
          `analyze_character_list 失败：未成功 submit_character_entities。` +
          `请先 scan_character_mentions 建 catalog，再 list/消解并 submit。` +
          `（${result.content.slice(0, 200)}）`,
        messages: result.messages,
      };
    }

    // Match character-extract-job: strip seed-only `名@uN` before handoff/commit.
    // Global agent may leave far same-name technical ids; UI must never show them.
    const beforeN = entities.length;
    entities = collapseTechnicalFarSameNameKeys(entities);
    const folded = foldSafeEntityRedundancies(entities);
    entities = folded.entities;
    if (cws) cws.entities = entities;
    if (getNovelAnalysisWorkspace(ctx.userId, ctx.novelId, branchId)) {
      try {
        const staged = entitiesToProfiles(entities);
        const aws = getNovelAnalysisWorkspace(ctx.userId, ctx.novelId, branchId);
        const nextDraft = rebuildDraftFromRoster(staged, aws?.charactersDraft);
        patchNovelAnalysisWorkspace(ctx.userId, ctx.novelId, branchId, {
          charactersDraft: nextDraft,
        });
      } catch {
        /* draft stage best-effort */
      }
    }

    // Suspended deictics as primary name = incomplete global coref
    const relationLeft = listRelationPrimaryNames(entities);
    if (relationLeft.length) {
      const names = relationLeft.map((e) => e.name).join("、");
      return {
        content:
          `analyze_character_list 未完成：仍有悬空指代作 name（${names}）。` +
          `必须 lookup 锚点并 merge 到真实实体后，再 submit 至「角色实体已存」。` +
          `（${result.content.slice(0, 160)}）`,
        messages: result.messages,
      };
    }

    // Multi-claim primary/alias dual hang (e.g. 雪棠 row + 雪棠 in others' aliases)
    const dualLeft = listBlockingConsistencyIssues(entities);
    if (dualLeft.length) {
      const block = formatDualHangBlockForSubmit(entities, { limit: 20 });
      return {
        content:
          `analyze_character_list 未完成：主名/别名双挂未消解（禁止重扫）。\n` +
          `${block}\n` +
          `须按清单 merge 或清理误挂 aliases 后再 submit。` +
          `（${result.content.slice(0, 100)}）`,
        messages: result.messages,
      };
    }

    // P3: open cross-name pairs without explicit processing
    const crossCands = ensureCrossNameCandidates(
      ctx.userId,
      ctx.novelId,
      branchId,
    );
    const crossLeft = listUnresolvedCrossNamePairs(
      crossCands,
      entities,
      cws?.pairResolutions,
    );
    if (crossLeft.length) {
      return {
        content:
          `analyze_character_list 未完成：异名怀疑未处理（禁止重扫）。\n` +
          `${formatUnresolvedCrossNameBlock(crossLeft, 20)}\n` +
          `须 merge 或 resolve_cross_name_pair(distinct|uncertain) 后再 submit。` +
          `（${result.content.slice(0, 80)}）`,
        messages: result.messages,
      };
    }

    // Always report workspace total (supports multi-batch submit merge)
    const collapsedNote =
      beforeN !== entities.length || folded.log.length
        ? `（折叠 @uN/安全别名 ${beforeN}→${entities.length}）`
        : "";
    return {
      content: `角色列表已完成：累计 ${entities.length} 个角色实体（分批已合并）${collapsedNote}。`,
      messages: result.messages,
    };
  },
};
