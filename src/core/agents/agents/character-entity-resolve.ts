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
import { SUBMIT_ENTITIES_OK } from "@/core/extractor/character-entity-types";

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
      "list_surface_candidates",
      "lookup_surface",
      "lookup_offset",
      "submit_character_entities",
    ],
    pool,
  ),
  submitTool: "submit_character_entities",
  okMarker: SUBMIT_ENTITIES_OK,
  maxSteps: 28,
  temperature: 0.25,
  maxTokens: 8192,
});

/** 子 Agent：工具循环由模型调度；成功后校验 workspace 实体 */
export const characterEntityResolveAgent: AgentDef = {
  execute: async (ctx, llm, onChunk, onTrail) => {
    // Fresh submit required each run
    const existing = getCharacterExtractWorkspace(
      ctx.userId,
      ctx.novelId,
      ctx.branchId || "main",
    );
    if (existing) existing.entities = null;

    const result = await characterListLoop.execute(ctx, llm, onChunk, onTrail);

    const entities = getCharacterExtractWorkspace(
      ctx.userId,
      ctx.novelId,
      ctx.branchId || "main",
    )?.entities;

    if (!entities?.length) {
      return {
        content:
          `analyze_character_list 失败：未成功 submit_character_entities。` +
          `请先 scan_character_mentions 建 catalog，再 list/消解并 submit。` +
          `（${result.content.slice(0, 200)}）`,
        messages: result.messages,
      };
    }

    // Always report workspace total (supports multi-batch submit merge)
    return {
      content: `角色列表已完成：累计 ${entities.length} 个角色实体（分批已合并）。`,
      messages: result.messages,
    };
  },
};
