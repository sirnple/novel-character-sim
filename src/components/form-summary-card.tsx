"use client";

import { useEffect, useState } from "react";
import { BookMarked, ChevronRight, Layers } from "lucide-react";
import type { BranchChapterMeta, NovelFormProfile } from "@/types";
import OverviewDetailSheet from "@/components/overview-detail-sheet";

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
  const [open, setOpen] = useState(false);

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
      <div className={`ov-card min-h-[13rem] p-6 flex items-center ${className}`}>
        <div className="flex items-center gap-3 text-fog text-sm">
          <span className="w-8 h-8 rounded-xl bg-secondary animate-pulse" />
          加载形态…
        </div>
      </div>
    );
  }

  if (!form) {
    return (
      <div
        className={`ov-card min-h-[13rem] p-6 flex flex-col justify-center border-dashed ${className}`}
      >
        <div className="w-10 h-10 rounded-xl bg-ember-soft flex items-center justify-center mb-3">
          <BookMarked className="w-5 h-5 text-primary" />
        </div>
        <p className="text-sm font-medium text-foreground">形态 / 章法</p>
        <p className="text-sm text-fog mt-1.5 leading-relaxed">
          分析后显示分章策略与目录。
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
    <>
      <button
        type="button"
        className={`ov-card-interactive min-h-[13rem] p-6 flex flex-col ${className}`}
        onClick={() => setOpen(true)}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <span className="w-10 h-10 rounded-xl bg-ember-soft flex items-center justify-center shrink-0">
              <BookMarked className="w-5 h-5 text-primary" />
            </span>
            <div className="text-left">
              <p className="text-sm font-semibold text-foreground">形态 / 章法</p>
              <p className="text-xs text-fog mt-0.5">{formTypeLabel(form.formType)}</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-0.5 text-xs text-fog group-hover:text-primary">
            详情 <ChevronRight className="w-3.5 h-3.5" />
          </span>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          <span className={enabled ? "ov-chip-ok" : "ov-chip-muted"}>
            {enabled ? `分章 · ${conf}%` : "弱分章"}
          </span>
          <span className="ov-chip-muted">目录 {catalogCount}</span>
          <span className="ov-chip-muted">{boundary === "open" ? "章中" : "章末"}</span>
        </div>

        {samples.length > 0 ? (
          <div className="mt-auto flex flex-wrap gap-1.5">
            {samples.map((s) => (
              <span
                key={s}
                className="text-xs px-2.5 py-1 rounded-lg bg-background/50 border border-border/50 text-muted-foreground"
              >
                {s}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-auto text-sm text-fog">无章名样例</p>
        )}
      </button>

      <OverviewDetailSheet
        open={open}
        onClose={() => setOpen(false)}
        title="形态 / 章法"
        subtitle={formTypeLabel(form.formType)}
      >
        <dl className="space-y-5">
          <Row label="分章" value={enabled ? `开启（置信度 ${conf}%）` : "弱分章 / 不分章"} />
          <Row label="编号" value={form.chaptering?.numbering || "—"} />
          <Row label="标题模式" value={form.chaptering?.titlePattern || "—"} />
          <Row label="目录条数" value={String(catalogCount)} />
          <Row
            label="章边界"
            value={
              boundary === "open"
                ? `章中${meta?.openChapter?.title ? ` · ${meta.openChapter.title}` : ""}`
                : `章末${meta?.lastClosedChapter?.title ? ` · ${meta.lastClosedChapter.title}` : ""}`
            }
          />
          {(form.chaptering?.samples?.length ?? 0) > 0 && (
            <div>
              <dt className="text-xs text-fog mb-2 flex items-center gap-1">
                <Layers className="w-3.5 h-3.5" /> 章名样例
              </dt>
              <dd className="flex flex-wrap gap-2">
                {form.chaptering!.samples.map((s) => (
                  <span key={s} className="ov-chip-muted text-foreground/90">
                    {s}
                  </span>
                ))}
              </dd>
            </div>
          )}
          {form.narrativeArchitecture && (
            <div className="rounded-xl bg-secondary/40 border border-border/40 p-4 space-y-2">
              <p className="text-xs text-fog">叙事骨架</p>
              <p className="text-sm text-muted-foreground">
                模板 {form.narrativeArchitecture.primaryTemplate || "—"}
                <span className="mx-1.5 text-border">·</span>
                视角 {form.narrativeArchitecture.povScheme || "—"}
                <span className="mx-1.5 text-border">·</span>
                时间 {form.narrativeArchitecture.timeScheme || "—"}
              </p>
              {form.narrativeArchitecture.evidenceNotes && (
                <p className="text-xs text-fog leading-relaxed">
                  {form.narrativeArchitecture.evidenceNotes}
                </p>
              )}
            </div>
          )}
          {(form.continuationRules?.length ?? 0) > 0 && (
            <div>
              <dt className="text-xs text-fog mb-2">续写规则</dt>
              <dd className="space-y-2">
                {form.continuationRules!.map((r, i) => (
                  <p
                    key={i}
                    className="text-sm text-muted-foreground leading-relaxed pl-3 border-l-2 border-primary/30"
                  >
                    {r}
                  </p>
                ))}
              </dd>
            </div>
          )}
          {(meta?.chapters?.length ?? 0) > 0 && (
            <div>
              <dt className="text-xs text-fog mb-2">目录</dt>
              <dd className="rounded-xl bg-secondary/30 border border-border/40 max-h-52 overflow-y-auto custom-scrollbar divide-y divide-border/30">
                {meta!.chapters.slice(0, 40).map((c) => (
                  <p key={c.id} className="text-xs text-muted-foreground px-3 py-2">
                    {c.number != null ? `第${c.number}章 ` : ""}
                    {c.title}
                  </p>
                ))}
              </dd>
            </div>
          )}
        </dl>
      </OverviewDetailSheet>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:gap-4">
      <dt className="text-xs text-fog sm:w-20 shrink-0 pt-0.5">{label}</dt>
      <dd className="text-sm text-foreground/90 leading-relaxed">{value}</dd>
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
