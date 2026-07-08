import { NextRequest, NextResponse } from "next/server";
import { appendNovelContent, getNovel, appendBranchContent, getBranch, saveBranch } from "@/lib/db";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "writer_save", { windowMs: 60_000, maxRequests: 20 });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }

  try {
    const { novelId, content, branchId, branchName, parentOffset } = await request.json();
    if (!novelId || !content) {
      return NextResponse.json({ error: "novelId and content are required" }, { status: 400 });
    }

    // Branch save
    if (branchId || branchName) {
      if (branchId) {
        // Append to existing branch
        appendBranchContent(userId, branchId, content);
        const updated = getBranch(userId, branchId);
        return NextResponse.json({ success: true, fullText: updated?.text || "", branch: updated });
      }
      // Create new branch
      const id = `branch_${Date.now()}`;
      saveBranch(userId, id, novelId, branchName, parentOffset || 0, content);
      const created = getBranch(userId, id);
      return NextResponse.json({ success: true, fullText: created?.text || "", branch: created });
    }

    // Main text save (existing behavior)
    appendNovelContent(userId, novelId, content);
    const updated = getNovel(userId, novelId);
    return NextResponse.json({ success: true, fullText: updated?.text || "" });
  } catch (error) {
    console.error("Writer save error:", error);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}
