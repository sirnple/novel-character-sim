/**
 * POST /api/novel/clean/preview — read-only clean preview (no DB writes).
 * Accepts JSON { text | novelId } or multipart FormData with file.
 * Spec: docs/superpowers/specs/2026-08-07-novel-cleaner-config-preview-design.md §6.1
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/lib/auth";
import { getBranchProse, getNovel } from "@/lib/db";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import type { NovelCleanConfig } from "@/lib/novel-clean-config";
import {
  buildCleanPreview,
  CLEAN_PREVIEW_TEXT_MAX_CHARS,
} from "@/lib/novel-clean-preview";
import { isServerDebugMode } from "@/lib/debug-mode";
import { decodeNovelUpload } from "@/lib/novel-upload-decode";

export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

interface PreviewBody {
  text?: string;
  novelId?: string;
  branchId?: string;
  configOverride?: Partial<NovelCleanConfig>;
  excludePatterns?: string[];
  excludeLineKeys?: string[];
  maxSamples?: number;
}

function parseJsonList(raw: FormDataEntryValue | null): string[] | undefined {
  if (raw == null || raw === "") return undefined;
  try {
    const parsed = JSON.parse(String(raw));
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    /* ignore */
  }
  return String(raw)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function POST(request: NextRequest) {
  const auth = resolveAuth(request);
  const userId = auth.userId;
  const isAdmin = !!auth.user?.isAdmin;
  const rate = checkRateLimit(userId, "novel_clean", {
    windowMs: 60_000,
    maxRequests: 30,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: rateLimitMessage(rate) },
      { status: 429 },
    );
  }

  const contentType = request.headers.get("content-type") || "";
  let sourceText = "";
  let source: "text" | "novel" | "file" = "text";
  let novelIdOut: string | undefined;
  let branchIdOut: string | undefined;
  let configOverride: Partial<NovelCleanConfig> | null = null;
  let excludePatterns: string[] | undefined;
  let excludeLineKeys: string[] | undefined;
  let maxSamples = 30;

  try {
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return NextResponse.json({ error: "未提供文件" }, { status: 400 });
      }
      const skipSize = isServerDebugMode() || isAdmin;
      if (!skipSize && file.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          {
            error: `文件过大（${(file.size / (1024 * 1024)).toFixed(1)} MB），限制 5 MB`,
          },
          { status: 413 },
        );
      }
      const decoded = await decodeNovelUpload(file);
      if (!decoded.ok) {
        return NextResponse.json(
          { error: decoded.error },
          { status: decoded.status },
        );
      }
      sourceText = decoded.text;
      source = "file";
      excludeLineKeys = parseJsonList(formData.get("excludeLineKeys"));
      excludePatterns = parseJsonList(formData.get("excludePatterns"));
      const ms = formData.get("maxSamples");
      if (ms != null && String(ms).trim()) {
        maxSamples = Math.min(100, Math.max(1, Math.floor(Number(ms) || 30)));
      }
      const overrideRaw = formData.get("configOverride");
      if (overrideRaw && String(overrideRaw).trim()) {
        try {
          configOverride = JSON.parse(String(overrideRaw)) as Partial<NovelCleanConfig>;
        } catch {
          return NextResponse.json(
            { error: "configOverride 不是有效 JSON" },
            { status: 400 },
          );
        }
      }
    } else {
      let body: PreviewBody;
      try {
        body = (await request.json()) as PreviewBody;
      } catch {
        return NextResponse.json({ error: "无效 JSON body" }, { status: 400 });
      }

      const branchId = (body.branchId || "main").trim() || "main";
      if (typeof body.text === "string" && body.text.length > 0) {
        sourceText = body.text;
        source = "text";
      } else if (body.novelId && String(body.novelId).trim()) {
        const novelId = String(body.novelId).trim();
        const novel = getNovel(userId, novelId);
        if (!novel) {
          return NextResponse.json({ error: "小说不存在" }, { status: 404 });
        }
        const { text, branch } = getBranchProse(userId, novelId, branchId);
        if (!branch && branchId !== "main") {
          return NextResponse.json({ error: "分支不存在" }, { status: 404 });
        }
        sourceText = text || novel.text || "";
        source = "novel";
        novelIdOut = novelId;
        branchIdOut = branchId;
      } else {
        return NextResponse.json(
          { error: "请提供 text、novelId 或 file" },
          { status: 400 },
        );
      }

      configOverride = body.configOverride ?? null;
      excludePatterns = Array.isArray(body.excludePatterns)
        ? body.excludePatterns.map(String)
        : undefined;
      excludeLineKeys = Array.isArray(body.excludeLineKeys)
        ? body.excludeLineKeys.map(String)
        : undefined;
      if (body.maxSamples != null) {
        maxSamples = Math.min(
          100,
          Math.max(1, Math.floor(Number(body.maxSamples) || 30)),
        );
      }
    }
  } catch (e) {
    console.error("[novel/clean/preview] parse body", e);
    return NextResponse.json({ error: "无法解析请求" }, { status: 400 });
  }

  if (!sourceText.trim()) {
    return NextResponse.json({ error: "正文为空" }, { status: 400 });
  }

  const skipSizeLimit = isServerDebugMode() || isAdmin;
  if (!skipSizeLimit && sourceText.length > CLEAN_PREVIEW_TEXT_MAX_CHARS) {
    return NextResponse.json(
      {
        error: `文本过长（${(sourceText.length / (1024 * 1024)).toFixed(1)} MB 字符量），限制约 5 MB`,
      },
      { status: 413 },
    );
  }

  try {
    const payload = buildCleanPreview({
      text: sourceText,
      configOverride,
      excludePatterns,
      excludeLineKeys,
      maxSamples,
    });

    return NextResponse.json({
      ok: true,
      source,
      novelId: novelIdOut,
      branchId: branchIdOut,
      ...payload,
    });
  } catch (e) {
    console.error("[novel/clean/preview]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "清洗预览失败" },
      { status: 500 },
    );
  }
}
