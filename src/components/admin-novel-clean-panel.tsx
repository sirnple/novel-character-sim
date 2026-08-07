"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Check,
  Eraser,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
} from "lucide-react";

/** Serializable config shape (matches NovelCleanConfig). */
export interface NovelCleanForm {
  enabled: boolean;
  stripZeroWidth: boolean;
  stripInlineUrls: boolean;
  stripLineUrls: boolean;
  stripNavLines: boolean;
  collapseBlankLines: boolean;
  lineAdPatterns: string[];
  siteNames: string[];
  navLinePatterns: string[];
  inlineUrlPatterns: string[];
  lineUrlPatterns: string[];
  lineDomainPatterns: string[];
  statistical: boolean;
  boilerplateChapterRatio: number;
  boilerplateMinChapters: number;
  boilerplateMaxLineLen: number;
  marginLineCount: number;
  warnRemoveRatio: number;
  blockRemoveRatio: number;
}

type CleanSample = {
  category: string;
  line: string;
  lineNo?: number;
  rule?: string;
  removedParts?: string[];
  partial?: boolean;
};

function strikeSegments(
  line: string,
  removedParts?: string[],
): Array<{ text: string; strike: boolean }> {
  if (!line) return [];
  if (!removedParts?.length) return [{ text: line, strike: true }];
  type Range = { start: number; end: number };
  const ranges: Range[] = [];
  for (const p of removedParts) {
    if (!p) continue;
    let from = 0;
    while (from < line.length) {
      const i = line.indexOf(p, from);
      if (i < 0) break;
      ranges.push({ start: i, end: i + p.length });
      from = i + Math.max(1, p.length);
    }
  }
  if (!ranges.length) return [{ text: line, strike: true }];
  ranges.sort((a, b) => a.start - b.start);
  const merged: Range[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  const segs: Array<{ text: string; strike: boolean }> = [];
  let cur = 0;
  for (const r of merged) {
    if (cur < r.start) segs.push({ text: line.slice(cur, r.start), strike: false });
    segs.push({ text: line.slice(r.start, r.end), strike: true });
    cur = r.end;
  }
  if (cur < line.length) segs.push({ text: line.slice(cur), strike: false });
  return segs;
}

type TrialReport = {
  stats: {
    originalLength: number;
    cleanedLength: number;
    removedChars: number;
    removeRatio: number;
    urlsStripped: number;
    adLinesDropped: number;
    navLinesDropped: number;
    boilerplateLinesDropped: number;
  };
  warnings: string[];
  removedSamples: CleanSample[];
  configFingerprint: string;
  boilerplatePatterns: string[];
};

const BOOL_FIELDS: { key: keyof NovelCleanForm; label: string; hint: string }[] =
  [
    { key: "enabled", label: "启用清洗", hint: "关闭后 clean 为 no-op" },
    { key: "stripZeroWidth", label: "去零宽字符", hint: "仅 ZWSP/BOM 等，不动普通空格" },
    { key: "stripInlineUrls", label: "剥行内 URL", hint: "保留上下文" },
    { key: "stripLineUrls", label: "删整行 URL/域名", hint: "L1 域名行" },
    { key: "stripNavLines", label: "删导航行", hint: "上一章|下一章…" },
    { key: "collapseBlankLines", label: "折叠空行", hint: "默认关；开则连续空行压成最多两行" },
    { key: "statistical", label: "L2 统计 boilerplate", hint: "章首尾重复行" },
  ];

const NUM_FIELDS: {
  key: keyof NovelCleanForm;
  label: string;
  hint: string;
  min?: number;
  max?: number;
  step?: number;
  floor?: boolean;
}[] = [
  {
    key: "boilerplateChapterRatio",
    label: "L2 跨章比例",
    hint: "默认 0.3",
    min: 0.05,
    max: 1,
    step: 0.05,
  },
  {
    key: "boilerplateMinChapters",
    label: "L2 最少章数",
    hint: "默认 3",
    min: 1,
    max: 50,
    floor: true,
  },
  {
    key: "boilerplateMaxLineLen",
    label: "L2 候选最大行长",
    hint: "默认 80",
    min: 20,
    max: 200,
    floor: true,
  },
  {
    key: "marginLineCount",
    label: "L2 章边 margin 行数",
    hint: "默认 5",
    min: 1,
    max: 20,
    floor: true,
  },
  {
    key: "warnRemoveRatio",
    label: "删除警告线",
    hint: "默认 0.15",
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: "blockRemoveRatio",
    label: "删除阻断线",
    hint: "默认 0.35，apply 需 force",
    min: 0,
    max: 1,
    step: 0.01,
  },
];

const LIST_FIELDS: {
  key: keyof NovelCleanForm;
  label: string;
  hint: string;
  rows?: number;
}[] = [
  {
    key: "lineAdPatterns",
    label: "整行广告正则（每行一条）",
    hint: "服务端 new RegExp(s, \"i\")；保存前校验",
    rows: 8,
  },
  {
    key: "siteNames",
    label: "站名列表（短行水印）",
    hint: "仅匹配短行/页脚样式，不会全文删「笔趣阁」",
    rows: 6,
  },
  {
    key: "navLinePatterns",
    label: "导航行模式",
    hint: "tokens: 前缀 = 多 token 导航条；否则整行正则",
    rows: 3,
  },
  {
    key: "inlineUrlPatterns",
    label: "行内 URL 正则",
    hint: "flags: gi",
    rows: 3,
  },
  {
    key: "lineUrlPatterns",
    label: "整行 URL 正则",
    hint: "flags: i",
    rows: 2,
  },
  {
    key: "lineDomainPatterns",
    label: "整行域名正则",
    hint: "如 biquge.com",
    rows: 2,
  },
];

const CATEGORY_LABEL: Record<string, string> = {
  url_line: "整行 URL",
  url_inline: "行内 URL",
  nav: "导航",
  ad_line: "广告",
  site_watermark: "站名",
  boilerplate: "L2",
  zero_width: "零宽",
  blank_collapse: "空行",
};

const SAMPLE_TRIAL = `第一章 开端

晨光穿过薄雾。
https://www.biquge.com/book/123.html
www.soushu2022.com
请记住本站域名，方便下次阅读
上一章 下一章 返回目录
求月票求推荐票
笔趣阁
他从某小说网站笔趣阁偶然看到这本书的简介，决定读下去。
本章完

第二章 继续

更多正文情节在这里展开，角色甲对角色乙说了几句话。
请记住本站域名，方便下次阅读
`;

function toListText(arr: string[] | undefined): string {
  return (arr || []).join("\n");
}

function fromListText(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolvedToForm(r: Record<string, unknown>): NovelCleanForm {
  const defaults: NovelCleanForm = {
    enabled: false,
    stripZeroWidth: true,
    stripInlineUrls: true,
    stripLineUrls: true,
    stripNavLines: true,
    collapseBlankLines: false,
    lineAdPatterns: [],
    siteNames: [],
    navLinePatterns: [],
    inlineUrlPatterns: [],
    lineUrlPatterns: [],
    lineDomainPatterns: [],
    statistical: true,
    boilerplateChapterRatio: 0.3,
    boilerplateMinChapters: 3,
    boilerplateMaxLineLen: 80,
    marginLineCount: 5,
    warnRemoveRatio: 0.15,
    blockRemoveRatio: 0.35,
  };
  return {
    ...defaults,
    enabled: r.enabled === true,
    stripZeroWidth: r.stripZeroWidth !== false,
    stripInlineUrls: r.stripInlineUrls !== false,
    stripLineUrls: r.stripLineUrls !== false,
    stripNavLines: r.stripNavLines !== false,
    collapseBlankLines: r.collapseBlankLines === true,
    lineAdPatterns: Array.isArray(r.lineAdPatterns)
      ? (r.lineAdPatterns as string[])
      : defaults.lineAdPatterns,
    siteNames: Array.isArray(r.siteNames)
      ? (r.siteNames as string[])
      : defaults.siteNames,
    navLinePatterns: Array.isArray(r.navLinePatterns)
      ? (r.navLinePatterns as string[])
      : defaults.navLinePatterns,
    inlineUrlPatterns: Array.isArray(r.inlineUrlPatterns)
      ? (r.inlineUrlPatterns as string[])
      : defaults.inlineUrlPatterns,
    lineUrlPatterns: Array.isArray(r.lineUrlPatterns)
      ? (r.lineUrlPatterns as string[])
      : defaults.lineUrlPatterns,
    lineDomainPatterns: Array.isArray(r.lineDomainPatterns)
      ? (r.lineDomainPatterns as string[])
      : defaults.lineDomainPatterns,
    statistical: r.statistical !== false,
    boilerplateChapterRatio: Number(r.boilerplateChapterRatio ?? 0.3),
    boilerplateMinChapters: Number(r.boilerplateMinChapters ?? 3),
    boilerplateMaxLineLen: Number(r.boilerplateMaxLineLen ?? 80),
    marginLineCount: Number(r.marginLineCount ?? 5),
    warnRemoveRatio: Number(r.warnRemoveRatio ?? 0.15),
    blockRemoveRatio: Number(r.blockRemoveRatio ?? 0.35),
  };
}

export default function AdminNovelCleanPanel({
  adminToken,
}: {
  adminToken: string;
}) {
  const [form, setForm] = useState<NovelCleanForm | null>(null);
  const [defaults, setDefaults] = useState<NovelCleanForm | null>(null);
  const [fingerprint, setFingerprint] = useState("");
  const [listDrafts, setListDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const [trialText, setTrialText] = useState(SAMPLE_TRIAL);
  const [trialing, setTrialing] = useState(false);
  const [trialReport, setTrialReport] = useState<TrialReport | null>(null);
  const [trialError, setTrialError] = useState("");
  const [useUnsavedOverride, setUseUnsavedOverride] = useState(true);

  const syncListDrafts = (f: NovelCleanForm) => {
    const d: Record<string, string> = {};
    for (const lf of LIST_FIELDS) {
      d[lf.key] = toListText(f[lf.key] as string[]);
    }
    setListDrafts(d);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/settings", {
        headers: { "x-admin-token": adminToken },
      });
      if (res.status === 401) {
        setError("未授权，请重新登录");
        return;
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || "加载失败");
        return;
      }
      const data = await res.json();
      const resolved = data.novelCleanResolved || data.novelCleanDefaults || {};
      const def = resolvedToForm(data.novelCleanDefaults || resolved);
      const f = resolvedToForm(resolved);
      setDefaults(def);
      setForm(f);
      syncListDrafts(f);
      setFingerprint(String(resolved.fingerprint || ""));
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  }, [adminToken]);

  useEffect(() => {
    load();
  }, [load]);

  const formWithLists = (): NovelCleanForm | null => {
    if (!form) return null;
    const next = { ...form };
    for (const lf of LIST_FIELDS) {
      (next as Record<string, unknown>)[lf.key] = fromListText(
        listDrafts[lf.key] ?? "",
      );
    }
    return next;
  };

  const handleSave = async () => {
    const payload = formWithLists();
    if (!payload) return;
    setSaving(true);
    setError("");
    setOkMsg("");
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": adminToken,
        },
        body: JSON.stringify({
          novelClean: payload,
          replaceNovelClean: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const details = Array.isArray(data.details)
          ? data.details
              .map(
                (d: { field?: string; index?: number; message?: string }) =>
                  `${d.field}${d.index != null ? `[${d.index}]` : ""}: ${d.message}`,
              )
              .join("; ")
          : "";
        setError((data.error || "保存失败") + (details ? ` — ${details}` : ""));
        return;
      }
      const resolved = data.novelCleanResolved || {};
      const f = resolvedToForm(resolved);
      setForm(f);
      syncListDrafts(f);
      setFingerprint(String(resolved.fingerprint || ""));
      setOkMsg(
        `已保存（fingerprint=${String(resolved.fingerprint || "").slice(0, 8)}…，立即生效）`,
      );
      setTimeout(() => setOkMsg(""), 4000);
    } catch {
      setError("网络错误");
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefaults = async () => {
    if (!confirm("清除小说清洗覆盖，恢复出厂 defaults？")) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": adminToken,
        },
        body: JSON.stringify({ clearNovelClean: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "重置失败");
        return;
      }
      const resolved = data.novelCleanResolved || data.novelCleanDefaults || {};
      const f = resolvedToForm(resolved);
      setForm(f);
      syncListDrafts(f);
      setFingerprint(String(resolved.fingerprint || ""));
      setOkMsg("已恢复出厂 defaults");
      setTimeout(() => setOkMsg(""), 3000);
    } catch {
      setError("网络错误");
    } finally {
      setSaving(false);
    }
  };

  const handleLoadFactoryIntoForm = () => {
    if (!defaults) return;
    if (!confirm("用出厂 defaults 填入表单（未保存）？")) return;
    setForm({ ...defaults, lineAdPatterns: [...defaults.lineAdPatterns], siteNames: [...defaults.siteNames], navLinePatterns: [...defaults.navLinePatterns], inlineUrlPatterns: [...defaults.inlineUrlPatterns], lineUrlPatterns: [...defaults.lineUrlPatterns], lineDomainPatterns: [...defaults.lineDomainPatterns] });
    syncListDrafts(defaults);
  };

  const runTrial = async () => {
    setTrialing(true);
    setTrialError("");
    setTrialReport(null);
    try {
      const body: Record<string, unknown> = {
        text: trialText,
        maxSamples: 40,
      };
      if (useUnsavedOverride) {
        const override = formWithLists();
        if (override) body.configOverride = override;
      }
      const res = await fetch("/api/novel/clean/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTrialError(data.error || "试跑失败");
        return;
      }
      setTrialReport(data.report as TrialReport);
    } catch {
      setTrialError("网络错误");
    } finally {
      setTrialing(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            小说清洗 · 规则配置
          </h2>
          <p className="text-[11px] text-fog mt-1 max-w-2xl leading-relaxed">
            下载站杂质：URL / 广告 / 导航 / 章间 boilerplate。保存写入{" "}
            <code className="text-muted-foreground">data/runtime-settings.json</code>{" "}
            的 <code className="text-muted-foreground">novelClean</code>，无需 rebuild。
            {fingerprint ? (
              <span className="text-muted-foreground">
                {" "}
                · 当前 fingerprint{" "}
                <code className="text-primary/80">{fingerprint}</code>
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
            刷新
          </button>
          <button
            type="button"
            onClick={handleLoadFactoryIntoForm}
            disabled={!defaults || saving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground"
            title="仅填入表单，需再点保存"
          >
            <Eraser className="w-3 h-3" />
            填入出厂值
          </button>
          <button
            type="button"
            onClick={handleResetDefaults}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="w-3 h-3" />
            清除覆盖
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !form}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Save className="w-3 h-3" />
            )}
            保存
          </button>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-400 flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </p>
      )}
      {okMsg && (
        <p className="text-xs text-primary flex items-center gap-1.5">
          <Check className="w-3.5 h-3.5" />
          {okMsg}
        </p>
      )}

      {loading && !form ? (
        <div className="flex items-center gap-2 text-xs text-fog py-12 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          加载中…
        </div>
      ) : form ? (
        <div className="grid lg:grid-cols-2 gap-6 max-w-6xl">
          <div className="space-y-6">
            <section className="space-y-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                开关
              </h3>
              <div className="grid sm:grid-cols-2 gap-3">
                {BOOL_FIELDS.map((f) => (
                  <label
                    key={f.key}
                    className="flex items-start gap-2 p-3 rounded-lg border border-border bg-card cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={!!form[f.key]}
                      onChange={(e) =>
                        setForm({ ...form, [f.key]: e.target.checked })
                      }
                      className="mt-0.5 h-4 w-4 accent-primary"
                    />
                    <span>
                      <span className="text-xs font-medium text-foreground block">
                        {f.label}
                      </span>
                      <span className="text-[11px] text-fog">{f.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                L2 / 安全阈值
              </h3>
              <div className="grid sm:grid-cols-2 gap-3">
                {NUM_FIELDS.map((f) => (
                  <label
                    key={f.key}
                    className="block p-3 rounded-lg border border-border bg-card space-y-1.5"
                  >
                    <span className="text-xs font-medium text-foreground block">
                      {f.label}
                    </span>
                    <span className="text-[11px] text-fog block">{f.hint}</span>
                    <input
                      type="number"
                      min={f.min}
                      max={f.max}
                      step={f.step ?? 1}
                      value={form[f.key] as number}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (!Number.isFinite(n)) return;
                        setForm({
                          ...form,
                          [f.key]: f.floor ? Math.floor(n) : n,
                        });
                      }}
                      className="w-full px-2.5 py-1.5 bg-[#1a1a1a] border border-border rounded text-sm text-foreground font-mono"
                    />
                  </label>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                正则 / 站名
              </h3>
              {LIST_FIELDS.map((lf) => (
                <label
                  key={lf.key}
                  className="block p-3 rounded-lg border border-border bg-card space-y-1.5"
                >
                  <span className="text-xs font-medium text-foreground block">
                    {lf.label}
                  </span>
                  <span className="text-[11px] text-fog block">{lf.hint}</span>
                  <textarea
                    rows={lf.rows ?? 4}
                    value={listDrafts[lf.key] ?? ""}
                    onChange={(e) =>
                      setListDrafts({ ...listDrafts, [lf.key]: e.target.value })
                    }
                    spellCheck={false}
                    className="w-full px-2.5 py-1.5 bg-[#1a1a1a] border border-border rounded text-xs text-foreground font-mono leading-relaxed resize-y min-h-[4rem]"
                  />
                </label>
              ))}
            </section>
          </div>

          {/* Trial run */}
          <div className="space-y-3 lg:sticky lg:top-4 self-start">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <Play className="w-3 h-3" />
              粘贴试跑（不写库）
            </h3>
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={useUnsavedOverride}
                onChange={(e) => setUseUnsavedOverride(e.target.checked)}
                className="accent-primary"
              />
              使用当前表单（含未保存）作为 configOverride
            </label>
            <textarea
              rows={12}
              value={trialText}
              onChange={(e) => setTrialText(e.target.value)}
              spellCheck={false}
              className="w-full px-3 py-2 bg-[#1a1a1a] border border-border rounded text-xs text-foreground font-mono leading-relaxed resize-y"
            />
            <button
              type="button"
              onClick={runTrial}
              disabled={trialing || !trialText.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50"
            >
              {trialing ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Play className="w-3 h-3" />
              )}
              试跑预览
            </button>
            {trialError && (
              <p className="text-xs text-red-400 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {trialError}
              </p>
            )}
            {trialReport && (
              <div className="space-y-2 border border-border rounded-lg p-3 bg-card text-xs">
                <div className="grid grid-cols-2 gap-2 font-mono">
                  <div>
                    原文 {trialReport.stats.originalLength}
                  </div>
                  <div>
                    清洗后 {trialReport.stats.cleanedLength}
                  </div>
                  <div>
                    删除 {trialReport.stats.removedChars}（
                    {(trialReport.stats.removeRatio * 100).toFixed(1)}%）
                  </div>
                  <div>
                    URL {trialReport.stats.urlsStripped} · 广告{" "}
                    {trialReport.stats.adLinesDropped} · 导航{" "}
                    {trialReport.stats.navLinesDropped} · L2{" "}
                    {trialReport.stats.boilerplateLinesDropped}
                  </div>
                </div>
                {trialReport.warnings?.length > 0 && (
                  <ul className="text-amber-400/90 space-y-0.5">
                    {trialReport.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
                {trialReport.removedSamples?.length > 0 && (
                  <ul className="max-h-64 overflow-y-auto space-y-2 border-t border-border/60 pt-2">
                    {trialReport.removedSamples.map((s, i) => (
                      <li key={i} className="break-all text-foreground/90">
                        <span className="text-fog mr-1">
                          [{CATEGORY_LABEL[s.category] || s.category}
                          {s.partial ? "·片段" : ""}]
                          {s.lineNo != null ? ` L${s.lineNo}` : ""}
                        </span>
                        <span className="block mt-0.5 leading-relaxed">
                          {strikeSegments(s.line, s.removedParts).map((seg, j) =>
                            seg.strike ? (
                              <del
                                key={j}
                                className="text-red-300/90 decoration-red-400/80"
                              >
                                {seg.text}
                              </del>
                            ) : (
                              <span key={j}>{seg.text}</span>
                            ),
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[10px] text-fog font-mono">
                  fp={trialReport.configFingerprint}
                </p>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
