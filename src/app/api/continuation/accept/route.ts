import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import {
  acceptContinuation,
  formatAcceptHint,
} from "@/core/foreshadowing/accept-continuation";

export const dynamic = "force-dynamic";

/**
 * User accepts continuation into branch.
 * Foreshadowing ledger always follows realized (actual), never plan fantasy.
 */
export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "continuation_accept", {
    windowMs: 60_000,
    maxRequests: 20,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }

  try {
    const body = await request.json();
    const result = acceptContinuation({
      userId,
      novelId: String(body.novelId || ""),
      branchId: String(body.branchId || "main"),
      content: body.content,
      fromOffset:
        typeof body.fromOffset === "number"
          ? body.fromOffset
          : body.fromOffset != null
            ? Number(body.fromOffset)
            : undefined,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.code === "NO_DRAFT" ? 400 : 400 },
      );
    }

    return NextResponse.json({
      success: true,
      branch: {
        id: result.branchId,
        text: result.branchText,
      },
      message: formatAcceptHint(result),
      realizationPass: result.realizationPass,
      foreshadowNote: result.foreshadowNote,
      activeCount: result.activeCount,
      ledgerVersion: result.ledgerVersion,
    });
  } catch (e) {
    console.error("[continuation/accept]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Accept failed" },
      { status: 500 },
    );
  }
}
