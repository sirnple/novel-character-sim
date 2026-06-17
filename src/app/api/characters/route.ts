import { NextRequest, NextResponse } from "next/server";
import type { CharacterProfile } from "@/types";
import { checkRateLimit, getClientIP, rateLimitMessage } from "@/lib/rate-limit";

// In-memory character store
const characterStore = new Map<string, CharacterProfile[]>();

export async function GET(request: NextRequest) {
  const ip = getClientIP(request);
  const rate = checkRateLimit(ip, "characters_get", { windowMs: 60_000, maxRequests: 60 });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: rateLimitMessage(rate) },
      { status: 429 }
    );
  }
  const sessionId = request.nextUrl.searchParams.get("sessionId") || "default";
  const characters = characterStore.get(sessionId) || [];
  return NextResponse.json({ characters });
}

export async function PUT(request: NextRequest) {
  const ip = getClientIP(request);
  const rate = checkRateLimit(ip, "characters_put", { windowMs: 60_000, maxRequests: 30 });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: rateLimitMessage(rate) },
      { status: 429 }
    );
  }
  try {
    const { sessionId, characters } = await request.json();
    const id = sessionId || "default";
    characterStore.set(id, characters as CharacterProfile[]);
    return NextResponse.json({ success: true, characters });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to save characters" },
      { status: 500 }
    );
  }
}
