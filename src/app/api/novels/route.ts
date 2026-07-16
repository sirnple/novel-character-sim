import { NextRequest, NextResponse } from "next/server";
import { listNovels, getNovel, getStoryInfo, getCharacters, deleteNovel, getBranchProse, listBranches } from "@/lib/db";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "novels_get", { windowMs: 60_000, maxRequests: 60 });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }
  const id = request.nextUrl.searchParams.get("id");
  const branchId = request.nextUrl.searchParams.get("branchId") || "main";

  if (id) {
    const { text, branch } = getBranchProse(userId, id, branchId);
    if (!branch) return NextResponse.json({ error: "Branch not found" }, { status: 404 });
    const novel = getNovel(userId, id);
    const storyInfo = getStoryInfo(userId, id);
    const characters = getCharacters(userId, id);
    const branches = listBranches(userId, id);
    return NextResponse.json({ id, title: novel?.title || "", text, storyInfo, characters, branches });
  }

  const novels = listNovels(userId);
  return NextResponse.json({ novels });
}

export async function DELETE(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "novels_delete", { windowMs: 60_000, maxRequests: 20 });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: rateLimitMessage(rate) },
      { status: 429 }
    );
  }
  let id = request.nextUrl.searchParams.get("id");
  if (!id) {
    try {
      const body = await request.json();
      id = body?.id || null;
    } catch { /* empty body */ }
  }
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  deleteNovel(userId, id);
  return NextResponse.json({ success: true, id });
}
