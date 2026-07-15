import type { AgentDef, TrailMessage } from "../types";
import { runSubAgentToolLoop } from "../tool-loop";
import { saveFindingsLocked } from "../intermediate-store";
import { extractJSON } from "@/lib/utils";
import { resolveAgentPrompt } from "@/core/prompts/resolve-agent-prompt";
import { branchTools } from "./branch-tools";
import { intermediateReadTools } from "./intermediate-tools";

// Review: read prose + branch context only; findings saved by execute layer
const TOOLS = [
  ...branchTools,
  ...intermediateReadTools.filter(t => t.name === "get_prose"),
].map(t => ({
  name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown>,
}));

const SEVERITIES = new Set(["critical", "major", "minor"]);

/** Prefer first JSON array in text; also accept { findings: [...] }. Ignore any trailing prose. */
function parseFindingsArray(raw: string): { items: any[]; jsonSlice: string; ok: boolean } {
  const text = (raw || "").trim();
  if (!text) return { items: [], jsonSlice: "[]", ok: true };

  const bracket = text.indexOf("[");
  const brace = text.indexOf("{");
  let candidate = text;
  if (bracket !== -1 && (brace === -1 || bracket < brace)) {
    candidate = text.slice(bracket);
  }

  try {
    const parsed = extractJSON<any>(candidate);
    if (Array.isArray(parsed)) {
      return { items: parsed, jsonSlice: JSON.stringify(parsed, null, 2), ok: true };
    }
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.findings)) {
      return {
        items: parsed.findings,
        jsonSlice: JSON.stringify(parsed.findings, null, 2),
        ok: true,
      };
    }
  } catch { /* fall through */ }

  return { items: [], jsonSlice: "[]", ok: false };
}

function normalizeFindings(items: any[], dimensionCode: string) {
  return items
    .filter(f => f && (f.description || f.suggestion))
    .map(f => {
      let severity = String(f.severity || "minor").toLowerCase();
      if (!SEVERITIES.has(severity)) {
        if (/严重|致命|critical/i.test(severity)) severity = "critical";
        else if (/重要|主要|major/i.test(severity)) severity = "major";
        else severity = "minor";
      }
      return {
        dimension: dimensionCode,
        severity,
        description: String(f.description || "").trim(),
        suggestion: String(f.suggestion || "").trim(),
      };
    })
    .filter(f => f.description.length > 0);
}

/** Replace final assistant turn with pure JSON so UI doesn't show trailing chatter. */
function cleanTrailJson(trail: TrailMessage[], jsonSlice: string): TrailMessage[] {
  if (!trail.length) return trail;
  const out = trail.slice();
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === "assistant") {
      out[i] = { ...out[i], content: jsonSlice };
      break;
    }
  }
  return out;
}

/** Admin agentId for each review dimension */
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
      const { system: sys, user: uc } = resolveAgentPrompt(agentId, "zh", {
        prompt: ctx.prompt,
        novelId: ctx.novelId,
        branchId: ctx.branchId,
        dimensionName,
        dimensionCode,
      });

      const { finalText, trail } = await runSubAgentToolLoop(llm, sys, uc, TOOLS, ctx, undefined, onTrail);

      const { items, jsonSlice, ok } = parseFindingsArray(finalText || "");
      const findings = normalizeFindings(items, dimensionCode);
      // Parallel-safe: multiple review_* agents may finish at once
      await saveFindingsLocked(ctx.novelId, ctx.branchId, findings);

      const cleanedTrail = cleanTrailJson(trail, jsonSlice);

      return {
        content: ok
          ? `${dimensionName}: ${findings.length} findings，已存储。主 agent 可用 get_findings 获取。`
          : `${dimensionName}: 输出未能解析为 JSON 数组，已存 0 findings。`,
        messages: cleanedTrail,
      };
    },
  };
}

export const reviewCharacterAgent = makeReviewAgent("角色一致性", "character");
export const reviewContinuityAgent = makeReviewAgent("连贯性", "continuity");
export const reviewForeshadowingAgent = makeReviewAgent("伏笔追踪", "foreshadowing");
export const reviewStyleAgent = makeReviewAgent("风格一致性", "style");
export const reviewWorldAgent = makeReviewAgent("世界观", "world");
export const reviewPacingAgent = makeReviewAgent("节奏", "pacing");
