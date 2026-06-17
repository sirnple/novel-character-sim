import type { CharacterProfile, ParsedNovel } from "@/types";
import { createLLMProvider } from "@/core/llm/factory";
import { buildNovelContext } from "@/core/parser/novel-parser";
import { generateId, isChinese } from "@/lib/utils";

// ============================================================
// Character Extraction Engine
// Multi-pass extraction:
//   1. Identify all character names + basic info
//   2. Deep-dive each character (personality, behavior, values, etc.)
//   3. Extract relationship graph
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
    const llm = createLLMProvider();
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

  private async extractCharacterList(llm: ReturnType<typeof createLLMProvider>): Promise<RawCharacter[]> {
    console.log(`[Extractor] Pass 1: Identifying characters (contextLen=${this.novelContext.length})...`);
    const t0 = Date.now();

    const promptZh = `你是文学分析家。阅读以下小说，识别所有有名有姓的角色。

小说全文：
${this.novelContext}

对每个角色提供 name（名字）、aliases（别名列表）、role（protagonist/antagonist/supporting/minor）、briefDescription（一句话简介，20字以内）。列出所有角色。`;

    const promptEn = `You are a literary analyst. Identify ALL named characters in this novel.

Novel text:
${this.novelContext}

Return JSON with name, aliases, role (protagonist/antagonist/supporting/minor), briefDescription (brief!). Include every named character.`;

    const result = await llm.chatWithTool<{ characters: RawCharacter[] }>(
      [{ role: "user", content: this.zh ? promptZh : promptEn }],
      CHARACTER_LIST_SCHEMA,
      { temperature: 0.3, maxTokens: 8192 }
    );

    console.log(`[Extractor] Pass 1 done: ${result.characters?.length || 0} characters found (${Date.now() - t0}ms)`);
    return result.characters || [];
  }

  private async extractCharacterDetail(
    llm: ReturnType<typeof createLLMProvider>,
    character: RawCharacter
  ): Promise<CharacterDetail> {
    const promptZh = `深度分析角色"${character.name}"（${character.briefDescription}）。

小说原文：
${this.novelContext}

角色: ${character.name} (定位: ${character.role})

请基于原文分析以下维度（每项简练，用原文证据支撑）：

1. appearance: 外貌描述（年龄、体型、容貌、着装、气质，2-3句话）
2. personality: 3-5个性格特征 + 详细描述 + 决策风格（冲动/谨慎？感性/理性？）+ 压力下如何反应
3. drive: 核心目标 + 动机 + 最大恐惧 + 性格弱点 + 底线 + 秘密（如果有）
4. behavior: 1-3个行为模式 + 1-2个习惯 + 对权威的态度
5. worldview: 1-2句世界观
6. values: 3-5个核心价值观
7. speakingStyle: 整体描述 + 口头禅 + 句式特点 + 词汇水平 + 情绪表达方式
8. background: 出身 + 2-3个关键事件 + 整体背景

如果你不确定某个维度（比如小说中没有透露角色的秘密），请根据角色性格合理推断，标注"（推测）"。保持简洁，每个维度不要太长。`;

    const promptEn = `Deep-dive analysis of "${character.name}" (${character.briefDescription}).

NOVEL CONTEXT:
${this.novelContext}

Character: ${character.name} (Role: ${character.role})

Analyze based on the text:
1. appearance: summary (age, build, features, attire, presence)
2. personality: 3-5 traits + description + decision style + under pressure
3. drive: goal + motivation + fear + weakness + bottom line + secret
4. behavior: patterns + habits + attitude to authority
5. worldview
6. values: 3-5
7. speakingStyle: description + catchphrases + sentence style + vocabulary + emotional expression
8. background: origin + 2-3 key events + overall

Be evidence-based. Infer reasonably where the text is silent. Keep it CONCISE.`;

    const result = await llm.chatWithTool<CharacterDetail>(
      [{ role: "user", content: this.zh ? promptZh : promptEn }],
      CHARACTER_DETAIL_SCHEMA,
      { temperature: 0.5, maxTokens: 8192 }
    );

    return result;
  }

  private async extractRelationships(
    llm: ReturnType<typeof createLLMProvider>,
    characterNames: string[]
  ): Promise<RawRelationship[]> {
    const promptZh = `你是一位文学分析家。请分析以下角色之间的关系网络。

角色列表: ${characterNames.join(", ")}

对每对有重要互动的角色，描述：
- characterA 和 characterB
- type: family/friend/enemy/rival/lover/colleague/mentor-student/acquaintance/other
- description: 关系动态的详细描述
- history: 两人如何认识、经历过什么关键事件
- dynamics: 权力动态——谁占主导、谁被动、互相利用还是平等？

小说原文：
${this.novelContext}

包含所有重要关系，不要遗漏。`;

    const promptEn = `Map relationships between these characters.

Characters: ${characterNames.join(", ")}

For each pair with meaningful interaction:
- characterA and characterB
- type: family/friend/enemy/rival/lover/colleague/mentor-student/acquaintance/other
- description: relationship dynamics
- history: how they met, key shared events
- dynamics: power balance — who dominates, equal, mutual dependency?

NOVEL CONTEXT:
${this.novelContext}`;

    const result = await llm.chatWithTool<{ relationships: RawRelationship[] }>(
      [{ role: "user", content: this.zh ? promptZh : promptEn }],
      RELATIONSHIP_SCHEMA,
      { temperature: 0.3, maxTokens: 8192 }
    );

    return result.relationships || [];
  }
}
