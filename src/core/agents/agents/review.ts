import type { AgentDef } from "../types";
import {
  reviewCharacterConsistencyClean,
  reviewContinuityClean,
  reviewForeshadowingClean,
  reviewStyleClean,
  reviewWorldBuildingClean,
  reviewPacingClean,
} from "@/core/codex/review-orchestrator";
import type { ReviewFinding } from "@/core/codex/types";

type ReviewFn = typeof reviewCharacterConsistencyClean;

interface ReviewToolResult {
  converged: boolean;
  findings: { dimension: string; severity: string; description: string; suggestion: string }[];
}

function makeReviewAgent(fn: ReviewFn, dimension: string): AgentDef {
  return {
    execute: async (ctx, llm) => {
      const fullText = ctx.novelText || "";
      const reviewTarget = ctx.prompt || "";
      const zh = /[一-鿿]/.test(fullText.slice(0, 1000));
      const r = await fn(fullText, reviewTarget, llm, zh);

      const result: ReviewToolResult = {
        converged: r.converged || r.findings.length === 0,
        findings: r.findings.map(f => ({
          dimension,
          severity: f.severity,
          description: f.description,
          suggestion: f.suggestion || "",
        })),
      };

      return {
        content: JSON.stringify(result),
        messages: [],
      };
    },
  };
}

export const reviewCharacterAgent = makeReviewAgent(reviewCharacterConsistencyClean, "角色一致性");
export const reviewContinuityAgent = makeReviewAgent(reviewContinuityClean, "连贯性");
export const reviewForeshadowingAgent = makeReviewAgent(reviewForeshadowingClean, "伏笔");
export const reviewStyleAgent = makeReviewAgent(reviewStyleClean, "风格");
export const reviewWorldAgent = makeReviewAgent(reviewWorldBuildingClean, "世界观");
export const reviewPacingAgent = makeReviewAgent(reviewPacingClean, "节奏");
