"use client";

/**
 * Overview card: form (骨) + catalog count + chapter boundary.
 */
import { useEffect, useState } from "react";
import { BookMarked } from "lucide-react";
import type { BranchChapterMeta, NovelFormProfile } from "@/types";

interface FormSummaryCardProps {
  novelId: string;
  branchId?: string;
  /** Bump to refetch after analysis */
  refreshKey?: number | string;
}

export default function FormSummaryCard({
  novelId,
  branchId = "main",
  refreshKey = 0,
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

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-5 sm:p-6">
        <p className="text-xs text-fog">加载形态信息…</p>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="bg-card border border-border rounded-xl p-5 sm:p-6">
        <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
          <BookMarked className="w-4 h-4" /> 形态 / 章法
        </h3>
        <p className="text-sm text-fog leading-relaxed">
          尚未分析形态。在上方勾选「形态/章法」并开始分析后，此处显示分章策略与目录摘要。
        </p>
      </div>
    );
  }

  const enabled = !!form.chaptering?.enabled;
  const catalogCount = meta?.chapters?.length ?? 0;
  const boundary = meta?.chapterBoundary || "closed";
  const samples = (form.chaptering?.samples || []).slice(0, 3);
  const rules = (form.continuationRules || []).slice(0, 4);

  return (
    <div className="bg-card border border-border rounded-xl p-5 sm:p-6 space-y-3">
      <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
        <BookMarked className="w-4 h-4" /> 形态 / 章法
      </h3>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <div>
          <dt className="text-xs text-fog">作品形态</dt>
          <dd className="text-foreground">{formTypeLabel(form.formType)}</dd>
        </div>
        <div>
          <dt className="text-xs text-fog">分章</dt>
          <dd className="text-foreground">
            {enabled
              ? `已开启（置信度 ${((form.chaptering?.confidence ?? 0) * 100).toFixed(0)}%）`
              : "弱分章 / 不分章（保守）"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-fog">目录条数（{branchId === "main" ? "主线" : branchId}）</dt>
          <dd className="text-foreground">{catalogCount}</dd>
        </div>
        <div>
          <dt className="text-xs text-fog">章边界</dt>
          <dd className="text-foreground">
            {boundary === "open" ? "章中（open）" : "章末（closed）"}
            {meta?.openChapter?.title
              ? ` · 进行中：${meta.openChapter.title}`
              : meta?.lastClosedChapter?.title
                ? ` · 最近收束：${meta.lastClosedChapter.title}`
                : ""}
          </dd>
        </div>
      </dl>

      {samples.length > 0 && (
        <div>
          <p className="text-xs text-fog mb-1">章名样例</p>
          <p className="text-sm text-foreground leading-relaxed">{samples.join(" · ")}</p>
        </div>
      )}

      {rules.length > 0 && (
        <div>
          <p className="text-xs text-fog mb-1">续写规则</p>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-0.5">
            {rules.map((r, i) => (
              <li key={i} className="leading-relaxed">
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function formTypeLabel(t: string): string {
  const map: Record<string, string> = {
    web_novel: "网络长篇",
    trad_novel: "传统长篇",
    novella: "中篇",
    short_story: "短篇",
    essay_prose: "散文 / 弱分章",
    epistolary: "书信体",
    script_like: "剧本体",
    mixed: "混合",
    unknown: "未判定",
  };
  return map[t] || t || "未判定";
}
