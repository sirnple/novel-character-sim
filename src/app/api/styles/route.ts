import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/rate-limit";
import { listStyles, getStyle, saveStyle, deleteStyle } from "@/lib/db";
import { generateId } from "@/lib/utils";
import type { StyleLibraryEntry, WritingStyle } from "@/types";

export const dynamic = "force-dynamic";

const EMPTY_STYLE: WritingStyle = {
  genre: "", styleDescription: "", narrativeTechniques: [], languageFeatures: "",
  pacingDescription: "", tone: "", examplePassages: [],
  contentRating: { level: "", description: "", hasExplicitContent: false },
};

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const id = request.nextUrl.searchParams.get("id");
  const sourceNovelId = request.nextUrl.searchParams.get("sourceNovelId") || undefined;
  if (id) {
    const style = getStyle(userId, id);
    if (!style) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ style });
  }
  return NextResponse.json({ styles: listStyles(userId, sourceNovelId ? { sourceNovelId } : undefined) });
}

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const body = await request.json();
  if (!body.name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const entry: StyleLibraryEntry = {
    id: body.id || `style_${generateId()}`,
    name: String(body.name),
    description: String(body.description || ""),
    style: { ...EMPTY_STYLE, ...(body.style || {}), styleDescription: body.style?.styleDescription || body.description || body.name },
    source: body.source === "extracted" ? "extracted" : "manual",
    sourceNovelId: String(body.sourceNovelId || ""),
    sourceNovelTitle: String(body.sourceNovelTitle || ""),
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
