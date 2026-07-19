import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/rate-limit";
import { commitAnalysisWorkspace } from "@/core/agents/commit-analysis";

export const dynamic = "force-dynamic";

/**
 * Programmatic commit after user confirms save in the analysis panel.
 * Does not rely on the master LLM calling finish_novel_analysis.
 */
export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  let body: { novelId?: string; branchId?: string; userConfirmed?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const novelId = String(body.novelId || "").trim();
  const branchId = String(body.branchId || "main").trim() || "main";
  if (!novelId) {
    return NextResponse.json({ error: "novelId required" }, { status: 400 });
  }
  if (body.userConfirmed !== true && body.userConfirmed !== "true" as any) {
    return NextResponse.json(
      { error: "userConfirmed must be true" },
      { status: 400 },
    );
  }

  const result = commitAnalysisWorkspace({ userId, novelId, branchId });
  return NextResponse.json({
    ok: result.ok,
    content: result.content,
    committed: result.committed,
    skipped: result.skipped,
    characters: result.characters,
  });
}
