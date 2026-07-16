import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import {
  appendBranchContent,
  ensureMainBranch,
  getBranch,
  getForeshadowingLedger,
  saveForeshadowingLedger,
} from "@/lib/db";
import {
  getForeshadowRealization,
  getProse,
  saveProse,
} from "@/core/agents/intermediate-store";
import { commitRealization } from "@/core/foreshadowing/commit";

export const dynamic = "force-dynamic";

/**
 * User accepts continuation: write prose into branch + commit foreshadowing realized.
 * Does NOT trust plan alone — requires realization from review_foreshadowing.
 */
export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "continuation_accept", {
    windowMs: 60_000,
    maxRequests: 20,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }

  try {
    const body = await request.json();
    const novelId = String(body.novelId || "");
    const branchId = String(body.branchId || "main");
    const allowPartial = !!body.allowPartialForeshadowing;
    let content = String(body.content || "").trim();

    if (!novelId) {
      return NextResponse.json({ error: "novelId required" }, { status: 400 });
    }

    if (!content) {
      content = (getProse(novelId, branchId) || "").trim();
    }
    if (!content || content.length < 50) {
      return NextResponse.json(
        { error: "没有可接受的正文草稿（请先完成 write_prose）" },
        { status: 400 },
      );
    }

    const realization = getForeshadowRealization(novelId, branchId);
    if (!realization) {
      return NextResponse.json(
        {
          error:
            "尚无伏笔审查结算（realization）。请先跑 review_foreshadowing / run_reviews。",
          code: "NO_REALIZATION",
        },
        { status: 400 },
      );
    }

    if (!realization.pass && !allowPartial) {
      return NextResponse.json(
        {
          error:
            "伏笔审查未通过。请 rewrite 后重审，或显式选择「允许不全落实」后再接受。",
          code: "FORESHADOW_FAIL",
          pass: false,
          gaps: realization.gaps,
          findings: realization.findings,
        },
        { status: 409 },
      );
    }

    ensureMainBranch(userId, novelId);
    const before = getBranch(userId, novelId, branchId);
    if (!before && branchId !== "main") {
      return NextResponse.json({ error: "分支不存在" }, { status: 404 });
    }
    if (branchId === "main") ensureMainBranch(userId, novelId);

    appendBranchContent(userId, novelId, branchId, content);
    const after = getBranch(userId, novelId, branchId);

    const ledger = getForeshadowingLedger(userId, novelId, branchId);
    const next = commitRealization(ledger, realization);
    saveForeshadowingLedger(next);

    // Clear draft prose after accept (optional keep for UI — clear to avoid re-accept)
    saveProse(novelId, branchId, "");

    return NextResponse.json({
      success: true,
      branch: after,
      ledger: next,
      allowPartial,
      applied: {
        planted: next.active.length - ledger.active.length,
        // rough; client can diff if needed
      },
      realizationPass: realization.pass,
    });
  } catch (e) {
    console.error("[continuation/accept]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Accept failed" },
      { status: 500 },
    );
  }
}
