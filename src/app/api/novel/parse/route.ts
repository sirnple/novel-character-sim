import { NextRequest, NextResponse } from "next/server";
import { parseNovel } from "@/core/parser/novel-parser";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import { saveNovel, ensureMainBranch } from "@/lib/db";
import { novelFingerprint } from "@/lib/utils";
import { createLLMProvider } from "@/core/llm/factory";
import { runWithTokenContext } from "@/lib/token-usage-context";
import iconv from "iconv-lite";
import AdmZip from "adm-zip";
import type { LLMMessage } from "@/types";

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

const MAX_FILE_BYTES = 5 * 1024 * 1024;  // 5 MB

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
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

    // Size check
    if (fileBytes > MAX_FILE_BYTES) {
      const mb = (fileBytes / (1024 * 1024)).toFixed(1);
      return NextResponse.json(
        { error: `文件过大（${mb} MB），限制为 5 MB。请拆分章节后重新上传。` },
        { status: 413 }
      );
    }

    if (!fileName.endsWith(".txt") && !fileName.endsWith(".zip")) {
      return NextResponse.json(
        { error: `不支持的文件格式（${file.name}），请上传 .txt 或 .zip 文件。` },
        { status: 400 }
      );
    }

    let novelText: string;
    let title = file.name.replace(/\.(txt|zip)$/i, "");

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

    // Use LLM to extract the real title from text content
    try {
      const llmTitle = await runWithTokenContext(
        { userId, agentId: "title_parse", category: "parse" },
        async () => {
          const llm = createLLMProvider();
          const sample = novelText.slice(0, 2000);
          const messages: LLMMessage[] = [
            { role: "system", content: "你是一个文本解析器。从小说开头提取正式书名。只返回书名，不要引号、不要解释、不要额外文字。如果找不到，返回空。" },
            { role: "user", content: sample },
          ];
          return (await llm.chat(messages, { temperature: 0, maxTokens: 50 })).trim();
        },
      );
      if (llmTitle && llmTitle.length < 100) {
        title = llmTitle;
        console.log(`[NovelParse] LLM extracted title: "${title}"`);
      }
    } catch (e) {
      console.warn("[NovelParse] LLM title extraction failed, using filename:", (e as Error).message);
    }

    // Persist immediately so the novel survives page refresh
    const novelId = novelFingerprint(novelText);
    saveNovel(userId, novelId, title, novelText);
    ensureMainBranch(userId, novelId);

    return NextResponse.json({
      title,
      fullText: novelText,
      totalLength: parsed.totalLength,
      chunkCount: parsed.chunks.length,
      preview: parsed.chunks[0]?.content.substring(0, 500) || "",
    });
  } catch (error) {
    console.error("Novel parse error:", error);
    return NextResponse.json({ error: "Failed to parse novel" }, { status: 500 });
  }
}
