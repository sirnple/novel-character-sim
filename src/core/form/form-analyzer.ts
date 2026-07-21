/**
 * Novel form analysis (bone): chaptering + light architecture.
 * Catalog: program scan first; LLM validates with a fixed order of rules.
 */
import type { LLMProvider } from "@/types";
import type {
  ChapterCatalogEntry,
  NovelFormProfile,
  NovelFormType,
} from "@/types";
import { extractJSON } from "@/lib/utils";
import {
  catalogQualityHints,
  extractChapterCatalog,
  inferChapteringFromCatalog,
} from "./chapter-catalog";
import { applyTrackLabels } from "./chapter-track";
import { buildNovelContext, parseNovel } from "@/core/parser/novel-parser";

const CONFIDENCE_ENABLE = 0.55;
/** Chars before/after chapter offset for LLM local inspection */
const WINDOW_RADIUS = 280;
const MAX_CATALOG_FOR_LLM = 40;

export function emptyFormProfile(novelId: string): NovelFormProfile {
  return {
    novelId,
    formType: "unknown",
    unitHierarchy: {
      volume: "absent",
      chapter: "absent",
      section: "absent",
    },
    chaptering: {
      enabled: false,
      confidence: 0,
      numbering: "none",
      titlePattern: "",
      separator: " ",
      samples: [],
      chapterEndTendency: "unknown",
    },
    narrativeArchitecture: {
      primaryTemplate: "unknown",
      genreHints: [],
      evidenceNotes: "",
      povScheme: "unknown",
      timeScheme: "unknown",
    },
    continuationRules: [
      "形态未充分判定：不要强行添加「第N章」标题，除非用户明确要求分章。",
    ],
    updatedAt: new Date().toISOString(),
  };
}

export interface FormAnalyzeResult {
  profile: NovelFormProfile;
  catalog: ChapterCatalogEntry[];
  catalogHints: string[];
}

/**
 * Program-only form draft: chapter catalog scan + heuristics (no LLM).
 * Used by analyze_form agent tools (step-by-step).
 */
export function buildFormDraftFromText(
  novelId: string,
  text: string,
): FormAnalyzeResult {
  const catalog = extractChapterCatalog(text);
  let chaptering = inferChapteringFromCatalog(text, catalog);
  const hints = catalogQualityHints(catalog, text.length);

  if (chaptering.confidence < CONFIDENCE_ENABLE) {
    chaptering = { ...chaptering, enabled: false };
  }

  let formType: NovelFormType = "unknown";
  if (chaptering.enabled && catalog.length >= 5) formType = "web_novel";
  else if (chaptering.enabled && catalog.length >= 2) formType = "trad_novel";
  else if (text.length < 15_000) formType = "short_story";
  else if (catalog.length === 0 && text.length > 20_000) formType = "essay_prose";

  const profile = emptyFormProfile(novelId);
  profile.formType = formType;
  profile.chaptering = chaptering;
  profile.unitHierarchy = {
    volume: "absent",
    chapter: chaptering.enabled ? "present" : catalog.length === 1 ? "weak" : "absent",
    section: "absent",
  };
  const mainN = catalog.filter((c) => !c.track || c.track === "main").length;
  const extraN = catalog.filter((c) => c.track === "extra").length;
  const otherN = catalog.length - mainN - extraN;

  profile.continuationRules = chaptering.enabled
    ? [
        "本书分章：新开主线章时使用与 samples 一致的章标题格式。",
        "续写同一章时不要无故新起「第N章」。",
        `章名样例（主线）：${chaptering.samples.slice(0, 3).join(" / ") || "（无）"}`,
        ...(extraN || otherN
          ? [
              `目录：主线 ${mainN} · 番外 ${extraN}` +
                (otherN ? ` · 序/尾/卷 ${otherN}` : "") +
                "。主线章号勿与番外混排；书末若在番外，续写前须让用户选择「续番外」或「回主线开新章」。",
            ]
          : []),
      ]
    : [
        "本书按保守策略视为弱分章/不分章：除非用户要求，不要添加「第N章」标题。",
      ];
  profile.updatedAt = new Date().toISOString();

  return {
    profile,
    catalog,
    catalogHints: hints,
  };
}

/**
 * Full form analysis (program + optional LLM). Prefer agent tools for interactive path.
 */
export async function analyzeNovelForm(
  novelId: string,
  text: string,
  llm?: LLMProvider,
): Promise<FormAnalyzeResult> {
  let { profile, catalog, catalogHints: hints } = buildFormDraftFromText(novelId, text);

  if (llm) {
    try {
      const enriched = await enrichFormWithLlm(profile, text, catalog, hints, llm);
      profile = enriched.profile;
      catalog = enriched.catalog;
    } catch (e) {
      console.warn("[form] LLM enrich failed:", (e as Error).message);
    }
  }

  profile.updatedAt = new Date().toISOString();
  return {
    profile,
    catalog,
    catalogHints: catalogQualityHints(catalog, text.length),
  };
}

/** LLM catalog review + narrative fields (exported for form agent tool). */
export async function enrichFormDraftWithLlm(
  base: NovelFormProfile,
  text: string,
  catalog: ChapterCatalogEntry[],
  hints: string[],
  llm: LLMProvider,
): Promise<{ profile: NovelFormProfile; catalog: ChapterCatalogEntry[] }> {
  return enrichFormWithLlm(base, text, catalog, hints, llm);
}

/* ── catalog validation helpers (program-side prep for LLM) ─────────────── */

export interface CatalogCoherence {
  coherent: boolean;
  numberedCount: number;
  sequentialPairs: number;
  totalPairs: number;
  gaps: number[];
  notes: string[];
}

/** Step 1: are **mainline** chapter numbers roughly sequential / continuous? */
export function analyzeCatalogCoherence(
  catalog: ChapterCatalogEntry[],
): CatalogCoherence {
  const notes: string[] = [];
  // 番外/序/尾 不参与主线章号连贯性
  const main = catalog.filter(
    (c) => !c.track || c.track === "main",
  );
  const nonMain = catalog.length - main.length;
  if (nonMain > 0) {
    notes.push(`已排除非主线 ${nonMain} 条后再验章号`);
  }
  const nums = main
    .map((c) => c.number)
    .filter((n): n is number => n != null && Number.isFinite(n));
  const numberedCount = nums.length;
  let sequentialPairs = 0;
  const gaps: number[] = [];

  for (let i = 1; i < nums.length; i++) {
    const d = nums[i] - nums[i - 1];
    if (d === 1) sequentialPairs++;
    else if (d > 1) gaps.push(d - 1);
    else if (d <= 0) notes.push(`主线章号回退或重复：${nums[i - 1]} → ${nums[i]}`);
  }

  const totalPairs = Math.max(0, nums.length - 1);
  const sequentialRatio = totalPairs === 0 ? 0 : sequentialPairs / totalPairs;
  const coherent =
    main.length >= 2 &&
    numberedCount >= 2 &&
    sequentialRatio >= 0.5 &&
    !notes.some((n) => n.includes("回退"));

  if (main.length >= 2 && coherent) {
    notes.push(
      `主线章号大体连贯（${sequentialPairs}/${totalPairs} 步长为 1${gaps.length ? `；空隙 ${gaps.join(",")}` : ""}）`,
    );
  } else if (main.length >= 2) {
    notes.push("主线章号不够连贯，需结合标题与原文窗口判断");
  } else if (main.length === 1) {
    notes.push("主线仅 1 条，无法谈连贯性");
  } else if (catalog.length > 0) {
    notes.push("无主线目录条目（仅有番外/序尾等）");
  } else {
    notes.push("无目录");
  }

  return { coherent, numberedCount, sequentialPairs, totalPairs, gaps, notes };
}

export interface CatalogLlmItem {
  index: number;
  number?: number;
  title: string;
  startOffset: number;
  rawLine: string;
  /** title looks odd as a chapter heading (heuristic only) */
  nameSuspicious: boolean;
  suspicionReasons: string[];
  /** local excerpt around heading for step-3 verification */
  nearText: string;
}

/** Heuristic: names that look less like chapter titles (step 2). */
export function flagSuspiciousChapterName(
  title: string,
  rawLine: string,
): { suspicious: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const t = (title || "").trim();
  const line = (rawLine || "").trim();

  if (!t && !line) {
    reasons.push("空标题");
  }
  if (t.length > 40) reasons.push("标题过长，可能像正文句子");
  if (/[。！？!?]/.test(t)) reasons.push("标题含句末标点");
  if ((t.match(/[「」『』""]/g) || []).length >= 2) {
    reasons.push("标题含对话引号");
  }
  if (/^(他说|她说|我|你|然后|于是|只见)/.test(t)) {
    reasons.push("标题像叙述起句");
  }
  // Pure noise patterns
  if (/搜书|下载|www\.|\.com|http/i.test(line)) {
    reasons.push("像站点/下载水印");
  }

  return { suspicious: reasons.length > 0, reasons };
}

export function sliceNearOffset(
  text: string,
  offset: number,
  radius = WINDOW_RADIUS,
): string {
  const start = Math.max(0, offset - Math.floor(radius / 4));
  const end = Math.min(text.length, offset + radius);
  let slice = text.slice(start, end);
  // Prefer showing from line start of the heading when possible
  const lineStart = text.lastIndexOf("\n", offset);
  if (lineStart >= 0 && offset - lineStart < 120) {
    const fromLine = Math.max(0, lineStart + 1);
    slice = text.slice(fromLine, Math.min(text.length, fromLine + radius));
  }
  return slice.replace(/\r/g, "").slice(0, radius + 40);
}

export function rawLineAtOffset(text: string, offset: number): string {
  const from = offset;
  const nl = text.indexOf("\n", from);
  const line = text.slice(from, nl < 0 ? undefined : nl);
  return line.replace(/\r/g, "").trim();
}

/** Build LLM payload items with local windows (step 3 material). */
export function buildCatalogLlmItems(
  text: string,
  catalog: ChapterCatalogEntry[],
  limit = MAX_CATALOG_FOR_LLM,
): CatalogLlmItem[] {
  return catalog.slice(0, limit).map((c, index) => {
    const rawLine = rawLineAtOffset(text, c.startOffset) || c.title;
    const { suspicious, reasons } = flagSuspiciousChapterName(c.title, rawLine);
    return {
      index,
      number: c.number,
      title: c.title,
      startOffset: c.startOffset,
      rawLine,
      nameSuspicious: suspicious,
      suspicionReasons: reasons,
      nearText: sliceNearOffset(text, c.startOffset),
    };
  });
}

/**
 * Apply LLM drops with guardrails:
 * - only known indices
 * - prefer drops that were name-suspicious OR have a non-empty reason
 * - if catalog was coherent and drop would leave a broken sequence without reasons, reject bulk
 */
export function applyCatalogDrops(
  catalog: ChapterCatalogEntry[],
  drops: { index: number; reason?: string }[],
  items: CatalogLlmItem[],
  coherence: CatalogCoherence,
): ChapterCatalogEntry[] {
  if (!drops.length) return catalog;

  const byIndex = new Map(items.map((it) => [it.index, it]));
  const dropSet = new Set<number>();

  for (const d of drops) {
    const i = d.index;
    if (!Number.isFinite(i) || i < 0 || i >= catalog.length) continue;
    const item = byIndex.get(i);
    const reason = normalizeDropReason(d.reason);
    // Allow drop if: real reason text, or program already marked name suspicious
    if (reason || item?.nameSuspicious) {
      dropSet.add(i);
    } else {
      console.warn(
        `[form] reject drop index=${i}: need reason or suspicious name`,
      );
    }
  }

  // Coherent short catalogs (e.g. 3 sequential): refuse wiping to <2
  // unless every drop cites a solid nearText/rawLine reason
  if (coherence.coherent && catalog.length <= 8 && dropSet.size > 0) {
    const remaining = catalog.length - dropSet.size;
    const allSolid = Array.from(dropSet).every((i) => {
      const d = drops.find((x) => x.index === i);
      return isSolidDropReason(normalizeDropReason(d?.reason));
    });
    if (remaining < 2 && !allSolid) {
      console.warn(
        "[form] reject bulk drop on coherent short catalog without solid reasons",
      );
      return catalog;
    }
  }

  if (!dropSet.size) return catalog;

  return catalog
    .filter((_, i) => !dropSet.has(i))
    .map((c) => ({
      ...c,
      source: c.source === "regex" ? ("llm_patch" as const) : c.source,
    }));
}

function normalizeDropReason(reason?: string): string {
  const r = (reason || "").trim();
  if (!r || r === "legacy_index_only") return "";
  return r;
}

/** Solid reasons must cite local evidence, not a bare label. */
function isSolidDropReason(reason: string): boolean {
  if (reason.length < 12) return false;
  // Prefer reasons that mention looking at text
  return /nearText|rawLine|正文|对话|段落|误检|水印|不是.{0,6}标题|非标题/.test(
    reason,
  ) || reason.length >= 20;
}

function parseDropList(
  data: Record<string, unknown>,
): { index: number; reason?: string }[] {
  const out: { index: number; reason?: string }[] = [];

  // Preferred: [{ index, reason }]
  if (Array.isArray(data.dropCatalog)) {
    for (const raw of data.dropCatalog) {
      if (raw && typeof raw === "object") {
        const o = raw as Record<string, unknown>;
        const index = Number(o.index);
        if (Number.isFinite(index)) {
          out.push({ index, reason: o.reason != null ? String(o.reason) : undefined });
        }
      }
    }
  }

  // Legacy: dropCatalogIndices: number[]
  if (Array.isArray(data.dropCatalogIndices)) {
    for (const n of data.dropCatalogIndices) {
      const index = Number(n);
      if (Number.isFinite(index) && !out.some((d) => d.index === index)) {
        out.push({ index, reason: "legacy_index_only" });
      }
    }
  }

  return out;
}

async function enrichFormWithLlm(
  base: NovelFormProfile,
  text: string,
  catalog: ChapterCatalogEntry[],
  hints: string[],
  llm: LLMProvider,
): Promise<{ profile: NovelFormProfile; catalog: ChapterCatalogEntry[] }> {
  const parsed = parseNovel(text);
  // Light book overview only — not a substitute for per-chapter windows
  const overview = buildNovelContext(parsed, 2).slice(0, 2500);
  const coherence = analyzeCatalogCoherence(catalog);
  const items = buildCatalogLlmItems(text, catalog);
  // Always attach nearText for suspicious; for short catalogs attach all windows
  const catalogForLlm = items.map((it) => {
    const includeWindow =
      it.nameSuspicious || catalog.length <= 12 || !coherence.coherent;
    return {
      index: it.index,
      number: it.number,
      title: it.title,
      startOffset: it.startOffset,
      rawLine: it.rawLine,
      nameSuspicious: it.nameSuspicious,
      suspicionReasons: it.suspicionReasons,
      ...(includeWindow ? { nearText: it.nearText } : {}),
    };
  });

  const catalogForLlmWithTrack = catalogForLlm.map((it, i) => ({
    ...it,
    trackSeed: catalog[i]?.track || "main",
    kind: catalog[i]?.kind,
  }));

  const prompt = `你是叙事形态分析师，负责校验程序抽出的章节目录，标注主线/番外轨，并补充形态字段。只输出 JSON。

## 校验顺序（必须按此执行，不可跳步）
1. **轨（track）**：为每条目录指定 track（见下）。程序给了 trackSeed，可改。
2. **连贯性**：只对 track=main 的条目看章号是否大体递增（允许少量跳号）。**不要把番外章号并进主线序列。**
3. **章名是否像章节**：标题是否像章名；不像的包括正文句子、对话、站点水印、过长叙述句。
4. **仅对「可疑」条目查原文**：nearText / rawLine 证明是标题则保留；是正文/误检才可 drop 并写 reason。
5. **默认保留**：不确定则保留，写入 catalogIssues。
6. **禁止**：因 overview 未见就删；无 reason 批量删；编造新章节。

## track 取值
- main：主线正文章（第N章等）
- extra：番外、外传、特别篇、加更等
- front_matter：序章、楔子、引子、前言
- back_matter：尾声、后记、终章
- volume：卷标（非章）

## 程序连贯性预检（已按主线过滤）
${JSON.stringify(coherence, null, 0)}

## 程序目录（含 trackSeed / rawLine；可疑项带 nearText）
${JSON.stringify(catalogForLlmWithTrack, null, 0)}

## 书摘 overview（仅题材/文风参考，不是验章依据）
${overview || "（无）"}

## 其他程序提示
${hints.join("；") || "无"}

## 输出 JSON
{
  "formType": "web_novel|trad_novel|novella|short_story|essay_prose|epistolary|script_like|mixed|unknown",
  "chapteringEnabled": true/false,
  "chapteringConfidence": 0-1,
  "primaryTemplate": "three_act|episodic|multi_plot|chronicle|quest|slice_of_life|loose|unknown",
  "povScheme": "一句话",
  "timeScheme": "linear|nonlinear|mixed|unknown",
  "evidenceNotes": "一两句依据",
  "genreHints": ["题材"],
  "continuationRules": ["给续写的短规则，须提及番外与主线勿混号"],
  "catalogIssues": ["疑虑备注，无则 []"],
  "coherenceOk": true/false,
  "trackLabels": [{"index": 0, "track": "main"}],
  "dropCatalog": [{"index": 0, "reason": "必须引用 nearText/rawLine 中的证据，至少一句"}]
}

trackLabels：尽量覆盖全部 index；缺省保留 trackSeed。
chapteringEnabled：主线 ≥2 条真标题且大体连贯时应为 true。
dropCatalog：无误检时输出 []。`;

  const raw = await llm.chat(
    [
      {
        role: "system",
        content:
          "只输出合法 JSON。先标 track，再只对 main 验章号连贯。默认保留目录。",
      },
      { role: "user", content: prompt },
    ],
    { temperature: 0.2, maxTokens: 2200 },
  );

  const data = extractJSON(raw) as Record<string, unknown>;
  if (!data || typeof data !== "object") return { profile: base, catalog };

  const dropList = parseDropList(data);
  let catalogPatched = applyCatalogDrops(catalog, dropList, items, coherence);
  catalogPatched = applyTrackLabelsFromLlm(catalogPatched, data);

  if (dropList.length) {
    console.log(
      "[form] LLM drop requests:",
      dropList,
      "→ kept",
      catalogPatched.length,
      "/",
      catalog.length,
    );
  }

  const confLlm = Number(data.chapteringConfidence);
  const confProgram = base.chaptering.confidence;
  let conf = Number.isFinite(confLlm) ? confLlm : confProgram;

  // Re-infer from (possibly) patched catalog
  const inferred = inferChapteringFromCatalog(text, catalogPatched);
  conf = Math.max(conf, inferred.confidence * 0.9);

  let enabled =
    data.chapteringEnabled === true && conf >= CONFIDENCE_ENABLE;
  // If program + remaining catalog still coherent sequential, prefer enabled
  const postCoherence = analyzeCatalogCoherence(catalogPatched);
  if (postCoherence.coherent && catalogPatched.length >= 2) {
    enabled = true;
    conf = Math.max(conf, CONFIDENCE_ENABLE, inferred.confidence);
  } else if (data.chapteringEnabled === false && catalogPatched.length < 2) {
    enabled = false;
  }

  const chaptering = {
    ...inferred,
    enabled,
    confidence: conf,
  };
  if (!enabled) chaptering.enabled = false;

  const rules = Array.isArray(data.continuationRules)
    ? (data.continuationRules as string[]).map(String).filter(Boolean).slice(0, 8)
    : base.continuationRules;

  const issues = Array.isArray(data.catalogIssues)
    ? (data.catalogIssues as unknown[]).map(String).filter(Boolean)
    : [];
  const evidenceExtra = issues.length
    ? `${String(data.evidenceNotes || "")}${data.evidenceNotes ? "；" : ""}目录备注：${issues.join("；")}`
    : String(data.evidenceNotes || "");

  return {
    profile: {
      ...base,
      formType: (data.formType as NovelFormProfile["formType"]) || base.formType,
      chaptering,
      unitHierarchy: {
        ...base.unitHierarchy,
        chapter: enabled
          ? "present"
          : catalogPatched.length === 1
            ? "weak"
            : base.unitHierarchy.chapter,
      },
      narrativeArchitecture: {
        primaryTemplate:
          (data.primaryTemplate as NovelFormProfile["narrativeArchitecture"]["primaryTemplate"]) ||
          "unknown",
        genreHints: Array.isArray(data.genreHints)
          ? (data.genreHints as string[]).map(String)
          : [],
        evidenceNotes: evidenceExtra,
        povScheme: String(data.povScheme || "unknown"),
        timeScheme:
          (data.timeScheme as "linear" | "nonlinear" | "mixed" | "unknown") || "unknown",
      },
      continuationRules: rules.length ? rules : base.continuationRules,
    },
    catalog: catalogPatched,
  };
}

function applyTrackLabelsFromLlm(
  catalog: ChapterCatalogEntry[],
  data: Record<string, unknown>,
): ChapterCatalogEntry[] {
  const raw = data.trackLabels;
  if (!Array.isArray(raw)) return catalog;
  const labels = raw.map((row) => {
    if (!row || typeof row !== "object") return null;
    const o = row as { index?: unknown; track?: unknown };
    return {
      index: Number(o.index),
      track: typeof o.track === "string" ? o.track : undefined,
    };
  });
  return applyTrackLabels(catalog, labels);
}

/** Re-export catalog for accept incremental scan */
export { extractChapterCatalog };
