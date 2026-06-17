import { NextRequest, NextResponse } from "next/server";
import { saveScene, getScene, listScenes } from "@/lib/db";
import { getUserId } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const { sceneId, novelId, scene } = await request.json();
  if (!sceneId || !scene) {
    return NextResponse.json({ error: "sceneId and scene required" }, { status: 400 });
  }
  saveScene(userId, sceneId, novelId || "default", scene);
  return NextResponse.json({ success: true });
}

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const sceneId = request.nextUrl.searchParams.get("sceneId");
  const novelId = request.nextUrl.searchParams.get("novelId");

  if (sceneId) {
    const s = getScene(userId, sceneId);
    return s ? NextResponse.json(s) : NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const scenes = listScenes(userId, novelId || undefined);
  return NextResponse.json({ scenes });
}
