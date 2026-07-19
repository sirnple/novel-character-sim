import type { CharacterProfile, ParsedNovel } from "@/types";
import { createLLMProvider } from "@/core/llm/factory";
import { buildNovelContext } from "@/core/parser/novel-parser";
import { generateId, isChinese } from "@/lib/utils";
import { resolveAgentSystem } from "@/core/prompts/resolve-agent-prompt";
import type { TextUnit } from "./character-name-units";
import type { NameAggregate } from "./character-name-aggregate";
import {
  buildAnchorIndex,
  buildContextFromUnits,
  buildRelationshipContext,
  cooccurringNames,
  resolveAnchor,
  selectDetailTargets,
  selectRelationshipFocus,
  sharedUnitIndices,
  type CharacterAnchor,
} from "./character-anchor-context";
import { isServerDebugMode } from "@/lib/debug-mode";
import {
  normalizeRelationshipTypeId,
  relationshipTypeEnum,
  relationshipTypePromptList,
} from "./relationship-types";
import {
  consolidateRawCharacters,
  sanitizeAliasesAgainstRoster,
  surfaceCountsFromRoster,
} from "./character-name-consolidate";

// ============================================================
// Character Extraction Engine
// Multi-pass extraction:
//   1. Identify character names + basic info (legacy excerpt Pass1)
//   2. Deep-dive each character (personality, behavior, values, etc.)
//   3. Extract relationship graph
//
// Async unit-scan path: Pass2/3 use per-character unit anchors for context.
// ============================================================

const CHARACTER_LIST_SCHEMA = {
  name: "character_list",
  description: "List of characters extracted from the novel",
  parameters: {
    type: "object",
    properties: {
      characters: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                "Real personal name only (真实姓名). e.g. 孙悟空, 猪八戒 — NOT titles like 齐天大圣",
            },
            aliases: {
              type: "array",
              items: { type: "string" },
              description:
                "Titles/epithets/nicknames for the SAME person only (e.g. 齐天大圣, 美猴王 for 孙悟空). Never a different character.",
            },
            role: {
              type: "string",
              description: "Role in the story: protagonist, antagonist, supporting, minor",
            },
            briefDescription: {
              type: "string",
              description: "One-line description of who this character is",
            },
          },
          required: ["name", "role", "briefDescription"],
        },
      },
    },
    required: ["characters"],
  },
};

const CHARACTER_DETAIL_SCHEMA = {
  name: "character_detail",
  description: "Detailed analysis of a single character",
  parameters: {
    type: "object",
    properties: {
      appearance: {
        type: "object",
        properties: {
          summary: { type: "string", description: "外貌、年龄、体型、容貌、着装、气质（2-4句话）" },
        },
        required: ["summary"],
      },
      personality: {
        type: "object",
        properties: {
          traits: { type: "array", items: { type: "string" }, description: "3-6个关键性格特征" },
          description: { type: "string", description: "性格详细描述（2-4句话）" },
          decisionStyle: { type: "string", description: "决策风格：冲动还是谨慎？感性还是理性？" },
          underPressure: { type: "string", description: "压力下如何反应？战斗/逃跑/僵住/爆发？" },
        },
        required: ["traits", "description", "decisionStyle", "underPressure"],
      },
      drive: {
        type: "object",
        properties: {
          goal: { type: "string", description: "核心目标或追求" },
          motivation: { type: "string", description: "为什么要追求这个目标" },
          fear: { type: "string", description: "最大的恐惧或最怕失去的东西" },
          weakness: { type: "string", description: "性格弱点或致命缺陷" },
          bottomLine: { type: "string", description: "底线——绝不做的事" },
          secret: { type: "string", description: "隐藏的秘密（如果有人知道会改变一切）" },
        },
        required: ["goal", "motivation", "fear", "weakness", "bottomLine", "secret"],
      },
      behavior: {
        type: "object",
        properties: {
          patterns: { type: "array", items: { type: "string" }, description: "1-3个反复出现的行为模式" },
          habits: { type: "array", items: { type: "string" }, description: "1-3个具体习惯或怪癖" },
          attitudeToAuthority: { type: "string", description: "对权威/上位者的态度" },
        },
        required: ["patterns", "habits", "attitudeToAuthority"],
      },
      worldview: { type: "string", description: "世界观——对世界如何运作的信念（1-2句话）" },
      values: { type: "array", items: { type: "string" }, description: "3-5个核心价值观" },
      speakingStyle: {
        type: "object",
        properties: {
          description: { type: "string", description: "整体说话风格描述（1-2句话）" },
          catchphrases: { type: "array", items: { type: "string" }, description: "口头禅或标志性语气词" },
          sentenceStyle: { type: "string", description: "句式特点：短促还是长篇大论？反问还是陈述？" },
          vocabulary: { type: "string", description: "词汇水平：粗俗、文雅、专业术语、市井俚语？" },
          emotionalExpression: { type: "string", description: "不同情绪下如何表达（生气/悲伤/开心时分别怎么说？）" },
        },
        required: ["description", "catchphrases", "sentenceStyle", "vocabulary", "emotionalExpression"],
      },
      background: {
        type: "object",
        properties: {
          origin: { type: "string", description: "出身——家庭、阶层、成长环境" },
          keyEvents: { type: "array", items: { type: "string" }, description: "改变人生的2-3个关键事件" },
          description: { type: "string", description: "整体背景描述" },
        },
        required: ["origin", "keyEvents", "description"],
      },
    },
    required: ["appearance", "personality", "drive", "behavior", "worldview", "values", "speakingStyle", "background"],
  },
};

const REL_SYMMETRY_ENUM = [
  "unidirectional",
  "bidirectional",
  "asymmetric",
] as const;

const REL_VALENCE_ENUM = [
  "positive",
  "negative",
  "ambivalent",
  "instrumental",
  "neutral",
] as const;

const REL_VISIBILITY_ENUM = ["public", "private", "hidden", "mixed"] as const;

const RELATIONSHIP_SCHEMA = {
  name: "relationships",
  description:
    "Directed character relationships (from→to) with symmetry, not undirected labels",
  parameters: {
    type: "object",
    properties: {
      relationships: {
        type: "array",
        items: {
          type: "object",
          properties: {
            from: {
              type: "string",
              description: "Source character (edge starts here)",
            },
            to: {
              type: "string",
              description: "Target character (edge points here)",
            },
            /** legacy aliases accepted */
            characterA: { type: "string", description: "Alias of from" },
            characterB: { type: "string", description: "Alias of to" },
            type: {
              type: "string",
              enum: relationshipTypeEnum(),
              description: "Type of the directed edge from→to",
            },
            symmetry: {
              type: "string",
              enum: [...REL_SYMMETRY_ENUM],
              description:
                "unidirectional | bidirectional | asymmetric (see prompt)",
            },
            reverseType: {
              type: "string",
              enum: relationshipTypeEnum(),
              description:
                "Type of reverse edge to→from when asymmetric or when reverse differs",
            },
            valence: {
              type: "string",
              enum: [...REL_VALENCE_ENUM],
              description: "from's affective stance toward to",
            },
            visibility: {
              type: "string",
              enum: [...REL_VISIBILITY_ENUM],
              description: "public/private/hidden/mixed in the story world",
            },
            description: {
              type: "string",
              description: "2–4句，**from 视角**对 to 的关系定义",
            },
            reverseDescription: {
              type: "string",
              description: "当 asymmetric/bidirectional 时，to 视角对 from 的简述",
            },
            history: {
              type: "string",
              description: "2–4句共同历史与关键事件",
            },
            dynamics: {
              type: "string",
              description: "1–3句权力/依赖/脆弱点（注明方向）",
            },
            keyEvents: {
              type: "array",
              items: { type: "string" },
            },
            emotionalBond: { type: "string" },
            tension: { type: "string" },
          },
          required: ["type", "symmetry", "description", "history", "dynamics"],
        },
      },
    },
    required: ["relationships"],
  },
};

/** Single-pair deep dive (second pass) */
const RELATIONSHIP_PAIR_SCHEMA = {
  name: "relationship_pair",
  description: "Directed deep analysis of one dyad",
  parameters: {
    type: "object",
    properties: {
      type: { type: "string", enum: relationshipTypeEnum() },
      symmetry: { type: "string", enum: [...REL_SYMMETRY_ENUM] },
      reverseType: { type: "string", enum: relationshipTypeEnum() },
      valence: { type: "string", enum: [...REL_VALENCE_ENUM] },
      reverseValence: { type: "string", enum: [...REL_VALENCE_ENUM] },
      visibility: { type: "string", enum: [...REL_VISIBILITY_ENUM] },
      description: { type: "string", description: "from→to POV" },
      reverseDescription: { type: "string", description: "to→from POV" },
      history: { type: "string" },
      dynamics: { type: "string" },
      keyEvents: { type: "array", items: { type: "string" } },
      emotionalBond: { type: "string" },
      tension: { type: "string" },
    },
    required: ["type", "symmetry", "description", "history", "dynamics"],
  },
};

interface RawCharacter {
  name: string;
  aliases?: string[];
  role: string;
  briefDescription: string;
}

interface CharacterDetail {
  appearance: { summary: string };
  personality: { traits: string[]; description: string; decisionStyle: string; underPressure: string };
  drive: { goal: string; motivation: string; fear: string; weakness: string; bottomLine: string; secret: string };
  behavior: { patterns: string[]; habits: string[]; attitudeToAuthority: string };
  worldview: string;
  values: string[];
  speakingStyle: { description: string; catchphrases: string[]; sentenceStyle: string; vocabulary: string; emotionalExpression: string };
  voice: { description: string };
  background: { origin: string; keyEvents: string[]; description: string };
}

interface RawRelationship {
  from?: string;
  to?: string;
  characterA?: string;
  characterB?: string;
  type: string;
  symmetry?: string;
  reverseType?: string;
  valence?: string;
  reverseValence?: string;
  visibility?: string;
  description: string;
  reverseDescription?: string;
  history: string;
  dynamics: string;
  keyEvents?: string[];
  emotionalBond?: string;
  tension?: string;
}

function resolveRawEndpoints(rel: RawRelationship): {
  from: string;
  to: string;
} {
  const from = (rel.from || rel.characterA || "").trim();
  const to = (rel.to || rel.characterB || "").trim();
  return { from, to };
}

function parseSymmetry(
  raw: string | undefined,
): "unidirectional" | "bidirectional" | "asymmetric" {
  const s = (raw || "").toLowerCase().trim();
  if (s === "unidirectional" || s === "单向" || s === "one-way" || s === "one_way") {
    return "unidirectional";
  }
  if (s === "asymmetric" || s === "不对称" || s === "非对称") {
    return "asymmetric";
  }
  if (s === "bidirectional" || s === "双向" || s === "mutual" || s === "对称") {
    return "bidirectional";
  }
  // Default: do not assume mutual mirroring
  return "unidirectional";
}

/** Fold optional rich fields into the three stored strings for UI compatibility. */
function enrichRelationshipText(rel: {
  description?: string;
  history?: string;
  dynamics?: string;
  keyEvents?: string[];
  emotionalBond?: string;
  tension?: string;
}): { description: string; history: string; dynamics: string } {
  let description = (rel.description || "").trim();
  let history = (rel.history || "").trim();
  let dynamics = (rel.dynamics || "").trim();
  if (rel.emotionalBond?.trim()) {
    const bond = rel.emotionalBond.trim();
    if (!description.includes(bond)) {
      description = description
        ? `${description}\n情感纽带：${bond}`
        : `情感纽带：${bond}`;
    }
  }
  if (rel.tension?.trim()) {
    const t = rel.tension.trim();
    if (!dynamics.includes(t)) {
      dynamics = dynamics ? `${dynamics}\n主要张力：${t}` : `主要张力：${t}`;
    }
  }
  if (rel.keyEvents?.length) {
    const ev = rel.keyEvents.map((e) => e.trim()).filter(Boolean);
    if (ev.length) {
      const block = `关键事件：${ev.join("；")}`;
      if (!history.includes(ev[0])) {
        history = history ? `${history}\n${block}` : block;
      }
    }
  }
  return { description, history, dynamics };
}

function relTextScore(r: {
  description?: string;
  history?: string;
  dynamics?: string;
}): number {
  return (
    (r.description || "").length +
    (r.history || "").length +
    (r.dynamics || "").length
  );
}

function asValence(
  v: string | undefined,
): import("@/types").RelationshipValence | undefined {
  const x = (v || "").toLowerCase();
  if (
    x === "positive" ||
    x === "negative" ||
    x === "ambivalent" ||
    x === "instrumental" ||
    x === "neutral"
  ) {
    return x;
  }
  return undefined;
}

function asVisibility(
  v: string | undefined,
): import("@/types").RelationshipVisibility | undefined {
  const x = (v || "").toLowerCase();
  if (x === "public" || x === "private" || x === "hidden" || x === "mixed") {
    return x;
  }
  return undefined;
}

export class CharacterExtractor {
  private novelContext: string;
  private novelContextSmall: string;
  private fullText: string;
  private zh: boolean;

  constructor(parsed: ParsedNovel) {
    this.novelContextSmall = buildNovelContext(parsed, 3);
    this.novelContext = buildNovelContext(parsed, 5);
    this.fullText = parsed.fullText;
    this.zh = isChinese(parsed.fullText);
  }

  async extractAll(): Promise<CharacterProfile[]> {
    const llm = createLLMProvider("analysis");
    const tTotal = Date.now();

    const rawCharacters = await this.extractCharacterList(llm);
    if (rawCharacters.length === 0) {
      throw new Error("No characters found in the novel text.");
    }

    const MAX_DETAIL_CHARS = 5;
    const priorityOrder = ["protagonist", "antagonist", "supporting"];
    const sortedChars = [...rawCharacters].sort(
      (a, b) => priorityOrder.indexOf(a.role) - priorityOrder.indexOf(b.role)
    );
    const detailChars = sortedChars.slice(0, MAX_DETAIL_CHARS);
    console.log(
      `[Extractor] Pass 2: Deep-diving ${detailChars.length}/${rawCharacters.length} characters...`
    );

    const characterMap = new Map<string, CharacterProfile>();

    for (const raw of rawCharacters) {
      characterMap.set(raw.name, {
        id: generateId(),
        name: raw.name,
        aliases: raw.aliases || [],
        appearance: { summary: raw.briefDescription },
        personality: { traits: [], description: raw.briefDescription, decisionStyle: "", underPressure: "" },
        drive: { goal: "", motivation: "", fear: "", weakness: "", bottomLine: "", secret: "" },
        behavior: { patterns: [], habits: [], attitudeToAuthority: "" },
        worldview: "",
        values: [],
        speakingStyle: { description: "", catchphrases: [], sentenceStyle: "", vocabulary: "", emotionalExpression: "" },
        voice: { description: "" },
        background: { origin: "", keyEvents: [], description: "" },
        relationships: [],
      });
    }

    for (let i = 0; i < detailChars.length; i++) {
      const raw = detailChars[i];
      console.log(`[Extractor] Pass 2 [${i + 1}/${detailChars.length}]: "${raw.name}"...`);
      const tChar = Date.now();
      const detail = await this.extractCharacterDetail(llm, raw);
      console.log(`[Extractor] Pass 2 [${i + 1}/${detailChars.length}]: "${raw.name}" done (${Date.now() - tChar}ms)`);

      const existing = characterMap.get(raw.name)!;
      existing.appearance = detail.appearance;
      existing.personality = detail.personality;
      existing.drive = detail.drive;
      existing.behavior = detail.behavior;
      existing.worldview = detail.worldview;
      existing.values = detail.values;
      existing.speakingStyle = detail.speakingStyle;
      existing.voice = detail.voice || { description: "" };
      existing.background = detail.background;
    }

    // Pass 3: Extract relationships
    console.log(`[Extractor] Pass 3: Extracting relationships for ${rawCharacters.length} characters...`);
    const tRel = Date.now();
    const rawRelationships = await this.extractRelationships(
      llm,
      rawCharacters.map((r) => r.name)
    );
    console.log(`[Extractor] Pass 3 done: ${rawRelationships.length} relationships found (${Date.now() - tRel}ms)`);

    // Fill in relationships (directed)
    const nameResolve = new Map<string, string>();
    for (const name of Array.from(characterMap.keys())) {
      nameResolve.set(name.replace(/\s+/g, ""), name);
    }
    const seen = new Set<string>();
    for (const rel of rawRelationships) {
      this.attachRelationship(
        characterMap,
        nameResolve,
        rel,
        seen,
        (a, b) => `${a}→${b}`,
      );
    }

    console.log(`[Extractor] All passes complete: ${characterMap.size} characters, total ${Date.now() - tTotal}ms`);
    return Array.from(characterMap.values());
  }

  /**
   * Extract the END-state snapshot of all characters from the last chapter(s).
   * This gives writer the "now" picture, not the full-book average.
   * Should be called AFTER extractAll() when character names are known.
   */
  async extractLastChapterStates(): Promise<import("@/types").CharacterChapterState[]> {
    const llm = createLLMProvider("analysis");
    // Only use the last ~30% of the novel text as the "recent" context
    const textLen = this.fullText.length;
    const recentStart = Math.max(0, textLen - Math.floor(textLen * 0.3));
    // Find nearest chapter boundary
    const recentText = this.fullText.slice(recentStart);

    const knownNames = Array.from(new Set([
      ...this.extractAllResults?.map(c => c.name) ?? []
    ]));

    if (knownNames.length === 0) {
      console.warn("[CharacterExtractor] extractLastChapterStates: no characters known yet, skipping");
      return [];
    }

    const schema = {
      name: "chapter_end_states",
      description: "All characters'' states at end of the latest content",
      parameters: {
        type: "object",
        properties: {
          characterStates: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                alive: { type: "boolean" },
                location: { type: "string", description: "角色目前所在位置" },
                delta: { type: "string", description: "从最近章节到当前时刻的状态变化摘要，1-2句" }
              },
              required: ["name", "alive", "location", "delta"]
            }
          }
        },
        required: ["characterStates"]
      }
    };

    const prompt = resolveAgentSystem("chapter_end_states", this.zh ? "zh" : "en", {
      recentText: recentText.slice(0, 12000),
      knownNames: knownNames.join(", "),
    });

    const result = await llm.chatWithTool<{ characterStates: any[] }>(
      [{ role: "user", content: prompt }],
      schema,
      { temperature: 0.3, maxTokens: 4096 }
    );

    const lastChapterNum = 999; // unknown exact number from this method

    return (result.characterStates || []).map(s => ({
      characterId: s.name || "",
      name: s.name || "",
      lastSeenChapter: lastChapterNum,
      alive: s.alive !== false,
      location: s.location || "未知",
      delta: s.delta || ""
    }));
  }

  // Cache for extractAll results so extractLastChapterStates can reference them
  private extractAllResults: import("@/types").CharacterProfile[] = [];

  private async extractCharacterList(llm: ReturnType<typeof createLLMProvider>): Promise<RawCharacter[]> {
    // Legacy excerpt-based Pass1 (sync extractAll). Unit-scan uses mergeFrequencyRoster via job.
    console.log(`[Extractor] Pass 1: Identifying characters (contextLen=${this.novelContext.length})...`);
    const t0 = Date.now();

    const prompt = resolveAgentSystem("character_list", this.zh ? "zh" : "en", {
      novelContext: this.novelContext,
      frequencyRoster:
        "（当前为节选直抽模式。请仅根据下方小说节选列出角色。）",
    });

    const result = await llm.chatWithTool<{ characters: RawCharacter[] }>(
      [{ role: "user", content: prompt }],
      CHARACTER_LIST_SCHEMA,
      { temperature: 0.3, maxTokens: 12288 }
    );

    const raw = result.characters || [];
    const consolidated = consolidateRawCharacters(raw);
    console.log(
      `[Extractor] Pass 1 done: ${raw.length} → consolidate ${consolidated.length} (${Date.now() - t0}ms)`,
    );
    return consolidated;
  }

  /**
   * Pass1b for unit-scan path: merge frequency-qualified roster into roles + brief.
   */
  async mergeFrequencyRoster(
    llm: ReturnType<typeof createLLMProvider>,
    frequencyRoster: string,
    opts?: {
      /** Frequency aggregates/clusters for name vs alias orientation */
      surfaceRoster?: { name: string; aliases?: string[]; mentions?: number }[];
    },
  ): Promise<RawCharacter[]> {
    console.log(
      `[Extractor] Pass 1b merge roster (contextLen=${this.novelContext.length})...`,
    );
    const t0 = Date.now();
    const prompt = resolveAgentSystem("character_list", this.zh ? "zh" : "en", {
      novelContext: this.novelContext,
      frequencyRoster:
        frequencyRoster ||
        "（无频次名单）",
    });

    const result = await llm.chatWithTool<{ characters: RawCharacter[] }>(
      [{ role: "user", content: prompt }],
      CHARACTER_LIST_SCHEMA,
      { temperature: 0.25, maxTokens: 12288 },
    );

    const raw = result.characters || [];
    const counts = opts?.surfaceRoster?.length
      ? surfaceCountsFromRoster(opts.surfaceRoster)
      : undefined;
    const consolidated = consolidateRawCharacters(raw, {
      surfaceCounts: counts,
    });
    console.log(
      `[Extractor] Pass 1b done: ${raw.length} → consolidate ${consolidated.length} (${Date.now() - t0}ms)`,
    );
    return consolidated;
  }

  /**
   * Pass2 + Pass3 from a raw list (used by async character job).
   * When `units` + scan anchors are provided, detail/rel use per-character
   * unit context (not the global 5-chunk excerpt).
   */
  async completeFromRawList(
    llm: ReturnType<typeof createLLMProvider>,
    rawCharacters: RawCharacter[],
    opts?: {
      onPhase?: (phase: "detail" | "relationships", message: string) => void;
      /** Name-scan units (chapter/windows) for anchor context */
      units?: TextUnit[];
      /** Post-coref entity aggregates with unitIndices (anchors) */
      scanClusters?: NameAggregate[];
      /** Optional safety cost caps only (undefined = frequency threshold only) */
      detailHardCap?: number;
      relHardCap?: number;
    },
  ): Promise<CharacterProfile[]> {
    if (rawCharacters.length === 0) {
      throw new Error("No characters found in the novel text.");
    }

    const units = opts?.units || [];
    const { bySurface } = buildAnchorIndex(opts?.scanClusters || []);

    // Re-sanitize after any upstream alias noise; keep one person per row
    const listChars = sanitizeAliasesAgainstRoster(
      consolidateRawCharacters(rawCharacters),
    );

    // Importance = appearance frequency; count is dynamic, not a fixed top-N
    const detailChars = selectDetailTargets(listChars, bySurface, {
      hardCap: opts?.detailHardCap,
    });
    opts?.onPhase?.(
      "detail",
      `深挖人设 ${detailChars.length}/${listChars.length}` +
        (units.length ? "（按出现频次·锚点章节）" : "（按出现频次）") +
        "…",
    );

    const characterMap = new Map<string, CharacterProfile>();
    /** normalized name / alias → profile name key in characterMap */
    const nameResolve = new Map<string, string>();

    for (const raw of listChars) {
      const anchor = resolveAnchor(raw.name, bySurface);
      // Only attach anchor surfaces that belong to this person (same cluster)
      const anchorSurfaces = [
        ...(anchor?.aliases || []),
        ...(anchor?.surfaces || []),
      ].filter((s) => s && s !== raw.name);
      const aliases = Array.from(
        new Set([...(raw.aliases || []), ...anchorSurfaces]),
      );
      characterMap.set(raw.name, {
        id: generateId(),
        name: raw.name,
        aliases,
        appearance: { summary: raw.briefDescription },
        personality: {
          traits: [],
          description: raw.briefDescription,
          decisionStyle: "",
          underPressure: "",
        },
        drive: {
          goal: "",
          motivation: "",
          fear: "",
          weakness: "",
          bottomLine: "",
          secret: "",
        },
        behavior: { patterns: [], habits: [], attitudeToAuthority: "" },
        worldview: "",
        values: [],
        speakingStyle: {
          description: "",
          catchphrases: [],
          sentenceStyle: "",
          vocabulary: "",
          emotionalExpression: "",
        },
        voice: { description: "" },
        background: { origin: "", keyEvents: [], description: "" },
        relationships: [],
      });
      const keys = [raw.name, ...aliases, anchor?.canonical].filter(Boolean) as string[];
      for (const k of keys) {
        const nk = k.replace(/\s+/g, "").trim();
        if (nk) nameResolve.set(nk, raw.name);
      }
    }

    const applyDetail = async (raw: RawCharacter, i: number) => {
      const ctx = this.contextForCharacter(raw.name, units, bySurface);
      console.log(
        `[Extractor] Pass 2 [${i + 1}/${detailChars.length}]: "${raw.name}" ` +
          `ctxLen=${ctx.length}`,
      );
      const detail = await this.extractCharacterDetail(llm, raw, ctx);
      const existing = characterMap.get(raw.name)!;
      existing.appearance = detail.appearance;
      existing.personality = detail.personality;
      existing.drive = detail.drive;
      existing.behavior = detail.behavior;
      existing.worldview = detail.worldview;
      existing.values = detail.values;
      existing.speakingStyle = detail.speakingStyle;
      existing.voice = detail.voice || { description: "" };
      existing.background = detail.background;
    };

    const unlimited = isServerDebugMode();
    if (unlimited) {
      console.log(
        `[Extractor] Pass 2 parallel detail x${detailChars.length} (debug unlimited)`,
      );
      await Promise.all(detailChars.map((raw, i) => applyDetail(raw, i)));
    } else {
      for (let i = 0; i < detailChars.length; i++) {
        await applyDetail(detailChars[i], i);
      }
    }

    // Drop aliases that collide with another profile's name after anchor attach
    {
      const names = Array.from(characterMap.values()).map((p) => ({
        name: p.name,
        aliases: p.aliases,
      }));
      const cleaned = sanitizeAliasesAgainstRoster(names);
      for (const c of cleaned) {
        const p = characterMap.get(c.name);
        if (p) p.aliases = c.aliases || [];
      }
    }

    const rosterNames = listChars.map((r) => r.name);
    // Relationship focus: same frequency ranking, lower relative bar than detail
    let relFocus = selectRelationshipFocus(listChars, bySurface, {
      hardCap: opts?.relHardCap,
    });
    // Ensure every detail target also gets a relationship pass
    const relNames = new Set(relFocus.map((c) => c.name));
    for (const d of detailChars) {
      if (!relNames.has(d.name)) {
        relFocus.push(d);
        relNames.add(d.name);
      }
    }

    opts?.onPhase?.(
      "relationships",
      units.length
        ? `关系网（${relFocus.length} 重要角色视角 × 共现）…`
        : `关系网 ${listChars.length} 人…`,
    );

    const edgeKey = (a: string, b: string) => {
      const x = a.replace(/\s+/g, "");
      const y = b.replace(/\s+/g, "");
      return x < y ? `${x}||${y}` : `${y}||${x}`;
    };
    const seenEdges = new Set<string>();

    if (units.length && bySurface.size > 0) {
      const runRelFocus = async (
        focus: (typeof relFocus)[0],
        i: number,
      ): Promise<{ focusName: string; edges: RawRelationship[] } | null> => {
        const anchor = resolveAnchor(focus.name, bySurface);
        if (!anchor) {
          console.log(
            `[Extractor] Pass 3 skip "${focus.name}" (no unit anchor)`,
          );
          return null;
        }
        let candidates = cooccurringNames(anchor, rosterNames, bySurface, {
          maxCandidates: 30,
        });
        // Pad with other high-importance roster names so graph is not only co-occur
        if (candidates.length < 12) {
          for (const n of rosterNames) {
            if (n === focus.name) continue;
            if (candidates.includes(n)) continue;
            candidates.push(n);
            if (candidates.length >= 20) break;
          }
        }
        if (!candidates.length) return null;

        const candAnchors = candidates
          .map((n) => resolveAnchor(n, bySurface))
          .filter((a): a is CharacterAnchor => !!a);
        const ctx =
          buildRelationshipContext(anchor, candAnchors, units, {
            maxChars: 28_000,
            maxUnits: 14,
          }).trim() || this.contextForCharacter(focus.name, units, bySurface);

        if (!unlimited) {
          opts?.onPhase?.(
            "relationships",
            `关系 ${i + 1}/${relFocus.length}：${focus.name}（${candidates.length} 候选）…`,
          );
        }
        console.log(
          `[Extractor] Pass 3 [${i + 1}/${relFocus.length}]: "${focus.name}" ` +
            `candidates=${candidates.length} ctxLen=${ctx.length}`,
        );

        try {
          const edges = await this.extractRelationshipsFromFocus(
            llm,
            focus.name,
            candidates,
            ctx,
          );
          return { focusName: focus.name, edges };
        } catch (e) {
          console.warn(
            `[Extractor] Pass 3 focus "${focus.name}" failed:`,
            (e as Error).message,
          );
          return null;
        }
      };

      let relResults: Array<{ focusName: string; edges: RawRelationship[] } | null>;
      if (unlimited) {
        console.log(
          `[Extractor] Pass 3 parallel rel focus x${relFocus.length} (debug unlimited)`,
        );
        opts?.onPhase?.(
          "relationships",
          `关系网并行 ${relFocus.length} 视角（debug）…`,
        );
        relResults = await Promise.all(
          relFocus.map((focus, i) => runRelFocus(focus, i)),
        );
      } else {
        relResults = [];
        for (let i = 0; i < relFocus.length; i++) {
          relResults.push(await runRelFocus(relFocus[i], i));
        }
      }

      for (const pack of relResults) {
        if (!pack) continue;
        for (const rel of pack.edges) {
          this.attachRelationship(
            characterMap,
            nameResolve,
            rel,
            seenEdges,
            edgeKey,
            pack.focusName,
          );
        }
      }

      // Pass 3b: deep-dive top pairs with co-occurrence-only context
      await this.enrichTopRelationshipPairs(
        llm,
        characterMap,
        nameResolve,
        bySurface,
        units,
        relFocus.map((r) => r.name),
        unlimited,
        opts?.onPhase,
      );
    } else {
      // Legacy single-shot relationship pass (no unit anchors)
      const rawRelationships = await this.extractRelationships(
        llm,
        rosterNames,
      );
      for (const rel of rawRelationships) {
        this.attachRelationship(
          characterMap,
          nameResolve,
          rel,
          seenEdges,
          edgeKey,
        );
      }
    }

    this.extractAllResults = Array.from(characterMap.values());
    return this.extractAllResults;
  }

  private contextForCharacter(
    name: string,
    units: TextUnit[],
    bySurface: Map<string, CharacterAnchor>,
  ): string {
    if (!units.length) return this.novelContext;
    const anchor = resolveAnchor(name, bySurface);
    if (!anchor?.unitIndices?.length) return this.novelContext;
    const ctx = buildContextFromUnits(units, anchor.unitIndices, {
      maxChars: 18_000,
      maxUnits: 8,
    });
    return ctx.trim() || this.novelContext;
  }

  /**
   * Second pass: re-analyze important pairs with co-occurrence excerpts only,
   * merging richer text into existing edges.
   */
  private async enrichTopRelationshipPairs(
    llm: ReturnType<typeof createLLMProvider>,
    characterMap: Map<string, CharacterProfile>,
    nameResolve: Map<string, string>,
    bySurface: Map<string, CharacterAnchor>,
    units: TextUnit[],
    focusNames: string[],
    parallel: boolean,
    onPhase?: (phase: "detail" | "relationships", message: string) => void,
  ): Promise<void> {
    type Pair = { a: string; b: string; score: number };
    const pairs: Pair[] = [];
    const seen = new Set<string>();
    const focusSet = new Set(focusNames);

    for (const name of Array.from(characterMap.keys())) {
      const char = characterMap.get(name)!;
      for (const rel of char.relationships || []) {
        const other = rel.characterName;
        const ek =
          name < other ? `${name}||${other}` : `${other}||${name}`;
        if (seen.has(ek)) continue;
        seen.add(ek);
        // Prefer pairs involving a relationship-focus character
        if (!focusSet.has(name) && !focusSet.has(other)) continue;
        const aa = resolveAnchor(name, bySurface);
        const bb = resolveAnchor(other, bySurface);
        if (!aa || !bb) continue;
        const shared = sharedUnitIndices(aa, bb);
        if (shared.length < 1) continue;
        const thin = relTextScore(rel) < 180;
        const score =
          shared.length * 20 +
          (aa.mentions + bb.mentions) +
          (thin ? 50 : 0);
        pairs.push({ a: name, b: other, score });
      }
    }

    pairs.sort((x, y) => y.score - x.score);
    const top = pairs.slice(0, Math.min(16, pairs.length));
    if (!top.length) return;

    onPhase?.(
      "relationships",
      `关系深挖 ${top.length} 对重要羁绊…`,
    );
    console.log(`[Extractor] Pass 3b pair deep-dive x${top.length}`);

    if (parallel) {
      await Promise.all(
        top.map((p, i) =>
          this.enrichOnePair(
            llm,
            characterMap,
            nameResolve,
            bySurface,
            units,
            p,
            i,
            top.length,
          ),
        ),
      );
    } else {
      for (let i = 0; i < top.length; i++) {
        await this.enrichOnePair(
          llm,
          characterMap,
          nameResolve,
          bySurface,
          units,
          top[i],
          i,
          top.length,
        );
      }
    }
  }

  private async enrichOnePair(
    llm: ReturnType<typeof createLLMProvider>,
    characterMap: Map<string, CharacterProfile>,
    nameResolve: Map<string, string>,
    bySurface: Map<string, CharacterAnchor>,
    units: TextUnit[],
    p: { a: string; b: string },
    i: number,
    total: number,
  ): Promise<void> {
    const aa = resolveAnchor(p.a, bySurface);
    const bb = resolveAnchor(p.b, bySurface);
    if (!aa || !bb) return;
    const shared = sharedUnitIndices(aa, bb);
    const ctx = buildContextFromUnits(
      units,
      shared.length ? shared : aa.unitIndices,
      {
        maxChars: 22_000,
        maxUnits: 12,
        preferIndices: shared,
      },
    );
    if (!ctx.trim()) return;
    console.log(
      `[Extractor] Pass 3b [${i + 1}/${total}]: ${p.a} ↔ ${p.b} ctxLen=${ctx.length}`,
    );
    try {
      const deep = await this.extractRelationshipPair(llm, p.a, p.b, ctx);
      if (!deep) return;
      this.mergeRelationshipEdge(characterMap, nameResolve, {
        from: p.a,
        to: p.b,
        type: deep.type,
        symmetry: deep.symmetry,
        reverseType: deep.reverseType,
        valence: deep.valence,
        reverseValence: deep.reverseValence,
        visibility: deep.visibility,
        description: deep.description,
        reverseDescription: deep.reverseDescription,
        history: deep.history,
        dynamics: deep.dynamics,
        keyEvents: deep.keyEvents,
        emotionalBond: deep.emotionalBond,
        tension: deep.tension,
      });
    } catch (e) {
      console.warn(
        `[Extractor] Pass 3b pair ${p.a}/${p.b} failed:`,
        (e as Error).message,
      );
    }
  }

  private resolveProfileName(
    name: string,
    nameResolve: Map<string, string>,
    characterMap: Map<string, CharacterProfile>,
  ): string | null {
    if (characterMap.has(name)) return name;
    const nk = name.replace(/\s+/g, "").trim();
    const hit = nameResolve.get(nk);
    if (hit && characterMap.has(hit)) return hit;
    // soft match
    const entries = Array.from(nameResolve.entries());
    for (let i = 0; i < entries.length; i++) {
      const k = entries[i][0];
      const v = entries[i][1];
      if (k.length >= 2 && nk.length >= 2 && (k.endsWith(nk) || nk.endsWith(k))) {
        if (characterMap.has(v)) return v;
      }
    }
    return null;
  }

  /**
   * Directed attach: owner profile lists only edges FROM that owner.
   * Does not blindly mirror labels both ways.
   */
  private attachRelationship(
    characterMap: Map<string, CharacterProfile>,
    nameResolve: Map<string, string>,
    rel: RawRelationship,
    seenEdges: Set<string>,
    _edgeKey: (a: string, b: string) => string,
    preferFrom?: string,
  ) {
    const ends = resolveRawEndpoints(rel);
    let fromName = this.resolveProfileName(ends.from, nameResolve, characterMap);
    let toName = this.resolveProfileName(ends.to, nameResolve, characterMap);

    if (preferFrom) {
      const focusKey = this.resolveProfileName(
        preferFrom,
        nameResolve,
        characterMap,
      );
      if (focusKey) {
        if (!fromName && toName && toName !== focusKey) fromName = focusKey;
        if (toName === focusKey && fromName && fromName !== focusKey) {
          const t = fromName;
          fromName = toName;
          toName = t;
        }
        if (!fromName) fromName = focusKey;
      }
    }

    if (!fromName || !toName || fromName === toName) return;

    const symmetry = parseSymmetry(rel.symmetry);
    const typeId = normalizeRelationshipTypeId(rel.type);
    const reverseTypeId = rel.reverseType
      ? normalizeRelationshipTypeId(rel.reverseType)
      : symmetry === "bidirectional"
        ? typeId
        : undefined;

    const fwdText = enrichRelationshipText({
      description: rel.description,
      history: rel.history,
      dynamics: rel.dynamics,
      keyEvents: rel.keyEvents,
      emotionalBond: rel.emotionalBond,
      tension: rel.tension,
    });
    const revText = enrichRelationshipText({
      description: rel.reverseDescription || "",
      history: rel.history,
      dynamics: rel.dynamics,
      keyEvents: rel.keyEvents,
      emotionalBond: rel.emotionalBond,
      tension: rel.tension,
    });

    const dirKey = `${fromName.replace(/\s+/g, "")}→${toName.replace(/\s+/g, "")}`;
    seenEdges.add(dirKey);
    this.upsertDirectedEdge(characterMap, fromName, toName, {
      type: typeId,
      symmetry,
      reverseType: reverseTypeId,
      valence: asValence(rel.valence),
      visibility: asVisibility(rel.visibility),
      description: fwdText.description,
      history: fwdText.history,
      dynamics: fwdText.dynamics,
    });

    if (symmetry === "unidirectional") return;

    const revType =
      reverseTypeId ||
      (symmetry === "bidirectional" ? typeId : typeId);
    const revKey = `${toName.replace(/\s+/g, "")}→${fromName.replace(/\s+/g, "")}`;
    seenEdges.add(revKey);

    // For bidirectional without reverseDescription, reverse text may be empty —
    // use a short placeholder so UI still shows the reverse type.
    const revDesc =
      revText.description ||
      (symmetry === "bidirectional"
        ? `与「${fromName}」相互的${typeId}关系（互向）。`
        : `从「${toName}」一侧回看「${fromName}」。`);

    this.upsertDirectedEdge(characterMap, toName, fromName, {
      type: revType,
      symmetry,
      reverseType: typeId,
      valence: asValence(rel.reverseValence || rel.valence),
      visibility: asVisibility(rel.visibility),
      description: revDesc,
      history: revText.history || fwdText.history,
      dynamics: revText.dynamics || fwdText.dynamics,
    });
  }

  private upsertDirectedEdge(
    characterMap: Map<string, CharacterProfile>,
    fromName: string,
    toName: string,
    edge: {
      type: string;
      symmetry: "unidirectional" | "bidirectional" | "asymmetric";
      reverseType?: string;
      valence?: import("@/types").RelationshipValence;
      visibility?: import("@/types").RelationshipVisibility;
      description: string;
      history: string;
      dynamics: string;
    },
  ) {
    const from = characterMap.get(fromName);
    const to = characterMap.get(toName);
    if (!from || !to) return;

    const idx = from.relationships.findIndex(
      (r) =>
        r.characterName === toName ||
        r.characterId === to.id ||
        r.characterName.replace(/\s+/g, "") === toName.replace(/\s+/g, ""),
    );

    const next: import("@/types").Relationship = {
      characterId: to.id,
      characterName: toName,
      type: edge.type,
      symmetry: edge.symmetry,
      reverseType: edge.reverseType,
      valence: edge.valence,
      visibility: edge.visibility,
      description: edge.description,
      history: edge.history,
      dynamics: edge.dynamics,
    };

    if (idx < 0) {
      from.relationships.push(next);
      return;
    }

    const cur = from.relationships[idx];
    const preferType =
      edge.type !== "other" || normalizeRelationshipTypeId(cur.type) === "other"
        ? edge.type
        : normalizeRelationshipTypeId(cur.type);
    from.relationships[idx] = {
      characterId: to.id,
      characterName: toName,
      type: preferType,
      symmetry: edge.symmetry || cur.symmetry || "unidirectional",
      reverseType: edge.reverseType || cur.reverseType,
      valence: edge.valence || cur.valence,
      visibility: edge.visibility || cur.visibility,
      description:
        (edge.description || "").length > (cur.description || "").length
          ? edge.description
          : cur.description,
      history:
        (edge.history || "").length > (cur.history || "").length
          ? edge.history
          : cur.history,
      dynamics:
        (edge.dynamics || "").length > (cur.dynamics || "").length
          ? edge.dynamics
          : cur.dynamics,
    };
  }

  private mergeRelationshipEdge(
    characterMap: Map<string, CharacterProfile>,
    nameResolve: Map<string, string>,
    rel: RawRelationship,
  ) {
    this.attachRelationship(
      characterMap,
      nameResolve,
      rel,
      new Set(),
      (a, b) => `${a}→${b}`,
    );
  }

  private async extractCharacterDetail(
    llm: ReturnType<typeof createLLMProvider>,
    character: RawCharacter,
    novelContext?: string,
  ): Promise<CharacterDetail> {
    const prompt = resolveAgentSystem("character_detail", this.zh ? "zh" : "en", {
      characterName: character.name,
      characterBrief: character.briefDescription,
      characterRole: character.role,
      novelContext: novelContext || this.novelContext,
    });

    const result = await llm.chatWithTool<CharacterDetail>(
      [{ role: "user", content: prompt }],
      CHARACTER_DETAIL_SCHEMA,
      { temperature: 0.25, maxTokens: 8192 },
    );

    return result;
  }

  private async extractRelationships(
    llm: ReturnType<typeof createLLMProvider>,
    characterNames: string[],
  ): Promise<RawRelationship[]> {
    const prompt = resolveAgentSystem("relationships", this.zh ? "zh" : "en", {
      characterNames: characterNames.join(", "),
      novelContext: this.novelContext,
      focusCharacter: "",
      focusInstruction: "",
      typeCatalog: relationshipTypePromptList(this.zh),
    });

    const result = await llm.chatWithTool<{ relationships: RawRelationship[] }>(
      [{ role: "user", content: prompt }],
      RELATIONSHIP_SCHEMA,
      { temperature: 0.2, maxTokens: 8192 },
    );

    return result.relationships || [];
  }

  /** Multi-round: one focus character's relations to co-occurring candidates. */
  private async extractRelationshipsFromFocus(
    llm: ReturnType<typeof createLLMProvider>,
    focusName: string,
    candidateNames: string[],
    novelContext: string,
  ): Promise<RawRelationship[]> {
    const typeCatalog = relationshipTypePromptList(this.zh);
    const focusInstruction = this.zh
      ? `以「${focusName}」为 from（边的起点）。输出有向关系边 from→to。
必须填写 symmetry：
- unidirectional：仅 from 对 to 成立（暗恋、单方面仇恨、单方面控制意图等）
- bidirectional：双方同类互向（互为战友、确认恋爱、结义）
- asymmetric：双方都重要但类型不同（必须填 reverseType + reverseDescription）
类型目录：${typeCatalog}
不要把单向写成双向。description 必须是 from 视角。`
      : `from="${focusName}". Emit directed edges. Set symmetry carefully (uni/bi/asymmetric). Types: ${typeCatalog}. description is from's POV.`;

    const prompt = resolveAgentSystem("relationships", this.zh ? "zh" : "en", {
      characterNames: candidateNames.join("、"),
      novelContext,
      focusCharacter: focusName,
      focusInstruction,
      typeCatalog,
    });

    const result = await llm.chatWithTool<{ relationships: RawRelationship[] }>(
      [{ role: "user", content: prompt }],
      RELATIONSHIP_SCHEMA,
      { temperature: 0.3, maxTokens: 8192 },
    );

    return (result.relationships || []).filter((r) => {
      const ends = resolveRawEndpoints(r);
      const a = ends.from.replace(/\s+/g, "");
      const b = ends.to.replace(/\s+/g, "");
      const f = focusName.replace(/\s+/g, "");
      return (
        a === f ||
        b === f ||
        a.includes(f) ||
        b.includes(f) ||
        f.includes(a) ||
        f.includes(b)
      );
    });
  }

  private async extractRelationshipPair(
    llm: ReturnType<typeof createLLMProvider>,
    nameA: string,
    nameB: string,
    novelContext: string,
  ): Promise<RawRelationship | null> {
    const focusInstruction = this.zh
      ? `深挖有向对：「${nameA}」(from) 与「${nameB}」(to)。必须给出 symmetry，以及必要时 reverseType/reverseDescription（to 对 from）。`
      : `Deep-dive directed pair from="${nameA}" to="${nameB}". Set symmetry and reverse fields when needed.`;

    const prompt = resolveAgentSystem("relationships", this.zh ? "zh" : "en", {
      characterNames: nameB,
      novelContext,
      focusCharacter: nameA,
      focusInstruction,
      typeCatalog: relationshipTypePromptList(this.zh),
    });

    try {
      const one = await llm.chatWithTool<{
        type: string;
        symmetry?: string;
        reverseType?: string;
        valence?: string;
        reverseValence?: string;
        visibility?: string;
        description: string;
        reverseDescription?: string;
        history: string;
        dynamics: string;
        keyEvents?: string[];
        emotionalBond?: string;
        tension?: string;
      }>(
        [
          {
            role: "user",
            content:
              prompt +
              `\n\n只输出一对关系的 JSON（from 隐含为 ${nameA}，to 为 ${nameB}）。`,
          },
        ],
        RELATIONSHIP_PAIR_SCHEMA,
        { temperature: 0.3, maxTokens: 4096 },
      );
      if (!one?.description) return null;
      return {
        from: nameA,
        to: nameB,
        ...one,
      };
    } catch {
      const list = await llm.chatWithTool<{ relationships: RawRelationship[] }>(
        [{ role: "user", content: prompt }],
        RELATIONSHIP_SCHEMA,
        { temperature: 0.3, maxTokens: 4096 },
      );
      const hit = (list.relationships || [])[0];
      if (!hit) return null;
      return {
        from: nameA,
        to: nameB,
        type: hit.type,
        symmetry: hit.symmetry,
        reverseType: hit.reverseType,
        valence: hit.valence,
        reverseValence: hit.reverseValence,
        visibility: hit.visibility,
        description: hit.description,
        reverseDescription: hit.reverseDescription,
        history: hit.history,
        dynamics: hit.dynamics,
        keyEvents: hit.keyEvents,
        emotionalBond: hit.emotionalBond,
        tension: hit.tension,
      };
    }
  }
}
