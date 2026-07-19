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
import iconv from "iconv-lite";
import AdmZip from "adm-zip";
import type { LLMMessage } from "@/types";
import { isServerDebugMode } from "@/lib/debug-mode";

function decodeChineseText(buffer: Buffer): string {
  const utf8 = buffer.toString("utf8");
  const utf8Periods = (utf8.match(/。/g) || []).length;
  const utf8Commas = (utf8.match(/，/g) || []).length;
  const utf8CJK = (utf8.match(/[一-鿿]/g) || []).length;
  const sampleLen = Math.min(utf8.length, 5000);

  if (utf8Periods > 3 || (utf8Commas > 5 && utf8CJK > sampleLen * 0.3)) {
    return utf8;
  }

  const gbk = iconv.decode(buffer, "gbk");
  const gbkPeriods = (gbk.match(/。/g) || []).length;
  const gbkCommas = (gbk.match(/，/g) || []).length;

  if (gbkPeriods + gbkCommas > utf8Periods + utf8Commas) {
    console.log(`[NovelParse] GBK chosen (。${gbkPeriods} ，${gbkCommas})`);
    return gbk;
  }

  return utf8;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;  // 5 MB (production / non-debug)

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

    const fileName = file.name.toLowerCase();
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

    if (!fileName.endsWith(".txt") && !fileName.endsWith(".zip")) {
      return NextResponse.json(
        { error: `不支持的文件格式（${file.name}），请上传 .txt 或 .zip 文件。` },
        { status: 400 }
      );
    }

    let novelText: string;
    const originalFileName = file.name;
    const filenameTitle = cleanFilenameTitle(originalFileName);

    if (fileName.endsWith(".zip")) {
      // Extract zip and merge all text files
      const arrayBuffer = await file.arrayBuffer();
      const zip = new AdmZip(Buffer.from(arrayBuffer));
      const entries = zip.getEntries();

      const parts: string[] = [];
      for (const entry of entries) {
        if (entry.isDirectory) continue;
        const name = entry.entryName.toLowerCase();
        if (name.match(/\.(txt|md)$/i) && !name.startsWith("__macosx")) {
          const buffer = entry.getData();
          const text = decodeChineseText(buffer);
          if (text.trim()) {
            parts.push(`// File: ${entry.entryName}\n\n${text}`);
          }
        }
      }

      if (parts.length === 0) {
        return NextResponse.json({ error: "No .txt/.md files found in zip" }, { status: 400 });
      }

      novelText = parts.join("\n\n---\n\n");
      console.log(`[NovelParse] Zip extracted: ${parts.length} text files`);
    } else {
      // Single text file
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      novelText = decodeChineseText(buffer);
    }

    if (!novelText.trim()) {
      return NextResponse.json({ error: "The novel text is empty" }, { status: 400 });
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
    });
  } catch (error) {
    console.error("Novel parse error:", error);
    return NextResponse.json({ error: "Failed to parse novel" }, { status: 500 });
  }
}
