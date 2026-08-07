import { NextRequest, NextResponse } from "next/server";
import { parseNovel } from "@/core/parser/novel-parser";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { resolveAuth } from "@/lib/auth";
import { importNovel } from "@/lib/db";
import {
  cleanFilenameTitle,
  novelFingerprint,
  resolveNovelTitle,
} from "@/lib/utils";
import { createLLMProvider } from "@/core/llm/factory";
import { runWithTokenContext } from "@/lib/token-usage-context";
import type { LLMMessage } from "@/types";
import { isServerDebugMode } from "@/lib/debug-mode";
import { decodeNovelUpload } from "@/lib/novel-upload-decode";
import { cleanNovelText } from "@/core/parser/novel-cleaner";
import { getNovelCleanConfigFromRuntime } from "@/lib/runtime-settings";

const MAX_FILE_BYTES = 5 * 1024 * 1024;  // 5 MB (production / non-debug)

function formFlag(formData: FormData, key: string): boolean {
  const v = formData.get(key);
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function formStringList(formData: FormData, key: string): string[] | undefined {
  const raw = formData.get(key);
  if (raw == null || raw === "") return undefined;
  try {
    const parsed = JSON.parse(String(raw));
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    /* comma-separated fallback */
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
  const rate = checkRateLimit(userId, "novel_parse", { windowMs: 60_000, maxRequests: 30 });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: rateLimitMessage(rate) },
      { status: 429 }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "未提供文件" }, { status: 400 });
    }

    const fileBytes = file.size;
    const debugMode = isServerDebugMode();
    const skipSizeLimit = debugMode || isAdmin;

    // Size check — skipped for admin users and debug (large TXT testing)
    if (!skipSizeLimit && fileBytes > MAX_FILE_BYTES) {
      const mb = (fileBytes / (1024 * 1024)).toFixed(1);
      return NextResponse.json(
        { error: `文件过大（${mb} MB），限制为 5 MB。请拆分章节后重新上传。` },
        { status: 413 }
      );
    }
    if (skipSizeLimit && fileBytes > MAX_FILE_BYTES) {
      console.log(
        `[NovelParse] ${isAdmin ? "admin" : "debug"}: allowing large upload ${(fileBytes / (1024 * 1024)).toFixed(1)} MB`,
      );
    }

    const decoded = await decodeNovelUpload(file);
    if (!decoded.ok) {
      return NextResponse.json({ error: decoded.error }, { status: decoded.status });
    }

    let novelText = decoded.text;
    const originalFileName = decoded.originalFileName;
    const filenameTitle = cleanFilenameTitle(originalFileName);

    if (!novelText.trim()) {
      return NextResponse.json({ error: "The novel text is empty" }, { status: 400 });
    }

    // applyClean: "1" after user confirms preview; forceClean skips fingerprint check
    const applyClean = formFlag(formData, "applyClean");
    const forceClean = formFlag(formData, "forceClean");
    let cleanReport: ReturnType<typeof cleanNovelText>["report"] | null = null;

    if (applyClean) {
      const excludeLineKeys = formStringList(formData, "excludeLineKeys");
      const excludePatterns = formStringList(formData, "excludePatterns");
      const expectedFp = String(formData.get("configFingerprint") || "").trim();
      // Explicit applyClean always runs rules (global enabled defaults to off)
      const resolved = getNovelCleanConfigFromRuntime({ enabled: true });

      if (expectedFp && expectedFp !== resolved.fingerprint) {
        return NextResponse.json(
          {
            error: "清洗配置已变更，请重新预览",
            code: "CONFIG_FINGERPRINT_MISMATCH",
            configFingerprint: resolved.fingerprint,
          },
          { status: 409 },
        );
      }

      const cleaned = cleanNovelText(novelText, {
        resolved,
        excludeLineKeys,
        excludePatterns,
      });
      cleanReport = cleaned.report;

      if (
        cleaned.report.stats.removeRatio >= resolved.blockRemoveRatio &&
        !forceClean
      ) {
        return NextResponse.json(
          {
            error: `删除比例 ${(cleaned.report.stats.removeRatio * 100).toFixed(1)}% 过高，请确认后勾选强制清洗`,
            code: "HIGH_REMOVE_RATIO",
            report: cleaned.report,
            needsForce: true,
          },
          { status: 409 },
        );
      }

      novelText = cleaned.text;
      console.log(
        `[NovelParse] applyClean removed=${cleaned.report.stats.removedChars} ratio=${(cleaned.report.stats.removeRatio * 100).toFixed(1)}% fp=${resolved.fingerprint}`,
      );
    }

    const parsed = parseNovel(novelText);

    // Title: filename + body (+ LLM). Filename is first-class (site dumps often bury real name in file name).
    let llmTitle: string | null = null;
    try {
      llmTitle = await runWithTokenContext(
        { userId, agentId: "title_parse", category: "parse" },
        async () => {
          const llm = createLLMProvider("analysis");
          const sample = novelText.slice(0, 2000);
          const messages: LLMMessage[] = [
            {
              role: "system",
              content:
                "你是文本解析器。提取小说的正式书名（不是章节名）。只返回书名本身，不要书名号、不要引号、不要解释。若无法判断返回空。",
            },
            {
              role: "user",
              content: [
                `文件名：${originalFileName}`,
                filenameTitle ? `文件名清洗候选：${filenameTitle}` : "",
                "要求：优先采用文件名中的书名（去掉下载站前缀、作者、章节范围后）；正文开头若是「【书名】一、章标题」或「第1章」则书名取括号内或文件名，不要把整章标题当书名。",
                "",
                "正文开头：",
                sample,
              ]
                .filter(Boolean)
                .join("\n"),
            },
          ];
          return (await llm.chat(messages, { temperature: 0, maxTokens: 50 })).trim();
        },
      );
      if (llmTitle && llmTitle.length >= 100) llmTitle = null;
      if (llmTitle) console.log(`[NovelParse] LLM title candidate: "${llmTitle}"`);
    } catch (e) {
      console.warn(
        "[NovelParse] LLM title extraction failed:",
        (e as Error).message,
      );
    }

    const title = resolveNovelTitle({
      text: novelText,
      fileName: originalFileName,
      llmTitle,
    });
    console.log(
      `[NovelParse] resolved title="${title}" (file="${filenameTitle || originalFileName}")`,
    );

    const novelId = novelFingerprint(novelText);
    importNovel(userId, novelId, title, novelText);
    console.log(`[NovelParse] imported ${novelId} (${novelText.length} chars) user=${userId}`);

    // Do not echo fullText — multi-MB response freezes browser; client loads by novelId
    return NextResponse.json({
      novelId,
      title,
      totalLength: parsed.totalLength,
      chunkCount: parsed.chunks.length,
      preview: parsed.chunks[0]?.content.substring(0, 500) || "",
      cleaned: !!applyClean,
      cleanReport: cleanReport
        ? {
            stats: cleanReport.stats,
            warnings: cleanReport.warnings,
            configFingerprint: cleanReport.configFingerprint,
            boilerplatePatterns: cleanReport.boilerplatePatterns,
          }
        : undefined,
    });
  } catch (error) {
    console.error("Novel parse error:", error);
    return NextResponse.json({ error: "Failed to parse novel" }, { status: 500 });
  }
}
