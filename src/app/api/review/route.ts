import { NextRequest, NextResponse } from "next/server";
import { runFullReview } from "@/core/codex/review-orchestrator";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import { saveGenerationLog } from "@/lib/db";
import type { WritersCodex } from "@/core/codex/types";

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "review", { windowMs: 120_000, maxRequests: 10 });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: rateLimitMessage(rate) },
      { status: 429 }
    );
  }

  try {
    const { draft, codex, chapterNumber } = await request.json();

    if (!draft) {
      return NextResponse.json({ error: "Draft text is required" }, { status: 400 });
    }

    if (!codex) {
      return NextResponse.json({ error: "Codex is required" }, { status: 400 });
    }

    const result = await runFullReview({
      generatedProse: draft,
      codex: codex as WritersCodex,
      chapterNumber: chapterNumber || 1,
    });

    saveGenerationLog({
      id: crypto.randomUUID(),
      userId,
      category: "review",
      label: "六维审查",
      inputSummary: draft.slice(0, 200),
      outputPreview: `autoFixed:${result.autoFixedCount}, needsHuman:${result.needsHumanReview.length}`,
      fullOutput: JSON.stringify(result),
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Review error:", error);
    const message = error instanceof Error ? error.message : "Review failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
