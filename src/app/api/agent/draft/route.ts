import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/rate-limit";
import { getProse } from "@/core/agents/intermediate-store";

export const dynamic = "force-dynamic";

/** Current session draft prose (save_prose), not yet accepted into branch. */
export async function GET(request: NextRequest) {
  getUserId(request); // ensure identity cookie path runs
  const novelId = request.nextUrl.searchParams.get("novelId") || "";
  const branchId = request.nextUrl.searchParams.get("branchId") || "main";
  if (!novelId) {
    return NextResponse.json({ error: "novelId required" }, { status: 400 });
  }
  const prose = getProse(novelId, branchId) || "";
  return NextResponse.json({
    novelId,
    branchId,
    prose,
    length: prose.length,
  });
}
