import { NextRequest, NextResponse } from "next/server";
import {
  saveBranch,
  getBranch,
  listBranches,
  appendBranchContent,
  copyForeshadowingLedger,
  getBranchProse,
  ensureMainBranch,
} from "@/lib/db";
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

  const { novelId, branchId, name, parentOffset, content, append, parentBranchId } = await request.json();

  if (!novelId || !name) {
    return NextResponse.json({ error: "novelId and name are required" }, { status: 400 });
  }

  if (append && branchId) {
    appendBranchContent(userId, novelId, branchId, content || "");
    const updated = getBranch(userId, novelId, branchId);
    return NextResponse.json({ success: true, branch: updated });
  }

  const id = branchId || `branch_${Date.now()}`;
  const parentId = String(parentBranchId || "main");
  let body = typeof content === "string" ? content : "";
  const offset = typeof parentOffset === "number" ? parentOffset : Number(parentOffset) || 0;

  // If client sent empty content, fill from parent branch text up to parentOffset
  // (fixes older clients that zeroed baseText when a branch was already selected)
  if (!body.trim()) {
    ensureMainBranch(userId, novelId);
    const { text: parentText } = getBranchProse(userId, novelId, parentId);
    if (parentText) {
      body =
        offset > 0
          ? parentText.slice(0, Math.min(offset, parentText.length))
          : parentText;
    }
  }

  saveBranch(userId, id, novelId, name, offset, body);
  // Snapshot foreshadowing ledger from parent (default main)
  try {
    copyForeshadowingLedger(userId, novelId, parentId, id);
  } catch (e) {
    console.warn("[branches] copy foreshadowing ledger failed:", (e as Error).message);
  }
  const branch = getBranch(userId, novelId, id);
  return NextResponse.json({ success: true, branch });
}
