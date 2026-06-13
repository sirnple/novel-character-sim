import { NextRequest, NextResponse } from "next/server";
import type { CharacterProfile } from "@/types";

// In-memory character store
const characterStore = new Map<string, CharacterProfile[]>();

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId") || "default";
  const characters = characterStore.get(sessionId) || [];
  return NextResponse.json({ characters });
}

export async function PUT(request: NextRequest) {
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
