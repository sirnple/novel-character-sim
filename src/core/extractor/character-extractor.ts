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
      personality: {
        type: "object",
        properties: {
          traits: {
            type: "array",
            items: { type: "string" },
            description: "Key personality traits (e.g., brave, cunning, compassionate)",
          },
          description: {
            type: "string",
            description: "Detailed description of the character's personality",
          },
        },
        required: ["traits", "description"],
      },
      behavior: {
        type: "object",
        properties: {
          patterns: {
            type: "array",
            items: { type: "string" },
            description: "Recurring behavioral patterns",
          },
          habits: {
            type: "array",
            items: { type: "string" },
            description: "Specific habits or mannerisms",
          },
        },
        required: ["patterns", "habits"],
      },
      worldview: {
        type: "string",
        description: "The character's worldview, beliefs about how the world works",
      },
      values: {
        type: "array",
        items: { type: "string" },
        description: "Core values the character holds (e.g., loyalty, freedom, justice)",
      },
      speakingStyle: {
        type: "string",
        description: "How the character speaks: vocabulary level, speech patterns, catchphrases, tone",
      },
      background: {
        type: "string",
        description: "Character's background and history relevant to their personality",
      },
    },
    required: ["personality", "behavior", "worldview", "values", "speakingStyle", "background"],
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
              enum: [
                "family",
                "friend",
                "enemy",
                "rival",
                "lover",
                "colleague",
                "mentor-student",
                "acquaintance",
                "stranger",
                "other",
              ],
              description: "Type of relationship",
            },
            description: {
              type: "string",
              description: "Detailed description of the relationship dynamics",
            },
          },
          required: ["characterA", "characterB", "type", "description"],
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
  personality: { traits: string[]; description: string };
  behavior: { patterns: string[]; habits: string[] };
  worldview: string;
  values: string[];
  speakingStyle: string;
  background: string;
}

interface RawRelationship {
  characterA: string;
  characterB: string;
  type: string;
  description: string;
}

export class CharacterExtractor {
  private novelContext: string;
  private novelContextSmall: string;
  private fullText: string;
  private zh: boolean; // Use Chinese prompts

  constructor(parsed: ParsedNovel) {
    // DeepSeek has 1M context — use full coverage
    this.novelContextSmall = buildNovelContext(parsed, 3);
    this.novelContext = buildNovelContext(parsed, 5);
    this.fullText = parsed.fullText;
    this.zh = isChinese(parsed.fullText);
  }

  /** Run the full extraction pipeline */
  async extractAll(): Promise<CharacterProfile[]> {
    const llm = createLLMProvider();
    const tTotal = Date.now();

    // Pass 1: Identify characters
    const rawCharacters = await this.extractCharacterList(llm);
    if (rawCharacters.length === 0) {
      throw new Error("No characters found in the novel text.");
    }

    // Pass 2: Deep-dive the most important characters (limit to top N)
    const MAX_DETAIL_CHARS = 5;
    const priorityOrder = ["protagonist", "antagonist", "supporting"];
    const sortedChars = [...rawCharacters].sort(
      (a, b) => priorityOrder.indexOf(a.role) - priorityOrder.indexOf(b.role)
    );
    const detailChars = sortedChars.slice(0, MAX_DETAIL_CHARS);
    console.log(
      `[Extractor] Pass 2: Deep-diving ${detailChars.length}/${rawCharacters.length} characters (top priority)...`
    );

    const characterMap = new Map<string, CharacterProfile>();

    // First create basic profiles for all characters
    for (const raw of rawCharacters) {
      characterMap.set(raw.name, {
        id: generateId(),
        name: raw.name,
        aliases: raw.aliases || [],
        personality: { traits: [], description: raw.briefDescription },
        behavior: { patterns: [], habits: [] },
        worldview: "",
        values: [],
        speakingStyle: "",
        background: "",
        relationships: [],
      });
    }

    // Deep-dive only the priority characters
    for (let i = 0; i < detailChars.length; i++) {
      const raw = detailChars[i];
      console.log(`[Extractor] Pass 2 [${i + 1}/${detailChars.length}]: Analyzing "${raw.name}"...`);
      const tChar = Date.now();
      const detail = await this.extractCharacterDetail(llm, raw);
      console.log(`[Extractor] Pass 2 [${i + 1}/${detailChars.length}]: "${raw.name}" done (${Date.now() - tChar}ms)`);

      // Update the existing profile with detailed info
      const existing = characterMap.get(raw.name)!;
      existing.personality = detail.personality;
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
        });
      }
      if (charB) {
        charB.relationships.push({
          characterId: charA?.id || "",
          characterName: rel.characterA,
          type: rel.type,
          description: rel.description,
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
    const promptZh = `分析角色"${character.name}"（${character.briefDescription}）。

小说原文：
${this.novelContext}

角色: ${character.name} (定位: ${character.role})

请简练分析（每项1-3句话）：
1. personality: 2-5个性格特征 + 1-2句描述
2. behavior: 1-3个行为模式 + 1-2个习惯
3. worldview: 1-2句世界观
4. values: 3-5个核心价值观
5. speakingStyle: 1-2句说话风格（语气/词汇/口头禅）
6. background: 1-2句关键背景

基于原文，保持简洁。`;

    const promptEn = `Analyze the character "${character.name}" (${character.briefDescription}) from the novel.

NOVEL CONTEXT:
${this.novelContext}

Character: ${character.name} (Role: ${character.role})

Provide a CONCISE analysis (each field 1-3 sentences max):
1. personality: 2-5 traits + 1-2 sentence description
2. behavior: 1-3 patterns + 1-2 habits
3. worldview: 1-2 sentences
4. values: 3-5 core values
5. speakingStyle: 1-2 sentences about vocabulary/tone/patterns
6. background: 1-2 sentences about key history

Be specific and evidence-based. Keep it BRIEF.`;

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

对每对有重要关系的角色，描述：
- characterA 和 characterB: 两个角色名
- type: family=家人/friend=朋友/enemy=敌人/rival=对手/lover=恋人/colleague=同僚/mentor-student=师徒/acquaintance=相识/other=其他
- description: 关系动态的详细描述

小说原文：
${this.novelContext}

请包含所有重要的关系，不要遗漏任何在小说中有互动的角色对。`;

    const promptEn = `You are a literary analyst. Map the relationships between ALL pairs of the following characters from the novel.

Characters: ${characterNames.join(", ")}

For each pair that has a meaningful relationship, describe:
- characterA and characterB: the two characters
- type: family / friend / enemy / rival / lover / colleague / mentor-student / acquaintance / other
- description: detailed description of their relationship dynamics

NOVEL CONTEXT:
${this.novelContext}

Include ALL significant relationships.`;

    const result = await llm.chatWithTool<{ relationships: RawRelationship[] }>(
      [{ role: "user", content: this.zh ? promptZh : promptEn }],
      RELATIONSHIP_SCHEMA,
      { temperature: 0.3, maxTokens: 8192 }
    );

    return result.relationships || [];
  }
}
