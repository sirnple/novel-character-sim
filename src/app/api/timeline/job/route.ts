import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import {
  cancelTimelineJob,
  getTimelineJob,
  listTimelineJobsForNovel,
  retryTimelineUnit,
  startTimelineJob,
} from "@/core/form/timeline-job";
import { getTimeline, saveTimeline } from "@/lib/db";
import { isServerDebugMode } from "@/lib/debug-mode";

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

/**
 * POST { novelId, branchId? } — start async timeline job
 * POST { jobId, unitId, action: "retry_unit" } — retry one unit
 */
export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "timeline_job_post", { windowMs: 60_000, maxRequests: 10 });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }

  try {
    const body = await request.json();

    if (body.action === "retry_unit" || (body.jobId && body.unitId)) {
      const jobId = String(body.jobId || "").trim();
      const unitId = String(body.unitId || "").trim();
      if (!jobId || !unitId) {
        return NextResponse.json({ error: "jobId and unitId required" }, { status: 400 });
      }
      const existing = getTimelineJob(jobId);
      if (!existing || existing.userId !== userId) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const result = retryTimelineUnit(jobId, unitId);
      if (!result.ok) {
        return NextResponse.json({ error: result.error || "重试失败" }, { status: 400 });
      }
      return NextResponse.json({
        job: result.job || getTimelineJob(jobId),
        message: "已开始重试该单元",
      });
    }

    const novelId = String(body.novelId || "").trim();
    const branchId = String(body.branchId || "main").trim();
    if (!novelId) {
      return NextResponse.json({ error: "novelId required" }, { status: 400 });
    }

    // force: wipe existing timeline then restart (debug / explicit rebuild)
    const force = !!body.force;
    if (force) {
      if (!isServerDebugMode()) {
        return NextResponse.json(
          { error: "强制重跑时间线仅在调试模式下可用" },
          { status: 403 },
        );
      }
      const existing = getTimeline(userId, novelId, branchId);
      if (existing?.chapters?.length) {
        saveTimeline(
          userId,
          novelId,
          {
            novelId,
            branchId,
            totalChapters: 0,
            chapters: [],
          },
          branchId,
        );
      }
    }

    const job = startTimelineJob({ userId, novelId, branchId });
    return NextResponse.json({
      job,
      message: force
        ? `时间线已强制重跑（共 ${job.total} 个单元）`
        : `时间线任务已启动（共 ${job.total} 个单元，后台运行）`,
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
