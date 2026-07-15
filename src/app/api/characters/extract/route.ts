/**
 * Backward-compatible extract: defaults to story + characters modules.
 */
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import { runModularExtract } from "@/core/extractor/run-modular-extract";
import type { ExtractModule } from "@/types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "extract", { windowMs: 300_000, maxRequests: 5 });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }

  try {
    const body = await request.json();
    const modules: ExtractModule[] =
      Array.isArray(body.modules) && body.modules.length > 0
        ? body.modules
        : ["story", "characters"];

    const result = await runModularExtract({
      userId,
      novelId: body.sessionId || body.novelId || "default",
      text: body.text,
      modules,
      forceRefresh: !!body.forceRefresh,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Extraction error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to extract" },
      { status: 500 },
    );
  }
}
