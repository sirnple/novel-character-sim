import { NextRequest, NextResponse } from "next/server";
import {
  createShareOverview,
  getCharacters,
  getNovel,
  getStoryInfo,
  listShareOverviews,
} from "@/lib/db";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import {
  buildSharePayload,
  hasShareableContent,
  isShareVisibility,
  mintShareToken,
  type ShareVisibility,
} from "@/lib/share-payload";

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "share_list", { windowMs: 60_000, maxRequests: 60 });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }
  const novelId = request.nextUrl.searchParams.get("novelId");
  if (!novelId) {
    return NextResponse.json({ error: "novelId required" }, { status: 400 });
  }
  const novel = getNovel(userId, novelId);
  if (!novel) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const includeRevoked = request.nextUrl.searchParams.get("includeRevoked") === "1";
  const shares = listShareOverviews(userId, novelId, { includeRevoked });
  return NextResponse.json({ shares });
}

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "share_create", { windowMs: 60_000, maxRequests: 20 });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }
  let body: { novelId?: string; visibility?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const novelId = body.novelId?.trim();
  if (!novelId) {
    return NextResponse.json({ error: "novelId required" }, { status: 400 });
  }
  const visibility: ShareVisibility = isShareVisibility(body.visibility)
    ? body.visibility
    : "public";

  const novel = getNovel(userId, novelId);
  if (!novel) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const story = getStoryInfo(userId, novelId);
  const characters = getCharacters(userId, novelId);
  if (!hasShareableContent(story, characters)) {
    return NextResponse.json(
      { error: "empty", message: "请先完成故事或角色分析" },
      { status: 400 },
    );
  }

  const payload = buildSharePayload({
    title: novel.title,
    story,
    characters,
  });
  const token = mintShareToken();
  createShareOverview({
    token,
    ownerUserId: userId,
    novelId,
    visibility,
    payload,
  });
  const url = `/share/${token}`;
  return NextResponse.json({
    token,
    url,
    visibility,
    createdAt: new Date().toISOString(),
  });
}
