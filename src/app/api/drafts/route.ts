import { NextRequest, NextResponse } from "next/server";
import { saveDraft, getDraft, listDrafts, deleteDraft } from "@/lib/db";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "drafts_get", { windowMs: 60_000, maxRequests: 30 });
  if (!rate.allowed) return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  const novelId = request.nextUrl.searchParams.get("novelId");
  const id = request.nextUrl.searchParams.get("id");
  if (id) {
    const draft = getDraft(userId, id);
    return draft ? NextResponse.json({ draft }) : NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return novelId ? NextResponse.json({ drafts: listDrafts(userId, novelId) }) : NextResponse.json({ error: "novelId required" }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "drafts_post", { windowMs: 60_000, maxRequests: 20 });
  if (!rate.allowed) return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  const { id, novelId, title, content, parentOffset } = await request.json();
  const draftId = id || `draft_${Date.now()}`;
  saveDraft(userId, draftId, novelId, title || "", content || "", parentOffset || 0);
  return NextResponse.json({ success: true, draft: getDraft(userId, draftId) });
}

export async function DELETE(request: NextRequest) {
  const userId = getUserId(request);
  const { id } = await request.json();
  deleteDraft(userId, id);
  return NextResponse.json({ success: true });
}
