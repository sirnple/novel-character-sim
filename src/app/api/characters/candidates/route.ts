/**
 * Debug: program-only character name candidate scan (no LLM).
 * POST { novelId } or { text }
 */
import { NextRequest, NextResponse } from "next/server";
import { getNovel, getBranchProse } from "@/lib/db";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import { isServerDebugMode } from "@/lib/debug-mode";
import {
  formatCandidatesForPrompt,
  scanCharacterCandidates,
} from "@/core/extractor/character-candidates";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isServerDebugMode()) {
    return NextResponse.json(
      { error: "程序扫人名仅在调试模式下可用" },
      { status: 403 },
    );
  }

  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "char_candidates", {
    windowMs: 60_000,
    maxRequests: 30,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const novelId = String(body.novelId || body.sessionId || "").trim();
    let text = typeof body.text === "string" ? body.text : "";

    if (!text && novelId) {
      const novel = getNovel(userId, novelId);
      if (novel?.text?.trim()) {
        text = novel.text;
      } else {
        const branch = getBranchProse(userId, novelId, "main");
        text = branch?.text || "";
      }
    }

    if (!text.trim()) {
      return NextResponse.json(
        { error: "需要 novelId 或 text" },
        { status: 400 },
      );
    }

    const t0 = Date.now();
    const maxCandidates = Math.min(
      Math.max(Number(body.maxCandidates) || 80, 10),
      200,
    );
    const candidates = scanCharacterCandidates(text, { maxCandidates });
    const ms = Date.now() - t0;

    return NextResponse.json({
      ok: true,
      textLength: text.length,
      count: candidates.length,
      ms,
      candidates,
      promptPreview: formatCandidatesForPrompt(candidates, 60),
    });
  } catch (error) {
    console.error("[characters/candidates]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "扫描失败" },
      { status: 500 },
    );
  }
}
