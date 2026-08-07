/**
 * GET /api/novel/clean/status — public flag for UI (no secrets).
 */
import { NextResponse } from "next/server";
import { getNovelCleanConfigFromRuntime } from "@/lib/runtime-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = getNovelCleanConfigFromRuntime();
  return NextResponse.json({
    enabled: !!cfg.enabled,
  });
}
