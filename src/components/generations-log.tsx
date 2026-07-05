"use client";

import { useEffect, useState } from "react";
import { History, ChevronDown, ChevronRight, ExternalLink, Loader2 } from "lucide-react";

interface GenLogEntry {
  id: string;
  userId: string;
  novelId?: string;
  category: string;
  label: string;
  inputSummary?: string;
  outputPreview?: string;
  fullOutput?: string;
  tokenEstimate?: number;
  createdAt: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  extract: "bg-blue-100 text-blue-700 border-blue-300",
  scene_recommend: "bg-purple-100 text-purple-700 border-purple-300",
  writer: "bg-green-100 text-green-700 border-green-300",
  review: "bg-orange-100 text-orange-700 border-orange-300",
};

export default function GenerationsLog() {
  const [logs, setLogs] = useState<GenLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [fullContent, setFullContent] = useState<string | null>(null);
  const [loadingFull, setLoadingFull] = useState(false);

  useEffect(() => {
    fetch("/api/generation-logs?limit=50")
      .then(r => r.json())
      .then(d => setLogs(d.logs || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const loadFull = async (id: string) => {
    setLoadingFull(true);
    try {
      const r = await fetch(`/api/generation-logs?id=${id}`);
      const d = await r.json();
      setFullContent(d.fullOutput || d.outputPreview || "无内容");
      setExpandedId(id);
    } catch {
      setFullContent("加载失败");
    } finally {
      setLoadingFull(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="w-4 h-4 animate-spin" />
        加载生成历史...
      </div>
    );
  }

  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">暂无生成记录</p>;
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <History className="w-4 h-4" />
        最近生成记录
        <span className="text-xs text-muted-foreground">({logs.length})</span>
      </h3>
      <div className="space-y-1 max-h-80 overflow-y-auto">
        {logs.map(log => (
          <div key={log.id}>
            <button
              className="w-full text-left px-3 py-2 rounded-md hover:bg-secondary/50 transition-colors flex items-center gap-2"
              onClick={() => expandedId === log.id ? setExpandedId(null) : loadFull(log.id)}
            >
              <span className={`text-xs px-1.5 py-0.5 rounded-full border ${CATEGORY_COLORS[log.category] || "bg-gray-100 text-gray-600 border-gray-300"}`}>
                {log.label}
              </span>
              <span className="text-xs text-muted-foreground flex-1 truncate">
                {log.outputPreview?.slice(0, 80) || "（无预览）"}
              </span>
              <span className="text-xs text-muted-foreground/50 shrink-0">
                {log.createdAt?.slice(5, 16) || ""}
              </span>
              {expandedId === log.id ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
            {expandedId === log.id && (
              <div className="ml-8 mr-2 mb-2 p-3 bg-secondary/10 rounded-md">
                {loadingFull ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <pre className="text-xs whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
                    {fullContent}
                  </pre>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
