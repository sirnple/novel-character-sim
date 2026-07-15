import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/rate-limit";
import { listIdeas, getIdea, saveIdea, deleteIdea } from "@/lib/db";
import { generateId } from "@/lib/utils";
import type { IdeaLibraryEntry } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const id = request.nextUrl.searchParams.get("id");
  const sourceNovelId = request.nextUrl.searchParams.get("sourceNovelId") || undefined;
  if (id) {
    const idea = getIdea(userId, id);
    if (!idea) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ idea });
  }
  return NextResponse.json({ ideas: listIdeas(userId, sourceNovelId ? { sourceNovelId } : undefined) });
}

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const body = await request.json();
  if (!body.title || !body.content) {
    return NextResponse.json({ error: "title and content required" }, { status: 400 });
  }
  const entry: IdeaLibraryEntry = {
    id: body.id || `idea_${generateId()}`,
    title: String(body.title),
    content: String(body.content),
    tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
    source: body.source === "extracted" ? "extracted" : "manual",
    sourceNovelId: String(body.sourceNovelId || ""),
    sourceNovelTitle: String(body.sourceNovelTitle || ""),
  };
  saveIdea(userId, entry);
  return NextResponse.json({ idea: entry });
}

export async function DELETE(request: NextRequest) {
  const userId = getUserId(request);
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  deleteIdea(userId, id);
  return NextResponse.json({ ok: true });
}
