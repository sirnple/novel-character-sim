/**
 * Shared TXT/ZIP decode for novel upload (parse + clean preview).
 */
import iconv from "iconv-lite";
import AdmZip from "adm-zip";

export function decodeChineseText(buffer: Buffer): string {
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
    return gbk;
  }

  return utf8;
}

export type DecodeUploadResult =
  | { ok: true; text: string; originalFileName: string }
  | { ok: false; error: string; status: number };

/**
 * Decode .txt or .zip (merged .txt/.md entries) from a File/Blob.
 */
export async function decodeNovelUpload(
  file: File,
): Promise<DecodeUploadResult> {
  const fileName = file.name.toLowerCase();
  const originalFileName = file.name;

  if (!fileName.endsWith(".txt") && !fileName.endsWith(".zip")) {
    return {
      ok: false,
      error: `不支持的文件格式（${file.name}），请上传 .txt 或 .zip 文件。`,
      status: 400,
    };
  }

  if (fileName.endsWith(".zip")) {
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
      return {
        ok: false,
        error: "No .txt/.md files found in zip",
        status: 400,
      };
    }
    return {
      ok: true,
      text: parts.join("\n\n---\n\n"),
      originalFileName,
    };
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return {
    ok: true,
    text: decodeChineseText(buffer),
    originalFileName,
  };
}
