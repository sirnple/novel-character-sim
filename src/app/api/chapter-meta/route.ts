import { NextRequest, NextResponse } from "next/server";
import {
  getBranchChapterMeta,
  getNovelForm,
  getBranchProse,
  saveBranchChapterMeta,
  ensureMainBranch,
} from "@/lib/db";
import { extractChapterCatalog } from "@/core/form/chapter-catalog";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "chapter_meta_get", { windowMs: 60_000, maxRequests: 60 });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }

  const novelId = request.nextUrl.searchParams.get("novelId") || "";
  const branchId = request.nextUrl.searchParams.get("branchId") || "main";
  if (!novelId) {
    return NextResponse.json({ error: "novelId required" }, { status: 400 });
  }

  const form = getNovelForm(userId, novelId);
  let meta = getBranchChapterMeta(userId, novelId, branchId);

  // Lazy build catalog if form says chaptering and catalog empty
  if (form?.chaptering?.enabled && meta.chapters.length === 0) {
    ensureMainBranch(userId, novelId);
    const { text } = getBranchProse(userId, novelId, branchId);
    if (text) {
      const catalog = extractChapterCatalog(text, form.chaptering);
      if (catalog.length) {
        meta = {
          ...meta,
          chapters: catalog,
          chapterBoundary: meta.chapterBoundary || "closed",
        };
        saveBranchChapterMeta(userId, meta);
      }
    }
  }

  return NextResponse.json({ form, meta });
}
