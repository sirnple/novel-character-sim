import { NextRequest, NextResponse } from "next/server";
import { listGenerationLogs, getGenerationLog } from "@/lib/db";
import { getUserId } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const limit = parseInt(url.searchParams.get("limit") || "50");
  const category = url.searchParams.get("category") || undefined;

  if (id) {
    const entry = getGenerationLog(userId, id);
    if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(entry);
  }

  const logs = listGenerationLogs(userId, limit, category);
  return NextResponse.json({ logs });
}
