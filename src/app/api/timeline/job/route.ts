import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import {
  cancelTimelineJob,
  getTimelineJob,
  listTimelineJobsForNovel,
  startTimelineJob,
} from "@/core/form/timeline-job";

/** GET ?jobId= | ?novelId=&branchId= */
export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "timeline_job_get", { windowMs: 60_000, maxRequests: 120 });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }

  const jobId = request.nextUrl.searchParams.get("jobId");
  if (jobId) {
    const job = getTimelineJob(jobId);
    if (!job || job.userId !== userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ job });
  }

  const novelId = request.nextUrl.searchParams.get("novelId") || "";
  const branchId = request.nextUrl.searchParams.get("branchId") || "main";
  if (!novelId) {
    return NextResponse.json({ error: "jobId or novelId required" }, { status: 400 });
  }
  const jobs = listTimelineJobsForNovel(userId, novelId, branchId);
  return NextResponse.json({ jobs, latest: jobs[0] || null });
}

/** POST { novelId, branchId? } — start async timeline job */
export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "timeline_job_post", { windowMs: 60_000, maxRequests: 5 });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }

  try {
    const body = await request.json();
    const novelId = String(body.novelId || "").trim();
    const branchId = String(body.branchId || "main").trim();
    if (!novelId) {
      return NextResponse.json({ error: "novelId required" }, { status: 400 });
    }
    const job = startTimelineJob({ userId, novelId, branchId });
    return NextResponse.json({
      job,
      message: `时间线任务已启动（共 ${job.total} 个单元，后台运行，可在阅读页查看进度）`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "启动失败" },
      { status: 400 },
    );
  }
}

/** DELETE ?jobId= — cancel */
export async function DELETE(request: NextRequest) {
  const userId = getUserId(request);
  const jobId = request.nextUrl.searchParams.get("jobId") || "";
  if (!jobId) {
    return NextResponse.json({ error: "jobId required" }, { status: 400 });
  }
  const job = getTimelineJob(jobId);
  if (!job || job.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  cancelTimelineJob(jobId);
  return NextResponse.json({ success: true });
}
