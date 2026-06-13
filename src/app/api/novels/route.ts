import { NextRequest, NextResponse } from "next/server";
import { listNovels, getNovel, getStoryInfo, getCharacters, deleteNovel } from "@/lib/db";

export async function GET(request: NextRequest) {
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
  const { id } = await request.json();
  deleteNovel(id);
  return NextResponse.json({ success: true });
}
