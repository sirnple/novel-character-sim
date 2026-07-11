import type { AgentDef } from "../types";
import {
  reviewCharacterConsistencyClean,
  reviewContinuityClean,
  reviewForeshadowingClean,
  reviewStyleClean,
  reviewWorldBuildingClean,
  reviewPacingClean,
} from "@/core/codex/review-orchestrator";

type ReviewFn = typeof reviewCharacterConsistencyClean;

function makeReviewAgent(fn: ReviewFn): AgentDef {
  return {
    execute: async (ctx, llm) => {
      const fullText = (ctx.novelText || "").slice(0, 50000);
      const reviewTarget = ctx.prompt || (ctx.novelText || "").slice(-8000);
      const zh = /[一-鿿]/.test(fullText.slice(0, 1000));
      const r = await fn(fullText, reviewTarget, llm, zh);
      const summary = r.findings.length === 0
        ? "审查完成，未发现问题。"
        : r.findings.map((f, i) => `${i + 1}. [${f.severity || "建议"}] ${f.description || ""}`).join("\n");
      return { content: summary, messages: [] };
    },
  };
}

export const reviewCharacterAgent = makeReviewAgent(reviewCharacterConsistencyClean);
export const reviewContinuityAgent = makeReviewAgent(reviewContinuityClean);
export const reviewForeshadowingAgent = makeReviewAgent(reviewForeshadowingClean);
export const reviewStyleAgent = makeReviewAgent(reviewStyleClean);
export const reviewWorldAgent = makeReviewAgent(reviewWorldBuildingClean);
export const reviewPacingAgent = makeReviewAgent(reviewPacingClean);
