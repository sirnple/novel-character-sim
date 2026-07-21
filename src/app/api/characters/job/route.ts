import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import {
  cancelCharacterExtractJob,
  getCharacterExtractJob,
  listCharacterExtractJobs,
  startCharacterExtractJob,
} from "@/core/extractor/character-extract-job";
import { getCharacters } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET ?jobId= | ?novelId= */
export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "char_job_get", {
    windowMs: 60_000,
    maxRequests: 120,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }

  const jobId = request.nextUrl.searchParams.get("jobId");
  if (jobId) {
    const job = getCharacterExtractJob(jobId);
    if (!job || job.userId !== userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const characters =
      job.status === "done" ? getCharacters(userId, job.novelId) : undefined;
    return NextResponse.json({ job, characters });
  }

  const novelId = request.nextUrl.searchParams.get("novelId") || "";
  if (!novelId) {
    return NextResponse.json({ error: "jobId or novelId required" }, { status: 400 });
  }
  const jobs = listCharacterExtractJobs(userId, novelId);
  return NextResponse.json({ jobs, latest: jobs[0] || null });
}

/** POST { novelId, forceRefresh?, text? } — start async character job */
export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "char_job_post", {
    windowMs: 60_000,
    maxRequests: 8,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }

  try {
    const body = await request.json();
    const novelId = String(body.novelId || body.sessionId || "").trim();
    if (!novelId) {
      return NextResponse.json({ error: "novelId required" }, { status: 400 });
    }
    const job = startCharacterExtractJob({
      userId,
      novelId,
      branchId: String(body.branchId || "main"),
      forceRefresh: body.forceRefresh === false ? false : true,
      text: typeof body.text === "string" ? body.text : undefined,
    });
    return NextResponse.json({
      job,
      message: `角色任务已启动（共 ${job.total} 段，后台扫描）`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "启动失败" },
      { status: 400 },
    );
  }
}

/** DELETE ?jobId= */
export async function DELETE(request: NextRequest) {
  const userId = getUserId(request);
  const jobId = request.nextUrl.searchParams.get("jobId") || "";
  if (!jobId) {
    return NextResponse.json({ error: "jobId required" }, { status: 400 });
  }
  const job = getCharacterExtractJob(jobId);
  if (!job || job.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const ok = cancelCharacterExtractJob(jobId);
  return NextResponse.json({ ok, job: getCharacterExtractJob(jobId) });
}
