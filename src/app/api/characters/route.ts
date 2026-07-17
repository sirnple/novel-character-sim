import { NextRequest, NextResponse } from "next/server";
import type { CharacterProfile } from "@/types";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import { getCharacters, saveCharacters } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "characters_get", {
    windowMs: 60_000,
    maxRequests: 60,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }

  const novelId =
    request.nextUrl.searchParams.get("novelId") ||
    request.nextUrl.searchParams.get("sessionId") ||
    "";
  if (!novelId) {
    return NextResponse.json({ error: "缺少 novelId" }, { status: 400 });
  }

  const characters = getCharacters(userId, novelId);
  return NextResponse.json({ characters, novelId });
}

export async function PUT(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "characters_put", {
    windowMs: 60_000,
    maxRequests: 30,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }

  try {
    const body = await request.json();
    const novelId = String(body.novelId || body.sessionId || "").trim();
    if (!novelId) {
      return NextResponse.json({ error: "缺少 novelId" }, { status: 400 });
    }
    if (!Array.isArray(body.characters)) {
      return NextResponse.json({ error: "characters 须为数组" }, { status: 400 });
    }

    const characters = body.characters as CharacterProfile[];
    // Ensure each has id
    for (const c of characters) {
      if (!c.id) c.id = c.name || `char_${Math.random().toString(36).slice(2, 9)}`;
      if (!Array.isArray(c.relationships)) c.relationships = [];
    }

    saveCharacters(userId, novelId, characters);
    return NextResponse.json({ success: true, characters, novelId });
  } catch (error) {
    console.error("[characters PUT]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存角色失败" },
      { status: 500 },
    );
  }
}
