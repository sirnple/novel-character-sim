/**
 * Novel form analysis (bone): chaptering + light architecture.
 * Catalog: program-first; optional LLM QA on the list only.
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
 * LLM only reviews catalog list when hints exist or catalog non-empty (cheap).
 */
export async function analyzeNovelForm(
  novelId: string,
  text: string,
  llm?: LLMProvider,
): Promise<FormAnalyzeResult> {
  const catalog = extractChapterCatalog(text);
  let chaptering = inferChapteringFromCatalog(text, catalog);
  const hints = catalogQualityHints(catalog, text.length);

  // Conservative: low confidence → disabled
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

  // Optional LLM: architecture + catalog QA (small payload)
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

async function enrichFormWithLlm(
  base: NovelFormProfile,
  text: string,
  catalog: ChapterCatalogEntry[],
  hints: string[],
  llm: LLMProvider,
): Promise<{ profile: NovelFormProfile; catalog: ChapterCatalogEntry[] }> {
  const parsed = parseNovel(text);
  const ctx = buildNovelContext(parsed, 3).slice(0, 8000);
  const catalogPreview = catalog.slice(0, 40).map((c) => ({
    number: c.number,
    title: c.title,
    startOffset: c.startOffset,
  }));

  const prompt = `你是叙事形态分析师。根据节选与程序抽出的章节目录，输出 JSON（不要 markdown）。

## 正文节选
${ctx}

## 程序章节目录（可能有误）
${JSON.stringify(catalogPreview, null, 0)}

## 程序提示
${hints.join("；") || "无"}

## 输出 JSON 字段
{
  "formType": "web_novel|trad_novel|novella|short_story|essay_prose|epistolary|script_like|mixed|unknown",
  "chapteringEnabled": true/false,
  "chapteringConfidence": 0-1,
  "primaryTemplate": "three_act|episodic|multi_plot|chronicle|quest|slice_of_life|loose|unknown",
  "povScheme": "一句话",
  "timeScheme": "linear|nonlinear|mixed|unknown",
  "evidenceNotes": "一两句依据",
  "genreHints": ["题材"],
  "continuationRules": ["给续写的短规则", "..."],
  "catalogIssues": ["目录明显问题，无则空数组"],
  "dropCatalogIndices": [若某条目录明显误检，给出 0-based 下标]
}

规则：不确定是否分章时 chapteringEnabled=false、confidence 给低。不要编造未见章节。`;

  const raw = await llm.chat(
    [
      { role: "system", content: "只输出合法 JSON。" },
      { role: "user", content: prompt },
    ],
    { temperature: 0.2, maxTokens: 1500 },
  );

  const data = extractJSON(raw) as Record<string, unknown>;
  if (!data || typeof data !== "object") return { profile: base, catalog };

  const conf = Number(data.chapteringConfidence);
  const enabled =
    data.chapteringEnabled === true &&
    (Number.isFinite(conf) ? conf : base.chaptering.confidence) >= CONFIDENCE_ENABLE;

  let catalogPatched = catalog;
  const drops = Array.isArray(data.dropCatalogIndices)
    ? (data.dropCatalogIndices as number[]).filter((n) => Number.isFinite(n))
    : [];
  if (drops.length) {
    const dropSet = new Set(drops);
    catalogPatched = catalog.filter((_, i) => !dropSet.has(i)).map((c) => ({
      ...c,
      source: c.source === "regex" ? "llm_patch" as const : c.source,
    }));
  }

  // Re-infer chaptering if catalog changed
  const chaptering = {
    ...inferChapteringFromCatalog(text, catalogPatched),
    enabled,
    confidence: Number.isFinite(conf) ? conf : base.chaptering.confidence,
  };
  if (!enabled) chaptering.enabled = false;

  const rules = Array.isArray(data.continuationRules)
    ? (data.continuationRules as string[]).map(String).filter(Boolean).slice(0, 8)
    : base.continuationRules;

  return {
    profile: {
      ...base,
      formType: (data.formType as NovelFormProfile["formType"]) || base.formType,
      chaptering,
      unitHierarchy: {
        ...base.unitHierarchy,
        chapter: enabled ? "present" : base.unitHierarchy.chapter,
      },
      narrativeArchitecture: {
        primaryTemplate:
          (data.primaryTemplate as NovelFormProfile["narrativeArchitecture"]["primaryTemplate"]) ||
          "unknown",
        genreHints: Array.isArray(data.genreHints)
          ? (data.genreHints as string[]).map(String)
          : [],
        evidenceNotes: String(data.evidenceNotes || ""),
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