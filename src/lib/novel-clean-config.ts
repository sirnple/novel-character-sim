/**
 * Novel download-site cleaner configuration.
 *
 * Engine: novel-processor `formatNovelText` (MIT, rockbenben) —
 * see `src/core/parser/novel-processor/`. This config maps into
 * NovelFormatOptions + filter keywords; we no longer maintain a
 * bespoke L1/L2 ad-regex tree.
 *
 * Priority (high → low):
 * 1. Call args (`partial` to resolveNovelCleanConfig)
 * 2. Runtime overrides (`data/runtime-settings.json` → novelClean)
 * 3. Env (NOVEL_CLEAN_ENABLED only for coarse toggle)
 * 4. Built-in product defaults
 *
 * Spec: docs/superpowers/specs/2026-08-07-novel-cleaner-config-preview-design.md
 */

import { createHash } from "crypto";
import { runtimeEnv } from "@/lib/runtime-env";

// ── Serializable config (JSON-safe) ─────────────────────────────────

export interface NovelCleanConfig {
  enabled: boolean;

  stripZeroWidth: boolean;
  stripInlineUrls: boolean;
  stripLineUrls: boolean;
  stripNavLines: boolean;
  collapseBlankLines: boolean;

  /** Whole-line ad regex sources (compiled with "i" unless noted). */
  lineAdPatterns: string[];
  /** Site names for short watermark lines (not full-text delete). */
  siteNames: string[];
  /**
   * Full-line nav patterns, OR a special form:
   * - if a pattern starts with "tokens:", rest is alternation for nav tokens
   *   used to build multi-token nav chrome lines (default).
   */
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

/** Max length of a single regex source string. */
export const NOVEL_CLEAN_PATTERN_MAX_LEN = 200;
/** Max patterns per list field. */
export const NOVEL_CLEAN_PATTERN_MAX_COUNT = 80;

// ── Product defaults (from feat/novel-cleaner) ──────────────────────

export const NOVEL_CLEAN_DEFAULTS: NovelCleanConfig = {
  /** Off by default — opt in via Admin or explicit applyClean / preview. */
  enabled: false,

  stripZeroWidth: true,
  stripInlineUrls: true,
  stripLineUrls: true,
  stripNavLines: true,
  /** false: keep layout blank lines (paragraph spacing). */
  collapseBlankLines: false,

  lineAdPatterns: [
    "请记住本站|本站域名|无弹窗|纯文字|秒更新|最快更新|手机用户请|电脑版|手机版阅读",
    "更多精彩小说|更多小说请|免费阅读网址|支持正版|首发本站|首发于|转载请",
    "最新章节请(?:到|关注)|更新最快|全文阅读|TXT\\s*下载|txt\\s*下载",
    "下载自|搜书吧|书友上传|本章完[!！.。]?\\s*$",
    "求推荐票|求月票|求打赏|求订阅|求收藏|求票票",
    "天才一秒记住|记住网址|方便阅读下次|收藏本站|加入书签请",
    "一秒记住【|【.{0,20}小说网】|来自[:：].{0,30}小说",
  ],
  siteNames: [
    "笔趣阁",
    "顶点小说",
    "顶点中文",
    "飞卢小说",
    "起点中文",
    "晋江文学",
    "纵横中文",
    "小说阅读网",
    "书旗小说",
    "掌阅",
    "17K小说网",
  ],
  navLinePatterns: [
    "tokens:(?:上一[章页]|下一[章页]|返回目录|返回书页|加入书签|我的书签|书架|回目录|章节目录|目录)",
  ],
  inlineUrlPatterns: [
    "https?:\\/\\/[^\\s\\u4e00-\\u9fff【】（）()\\[\\]<>\"']+",
    "(?<![@\\w])www\\.[a-z0-9][-a-z0-9.]*\\.[a-z]{2,}(?:\\/[^\\s\\u4e00-\\u9fff【】（）()\\[\\]<>\"']*)?",
  ],
  lineUrlPatterns: ["^\\s*(?:https?:\\/\\/|www\\.)\\S+\\s*$"],
  lineDomainPatterns: [
    "^\\s*[a-z0-9][-a-z0-9]*\\.(?:com|net|org|cc|cn|xyz|top|info|me|la|tw|hk)(?:\\/\\S*)?\\s*$",
  ],

  statistical: true,
  boilerplateChapterRatio: 0.3,
  boilerplateMinChapters: 3,
  boilerplateMaxLineLen: 80,
  marginLineCount: 5,

  warnRemoveRatio: 0.15,
  blockRemoveRatio: 0.35,
};

export const NOVEL_CLEAN_FIELD_DOCS: Record<string, string> = {
  enabled: "总开关；默认关。false 时 clean 为 no-op（上传不强制清洗）",
  stripZeroWidth: "仅去除零宽字符（ZWSP/BOM 等），不动普通空格",
  stripInlineUrls: "剥行内 URL，保留上下文",
  stripLineUrls: "删除整行 URL/域名",
  stripNavLines: "删除章节导航条",
  collapseBlankLines: "连续空行压成最多两行（默认关，保留排版空行）",
  lineAdPatterns: "整行广告正则（字符串，服务端 i 标志）",
  siteNames: "站名列表，仅用于短行水印判定",
  navLinePatterns: "导航行正则；tokens: 前缀表示多 token 导航条",
  statistical: "L2 章间重复 boilerplate",
  boilerplateChapterRatio: "跨章命中比例阈值，默认 0.3",
  boilerplateMinChapters: "至少命中多少章，默认 3",
  warnRemoveRatio: "删除比例警告线，默认 0.15",
  blockRemoveRatio: "删除比例阻断线（apply 需 force），默认 0.35",
};

// ── Compile / resolve ───────────────────────────────────────────────

export interface CompiledPattern {
  source: string;
  re: RegExp;
}

export interface ResolvedNovelCleanConfig extends NovelCleanConfig {
  lineAdRes: CompiledPattern[];
  siteNameRes: RegExp;
  siteNamesList: string[];
  navLineRes: RegExp[];
  inlineUrlRes: RegExp[];
  lineUrlRes: RegExp[];
  lineDomainRes: RegExp[];
  /** Hash of public config for preview/apply alignment */
  fingerprint: string;
}

export type NovelCleanSettingsSlice = {
  novelClean?: Partial<NovelCleanConfig> | null;
};

export interface RegexValidationError {
  field: string;
  index?: number;
  source: string;
  message: string;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function asStringArray(raw: unknown, fallback: string[]): string[] {
  if (!Array.isArray(raw)) return fallback;
  const out = raw
    .map((x) => String(x ?? "").trim())
    .filter((s) => s.length > 0);
  return out.length ? out.slice(0, NOVEL_CLEAN_PATTERN_MAX_COUNT) : fallback;
}

function asBool(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === "boolean") return raw;
  if (raw == null) return fallback;
  const t = String(raw).trim().toLowerCase();
  if (t === "1" || t === "true" || t === "yes" || t === "on") return true;
  if (t === "0" || t === "false" || t === "no" || t === "off") return false;
  return fallback;
}

function asNum(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Escape string for use inside a RegExp character class / alternation. */
export function escapeRegexLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Validate regex sources without applying config.
 * Returns list of errors (empty = ok).
 */
export function validateNovelCleanPatterns(
  cfg: Partial<NovelCleanConfig>,
): RegexValidationError[] {
  const errors: RegexValidationError[] = [];
  const checkList = (field: keyof NovelCleanConfig, list: unknown) => {
    if (list == null) return;
    if (!Array.isArray(list)) {
      errors.push({
        field,
        source: "",
        message: "必须是字符串数组",
      });
      return;
    }
    list.forEach((item, index) => {
      const source = String(item ?? "");
      if (!source.trim()) return;
      if (source.length > NOVEL_CLEAN_PATTERN_MAX_LEN) {
        errors.push({
          field,
          index,
          source: source.slice(0, 80),
          message: `长度超过 ${NOVEL_CLEAN_PATTERN_MAX_LEN}`,
        });
        return;
      }
      try {
        if (field === "navLinePatterns" && source.startsWith("tokens:")) {
          const tok = source.slice("tokens:".length);
          // eslint-disable-next-line no-new
          new RegExp(
            `^\\s*${tok}(?:\\s*[|｜/／·•\\s]+\\s*${tok})*\\s*$`,
            "i",
          );
        } else if (
          field === "inlineUrlPatterns" ||
          field === "lineUrlPatterns" ||
          field === "lineDomainPatterns"
        ) {
          // eslint-disable-next-line no-new
          new RegExp(source, field === "inlineUrlPatterns" ? "gi" : "i");
        } else {
          // eslint-disable-next-line no-new
          new RegExp(source, "i");
        }
      } catch (e) {
        errors.push({
          field,
          index,
          source: source.slice(0, 80),
          message: (e as Error).message || "无效正则",
        });
      }
    });
  };

  checkList("lineAdPatterns", cfg.lineAdPatterns);
  checkList("navLinePatterns", cfg.navLinePatterns);
  checkList("inlineUrlPatterns", cfg.inlineUrlPatterns);
  checkList("lineUrlPatterns", cfg.lineUrlPatterns);
  checkList("lineDomainPatterns", cfg.lineDomainPatterns);

  if (cfg.siteNames != null) {
    if (!Array.isArray(cfg.siteNames)) {
      errors.push({ field: "siteNames", source: "", message: "必须是字符串数组" });
    } else {
      cfg.siteNames.forEach((name, index) => {
        const s = String(name ?? "").trim();
        if (s.length > 40) {
          errors.push({
            field: "siteNames",
            index,
            source: s.slice(0, 40),
            message: "站名过长（≤40）",
          });
        }
      });
    }
  }

  return errors;
}

/** Sanitize partial for persistence (drops invalid fields, keeps valid). */
export function sanitizeNovelCleanPartial(
  raw: unknown,
): Partial<NovelCleanConfig> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: Partial<NovelCleanConfig> = {};

  if (r.enabled != null) out.enabled = asBool(r.enabled, false);
  if (r.stripZeroWidth != null) out.stripZeroWidth = asBool(r.stripZeroWidth, true);
  if (r.stripInlineUrls != null) out.stripInlineUrls = asBool(r.stripInlineUrls, true);
  if (r.stripLineUrls != null) out.stripLineUrls = asBool(r.stripLineUrls, true);
  if (r.stripNavLines != null) out.stripNavLines = asBool(r.stripNavLines, true);
  if (r.collapseBlankLines != null)
    out.collapseBlankLines = asBool(r.collapseBlankLines, false);
  if (r.statistical != null) out.statistical = asBool(r.statistical, true);

  if (r.lineAdPatterns != null)
    out.lineAdPatterns = asStringArray(r.lineAdPatterns, []);
  if (r.siteNames != null) out.siteNames = asStringArray(r.siteNames, []);
  if (r.navLinePatterns != null)
    out.navLinePatterns = asStringArray(r.navLinePatterns, []);
  if (r.inlineUrlPatterns != null)
    out.inlineUrlPatterns = asStringArray(r.inlineUrlPatterns, []);
  if (r.lineUrlPatterns != null)
    out.lineUrlPatterns = asStringArray(r.lineUrlPatterns, []);
  if (r.lineDomainPatterns != null)
    out.lineDomainPatterns = asStringArray(r.lineDomainPatterns, []);

  if (r.boilerplateChapterRatio != null)
    out.boilerplateChapterRatio = clamp(asNum(r.boilerplateChapterRatio, 0.3), 0.05, 1);
  if (r.boilerplateMinChapters != null)
    out.boilerplateMinChapters = clamp(
      Math.floor(asNum(r.boilerplateMinChapters, 3)),
      1,
      50,
    );
  if (r.boilerplateMaxLineLen != null)
    out.boilerplateMaxLineLen = clamp(
      Math.floor(asNum(r.boilerplateMaxLineLen, 80)),
      20,
      200,
    );
  if (r.marginLineCount != null)
    out.marginLineCount = clamp(Math.floor(asNum(r.marginLineCount, 5)), 1, 20);
  if (r.warnRemoveRatio != null)
    out.warnRemoveRatio = clamp(asNum(r.warnRemoveRatio, 0.15), 0, 1);
  if (r.blockRemoveRatio != null)
    out.blockRemoveRatio = clamp(asNum(r.blockRemoveRatio, 0.35), 0, 1);

  const errs = validateNovelCleanPatterns(out);
  if (errs.length) {
    // Drop invalid list fields so bad file doesn't break process
    for (const e of errs) {
      if (e.field === "lineAdPatterns") delete out.lineAdPatterns;
      if (e.field === "navLinePatterns") delete out.navLinePatterns;
      if (e.field === "inlineUrlPatterns") delete out.inlineUrlPatterns;
      if (e.field === "lineUrlPatterns") delete out.lineUrlPatterns;
      if (e.field === "lineDomainPatterns") delete out.lineDomainPatterns;
      if (e.field === "siteNames") delete out.siteNames;
    }
    console.warn(
      "[novel-clean-config] sanitize dropped invalid patterns:",
      errs.map((x) => `${x.field}[${x.index}]: ${x.message}`).join("; "),
    );
  }

  return Object.keys(out).length ? out : undefined;
}

function mergeConfig(
  base: NovelCleanConfig,
  over?: Partial<NovelCleanConfig> | null,
): NovelCleanConfig {
  if (!over) return { ...base, lineAdPatterns: [...base.lineAdPatterns], siteNames: [...base.siteNames], navLinePatterns: [...base.navLinePatterns], inlineUrlPatterns: [...base.inlineUrlPatterns], lineUrlPatterns: [...base.lineUrlPatterns], lineDomainPatterns: [...base.lineDomainPatterns] };
  return {
    enabled: over.enabled ?? base.enabled,
    stripZeroWidth: over.stripZeroWidth ?? base.stripZeroWidth,
    stripInlineUrls: over.stripInlineUrls ?? base.stripInlineUrls,
    stripLineUrls: over.stripLineUrls ?? base.stripLineUrls,
    stripNavLines: over.stripNavLines ?? base.stripNavLines,
    collapseBlankLines: over.collapseBlankLines ?? base.collapseBlankLines,
    // Use != null so empty arrays from Admin clear the list (not fall back to defaults)
    lineAdPatterns:
      over.lineAdPatterns != null
        ? [...over.lineAdPatterns]
        : [...base.lineAdPatterns],
    siteNames:
      over.siteNames != null ? [...over.siteNames] : [...base.siteNames],
    navLinePatterns:
      over.navLinePatterns != null
        ? [...over.navLinePatterns]
        : [...base.navLinePatterns],
    inlineUrlPatterns:
      over.inlineUrlPatterns != null
        ? [...over.inlineUrlPatterns]
        : [...base.inlineUrlPatterns],
    lineUrlPatterns:
      over.lineUrlPatterns != null
        ? [...over.lineUrlPatterns]
        : [...base.lineUrlPatterns],
    lineDomainPatterns:
      over.lineDomainPatterns != null
        ? [...over.lineDomainPatterns]
        : [...base.lineDomainPatterns],
    statistical: over.statistical ?? base.statistical,
    boilerplateChapterRatio:
      over.boilerplateChapterRatio ?? base.boilerplateChapterRatio,
    boilerplateMinChapters:
      over.boilerplateMinChapters ?? base.boilerplateMinChapters,
    boilerplateMaxLineLen:
      over.boilerplateMaxLineLen ?? base.boilerplateMaxLineLen,
    marginLineCount: over.marginLineCount ?? base.marginLineCount,
    warnRemoveRatio: over.warnRemoveRatio ?? base.warnRemoveRatio,
    blockRemoveRatio: over.blockRemoveRatio ?? base.blockRemoveRatio,
  };
}

function compileList(
  sources: string[],
  flags: string,
  field: string,
): CompiledPattern[] {
  const out: CompiledPattern[] = [];
  for (const source of sources) {
    const s = source.trim();
    if (!s) continue;
    try {
      out.push({ source: s, re: new RegExp(s, flags) });
    } catch (e) {
      console.warn(
        `[novel-clean-config] skip bad ${field}: ${s.slice(0, 40)} (${(e as Error).message})`,
      );
    }
  }
  return out;
}

function compileNavPatterns(sources: string[]): RegExp[] {
  const out: RegExp[] = [];
  for (const source of sources) {
    const s = source.trim();
    if (!s) continue;
    try {
      if (s.startsWith("tokens:")) {
        const tok = s.slice("tokens:".length);
        out.push(
          new RegExp(
            `^\\s*${tok}(?:\\s*[|｜/／·•\\s]+\\s*${tok})*\\s*$`,
            "i",
          ),
        );
      } else {
        out.push(new RegExp(s, "i"));
      }
    } catch (e) {
      console.warn(
        `[novel-clean-config] skip bad nav: ${s.slice(0, 40)} (${(e as Error).message})`,
      );
    }
  }
  return out;
}

function fingerprintOf(cfg: NovelCleanConfig): string {
  const json = JSON.stringify(cfg);
  return createHash("sha256").update(json).digest("hex").slice(0, 16);
}

/**
 * Resolve full config + compiled regexes.
 * @param partial call-site overrides (highest)
 * @param settings runtime settings slice (file/admin)
 */
export function resolveNovelCleanConfig(
  partial?: Partial<NovelCleanConfig> | null,
  settings?: NovelCleanSettingsSlice | null,
): ResolvedNovelCleanConfig {
  let cfg = mergeConfig(NOVEL_CLEAN_DEFAULTS, settings?.novelClean ?? null);
  cfg = mergeConfig(cfg, partial ?? null);

  // Coarse env kill-switch
  const envEn = runtimeEnv("NOVEL_CLEAN_ENABLED", "").trim();
  if (envEn !== "") {
    cfg.enabled = asBool(envEn, cfg.enabled);
  }

  const lineAdRes = compileList(cfg.lineAdPatterns, "i", "lineAdPatterns");
  const siteNamesList = cfg.siteNames.map((s) => s.trim()).filter(Boolean);
  const siteNameRes =
    siteNamesList.length > 0
      ? new RegExp(siteNamesList.map(escapeRegexLiteral).join("|"), "i")
      : /(?!)/; // never matches
  const navLineRes = compileNavPatterns(cfg.navLinePatterns);
  const inlineUrlRes = compileList(
    cfg.inlineUrlPatterns,
    "gi",
    "inlineUrlPatterns",
  ).map((p) => p.re);
  const lineUrlRes = compileList(cfg.lineUrlPatterns, "i", "lineUrlPatterns").map(
    (p) => p.re,
  );
  const lineDomainRes = compileList(
    cfg.lineDomainPatterns,
    "i",
    "lineDomainPatterns",
  ).map((p) => p.re);

  const publicCfg: NovelCleanConfig = { ...cfg };
  return {
    ...publicCfg,
    lineAdRes,
    siteNameRes,
    siteNamesList,
    navLineRes,
    inlineUrlRes,
    lineUrlRes,
    lineDomainRes,
    fingerprint: fingerprintOf(publicCfg),
  };
}

/**
 * App helper: resolve with runtime-settings when available.
 * Prefer `getNovelCleanConfigFromRuntime` from runtime-settings to avoid cycles
 * when already holding settings; this uses a dynamic require of getRuntimeSettings.
 */
export function getNovelCleanConfig(
  partial?: Partial<NovelCleanConfig> | null,
): ResolvedNovelCleanConfig {
  try {
    // Dynamic require breaks static cycle with runtime-settings (which imports this module).
    const rs = require("@/lib/runtime-settings") as {
      getRuntimeSettings: () => NovelCleanSettingsSlice;
    };
    return resolveNovelCleanConfig(partial, rs.getRuntimeSettings());
  } catch {
    return resolveNovelCleanConfig(partial, null);
  }
}
