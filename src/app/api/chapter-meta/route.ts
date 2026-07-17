import { NextRequest, NextResponse } from "next/server";
import {
  getBranchChapterMeta,
  getNovelForm,
  getBranchProse,
  saveBranchChapterMeta,
  ensureMainBranch,
} from "@/lib/db";
import { extractChapterCatalog } from "@/core/form/chapter-catalog";
import { reextractChapters } from "@/core/form/reextract-chapters";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import { isServerDebugMode } from "@/lib/debug-mode";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "chapter_meta_get", {
    windowMs: 60_000,
    maxRequests: 60,
  });
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

/**
 * POST actions:
 * - reextract: program-only chapter catalog rescan (no LLM)
 */
export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "chapter_meta_post", {
    windowMs: 60_000,
    maxRequests: 20,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }

  try {
    const body = await request.json();
    const action = String(body.action || "reextract");
    const novelId = String(body.novelId || "").trim();
    const branchId = String(body.branchId || "main").trim() || "main";

    if (!novelId) {
      return NextResponse.json({ error: "缺少 novelId" }, { status: 400 });
    }

    if (action === "reextract") {
      // Dev-only: chapter rescan is a debug tool, not a product feature
      if (!isServerDebugMode()) {
        return NextResponse.json(
          { error: "章节重扫仅在调试模式下可用" },
          { status: 403 },
        );
      }
      const result = reextractChapters({
        userId,
        novelId,
        branchId,
        onTimelineMismatch: body.keepTimeline ? "keep" : "clear",
      });
      return NextResponse.json({
        ok: true,
        catalogCount: result.catalog.length,
        previousCatalogCount: result.previousCatalogCount,
        timelineCleared: result.timelineCleared,
        suggestTimelineRerun: result.suggestTimelineRerun,
        form: result.form,
        meta: result.meta,
        chapters: result.catalog.map((c) => ({
          number: c.number,
          title: c.title,
          startOffset: c.startOffset,
          endOffset: c.endOffset,
        })),
      });
    }

    return NextResponse.json({ error: `未知 action: ${action}` }, { status: 400 });
  } catch (e) {
    console.error("[chapter-meta POST]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "章节扫描失败" },
      { status: 500 },
    );
  }
}
