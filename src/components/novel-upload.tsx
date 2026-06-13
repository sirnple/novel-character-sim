"use client";

import { useState, useRef } from "react";
import { Upload, Loader2 } from "lucide-react";

interface NovelUploadProps {
  onParsed: (title: string, fullText: string, preview: string) => void;
}

export default function NovelUpload({ onParsed }: NovelUploadProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setLoading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/novel/parse", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Parse failed");

      onParsed(data.title, data.fullText, data.preview);
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
                .zip 压缩包会在服务端自动解压，合并其中的所有文本文件
              </p>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">{error}</div>
      )}
    </div>
  );
}
