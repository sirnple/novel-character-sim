import { NextRequest, NextResponse } from "next/server";
import { listNovels, getNovel, getStoryInfo, getCharacters, deleteNovel } from "@/lib/db";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "novels_get", { windowMs: 60_000, maxRequests: 60 });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: rateLimitMessage(rate) },
      { status: 429 }
    );
  }
  const id = request.nextUrl.searchParams.get("id");

  if (id) {
    const novel = getNovel(id);
    if (!novel) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const storyInfo = getStoryInfo(id);
    const characters = getCharacters(id);
    return NextResponse.json({ id, ...novel, storyInfo, characters });
  }

  const novels = listNovels();
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
  deleteNovel(id);
  return NextResponse.json({ success: true });
}
