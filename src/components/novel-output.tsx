"use client";

import { useState } from "react";
import { Download, Copy, Check, BookOpen } from "lucide-react";

interface NovelOutputProps {
  title: string;
  content: string;
  isComplete: boolean;
}

export default function NovelOutput({ title, content, isComplete }: NovelOutputProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^a-zA-Z0-9一-鿿]/g, "_")}_scene.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!content) {
    return (
      <div className="text-center py-12">
        <BookOpen className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">
          {isComplete
            ? "场景已完成。可切换到实时过程查看细节。"
            : "等待第一段正文…"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-base font-semibold flex items-center gap-2 text-foreground">
          <BookOpen className="w-5 h-5 text-primary" />
          {title}
        </h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="px-3 py-2 border border-border rounded-lg text-sm flex items-center gap-1.5 hover:bg-panel-elevated transition-colors text-foreground"
            onClick={handleCopy}
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-emerald-500" />
                已复制
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                复制
              </>
            )}
          </button>
          <button
            type="button"
            className="px-3 py-2 border border-border rounded-lg text-sm flex items-center gap-1.5 hover:bg-panel-elevated transition-colors text-foreground"
            onClick={handleDownload}
          >
            <Download className="w-4 h-4" />
            下载
          </button>
        </div>
      </div>

      <div className="surface-paper px-5 sm:px-8 lg:px-12 xl:px-16 py-8 sm:py-10 lg:py-12">
        <div className="prose-novel">
          {content.split("\n\n").map((paragraph, i) => (
            <p key={i} className="mb-4 last:mb-0 whitespace-pre-wrap">
              {paragraph}
            </p>
          ))}
        </div>
      </div>

      {!isComplete && (
        <div className="text-center text-sm text-muted-foreground animate-pulse">
          写作进行中…
        </div>
      )}
    </div>
  );
}
