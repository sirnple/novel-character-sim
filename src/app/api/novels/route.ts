import { NextRequest, NextResponse } from "next/server";
import { listNovels, getNovel, getStoryInfo, getCharacters, deleteNovel, getBranch, ensureMainBranch } from "@/lib/db";
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
    let branch = getBranch(userId, id, branchId);
    if (!branch && branchId === "main") {
      ensureMainBranch(userId, id);
      branch = getBranch(userId, id, "main");
    }
    if (!branch) return NextResponse.json({ error: "Branch not found" }, { status: 404 });
    const novel = getNovel(userId, id);
    const storyInfo = getStoryInfo(userId, id);
    const characters = getCharacters(userId, id);
    return NextResponse.json({ id, title: novel?.title || "", text: branch.text, storyInfo, characters });
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
  const { id } = await request.json();
  deleteNovel(userId, id);
  return NextResponse.json({ success: true });
}
