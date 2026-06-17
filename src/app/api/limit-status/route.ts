import { NextRequest, NextResponse } from "next/server";
import { queryRateLimit, getUserId } from "@/lib/rate-limit";

const ENDPOINTS = [
  { key: "chat", label: "角色对话", windowMs: 60_000, maxRequests: 20 },
  { key: "extract", label: "角色提取", windowMs: 300_000, maxRequests: 3 },
  { key: "scene_recommend", label: "场景推荐", windowMs: 60_000, maxRequests: 10 },
  { key: "simulation_stream", label: "模拟流", windowMs: 300_000, maxRequests: 5 },
  { key: "novel_parse", label: "文件上传", windowMs: 60_000, maxRequests: 30 },
];

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const limits = ENDPOINTS.map((e) => {
    const status = queryRateLimit(userId, e.key, { windowMs: e.windowMs, maxRequests: e.maxRequests });
    return {
      key: e.key,
      label: e.label,
      limit: e.maxRequests,
      remaining: status.remaining,
      windowSec: Math.round(e.windowMs / 1000),
      resetSec: Math.max(0, Math.ceil((status.resetAt - Date.now()) / 1000)),
    };
  });
  return NextResponse.json({ userId, limits });
}
