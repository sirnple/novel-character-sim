import type { CharacterProfile, ParsedNovel } from "@/types";
import { createLLMProvider } from "@/core/llm/factory";
import { buildNovelContext } from "@/core/parser/novel-parser";
import { generateId, isChinese } from "@/lib/utils";
import { resolveAgentSystem } from "@/core/prompts/resolve-agent-prompt";

// ============================================================
// Character Extraction Engine
// Multi-pass extraction:
//   1. Identify character names + basic info (legacy excerpt Pass1)
//   2. Deep-dive each character (personality, behavior, values, etc.)
//   3. Extract relationship graph
//
// NOTE: Unit-wise Flash name scan is specified in
// docs/superpowers/specs/2026-07-18-character-name-scan-design.md
// and is NOT the default path until that spec is grill-frozen.
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
   */
  async completeFromRawList(
    llm: ReturnType<typeof createLLMProvider>,
    rawCharacters: RawCharacter[],
    opts?: { onPhase?: (phase: "detail" | "relationships", message: string) => void },
  ): Promise<CharacterProfile[]> {
    if (rawCharacters.length === 0) {
      throw new Error("No characters found in the novel text.");
    }

    const MAX_DETAIL_CHARS = 5;
    const priorityOrder = ["protagonist", "antagonist", "supporting"];
    const sortedChars = [...rawCharacters].sort(
      (a, b) => priorityOrder.indexOf(a.role) - priorityOrder.indexOf(b.role),
    );
    const detailChars = sortedChars.slice(0, MAX_DETAIL_CHARS);
    opts?.onPhase?.(
      "detail",
      `深挖人设 ${detailChars.length}/${rawCharacters.length}…`,
    );

    const characterMap = new Map<string, CharacterProfile>();
    for (const raw of rawCharacters) {
      characterMap.set(raw.name, {
        id: generateId(),
        name: raw.name,
        aliases: raw.aliases || [],
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
    }

    for (let i = 0; i < detailChars.length; i++) {
      const raw = detailChars[i];
      const detail = await this.extractCharacterDetail(llm, raw);
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

    opts?.onPhase?.("relationships", `关系网 ${rawCharacters.length} 人…`);
    const rawRelationships = await this.extractRelationships(
      llm,
      rawCharacters.map((r) => r.name),
    );

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

    this.extractAllResults = Array.from(characterMap.values());
    return this.extractAllResults;
  }

  private async extractCharacterDetail(
    llm: ReturnType<typeof createLLMProvider>,
    character: RawCharacter
  ): Promise<CharacterDetail> {
    const prompt = resolveAgentSystem("character_detail", this.zh ? "zh" : "en", {
      characterName: character.name,
      characterBrief: character.briefDescription,
      characterRole: character.role,
      novelContext: this.novelContext,
    });

    const result = await llm.chatWithTool<CharacterDetail>(
      [{ role: "user", content: prompt }],
      CHARACTER_DETAIL_SCHEMA,
      { temperature: 0.5, maxTokens: 8192 }
    );

    return result;
  }

  private async extractRelationships(
    llm: ReturnType<typeof createLLMProvider>,
    characterNames: string[]
  ): Promise<RawRelationship[]> {
    const prompt = resolveAgentSystem("relationships", this.zh ? "zh" : "en", {
      characterNames: characterNames.join(", "),
      novelContext: this.novelContext,
    });

    const result = await llm.chatWithTool<{ relationships: RawRelationship[] }>(
      [{ role: "user", content: prompt }],
      RELATIONSHIP_SCHEMA,
      { temperature: 0.3, maxTokens: 16384 }
    );

    return result.relationships || [];
  }
}
