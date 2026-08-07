"use client";

import { useState, useRef, useEffect } from "react";
import { Upload, Loader2, Sparkles, AlertTriangle } from "lucide-react";
import { useRateLimitCooldown } from "@/lib/rate-limit-ui";
import { isClientDebugMode } from "@/lib/debug-mode";

interface NovelUploadProps {
  /** totalLength replaces fullText — client must not hold 1M-char payload from upload. */
  onParsed: (title: string, totalLength: number, preview: string, novelId?: string) => void;
}

type CleanSample = {
  category: string;
  line: string;
  lineNo?: number;
  rule?: string;
  /** Substrings to strike; empty ⇒ strike whole line */
  removedParts?: string[];
  partial?: boolean;
};

/** Build keep/strike segments for full-line display. */
function strikeSegments(
  line: string,
  removedParts?: string[],
): Array<{ text: string; strike: boolean }> {
  if (!line) return [{ text: "（空）", strike: true }];
  if (!removedParts?.length) {
    return [{ text: visualizeInvisible(line), strike: true }];
  }
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
  if (!ranges.length) {
    // parts not found as substrings (summary-style samples e.g. zero_width)
    return [
      {
        text: visualizeInvisible(line),
        strike: true,
      },
    ];
  }
  ranges.sort((a, b) => a.start - b.start);
  const merged: Range[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }
  const segs: Array<{ text: string; strike: boolean }> = [];
  let cur = 0;
  for (const r of merged) {
    if (cur < r.start) {
      segs.push({
        text: visualizeInvisible(line.slice(cur, r.start)),
        strike: false,
      });
    }
    segs.push({
      text: visualizeInvisible(line.slice(r.start, r.end)),
      strike: true,
    });
    cur = r.end;
  }
  if (cur < line.length) {
    segs.push({ text: visualizeInvisible(line.slice(cur)), strike: false });
  }
  return segs;
}

function sampleLineKey(s: CleanSample): string {
  return s.line
    .trim()
    .replace(/\s+/g, " ")
    .replace(/https?:\/\/[^\s]+/gi, "")
    .replace(/www\.[^\s]+/gi, "")
    .trim()
    .toLowerCase();
}

type CleanPreviewState = {
  file: File;
  report: {
    stats: {
      originalLength: number;
      cleanedLength: number;
      removedChars: number;
      removeRatio: number;
      urlsStripped: number;
      adLinesDropped: number;
      navLinesDropped: number;
      zeroWidthRemoved: number;
      boilerplateLinesDropped: number;
      blankCollapsed: boolean;
    };
    warnings: string[];
    removedSamples: CleanSample[];
    configFingerprint: string;
    boilerplatePatterns: string[];
  };
  highRemoveWarning: boolean;
  blockWithoutForce: boolean;
  previewMode: string;
  cleanedLength: number;
};

const CATEGORY_LABEL: Record<string, string> = {
  url_line: "整行 URL",
  url_inline: "行内 URL",
  nav: "导航",
  ad_line: "广告行",
  site_watermark: "站名水印",
  boilerplate: "章间重复",
  zero_width: "零宽字符",
  blank_collapse: "空行",
};

/** Make zero-width / control chars visible in sample list. */
function visualizeInvisible(text: string): string {
  if (!text) return "（空）";
  return text
    .replace(/\u200B/g, "⟦ZWSP⟧")
    .replace(/\u200C/g, "⟦ZWNJ⟧")
    .replace(/\u200D/g, "⟦ZWJ⟧")
    .replace(/\uFEFF/g, "⟦BOM⟧")
    .replace(/\u2060/g, "⟦WJ⟧")
    .replace(/\u00AD/g, "⟦SHY⟧")
    .replace(/\r/g, "⟦CR⟧")
    .replace(/\n/g, "⟦LF⟧");
}

export default function NovelUpload({ onParsed }: NovelUploadProps) {
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("正在处理文件...");
  const [error, setError] = useState("");
  const rateLimitHint = useRateLimitCooldown(error);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const debugMode = isClientDebugMode();
  const [isAdmin, setIsAdmin] = useState(false);

  const [preview, setPreview] = useState<CleanPreviewState | null>(null);
  const [excludedKeys, setExcludedKeys] = useState<Set<string>>(new Set());
  /** Server novelClean.enabled — when false, hide all clean UI. */
  const [cleanFeatureOn, setCleanFeatureOn] = useState(false);
  /**
   * When feature is on: user may opt into preview → applyClean.
   */
  const [wantClean, setWantClean] = useState(false);
  const [forceClean, setForceClean] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setIsAdmin(!!data?.user?.isAdmin);
      })
      .catch(() => {});
    fetch("/api/novel/clean/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) {
          const on = !!data?.enabled;
          setCleanFeatureOn(on);
          if (!on) {
            setWantClean(false);
            setPreview(null);
          }
        }
      })
      .catch(() => {
        if (!cancelled) setCleanFeatureOn(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const MAX_FILE_MB = 5;
  const skipSizeLimit = debugMode || isAdmin;

  function validateFile(file: File): string | null {
    const name = file.name.toLowerCase();
    if (!name.endsWith(".txt") && !name.endsWith(".zip")) {
      return `不支持的文件格式（${file.name}），请上传 .txt 或 .zip 文件。`;
    }
    if (!skipSizeLimit) {
      const mb = file.size / (1024 * 1024);
      if (file.size > MAX_FILE_MB * 1024 * 1024) {
        return `文件过大（${mb.toFixed(1)} MB），限制为 ${MAX_FILE_MB} MB。请拆分章节后重新上传。`;
      }
    }
    return null;
  }

  function sampleKey(s: CleanSample): string {
    return `${s.category}|${s.lineNo ?? ""}|${s.line.slice(0, 80)}`;
  }

  function excludeKeyForSample(s: CleanSample): string {
    return sampleLineKey(s);
  }

  async function runPreview(file: File, excludeLineKeys?: string[]) {
    setLoading(true);
    setLoadingLabel("正在预览清洗…");
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("maxSamples", "40");
      // Opt-in clean: force enabled even if global default is off
      formData.append("configOverride", JSON.stringify({ enabled: true }));
      if (excludeLineKeys?.length) {
        formData.append("excludeLineKeys", JSON.stringify(excludeLineKeys));
      }
      const res = await fetch("/api/novel/clean/preview", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "预览失败");

      setPreview({
        file,
        report: data.report,
        highRemoveWarning: !!data.highRemoveWarning,
        blockWithoutForce: !!data.blockWithoutForce,
        previewMode: data.previewMode || "full",
        cleanedLength: data.cleanedLength ?? data.report?.stats?.cleanedLength ?? 0,
      });
      setForceClean(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "预览失败");
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }

  async function runImport(
    file: File,
    opts: {
      applyClean: boolean;
      forceClean?: boolean;
      excludeLineKeys?: string[];
      configFingerprint?: string;
    },
  ) {
    setLoading(true);
    setLoadingLabel(opts.applyClean ? "正在清洗并导入…" : "正在导入…");
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (opts.applyClean) {
        formData.append("applyClean", "1");
        if (opts.forceClean) formData.append("forceClean", "1");
        if (opts.configFingerprint) {
          formData.append("configFingerprint", opts.configFingerprint);
        }
        if (opts.excludeLineKeys?.length) {
          formData.append("excludeLineKeys", JSON.stringify(opts.excludeLineKeys));
        }
      }

      const res = await fetch("/api/novel/parse", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "HIGH_REMOVE_RATIO") {
          setForceClean(true);
          throw new Error(
            data.error || "删除比例过高，请勾选强制清洗后重试",
          );
        }
        if (data.code === "CONFIG_FINGERPRINT_MISMATCH") {
          throw new Error(data.error || "配置已变更，请重新预览");
        }
        throw new Error(data.error || "Parse failed");
      }

      setPreview(null);
      setExcludedKeys(new Set());
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

  async function handleFile(file: File) {
    const err = validateFile(file);
    if (err) {
      setError(err);
      return;
    }
    setExcludedKeys(new Set());

    if (cleanFeatureOn && wantClean) {
      await runPreview(file);
      return;
    }
    // Default / feature off: import as-is
    await runImport(file, { applyClean: false });
  }

  function toggleExcludeSample(s: CleanSample) {
    const key = excludeKeyForSample(s);
    if (!key) return;
    setExcludedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function rePreviewWithExcludes() {
    if (!preview) return;
    await runPreview(preview.file, Array.from(excludedKeys));
  }

  const ratioPct = preview
    ? (preview.report.stats.removeRatio * 100).toFixed(1)
    : "0";

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-foreground">第一步：上传小说</h2>

      {!preview && (
        <>
          <div
            className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
              dragOver
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-primary/50"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files[0];
              if (file) handleFile(file);
            }}
            onClick={() => !loading && fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.zip"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = "";
              }}
            />

            {loading ? (
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-10 h-10 text-primary animate-spin" />
                <p className="text-muted-foreground">{loadingLabel}</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 cursor-pointer">
                <Upload className="w-10 h-10 text-muted-foreground" />
                <div>
                  <p className="text-muted-foreground">
                    拖入 .txt 或 .zip 文件，或点击浏览
                  </p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    支持 .txt / .zip
                    {skipSizeLimit
                      ? isAdmin
                        ? " · 管理员：不限制大小"
                        : " · debug：不限制大小"
                      : `，单个文件限制 ${MAX_FILE_MB} MB`}
                  </p>
                  <p className="text-xs text-muted-foreground/50 mt-1">
                    {cleanFeatureOn
                      ? "默认原样导入；需要去广告时可勾选下方清洗"
                      : "选择文件后直接导入"}
                  </p>
                </div>
              </div>
            )}
          </div>

          {cleanFeatureOn && (
            <label className="flex items-start gap-2 text-sm text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 rounded border-border"
                checked={wantClean}
                onChange={(e) => setWantClean(e.target.checked)}
              />
              <span>
                <span className="text-foreground">导入前清洗下载站杂质</span>
                <span className="block text-xs text-muted-foreground/70">
                  先预览将删除内容，确认后再导入
                </span>
              </span>
            </label>
          )}
        </>
      )}

      {cleanFeatureOn && preview && !loading && (
        <div className="space-y-4 rounded-xl border border-border bg-secondary/40 p-4">
          <div className="flex items-start gap-2">
            <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">清洗预览</div>
              <div className="text-xs text-mist truncate" title={preview.file.name}>
                {preview.file.name}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            <div className="rounded-lg bg-card px-3 py-2.5 border border-border shadow-sm">
              <div className="text-[11px] font-medium text-mist uppercase tracking-wide">
                原文
              </div>
              <div className="mt-0.5 text-base font-semibold font-mono tabular-nums text-foreground">
                {preview.report.stats.originalLength.toLocaleString()}
                <span className="text-xs font-normal text-mist ml-1">字</span>
              </div>
            </div>
            <div className="rounded-lg bg-card px-3 py-2.5 border border-border shadow-sm">
              <div className="text-[11px] font-medium text-mist uppercase tracking-wide">
                清洗后
              </div>
              <div className="mt-0.5 text-base font-semibold font-mono tabular-nums text-foreground">
                {preview.cleanedLength.toLocaleString()}
                <span className="text-xs font-normal text-mist ml-1">字</span>
              </div>
            </div>
            <div className="rounded-lg bg-card px-3 py-2.5 border border-border shadow-sm">
              <div className="text-[11px] font-medium text-mist uppercase tracking-wide">
                删除
              </div>
              <div className="mt-0.5 text-base font-semibold font-mono tabular-nums text-primary">
                {preview.report.stats.removedChars.toLocaleString()}
                <span className="text-xs font-normal text-mist ml-1">
                  字 · {ratioPct}%
                </span>
              </div>
            </div>
            <div className="rounded-lg bg-card px-3 py-2.5 border border-border shadow-sm">
              <div className="text-[11px] font-medium text-mist uppercase tracking-wide">
                命中
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded-md bg-secondary px-1.5 py-0.5 text-foreground border border-border/80">
                  URL {preview.report.stats.urlsStripped}
                </span>
                <span className="rounded-md bg-secondary px-1.5 py-0.5 text-foreground border border-border/80">
                  广告 {preview.report.stats.adLinesDropped}
                </span>
                <span className="rounded-md bg-secondary px-1.5 py-0.5 text-foreground border border-border/80">
                  导航 {preview.report.stats.navLinesDropped}
                </span>
                <span className="rounded-md bg-secondary px-1.5 py-0.5 text-foreground border border-border/80">
                  L2 {preview.report.stats.boilerplateLinesDropped}
                </span>
              </div>
            </div>
          </div>

          {(preview.highRemoveWarning || preview.report.warnings?.length > 0) && (
            <div className="flex gap-2 p-3 rounded-lg bg-amber-500/15 border border-amber-400/40 text-amber-100 text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-300" />
              <div className="space-y-1 leading-relaxed">
                {preview.report.warnings?.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
                {preview.blockWithoutForce && (
                  <p>删除比例较高：若确认无误，导入时请勾选「强制清洗」。</p>
                )}
              </div>
            </div>
          )}

          {preview.report.removedSamples?.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-medium text-foreground">
                将删除的样例
                <span className="ml-2 text-xs font-normal text-mist">
                  删除线 = 将被去掉的文字；点击行可取消删除（本趟保留）
                </span>
              </div>
              <ul className="max-h-56 overflow-y-auto rounded-lg border border-border bg-card divide-y divide-border shadow-inner">
                {preview.report.removedSamples.map((s, i) => {
                  const lineKey = excludeKeyForSample(s);
                  const kept = !!(lineKey && excludedKeys.has(lineKey));
                  const segs = strikeSegments(s.line, s.removedParts);
                  return (
                    <li key={`${sampleKey(s)}-${i}`}>
                      <button
                        type="button"
                        onClick={() => toggleExcludeSample(s)}
                        className={`w-full text-left px-3 py-2.5 transition-colors hover:bg-panel-elevated ${
                          kept
                            ? "bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/25"
                            : ""
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium bg-primary/20 text-primary border border-primary/30">
                            {CATEGORY_LABEL[s.category] || s.category}
                            {s.partial ? " · 片段" : ""}
                          </span>
                          {s.lineNo != null && (
                            <span className="text-[11px] font-mono text-mist">
                              L{s.lineNo}
                            </span>
                          )}
                          {kept ? (
                            <span className="text-[11px] font-medium text-emerald-300">
                              已取消删除
                            </span>
                          ) : (
                            <span className="text-[11px] text-mist">
                              点击取消删除
                            </span>
                          )}
                        </div>
                        <div className="text-sm leading-relaxed break-all text-foreground/95 font-mono">
                          {kept
                            ? // 保留：整行正常显示，无删除线（不可见字符仍可视化）
                              visualizeInvisible(s.line)
                            : segs.map((seg, j) =>
                                seg.strike ? (
                                  <del
                                    key={j}
                                    className="text-red-300/90 decoration-red-400/80 decoration-2"
                                  >
                                    {seg.text}
                                  </del>
                                ) : (
                                  <span key={j}>{seg.text}</span>
                                ),
                              )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {excludedKeys.size > 0 && (
                <button
                  type="button"
                  className="text-sm text-primary hover:underline font-medium"
                  onClick={() => rePreviewWithExcludes()}
                >
                  用当前排除项重新预览（{excludedKeys.size} 条保留）
                </button>
              )}
            </div>
          )}

          {(preview.blockWithoutForce || forceClean) && (
            <label className="flex items-start gap-2 text-sm text-foreground cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 accent-primary"
                checked={forceClean}
                onChange={(e) => setForceClean(e.target.checked)}
              />
              <span>强制清洗并导入（删除比例已达阻断线）</span>
            </label>
          )}

          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <button
              type="button"
              className="flex-1 px-3 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50 shadow-sm"
              disabled={preview.blockWithoutForce && !forceClean}
              onClick={() =>
                runImport(preview.file, {
                  applyClean: true,
                  forceClean,
                  excludeLineKeys: Array.from(excludedKeys),
                  configFingerprint: preview.report.configFingerprint,
                })
              }
            >
              应用清洗后导入
            </button>
            <button
              type="button"
              className="flex-1 px-3 py-2.5 rounded-lg border border-border bg-card text-sm font-medium text-foreground hover:bg-panel-elevated"
              onClick={() =>
                runImport(preview.file, {
                  applyClean: false,
                })
              }
            >
              直接导入（不清洗）
            </button>
            <button
              type="button"
              className="px-3 py-2.5 rounded-lg text-sm font-medium text-mist hover:text-foreground hover:bg-panel-elevated border border-transparent hover:border-border"
              onClick={() => {
                setPreview(null);
                setExcludedKeys(new Set());
                setError("");
              }}
            >
              重选文件
            </button>
          </div>
        </div>
      )}

      {cleanFeatureOn && preview && loading && (
        <div className="flex flex-col items-center gap-3 py-8">
          <Loader2 className="w-10 h-10 text-primary animate-spin" />
          <p className="text-muted-foreground">{loadingLabel}</p>
        </div>
      )}

      {error && (
        <div
          className={`p-3 rounded-md text-sm ${
            rateLimitHint
              ? "bg-amber-50 text-amber-700 border border-amber-200"
              : "bg-destructive/10 text-destructive"
          }`}
        >
          {rateLimitHint || error}
        </div>
      )}
    </div>
  );
}
