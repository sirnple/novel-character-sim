import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/core/prompts/admin-auth";
import {
  envRuntimeSettings,
  getRuntimeSettings,
  patchRuntimeSettings,
  resetRuntimeSettings,
  type RuntimeSettings,
} from "@/lib/runtime-settings";

export const dynamic = "force-dynamic";

/** GET — current effective settings + env bootstrap + docs. */
export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }
  return NextResponse.json({
    effective: getRuntimeSettings(),
    envDefaults: envRuntimeSettings(),
    docs: {
      mentionScanConcurrency: "普通用户并行 LLM 数，默认 4",
      mentionScanBatchUnits: "普通用户每 call 打包 unit 数，默认 4",
      mentionScanBatchChars: "每 call 正文字符预算，默认 16000",
      privilegedMentionScanConcurrency:
        "admin/debug 并行 LLM 数，默认 20（更高但仍限流友好，非一次拉满）",
      adminMentionScanBatchUnits: "管理员每 call unit 数，默认 1",
      env: [
        "CHARACTER_MENTION_CONCURRENCY",
        "CHARACTER_MENTION_BATCH_UNITS",
        "CHARACTER_MENTION_BATCH_CHARS",
        "CHARACTER_MENTION_PRIVILEGED_CONCURRENCY",
        "CHARACTER_MENTION_ADMIN_BATCH_UNITS",
      ],
    },
  });
}

/** PATCH — merge runtime overrides (persisted under data/runtime-settings.json). */
export async function PATCH(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }
  try {
    const body = (await req.json()) as Partial<RuntimeSettings> & {
      reset?: boolean;
    };
    if (body.reset) {
      return NextResponse.json({
        ok: true,
        effective: resetRuntimeSettings(),
      });
    }
    const {
      mentionScanConcurrency,
      mentionScanBatchUnits,
      mentionScanBatchChars,
      privilegedMentionScanConcurrency,
      adminMentionScanBatchUnits,
    } = body;
    const effective = patchRuntimeSettings({
      ...(mentionScanConcurrency !== undefined
        ? { mentionScanConcurrency }
        : {}),
      ...(mentionScanBatchUnits !== undefined
        ? { mentionScanBatchUnits }
        : {}),
      ...(mentionScanBatchChars !== undefined
        ? { mentionScanBatchChars }
        : {}),
      ...(privilegedMentionScanConcurrency !== undefined
        ? { privilegedMentionScanConcurrency }
        : {}),
      ...(adminMentionScanBatchUnits !== undefined
        ? { adminMentionScanBatchUnits }
        : {}),
    });
    return NextResponse.json({ ok: true, effective });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "invalid body" },
      { status: 400 },
    );
  }
}
