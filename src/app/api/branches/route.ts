import { NextRequest, NextResponse } from "next/server";
import { saveBranch, getBranch, listBranches, appendBranchContent } from "@/lib/db";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "branches_get", { windowMs: 60_000, maxRequests: 30 });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }

  const novelId = request.nextUrl.searchParams.get("novelId");
  const branchId = request.nextUrl.searchParams.get("branchId");

  if (branchId) {
    if (!novelId) return NextResponse.json({ error: "novelId required with branchId" }, { status: 400 });
    const branch = getBranch(userId, novelId, branchId);
    if (!branch) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ branch });
  }

  if (novelId) {
    const branches = listBranches(userId, novelId);
    return NextResponse.json({ branches });
  }

  return NextResponse.json({ error: "novelId or branchId required" }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "branches_post", { windowMs: 60_000, maxRequests: 20 });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }

  const { novelId, branchId, name, parentOffset, content, append } = await request.json();

  if (!novelId || !name) {
    return NextResponse.json({ error: "novelId and name are required" }, { status: 400 });
  }

  if (append && branchId) {
    appendBranchContent(userId, novelId, branchId, content || "");
    const updated = getBranch(userId, novelId, branchId);
    return NextResponse.json({ success: true, branch: updated });
  }

  const id = branchId || `branch_${Date.now()}`;
  saveBranch(userId, id, novelId, name, parentOffset || 0, content || "");
  const branch = getBranch(userId, novelId, id);
  return NextResponse.json({ success: true, branch });
}
