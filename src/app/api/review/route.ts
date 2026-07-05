import { NextRequest, NextResponse } from "next/server";
import { runFullReview } from "@/core/reviewer";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import { saveGenerationLog } from "@/lib/db";

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
    const { draft, timelineEvents, characterStates, writingStyle } = await request.json();

    if (!draft) {
      return NextResponse.json({ error: "Draft text is required" }, { status: 400 });
    }

    const result = await runFullReview({
      draft,
      timelineEvents: timelineEvents || "",
      characterStates: characterStates || "",
      writingStyle: writingStyle || ""
    });

    saveGenerationLog({
      id: crypto.randomUUID(),
      userId,
      category: "review",
      label: "三层审查",
      inputSummary: draft.slice(0, 200),
      outputPreview: `${result.totalIssues}个问题, 全通过=${result.allPassed}`,
      fullOutput: JSON.stringify(result),
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Review error:", error);
    const message = error instanceof Error ? error.message : "Review failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
