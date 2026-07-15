import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/rate-limit";
import { listStyles, getStyle, saveStyle, deleteStyle } from "@/lib/db";
import { generateId } from "@/lib/utils";
import type { StyleLibraryEntry } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const novelId = request.nextUrl.searchParams.get("novelId");
  const id = request.nextUrl.searchParams.get("id");
  if (id) {
    const s = getStyle(userId, id);
    if (!s) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ style: s });
  }
  if (!novelId) return NextResponse.json({ error: "novelId required" }, { status: 400 });
  return NextResponse.json({ styles: listStyles(userId, novelId) });
}

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const body = await request.json();
  const novelId = body.novelId as string;
  if (!novelId || !body.name) {
    return NextResponse.json({ error: "novelId and name required" }, { status: 400 });
  }
  const entry: StyleLibraryEntry = {
    id: body.id || `style_${generateId()}`,
    novelId,
    name: String(body.name),
    description: String(body.description || ""),
    style: body.style || {
      styleDescription: body.description || body.name,
      genre: body.genre || "",
      narrativeTechniques: body.narrativeTechniques || [],
      languageFeatures: body.languageFeatures || "",
      pacingDescription: body.pacingDescription || "",
      tone: body.tone || "",
      examplePassages: body.examplePassages || [],
      contentRating: body.contentRating || { level: "", description: "", hasExplicitContent: false },
    },
    source: body.source === "extracted" ? "extracted" : "manual",
  };
  saveStyle(userId, entry);
  return NextResponse.json({ style: entry });
}

export async function DELETE(request: NextRequest) {
  const userId = getUserId(request);
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  deleteStyle(userId, id);
  return NextResponse.json({ ok: true });
}
