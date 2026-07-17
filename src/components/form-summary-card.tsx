"use client";

/**
 * Dense form / chaptering summary for overview dashboard.
 */
import { useEffect, useState } from "react";
import { BookMarked, Layers } from "lucide-react";
import type { BranchChapterMeta, NovelFormProfile } from "@/types";

interface FormSummaryCardProps {
  novelId: string;
  branchId?: string;
  refreshKey?: number | string;
  className?: string;
}

export default function FormSummaryCard({
  novelId,
  branchId = "main",
  refreshKey = 0,
  className = "",
}: FormSummaryCardProps) {
  const [form, setForm] = useState<NovelFormProfile | null>(null);
  const [meta, setMeta] = useState<BranchChapterMeta | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!novelId) return;
    let cancelled = false;
    setLoading(true);
    fetch(
      `/api/chapter-meta?novelId=${encodeURIComponent(novelId)}&branchId=${encodeURIComponent(branchId)}`,
    )
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setForm(d.form || null);
        setMeta(d.meta || null);
      })
      .catch(() => {
        if (!cancelled) {
          setForm(null);
          setMeta(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [novelId, branchId, refreshKey]);

  const shell =
    "rounded-xl border border-border/80 bg-card h-full flex flex-col min-h-0 " + className;

  if (loading) {
    return (
      <div className={`${shell} p-3`}>
        <p className="text-[11px] text-fog">加载形态…</p>
      </div>
    );
  }

  if (!form) {
    return (
      <div className={`${shell} p-3`}>
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
          <BookMarked className="w-3.5 h-3.5 text-primary" />
          形态 / 章法
        </div>
        <p className="text-xs text-fog leading-relaxed">
          尚未分析。点上方「开始分析」后显示分章与目录。
        </p>
      </div>
    );
  }

  const enabled = !!form.chaptering?.enabled;
  const catalogCount = meta?.chapters?.length ?? 0;
  const boundary = meta?.chapterBoundary || "closed";
  const samples = (form.chaptering?.samples || []).slice(0, 3);
  const conf = Math.round((form.chaptering?.confidence ?? 0) * 100);

  return (
    <div className={`${shell} p-3 sm:p-3.5`}>
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <BookMarked className="w-3.5 h-3.5 text-primary" />
          形态 / 章法
        </div>
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${
            enabled
              ? "bg-primary/15 text-primary"
              : "bg-secondary text-muted-foreground"
          }`}
        >
          {enabled ? `分章 · ${conf}%` : "弱分章"}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-1.5 mb-2.5">
        <Stat label="形态" value={formTypeLabel(form.formType)} />
        <Stat label="目录" value={`${catalogCount}`} />
        <Stat
          label="边界"
          value={boundary === "open" ? "章中" : "章末"}
        />
      </div>

      {samples.length > 0 && (
        <div className="mb-2">
          <p className="text-[10px] text-fog mb-1 flex items-center gap-1">
            <Layers className="w-3 h-3" /> 章名样例
          </p>
          <div className="flex flex-wrap gap-1">
            {samples.map((s) => (
              <span
                key={s}
                className="text-[10px] px-1.5 py-0.5 rounded bg-panel-elevated text-muted-foreground border border-border/50"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {(form.continuationRules || []).length > 0 && (
        <p className="text-[11px] text-fog leading-snug line-clamp-2 mt-auto">
          {form.continuationRules![0]}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-secondary/50 border border-border/40 px-2 py-1.5 min-w-0">
      <p className="text-[9px] uppercase tracking-wide text-fog">{label}</p>
      <p className="text-xs font-medium text-foreground truncate mt-0.5" title={value}>
        {value}
      </p>
    </div>
  );
}

function formTypeLabel(t: string): string {
  const map: Record<string, string> = {
    web_novel: "网文",
    trad_novel: "长篇",
    novella: "中篇",
    short_story: "短篇",
    essay_prose: "散文",
    epistolary: "书信",
    script_like: "剧本",
    mixed: "混合",
    unknown: "未知",
  };
  return map[t] || t || "未知";
}
