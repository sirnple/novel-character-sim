/**
 * POST /api/novel/clean/apply — apply clean to an existing novel branch.
 * Keeps novelId stable; overwrites branch full text.
 * Spec: docs/superpowers/specs/2026-08-07-novel-cleaner-config-preview-design.md §6.2 / §8
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/lib/auth";
import {
  getBranchProse,
  getNovel,
  importNovel,
  overwriteBranchContent,
  rebuildBranchChapterMetaFromText,
} from "@/lib/db";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { cleanNovelText } from "@/core/parser/novel-cleaner";
import { getNovelCleanConfigFromRuntime } from "@/lib/runtime-settings";
import { novelFingerprint } from "@/lib/utils";
import type { NovelCleanConfig } from "@/lib/novel-clean-config";

export const dynamic = "force-dynamic";

interface ApplyBody {
  novelId?: string;
  branchId?: string;
  configFingerprint?: string;
  excludePatterns?: string[];
  excludeLineKeys?: string[];
  force?: boolean;
  mode?: "overwrite_branch" | "import_new";
  configOverride?: Partial<NovelCleanConfig>;
}

export async function POST(request: NextRequest) {
  const auth = resolveAuth(request);
  const userId = auth.userId;
  const rate = checkRateLimit(userId, "novel_clean", {
    windowMs: 60_000,
    maxRequests: 20,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: rateLimitMessage(rate) },
      { status: 429 },
    );
  }

  let body: ApplyBody;
  try {
    body = (await request.json()) as ApplyBody;
  } catch {
    return NextResponse.json({ error: "无效 JSON body" }, { status: 400 });
  }

  const novelId = String(body.novelId || "").trim();
  if (!novelId) {
    return NextResponse.json({ error: "novelId 必填" }, { status: 400 });
  }

  const branchId = (body.branchId || "main").trim() || "main";
  const mode = body.mode === "import_new" ? "import_new" : "overwrite_branch";
  const expectedFp = String(body.configFingerprint || "").trim();
  if (!expectedFp) {
    return NextResponse.json(
      { error: "configFingerprint 必填（须与最近 preview 一致）" },
      { status: 400 },
    );
  }

  const novel = getNovel(userId, novelId);
  if (!novel) {
    return NextResponse.json({ error: "小说不存在" }, { status: 404 });
  }

  const { text: sourceText, branch } = getBranchProse(userId, novelId, branchId);
  if (!branch && branchId !== "main") {
    return NextResponse.json({ error: "分支不存在" }, { status: 404 });
  }
  const raw = sourceText || novel.text || "";
  if (!raw.trim()) {
    return NextResponse.json({ error: "正文为空" }, { status: 400 });
  }

  // Explicit apply always runs (global enabled defaults to off)
  const resolved = getNovelCleanConfigFromRuntime({
    enabled: true,
    ...(body.configOverride || {}),
  });
  if (expectedFp !== resolved.fingerprint) {
    return NextResponse.json(
      {
        error: "清洗配置已变更，请重新预览",
        code: "CONFIG_FINGERPRINT_MISMATCH",
        configFingerprint: resolved.fingerprint,
      },
      { status: 409 },
    );
  }

  const cleaned = cleanNovelText(raw, {
    resolved,
    excludeLineKeys: Array.isArray(body.excludeLineKeys)
      ? body.excludeLineKeys.map(String)
      : undefined,
    excludePatterns: Array.isArray(body.excludePatterns)
      ? body.excludePatterns.map(String)
      : undefined,
  });

  if (
    cleaned.report.stats.removeRatio >= resolved.blockRemoveRatio &&
    !body.force
  ) {
    return NextResponse.json(
      {
        error: `删除比例 ${(cleaned.report.stats.removeRatio * 100).toFixed(1)}% 过高，请 force=true 确认`,
        code: "HIGH_REMOVE_RATIO",
        report: cleaned.report,
        needsForce: true,
      },
      { status: 409 },
    );
  }

  try {
    if (mode === "import_new") {
      const newId = novelFingerprint(cleaned.text);
      const title = `${novel.title || "未命名"}（清洗）`;
      importNovel(userId, newId, title, cleaned.text);
      rebuildBranchChapterMetaFromText(userId, newId, "main", cleaned.text);
      console.log(
        `[novel/clean/apply] import_new ${novelId} → ${newId} removed=${cleaned.report.stats.removedChars}`,
      );
      return NextResponse.json({
        ok: true,
        mode,
        novelId: newId,
        sourceNovelId: novelId,
        branchId: "main",
        totalLength: cleaned.text.length,
        report: cleaned.report,
      });
    }

    // overwrite_branch — keep novelId
    overwriteBranchContent(userId, novelId, branchId, cleaned.text);
    rebuildBranchChapterMetaFromText(userId, novelId, branchId, cleaned.text);
    console.log(
      `[novel/clean/apply] overwrite ${novelId}/${branchId} removed=${cleaned.report.stats.removedChars} len=${cleaned.text.length}`,
    );

    return NextResponse.json({
      ok: true,
      mode,
      novelId,
      branchId,
      totalLength: cleaned.text.length,
      report: cleaned.report,
    });
  } catch (e) {
    console.error("[novel/clean/apply]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "应用清洗失败" },
      { status: 500 },
    );
  }
}
