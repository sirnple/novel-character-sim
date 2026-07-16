import type { AgentDef, TrailMessage } from "../types";
import { runSubAgentToolLoop } from "../tool-loop";
import {
  saveFindingsLocked,
  saveForeshadowRealization,
  getProse,
} from "../intermediate-store";
import { extractJSON } from "@/lib/utils";
import { resolveAgentPrompt } from "@/core/prompts/resolve-agent-prompt";
import { branchTools } from "./branch-tools";
import { intermediateReadTools } from "./intermediate-tools";
import { foreshadowTools } from "./foreshadow-tools";
import type { ForeshadowingRealization } from "@/core/foreshadowing/types";

// Review: read prose + branch context only; findings saved by execute layer
const TOOLS = [
  ...branchTools,
  ...intermediateReadTools.filter(t => t.name === "get_prose"),
].map(t => ({
  name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown>,
}));

const FORESHADOW_TOOLS = [
  ...TOOLS,
  ...foreshadowTools
    .filter(t =>
      t.name === "get_foreshadowing_ledger" ||
      t.name === "get_foreshadowing_plan",
    )
    .map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters as Record<string, unknown>,
    })),
];

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

function parseForeshadowRealization(
  raw: string,
  novelId: string,
  branchId: string,
): { realization: ForeshadowingRealization; ok: boolean; jsonSlice: string } {
  try {
    const parsed = extractJSON<any>(raw || "");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not object");
    }
    const findings = Array.isArray(parsed.findings)
      ? parsed.findings
      : Array.isArray(parsed)
        ? parsed
        : [];
    const realization: ForeshadowingRealization = {
      novelId,
      branchId,
      reviewedAt: new Date().toISOString(),
      proseFingerprint: String((getProse(novelId, branchId) || "").length),
      pass: !!parsed.pass,
      findings: findings.map((f: any) => ({
        severity: (["critical", "major", "minor"].includes(f.severity)
          ? f.severity
          : "minor") as "critical" | "major" | "minor",
        code: f.code,
        description: String(f.description || ""),
        suggestion: f.suggestion ? String(f.suggestion) : undefined,
      })),
      realized: {
        planted: Array.isArray(parsed.realized?.planted) ? parsed.realized.planted : [],
        advanced: Array.isArray(parsed.realized?.advanced) ? parsed.realized.advanced : [],
        revealed: Array.isArray(parsed.realized?.revealed) ? parsed.realized.revealed : [],
        abandoned: Array.isArray(parsed.realized?.abandoned) ? parsed.realized.abandoned : [],
      },
      gaps: {
        planNotRealized: Array.isArray(parsed.gaps?.planNotRealized)
          ? parsed.gaps.planNotRealized
          : [],
        realizedNotInPlan: Array.isArray(parsed.gaps?.realizedNotInPlan)
          ? parsed.gaps.realizedNotInPlan
          : [],
      },
    };
    // If model only returned findings array legacy style, fail closed
    if (parsed.pass === undefined && findings.length > 0) {
      realization.pass = !findings.some(
        (f: any) => f.severity === "critical" || f.severity === "major",
      );
    }
    return {
      realization,
      ok: true,
      jsonSlice: JSON.stringify(realization, null, 2),
    };
  } catch {
    const realization: ForeshadowingRealization = {
      novelId,
      branchId,
      reviewedAt: new Date().toISOString(),
      pass: false,
      findings: [
        {
          severity: "major",
          description: "伏笔审查输出无法解析为 realization 对象，请重跑 review_foreshadowing",
        },
      ],
      realized: { planted: [], advanced: [], revealed: [], abandoned: [] },
      gaps: { planNotRealized: [], realizedNotInPlan: [] },
    };
    return { realization, ok: false, jsonSlice: JSON.stringify(realization) };
  }
}

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

      const isFs = dimensionCode === "foreshadowing";
      const tools = isFs ? FORESHADOW_TOOLS : TOOLS;
      const { finalText, trail } = await runSubAgentToolLoop(llm, sys, uc, tools, ctx, undefined, onTrail);

      if (isFs) {
        const { realization, ok, jsonSlice } = parseForeshadowRealization(
          finalText || "",
          ctx.novelId,
          ctx.branchId,
        );
        saveForeshadowRealization(ctx.novelId, ctx.branchId, realization);
        const findings = normalizeFindings(
          realization.findings.map(f => ({
            severity: f.severity,
            description: f.description,
            suggestion: f.suggestion || "",
          })),
          "foreshadowing",
        );
        await saveFindingsLocked(ctx.novelId, ctx.branchId, findings);
        const cleanedTrail = cleanTrailJson(trail, jsonSlice);
        return {
          content: ok
            ? `伏笔追踪: pass=${realization.pass}, findings=${findings.length}, realized plant=${realization.realized.planted.length}/reveal=${realization.realized.revealed.length}（已存 realization，Accept 后落定账本）`
            : `伏笔追踪: realization 解析失败，pass=false。`,
          messages: cleanedTrail,
        };
      }

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
