"use client";

/**
 * Large form preview card — click opens floating detail sheet.
 */
import { useEffect, useState } from "react";
import { BookMarked, ChevronRight } from "lucide-react";
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

  const shell =
    "group relative text-left w-full min-h-[11rem] sm:min-h-[12.5rem] rounded-2xl border border-border/80 bg-card p-5 transition-colors " +
    (form
      ? "hover:border-primary/35 hover:bg-panel-elevated/30 cursor-pointer "
      : "") +
    className;

  if (loading) {
    return (
      <div className={shell + " flex items-center"}>
        <p className="text-sm text-fog">加载形态…</p>
      </div>
    );
  }

  if (!form) {
    return (
      <div className={shell + " flex flex-col justify-center"}>
        <div className="flex items-center gap-2 text-muted-foreground mb-2">
          <BookMarked className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">形态 / 章法</span>
        </div>
        <p className="text-sm text-fog leading-relaxed">
          尚未分析。运行下方分析后，这里显示分章与目录摘要。
        </p>
      </div>
    );
  }

  const enabled = !!form.chaptering?.enabled;
  const catalogCount = meta?.chapters?.length ?? 0;
  const boundary = meta?.chapterBoundary || "closed";
  const samples = (form.chaptering?.samples || []).slice(0, 4);
  const conf = Math.round((form.chaptering?.confidence ?? 0) * 100);

  return (
    <>
      <button type="button" className={shell} onClick={() => setOpen(true)}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <BookMarked className="w-4 h-4 text-primary shrink-0" />
            <span className="text-sm font-medium text-foreground">形态 / 章法</span>
          </div>
          <span className="inline-flex items-center gap-0.5 text-xs text-fog group-hover:text-primary transition-colors">
            详情
            <ChevronRight className="w-3.5 h-3.5" />
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span
            className={`text-xs px-2.5 py-1 rounded-full font-medium ${
              enabled
                ? "bg-primary/15 text-primary"
                : "bg-secondary text-muted-foreground"
            }`}
          >
            {enabled ? `分章 · 置信 ${conf}%` : "弱分章 / 不分章"}
          </span>
          <span className="text-xs px-2.5 py-1 rounded-full bg-secondary/70 text-muted-foreground">
            {formTypeLabel(form.formType)}
          </span>
          <span className="text-xs px-2.5 py-1 rounded-full bg-secondary/70 text-muted-foreground">
            目录 {catalogCount}
          </span>
          <span className="text-xs px-2.5 py-1 rounded-full bg-secondary/70 text-muted-foreground">
            {boundary === "open" ? "章中" : "章末"}
          </span>
        </div>

        {samples.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {samples.map((s) => (
              <span
                key={s}
                className="text-xs px-2 py-1 rounded-lg bg-panel-elevated border border-border/50 text-muted-foreground"
              >
                {s}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-fog">无章名样例</p>
        )}
      </button>

      <OverviewDetailSheet
        open={open}
        onClose={() => setOpen(false)}
        title="形态 / 章法"
        subtitle={formTypeLabel(form.formType)}
      >
        <dl className="space-y-4">
          <Row label="分章" value={enabled ? `开启（置信度 ${conf}%）` : "弱分章 / 不分章（保守）"} />
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
              <dt className="text-xs text-fog mb-1.5">章名样例</dt>
              <dd className="flex flex-wrap gap-1.5">
                {form.chaptering!.samples.map((s) => (
                  <span
                    key={s}
                    className="text-xs px-2 py-1 rounded-lg bg-secondary text-foreground/90"
                  >
                    {s}
                  </span>
                ))}
              </dd>
            </div>
          )}
          {form.narrativeArchitecture && (
            <div>
              <dt className="text-xs text-fog mb-1.5">叙事骨架</dt>
              <dd className="text-muted-foreground leading-relaxed space-y-1">
                <p>模板：{form.narrativeArchitecture.primaryTemplate || "unknown"}</p>
                <p>视角：{form.narrativeArchitecture.povScheme || "—"}</p>
                <p>时间：{form.narrativeArchitecture.timeScheme || "—"}</p>
                {form.narrativeArchitecture.evidenceNotes && (
                  <p className="text-fog text-xs mt-1">
                    {form.narrativeArchitecture.evidenceNotes}
                  </p>
                )}
              </dd>
            </div>
          )}
          {(form.continuationRules?.length ?? 0) > 0 && (
            <div>
              <dt className="text-xs text-fog mb-1.5">续写规则</dt>
              <dd>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  {form.continuationRules!.map((r, i) => (
                    <li key={i} className="leading-relaxed">
                      {r}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
          {(meta?.chapters?.length ?? 0) > 0 && (
            <div>
              <dt className="text-xs text-fog mb-1.5">目录（前 30 条）</dt>
              <dd className="space-y-1 max-h-48 overflow-y-auto custom-scrollbar">
                {meta!.chapters.slice(0, 30).map((c) => (
                  <p key={c.id} className="text-xs text-muted-foreground">
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
    <div>
      <dt className="text-xs text-fog mb-0.5">{label}</dt>
      <dd className="text-foreground/90 leading-relaxed">{value}</dd>
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
