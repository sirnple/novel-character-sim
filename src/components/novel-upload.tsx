"use client";

import { useState, useRef } from "react";
import { Upload, Loader2 } from "lucide-react";
import { useRateLimitCooldown } from "@/lib/rate-limit-ui";
import { isClientDebugMode } from "@/lib/debug-mode";

interface NovelUploadProps {
  /** totalLength replaces fullText — client must not hold 1M-char payload from upload. */
  onParsed: (title: string, totalLength: number, preview: string, novelId?: string) => void;
}

export default function NovelUpload({ onParsed }: NovelUploadProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const rateLimitHint = useRateLimitCooldown(error);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const debugMode = isClientDebugMode();

  const MAX_FILE_MB = 5;

  function validateFile(file: File): string | null {
    const name = file.name.toLowerCase();
    if (!name.endsWith(".txt") && !name.endsWith(".zip")) {
      return `不支持的文件格式（${file.name}），请上传 .txt 或 .zip 文件。`;
    }
    // Debug: no size cap for local large-novel testing
    if (!debugMode) {
      const mb = file.size / (1024 * 1024);
      if (file.size > MAX_FILE_MB * 1024 * 1024) {
        return `文件过大（${mb.toFixed(1)} MB），限制为 ${MAX_FILE_MB} MB。请拆分章节后重新上传。`;
      }
    }
    return null;
  }

  async function handleFile(file: File) {
    const err = validateFile(file);
    if (err) { setError(err); return; }

    setLoading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/novel/parse", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Parse failed");

      onParsed(
        data.title,
        typeof data.totalLength === "number" ? data.totalLength : 0,
        data.preview || "",
        data.novelId,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to upload");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-foreground">第一步：上传小说</h2>

      <div
        className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
          dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file);
        }}
        onClick={() => fileRef.current?.click()}
      >
        <input ref={fileRef} type="file" accept=".txt,.zip" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

        {loading ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-10 h-10 text-primary animate-spin" />
            <p className="text-muted-foreground">正在处理文件...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 cursor-pointer">
            <Upload className="w-10 h-10 text-muted-foreground" />
            <div>
              <p className="text-muted-foreground">拖入 .txt 或 .zip 文件，或点击浏览</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                支持 .txt / .zip
                {debugMode
                  ? " · debug：不限制大小"
                  : `，单个文件限制 ${MAX_FILE_MB} MB`}
              </p>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className={`p-3 rounded-md text-sm ${rateLimitHint ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-destructive/10 text-destructive"}`}>
          {rateLimitHint || error}
        </div>
      )}
    </div>
  );
}
