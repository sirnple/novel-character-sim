/**
 * Load & compile chapter TOC rules from chapter-rules.json.
 * Add new formats in JSON — engine code stays stable.
 */
import rulesJson from "./chapter-rules.json";
import { parseChineseNumeral } from "./chapter-numerals";

export type NumberParse = "int" | "cn" | "cnOrInt" | "none";

export interface ChapterRuleDef {
  id: string;
  name?: string;
  enabled?: boolean;
  strength: number;
  flags?: string;
  pattern: string;
  /** 1-based capture group for number; 0 = none */
  numberGroup: number;
  numberParse: NumberParse;
  /** 1-based group for title text */
  titleGroup: number;
  /** Fallback title with $1..$n from groups; empty = use full line */
  titleFallback?: string;
  /** If title empty, prefix with this group (e.g. 序章) */
  titlePrefixGroup?: number;
  requireTitleMinLen?: number;
}

export interface ChapterRulesConfig {
  version: number;
  description?: string;
  maxTitleLen: number;
  strongThreshold: number;
  weakMinStrength: number;
  keepWeakWithStrongMin: number;
  blankLineBoostPrev: number;
  blankLineBoostNext: number;
  noisePatterns: string[];
  rules: ChapterRuleDef[];
}

export interface CompiledChapterRule {
  def: ChapterRuleDef;
  re: RegExp;
}

export interface LineMatch {
  number?: number;
  title: string;
  strength: number;
  kind: string;
}

let cached: {
  config: ChapterRulesConfig;
  compiled: CompiledChapterRule[];
  noise: RegExp[];
} | null = null;

export function getChapterRulesConfig(): ChapterRulesConfig {
  return load().config;
}

export function loadChapterRules(): {
  config: ChapterRulesConfig;
  compiled: CompiledChapterRule[];
  noise: RegExp[];
} {
  return load();
}

/** Test helper: clear cache after hot-reload of rules in tests */
export function _resetChapterRulesCache(): void {
  cached = null;
}

function load() {
  if (cached) return cached;
  const config = rulesJson as ChapterRulesConfig;
  const compiled: CompiledChapterRule[] = [];
  for (const def of config.rules || []) {
    if (def.enabled === false) continue;
    try {
      const flags = def.flags || "";
      compiled.push({ def, re: new RegExp(def.pattern, flags) });
    } catch (e) {
      console.warn(
        `[chapter-rules] invalid pattern id=${def.id}:`,
        (e as Error).message,
      );
    }
  }
  // Higher strength first
  compiled.sort((a, b) => b.def.strength - a.def.strength);

  const noise = (config.noisePatterns || []).map((p) => {
    try {
      return new RegExp(p, "i");
    } catch {
      return /$^/; // never match
    }
  });

  cached = { config, compiled, noise };
  return cached;
}

function parseNumber(
  raw: string | undefined,
  mode: NumberParse,
): number | undefined {
  if (mode === "none" || raw == null || raw === "") return undefined;
  if (mode === "int") {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : undefined;
  }
  if (mode === "cn") return parseChineseNumeral(raw);
  // cnOrInt
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  return parseChineseNumeral(raw);
}

function expandFallback(template: string, m: RegExpExecArray): string {
  if (!template) return "";
  return template.replace(/\$(\d+)/g, (_, g) => m[Number(g)] ?? "");
}

export function isNarrativeNoise(
  line: string,
  config?: ChapterRulesConfig,
  noise?: RegExp[],
): boolean {
  const { config: cfg, noise: noiseRes } = load();
  const c = config || cfg;
  const noises = noise || noiseRes;
  const t = line.trim();
  if (!t) return true;
  if (t.length > (c.maxTitleLen || 80)) return true;
  if (/^[「『"'“]/.test(t)) return true;
  if ((t.match(/[。！？!?；;]/g) || []).length >= 2) return true;
  if (t.length > 24 && /[。！？]$/.test(t)) return true;
  for (const re of noises) {
    if (re.test(t) && t.length > 12) return true;
  }
  return false;
}

/** Try rules against a trimmed line. */
export function matchChapterLine(line: string): LineMatch | null {
  const { config, compiled } = load();
  if (isNarrativeNoise(line, config)) return null;

  for (const { def, re } of compiled) {
    const m = re.exec(line);
    if (!m) continue;

    const numRaw =
      def.numberGroup > 0 ? m[def.numberGroup] : undefined;
    const number = parseNumber(numRaw, def.numberParse || "none");

    let title = "";
    if (def.titleGroup > 0 && m[def.titleGroup]) {
      title = m[def.titleGroup].trim();
    }
    if (!title && def.titlePrefixGroup && m[def.titlePrefixGroup]) {
      const rest =
        def.titleGroup > 0 ? (m[def.titleGroup] || "").trim() : "";
      title = rest
        ? `${m[def.titlePrefixGroup]} ${rest}`.trim()
        : m[def.titlePrefixGroup];
    }
    if (!title && def.titleFallback) {
      title = expandFallback(def.titleFallback, m).trim();
    }
    if (!title) title = line;

    const minLen = def.requireTitleMinLen ?? 0;
    if (minLen > 0 && title.length < minLen) continue;
    if (def.strength < 60 && title.length < 2) continue;

    return {
      number: Number.isFinite(number as number) ? number : undefined,
      title,
      strength: def.strength,
      kind: def.id,
    };
  }
  return null;
}
