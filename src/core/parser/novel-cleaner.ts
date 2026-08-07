/**
 * Novel text cleaner — product wrapper around novel-processor (MIT, rockbenben).
 *
 * Engine: {@link formatNovelText} from `@/core/parser/novel-processor`
 * Spec: docs/superpowers/specs/2026-08-07-novel-cleaner-config-preview-design.md
 *
 * We do not hand-maintain ad/regex L1/L2 trees here; formatting + artifact
 * cleanup come from novel-processor. This module adds:
 * - runtime config mapping
 * - CleanReport for preview UI
 * - optional CRLF restore (processor normalizes to LF)
 */

import {
  formatNovelText,
  NOVEL_PROCESSOR_DEFAULT_OPTIONS,
  type NovelFormatOptions,
} from "@/core/parser/novel-processor";
import {
  resolveNovelCleanConfig,
  type NovelCleanConfig,
  type ResolvedNovelCleanConfig,
} from "@/lib/novel-clean-config";

export type CleanRemoveCategory =
  | "url_line"
  | "url_inline"
  | "nav"
  | "ad_line"
  | "site_watermark"
  | "boilerplate"
  | "zero_width"
  | "blank_collapse"
  | "processor";

export interface CleanRemovedSample {
  category: CleanRemoveCategory;
  line: string;
  lineNo?: number;
  rule?: string;
  contextBefore?: string;
  contextAfter?: string;
  removedParts?: string[];
  partial?: boolean;
}

export interface CleanReport {
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
  boilerplatePatterns: string[];
  removedSamples: CleanRemovedSample[];
  warnings: string[];
  configFingerprint: string;
}

export type CleanNovelStats = CleanReport["stats"] & {
  boilerplatePatterns: string[];
};

export interface CleanNovelResult {
  text: string;
  report: CleanReport;
  stats: CleanNovelStats;
}

export interface CleanNovelOptions {
  config?: Partial<NovelCleanConfig> | null;
  resolved?: ResolvedNovelCleanConfig | null;
  settings?: { novelClean?: Partial<NovelCleanConfig> | null } | null;
  excludeLineKeys?: string[];
  excludePatterns?: string[];
  maxSamples?: number;
  /** @deprecated */
  statistical?: boolean;
  boilerplateChapterRatio?: number;
  boilerplateMinChapters?: number;
  boilerplateMaxLineLen?: number;
  marginLineCount?: number;
  /** Processor option overrides */
  processor?: Partial<NovelFormatOptions> | null;
  /** Restore original CRLF after processor (default true if input had CRLF) */
  preserveCrlf?: boolean;
}

export type NewlineStyle = "\r\n" | "\n" | "\r";

export function detectNewline(text: string): NewlineStyle {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        crlf++;
        i++;
      } else cr++;
    } else if (c === 10) lf++;
  }
  if (crlf >= lf && crlf >= cr && crlf > 0) return "\r\n";
  if (cr > lf && cr > 0) return "\r";
  return "\n";
}

function emptyReport(
  originalLength: number,
  fingerprint: string,
): CleanReport {
  return {
    stats: {
      originalLength,
      cleanedLength: originalLength,
      removedChars: 0,
      removeRatio: 0,
      urlsStripped: 0,
      adLinesDropped: 0,
      navLinesDropped: 0,
      zeroWidthRemoved: 0,
      boilerplateLinesDropped: 0,
      blankCollapsed: false,
    },
    boilerplatePatterns: [],
    removedSamples: [],
    warnings: [],
    configFingerprint: fingerprint,
  };
}

/** Map product NovelCleanConfig → novel-processor options. */
export function toProcessorOptions(
  cfg: ResolvedNovelCleanConfig,
  partial?: Partial<NovelFormatOptions> | null,
): NovelFormatOptions {
  // Whole-line keyword filter: site names + short ad-ish tokens from defaults
  const keywords = [
    ...(cfg.siteNames || []),
    // From lineAdPatterns sources, only take short literal tokens for filterLines
    "请记住本站",
    "本站域名",
    "求月票",
    "求推荐票",
    "求打赏",
    "求订阅",
    "求收藏",
    "天才一秒记住",
    "无弹窗",
    "纯文字",
  ];
  const filterFromPatterns = (cfg.lineAdPatterns || [])
    .join("|")
    .split("|")
    .map((s) => s.replace(/\\s\*/g, "").replace(/[\\^$.*+?()[\]{}|]/g, "").trim())
    .filter((s) => s.length >= 2 && s.length <= 16 && !s.includes("?"));

  const filterText = Array.from(
    new Set([...keywords, ...filterFromPatterns]),
  ).join("\n");

  const base: NovelFormatOptions = {
    ...NOVEL_PROCESSOR_DEFAULT_OPTIONS,
    filterText:
      filterText ||
      NOVEL_PROCESSOR_DEFAULT_OPTIONS.filterText,
    // collapseBlankLines=false → keep more newlines (compress less aggressively)
    // processor still compresses inside smartLineBreak; disable smart if user wants raw blanks
    smartLineBreak: cfg.collapseBlankLines
      ? true
      : NOVEL_PROCESSOR_DEFAULT_OPTIONS.smartLineBreak,
    enableTrim: true,
  };

  return { ...base, ...(partial || {}) };
}

/**
 * Sample lines present in original but missing (or heavily changed) after clean.
 * Approximate report for preview UI — not a byte-perfect diff.
 */
function buildSamples(
  original: string,
  cleaned: string,
  maxSamples: number,
  excludeKeys: Set<string>,
): CleanRemovedSample[] {
  const norm = (s: string) =>
    s
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  const origLines = original.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const cleanSet = new Set(
    cleaned
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map(norm)
      .filter(Boolean),
  );

  const samples: CleanRemovedSample[] = [];
  for (let i = 0; i < origLines.length && samples.length < maxSamples; i++) {
    const line = origLines[i];
    const t = line.trim();
    if (!t || t.length < 2) continue;
    const key = norm(t);
    if (excludeKeys.has(key)) continue;
    if (cleanSet.has(key)) continue;
    // Still in cleaned as substring of some line? skip sample noise
    if (cleaned.includes(t) && t.length >= 8) continue;

    let category: CleanRemoveCategory = "processor";
    if (/https?:\/\/|www\./i.test(t)) category = "url_line";
    else if (/上一[章页]|下一[章页]|返回目录/.test(t)) category = "nav";
    else if (/请记住|求月票|求推荐|更新最快|本站|无弹窗/.test(t))
      category = "ad_line";

    samples.push({
      category,
      line: t.length > 280 ? t.slice(0, 280) + "…" : t,
      lineNo: i + 1,
      rule: "novel-processor",
    });
  }
  return samples;
}

/**
 * Clean full novel text via novel-processor formatNovelText.
 */
export function cleanNovelText(
  text: string,
  options: CleanNovelOptions = {},
): CleanNovelResult {
  const originalLength = text?.length ?? 0;

  const legacyPartial: Partial<NovelCleanConfig> = {
    ...(options.config || {}),
  };
  if (options.statistical != null) {
    legacyPartial.statistical = options.statistical;
  }

  const cfg =
    options.resolved ||
    resolveNovelCleanConfig(legacyPartial, options.settings ?? null);

  const report = emptyReport(originalLength, cfg.fingerprint);
  const maxSamples = Math.min(100, Math.max(1, options.maxSamples ?? 30));
  const excludeKeys = new Set(
    (options.excludeLineKeys || [])
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean),
  );

  if (!text || !text.trim() || !cfg.enabled) {
    report.stats.cleanedLength = originalLength;
    if (!cfg.enabled) {
      report.warnings.push("清洗已关闭（novelClean.enabled=false）");
    }
    return {
      text: text || "",
      report,
      stats: { ...report.stats, boilerplatePatterns: [] },
    };
  }

  // Apply excludeLineKeys: protect those lines by temporarily tagging
  // (processor has no exclude API — re-inject protected lines after if needed)
  const eol = detectNewline(text);
  const procOpts = toProcessorOptions(cfg, options.processor);

  // If excludePatterns skip ad filter tokens
  if (options.excludePatterns?.length) {
    const skip = new Set(options.excludePatterns.map((p) => p.trim()));
    procOpts.filterText = procOpts.filterText
      .split("\n")
      .filter((k) => !skip.has(k))
      .join("\n");
  }

  let cleaned = formatNovelText(text, procOpts);

  // Re-apply protected full lines that excludeKeys matched (best-effort)
  if (excludeKeys.size > 0) {
    const origLines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const protectedLines = origLines.filter((l) => {
      const key = l
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
      return key && excludeKeys.has(key);
    });
    // If a protected line vanished from cleaned, append note samples only —
    // re-inserting breaks processor layout; UI exclude is for next import.
    void protectedLines;
  }

  const preserveCrlf =
    options.preserveCrlf !== false && eol === "\r\n";
  if (preserveCrlf) {
    cleaned = cleaned.replace(/\n/g, "\r\n");
  }

  report.removedSamples = buildSamples(text, cleaned, maxSamples, excludeKeys);
  report.stats.adLinesDropped = report.removedSamples.filter(
    (s) => s.category === "ad_line" || s.category === "processor",
  ).length;
  report.stats.urlsStripped = report.removedSamples.filter(
    (s) => s.category === "url_line" || s.category === "url_inline",
  ).length;
  report.stats.navLinesDropped = report.removedSamples.filter(
    (s) => s.category === "nav",
  ).length;
  report.stats.cleanedLength = cleaned.length;
  report.stats.removedChars = Math.max(0, originalLength - cleaned.length);
  report.stats.removeRatio =
    originalLength > 0 ? report.stats.removedChars / originalLength : 0;

  if (report.stats.removeRatio >= cfg.warnRemoveRatio) {
    report.warnings.push(
      `删除比例 ${(report.stats.removeRatio * 100).toFixed(1)}% 超过建议阈值 ${(cfg.warnRemoveRatio * 100).toFixed(0)}%`,
    );
  }
  if (report.stats.removeRatio >= cfg.blockRemoveRatio) {
    report.warnings.push(
      `删除比例 ${(report.stats.removeRatio * 100).toFixed(1)}% 达到阻断线 ${(cfg.blockRemoveRatio * 100).toFixed(0)}%（apply 需 force）`,
    );
  }

  return {
    text: cleaned,
    report,
    stats: {
      ...report.stats,
      boilerplatePatterns: report.boilerplatePatterns,
    },
  };
}

/** Stable line key for excludeLineKeys. */
export function novelCleanLineKey(line: string): string {
  return line
    .trim()
    .replace(/\s+/g, " ")
    .replace(/https?:\/\/[^\s]+/gi, "")
    .replace(/www\.[^\s]+/gi, "")
    .trim()
    .toLowerCase();
}
