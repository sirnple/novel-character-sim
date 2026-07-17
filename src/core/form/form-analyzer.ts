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
 * Build form profile + chapter catalog from full text.
 * LLM reviews catalog with: coherence → suspicious names → local text windows.
 */
export async function analyzeNovelForm(
  novelId: string,
  text: string,
  llm?: LLMProvider,
): Promise<FormAnalyzeResult> {
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

  let profile = emptyFormProfile(novelId);
  profile.formType = formType;
  profile.chaptering = chaptering;
  profile.unitHierarchy = {
    volume: "absent",
    chapter: chaptering.enabled ? "present" : catalog.length === 1 ? "weak" : "absent",
    section: "absent",
  };
  profile.continuationRules = chaptering.enabled
    ? [
        "本书分章：新开章时使用与 samples 一致的章标题格式。",
        "续写同一章时不要无故新起「第N章」。",
        `章名样例：${chaptering.samples.slice(0, 3).join(" / ") || "（无）"}`,
      ]
    : [
        "本书按保守策略视为弱分章/不分章：除非用户要求，不要添加「第N章」标题。",
      ];

  let finalCatalog = catalog;

  if (llm) {
    try {
      const enriched = await enrichFormWithLlm(profile, text, catalog, hints, llm);
      profile = enriched.profile;
      finalCatalog = enriched.catalog;
    } catch (e) {
      console.warn("[form] LLM enrich failed:", (e as Error).message);
    }
  }

  profile.updatedAt = new Date().toISOString();
  return {
    profile,
    catalog: finalCatalog,
    catalogHints: catalogQualityHints(finalCatalog, text.length),
  };
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

/** Step 1: are chapter numbers roughly sequential / continuous? */
export function analyzeCatalogCoherence(
  catalog: ChapterCatalogEntry[],
): CatalogCoherence {
  const notes: string[] = [];
  const nums = catalog
    .map((c) => c.number)
    .filter((n): n is number => n != null && Number.isFinite(n));
  const numberedCount = nums.length;
  let sequentialPairs = 0;
  const gaps: number[] = [];

  for (let i = 1; i < nums.length; i++) {
    const d = nums[i] - nums[i - 1];
    if (d === 1) sequentialPairs++;
    else if (d > 1) gaps.push(d - 1);
    else if (d <= 0) notes.push(`章号回退或重复：${nums[i - 1]} → ${nums[i]}`);
  }

  const totalPairs = Math.max(0, nums.length - 1);
  const sequentialRatio = totalPairs === 0 ? 0 : sequentialPairs / totalPairs;
  const coherent =
    catalog.length >= 2 &&
    numberedCount >= 2 &&
    sequentialRatio >= 0.5 &&
    !notes.some((n) => n.includes("回退"));

  if (catalog.length >= 2 && coherent) {
    notes.push(
      `章号大体连贯（${sequentialPairs}/${totalPairs} 步长为 1${gaps.length ? `；空隙 ${gaps.join(",")}` : ""}）`,
    );
  } else if (catalog.length >= 2) {
    notes.push("章号不够连贯，需结合标题与原文窗口判断");
  } else if (catalog.length === 1) {
    notes.push("仅 1 条目录，无法谈连贯性");
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

  const prompt = `你是叙事形态分析师，负责校验程序抽出的章节目录，并补充形态字段。只输出 JSON。

## 校验顺序（必须按此执行，不可跳步）
1. **连贯性**：看章号是否大体递增、是否像完整序列（允许少量跳号）。格式是否一致（如都是「第N章」或都是「【书名】一、二、」）。
2. **章名是否像章节**：标题是否像章名（可短、可俗、可带书名括号）；不像的包括：明显正文句子、对话、站点水印、过长叙述句。
3. **仅对「可疑」条目查原文**：使用该条的 nearText / rawLine，看该行是否真是独立章标题（前后常为空行或明显分段）。
   - 若 nearText 证明它是标题 → **保留**
   - 若 nearText 证明它是正文/误检 → 才可 drop，并写清 reason
4. **默认保留**：不确定则保留，写入 catalogIssues，不要删。
5. **禁止**：因为没在书摘 overview 里看见某章就删除；禁止无 reason 的批量删除；禁止编造新章节。

## 程序连贯性预检
${JSON.stringify(coherence, null, 0)}

## 程序目录（含 rawLine；可疑项带 nearText）
${JSON.stringify(catalogForLlm, null, 0)}

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
  "continuationRules": ["给续写的短规则"],
  "catalogIssues": ["疑虑备注，无则 []"],
  "coherenceOk": true/false,
  "dropCatalog": [{"index": 0, "reason": "必须引用 nearText/rawLine 中的证据，至少一句"}]
}

chapteringEnabled：目录连贯且 ≥2 条真标题时应为 true。
dropCatalog：无误检时输出 []。legacy dropCatalogIndices 不要使用。`;

  const raw = await llm.chat(
    [
      {
        role: "system",
        content:
          "只输出合法 JSON。校验目录时严格按：连贯→章名→可疑才看 nearText。默认保留。",
      },
      { role: "user", content: prompt },
    ],
    { temperature: 0.2, maxTokens: 1800 },
  );

  const data = extractJSON(raw) as Record<string, unknown>;
  if (!data || typeof data !== "object") return { profile: base, catalog };

  const dropList = parseDropList(data);
  const catalogPatched = applyCatalogDrops(catalog, dropList, items, coherence);

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

/** Re-export catalog for accept incremental scan */
export { extractChapterCatalog };
