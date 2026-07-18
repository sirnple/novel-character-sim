import type { CharacterProfile, ParsedNovel } from "@/types";
import { createLLMProvider } from "@/core/llm/factory";
import { buildNovelContext } from "@/core/parser/novel-parser";
import { generateId, isChinese } from "@/lib/utils";
import { resolveAgentSystem } from "@/core/prompts/resolve-agent-prompt";
import type { TextUnit } from "./character-name-units";
import type { NameCluster } from "./character-name-cluster";
import type { NameAggregate } from "./character-name-aggregate";
import {
  buildAnchorIndex,
  buildContextFromUnits,
  cooccurringNames,
  resolveAnchor,
  selectDetailTargets,
  selectRelationshipFocus,
  type CharacterAnchor,
} from "./character-anchor-context";
import { isServerDebugMode } from "@/lib/debug-mode";

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
            name: { type: "string", description: "Character's full name" },
            aliases: {
              type: "array",
              items: { type: "string" },
              description: "Other names or nicknames used for this character",
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

const RELATIONSHIP_SCHEMA = {
  name: "relationships",
  description: "Relationship graph between characters",
  parameters: {
    type: "object",
    properties: {
      relationships: {
        type: "array",
        items: {
          type: "object",
          properties: {
            characterA: { type: "string", description: "First character name" },
            characterB: { type: "string", description: "Second character name" },
            type: {
              type: "string",
              enum: ["family","friend","enemy","rival","lover","colleague","mentor-student","acquaintance","other"],
              description: "Type of relationship",
            },
            description: { type: "string", description: "关系动态描述" },
            history: { type: "string", description: "两人如何认识的，经历过什么关键事件" },
            dynamics: { type: "string", description: "权力动态（谁主导、谁被动、平等、互相利用？）" },
          },
          required: ["characterA", "characterB", "type", "description", "history", "dynamics"],
        },
      },
    },
    required: ["relationships"],
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
  characterA: string;
  characterB: string;
  type: string;
  description: string;
  history: string;
  dynamics: string;
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

    // Fill in relationships
    for (const rel of rawRelationships) {
      const charA = characterMap.get(rel.characterA);
      const charB = characterMap.get(rel.characterB);
      if (charA) {
        charA.relationships.push({
          characterId: charB?.id || "",
          characterName: rel.characterB,
          type: rel.type,
          description: rel.description,
          history: rel.history || "",
          dynamics: rel.dynamics || "",
        });
      }
      if (charB) {
        charB.relationships.push({
          characterId: charA?.id || "",
          characterName: rel.characterA,
          type: rel.type,
          description: rel.description,
          history: rel.history || "",
          dynamics: rel.dynamics || "",
        });
      }
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
      { temperature: 0.3, maxTokens: 8192 }
    );

    console.log(
      `[Extractor] Pass 1 done: ${result.characters?.length || 0} characters found (${Date.now() - t0}ms)`,
    );
    return result.characters || [];
  }

  /**
   * Pass1b for unit-scan path: merge frequency-qualified roster into roles + brief.
   */
  async mergeFrequencyRoster(
    llm: ReturnType<typeof createLLMProvider>,
    frequencyRoster: string,
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
      { temperature: 0.3, maxTokens: 8192 },
    );

    // Chunked merge if model returns nothing but roster huge — caller may retry batches
    console.log(
      `[Extractor] Pass 1b done: ${result.characters?.length || 0} (${Date.now() - t0}ms)`,
    );
    return result.characters || [];
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
      /** Clusters or kept aggregates with unitIndices */
      scanClusters?: NameCluster[] | NameAggregate[];
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

    // Importance = appearance frequency; count is dynamic, not a fixed top-N
    const detailChars = selectDetailTargets(rawCharacters, bySurface, {
      hardCap: opts?.detailHardCap,
    });
    opts?.onPhase?.(
      "detail",
      `深挖人设 ${detailChars.length}/${rawCharacters.length}` +
        (units.length ? "（按出现频次·锚点章节）" : "（按出现频次）") +
        "…",
    );

    const characterMap = new Map<string, CharacterProfile>();
    /** normalized name / alias → profile name key in characterMap */
    const nameResolve = new Map<string, string>();

    for (const raw of rawCharacters) {
      const anchor = resolveAnchor(raw.name, bySurface);
      const aliases = Array.from(
        new Set([
          ...(raw.aliases || []),
          ...(anchor?.aliases || []),
          ...(anchor?.surfaces || []).filter((s) => s !== raw.name),
        ]),
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

    const rosterNames = rawCharacters.map((r) => r.name);
    // Relationship focus: same frequency ranking, lower relative bar than detail
    let relFocus = selectRelationshipFocus(rawCharacters, bySurface, {
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
        : `关系网 ${rawCharacters.length} 人…`,
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
          maxCandidates: 15,
        });
        if (!candidates.length) {
          candidates = rosterNames
            .filter((n) => n !== focus.name)
            .slice(0, 10);
        }
        if (!candidates.length) return null;

        const ctx = this.contextForCharacter(focus.name, units, bySurface);
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

  private attachRelationship(
    characterMap: Map<string, CharacterProfile>,
    nameResolve: Map<string, string>,
    rel: RawRelationship,
    seenEdges: Set<string>,
    edgeKey: (a: string, b: string) => string,
    preferA?: string,
  ) {
    let nameA = this.resolveProfileName(rel.characterA, nameResolve, characterMap);
    let nameB = this.resolveProfileName(rel.characterB, nameResolve, characterMap);
    // If model swapped names, try to pin focus as A
    if (preferA) {
      const focusKey = this.resolveProfileName(preferA, nameResolve, characterMap);
      if (focusKey) {
        if (nameB === focusKey && nameA !== focusKey) {
          // swap so focus is A for description direction only; store undirected
          const t = nameA;
          nameA = nameB;
          nameB = t;
        }
        if (!nameA && nameB && nameB !== focusKey) {
          nameA = focusKey;
        }
        if (!nameB && nameA && nameA !== focusKey) {
          nameB = this.resolveProfileName(rel.characterB, nameResolve, characterMap);
        }
      }
    }
    if (!nameA || !nameB || nameA === nameB) return;

    const ek = edgeKey(nameA, nameB);
    if (seenEdges.has(ek)) return;
    seenEdges.add(ek);

    const charA = characterMap.get(nameA)!;
    const charB = characterMap.get(nameB)!;
    charA.relationships.push({
      characterId: charB.id,
      characterName: nameB,
      type: rel.type,
      description: rel.description,
      history: rel.history || "",
      dynamics: rel.dynamics || "",
    });
    charB.relationships.push({
      characterId: charA.id,
      characterName: nameA,
      type: rel.type,
      description: rel.description,
      history: rel.history || "",
      dynamics: rel.dynamics || "",
    });
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
    const focusInstruction = this.zh
      ? `请以「${focusName}」为视角，只描述 TA 与下列角色之间有原文依据的重要关系。characterA 必须是「${focusName}」，characterB 为对方。不要编造未在节选中出现的关系。`
      : `From the perspective of "${focusName}" only. characterA must be "${focusName}". Only include relationships supported by the excerpts.`;

    const prompt = resolveAgentSystem("relationships", this.zh ? "zh" : "en", {
      characterNames: candidateNames.join(", "),
      novelContext,
      focusCharacter: focusName,
      focusInstruction,
    });

    const result = await llm.chatWithTool<{ relationships: RawRelationship[] }>(
      [{ role: "user", content: prompt }],
      RELATIONSHIP_SCHEMA,
      { temperature: 0.2, maxTokens: 4096 },
    );

    return (result.relationships || []).filter((r) => {
      // keep edges involving focus (either side, after resolve)
      const a = (r.characterA || "").replace(/\s+/g, "");
      const b = (r.characterB || "").replace(/\s+/g, "");
      const f = focusName.replace(/\s+/g, "");
      return a === f || b === f || a.includes(f) || b.includes(f) || f.includes(a) || f.includes(b);
    });
  }
}
