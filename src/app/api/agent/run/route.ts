import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import {
  agentRunToDto,
  cancelAgentRun,
  getAgentRun,
  listAgentRunsForNovel,
} from "@/core/agents/agent-run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET ?runId= | ?novelId=&branchId=
 * Poll server-owned agent run events (OpenCode-style subscribe).
 */
export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "agent_run_get", {
    windowMs: 60_000,
    maxRequests: 180,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: rateLimitMessage(rate) },
      { status: 429 },
    );
  }

  const runId = request.nextUrl.searchParams.get("runId");
  const afterSeq = Number(request.nextUrl.searchParams.get("afterSeq") || "0");

  if (runId) {
    const run = getAgentRun(runId);
    if (!run || run.userId !== userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({
      run: agentRunToDto(run, Number.isFinite(afterSeq) ? afterSeq : 0),
    });
  }

  const novelId = request.nextUrl.searchParams.get("novelId") || "";
  const branchId = request.nextUrl.searchParams.get("branchId") || "main";
  if (!novelId) {
    return NextResponse.json(
      { error: "runId or novelId required" },
      { status: 400 },
    );
  }
  const runs = listAgentRunsForNovel(userId, novelId, branchId).map((r) =>
    agentRunToDto(r, 0),
  );
  return NextResponse.json({
    runs,
    latest: runs[0] || null,
    active:
      runs.find(
        (r) => r.status === "running" || r.status === "awaiting_user",
      ) || null,
  });
}

/** DELETE ?runId= — cancel server-owned run */
export async function DELETE(request: NextRequest) {
  const userId = getUserId(request);
  const runId = request.nextUrl.searchParams.get("runId") || "";
  if (!runId) {
    return NextResponse.json({ error: "runId required" }, { status: 400 });
  }
  const run = getAgentRun(runId);
  if (!run || run.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const ok = cancelAgentRun(runId);
  return NextResponse.json({
    ok,
    run: agentRunToDto(getAgentRun(runId) || run, 0),
  });
}
