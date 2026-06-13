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
        <p className="text-muted-foreground">
          {isComplete
            ? "Scene completed. Switch to Live Feed to see the process."
            : "Waiting for the first prose segment..."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-primary" />
          {title}
        </h3>
        <div className="flex items-center gap-2">
          <button
            className="px-3 py-1.5 border rounded-md text-sm flex items-center gap-1 hover:bg-secondary transition-colors"
            onClick={handleCopy}
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-green-600" />
                Copied
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                Copy
              </>
            )}
          </button>
          <button
            className="px-3 py-1.5 border rounded-md text-sm flex items-center gap-1 hover:bg-secondary transition-colors"
            onClick={handleDownload}
          >
            <Download className="w-4 h-4" />
            Download
          </button>
        </div>
      </div>

      <div className="prose prose-stone max-w-none">
        {content.split("\n\n").map((paragraph, i) => (
          <p key={i} className="mb-4 leading-relaxed text-foreground/90 whitespace-pre-wrap">
            {paragraph}
          </p>
        ))}
      </div>

      {!isComplete && (
        <div className="text-center text-sm text-muted-foreground animate-pulse">
          Writing continues...
        </div>
      )}
    </div>
  );
}
