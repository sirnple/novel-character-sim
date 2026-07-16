import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/rate-limit";
import { getForeshadowingLedger } from "@/lib/db";
import {
  getForeshadowPlan,
  getForeshadowRealization,
  getProse,
} from "@/core/agents/intermediate-store";

export const dynamic = "force-dynamic";

/** GET ledger (+ optional session plan/realization) */
export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const novelId = request.nextUrl.searchParams.get("novelId") || "";
  const branchId = request.nextUrl.searchParams.get("branchId") || "main";
  if (!novelId) {
    return NextResponse.json({ error: "novelId required" }, { status: 400 });
  }
  const ledger = getForeshadowingLedger(userId, novelId, branchId);
  const plan = getForeshadowPlan(novelId, branchId) || null;
  const realization = getForeshadowRealization(novelId, branchId) || null;
  const prose = getProse(novelId, branchId) || "";
  return NextResponse.json({
    ledger,
    plan,
    realization,
    hasProseDraft: prose.length > 0,
    proseLength: prose.length,
  });
}
