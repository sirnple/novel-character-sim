import type { StoryInfo, ParsedNovel } from "@/types";
import { createLLMProvider } from "@/core/llm/factory";
import { buildNovelContext } from "@/core/parser/novel-parser";
import { isChinese } from "@/lib/utils";

const STORY_SCHEMA_ZH = {
  name: "story_info",
  description: "小说故事信息提取",
  parameters: {
    type: "object",
    properties: {
      plotSummary: { type: "string", description: "整体情节摘要（200字以内）" },
      mainStoryline: { type: "string", description: "主线故事概括" },
      subPlots: { type: "array", items: { type: "string" }, description: "支线情节" },
      themes: { type: "array", items: { type: "string" }, description: "小说主题" },
      chapterOutlines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            chapterNumber: { type: "number" },
            title: { type: "string" },
            summary: { type: "string" },
            keyEvents: { type: "array", items: { type: "string" } },
          },
          required: ["chapterNumber", "title", "summary", "keyEvents"],
        },
        description: "各章节概要",
      },
      worldSetting: {
        type: "object",
        properties: {
          timePeriod: { type: "string", description: "时代背景" },
          location: { type: "string", description: "主要地点" },
          socialStructure: { type: "string", description: "社会结构/等级制度" },
          powerSystem: { type: "string", description: "力量体系（修仙/魔法/科技等）" },
          factions: { type: "array", items: { type: "string" }, description: "势力/门派" },
          rules: { type: "array", items: { type: "string" }, description: "世界规则" },
          atmosphere: { type: "string", description: "世界观氛围" },
        },
        required: ["timePeriod", "location", "socialStructure"],
      },
      backgroundInfo: { type: "string", description: "故事背景介绍" },
      writingStyle: {
        type: "object",
        properties: {
          genre: { type: "string", description: "小说类型" },
          styleDescription: { type: "string", description: "文风描述" },
          narrativeTechniques: { type: "array", items: { type: "string" }, description: "叙事手法" },
          languageFeatures: { type: "string", description: "语言特点" },
          pacingDescription: { type: "string", description: "节奏特点" },
          tone: { type: "string", description: "基调" },
          examplePassages: {
            type: "array",
            items: {
              type: "object",
              properties: {
                aspect: { type: "string", description: "这个片段展示的写作特点" },
                text: { type: "string", description: "原文片段（200-500字）" },
              },
              required: ["aspect", "text"],
            },
            description: "3-5个代表性文风片段",
          },
          contentRating: {
            type: "object",
            properties: {
              level: { type: "string", description: "成人内容等级：无/轻度暧昧/情色描写/露骨色情" },
              description: { type: "string", description: "原著成人内容处理方式的描述" },
              hasExplicitContent: { type: "boolean", description: "是否包含露骨内容" },
            },
            required: ["level", "hasExplicitContent"],
          },
        },
        required: ["genre", "styleDescription"],
      },
    },
    required: ["plotSummary", "mainStoryline", "worldSetting"],
  },
};

const STORY_SCHEMA_EN = {
  name: "story_info",
  description: "Story information extraction",
  parameters: {
    type: "object",
    properties: {
      plotSummary: { type: "string" },
      mainStoryline: { type: "string" },
      subPlots: { type: "array", items: { type: "string" } },
      themes: { type: "array", items: { type: "string" } },
      chapterOutlines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            chapterNumber: { type: "number" },
            title: { type: "string" },
            summary: { type: "string" },
            keyEvents: { type: "array", items: { type: "string" } },
          },
          required: ["chapterNumber", "title", "summary", "keyEvents"],
        },
      },
      worldSetting: {
        type: "object",
        properties: {
          timePeriod: { type: "string" },
          location: { type: "string" },
          socialStructure: { type: "string" },
          powerSystem: { type: "string" },
          factions: { type: "array", items: { type: "string" } },
          rules: { type: "array", items: { type: "string" } },
          atmosphere: { type: "string" },
        },
        required: ["timePeriod", "location"],
      },
      backgroundInfo: { type: "string" },
      writingStyle: {
        type: "object",
        properties: {
          genre: { type: "string" },
          styleDescription: { type: "string" },
          narrativeTechniques: { type: "array", items: { type: "string" } },
          languageFeatures: { type: "string" },
          pacingDescription: { type: "string" },
          tone: { type: "string" },
          examplePassages: {
            type: "array",
            items: {
              type: "object",
              properties: {
                aspect: { type: "string" },
                text: { type: "string" },
              },
              required: ["aspect", "text"],
            },
          },
          contentRating: {
            type: "object",
            properties: {
              level: { type: "string" },
              description: { type: "string" },
              hasExplicitContent: { type: "boolean" },
            },
            required: ["level", "hasExplicitContent"],
          },
        },
        required: ["genre", "styleDescription"],
      },
    },
    required: ["plotSummary", "mainStoryline", "worldSetting"],
  },
};

export class StoryExtractor {
  private novelContext: string;
  private useChinese: boolean;

  constructor(parsed: ParsedNovel) {
    this.novelContext = buildNovelContext(parsed, 2);
    this.useChinese = isChinese(this.novelContext);
  }

  async extract(): Promise<StoryInfo> {
    const llm = createLLMProvider();
    const schema = this.useChinese ? STORY_SCHEMA_ZH : STORY_SCHEMA_EN;
    const title = this.useChinese ? "《未命名小说》" : "Untitled Novel";

    console.log(
      `[StoryExtractor] Extracting story info (lang=${this.useChinese ? "zh" : "en"}, contextLen=${this.novelContext.length})...`
    );
    const t0 = Date.now();

    const prompt = this.useChinese
      ? `你是一位文学分析家。请阅读以下小说节选，提取故事信息。

小说内容：
${this.novelContext}

请提取：
1. 整体情节摘要
2. 主线故事
3. 支线情节（如有）
4. 各章节概要（含章节号、标题、摘要、关键事件）
5. 世界观设定（时代、地点、社会结构、力量体系、势力、规则、氛围）
6. 主题
7. 背景介绍
8. 文风特点（类型、文风描述、叙事手法、语言特点、节奏、基调、3-5个代表性文风片段、成人内容等级如实评估）

尽可能详细。`
      : `You are a literary analyst. Read the novel excerpts and extract story information.

Novel content:
${this.novelContext}

Extract plot summary, main storyline, sub-plots, chapter outlines, world setting, themes, and background info.`;

    const result = await llm.chatWithTool<{
      plotSummary: string;
      mainStoryline: string;
      subPlots: string[];
      themes: string[];
      chapterOutlines: { chapterNumber: number; title: string; summary: string; keyEvents: string[] }[];
      worldSetting: {
        timePeriod: string;
        location: string;
        socialStructure: string;
        powerSystem: string;
        factions: string[];
        rules: string[];
        atmosphere: string;
      };
      backgroundInfo: string;
      writingStyle: {
        genre: string;
        styleDescription: string;
        narrativeTechniques: string[];
        languageFeatures: string;
        pacingDescription: string;
        tone: string;
        examplePassages: { aspect: string; text: string }[];
        contentRating: { level: string; description: string; hasExplicitContent: boolean };
      };
    }>(
      [{ role: "user", content: prompt }],
      schema,
      { temperature: 0.5, maxTokens: 8192 }
    );

    console.log(`[StoryExtractor] Done in ${Date.now() - t0}ms`);

    return {
      title,
      plotSummary: result.plotSummary || "",
      mainStoryline: result.mainStoryline || "",
      subPlots: result.subPlots || [],
      chapterOutlines: (result.chapterOutlines || []).map((c) => ({
        chapterNumber: c.chapterNumber || 0,
        title: c.title || "",
        summary: c.summary || "",
        keyEvents: c.keyEvents || [],
      })),
      worldSetting: {
        timePeriod: result.worldSetting?.timePeriod || "",
        location: result.worldSetting?.location || "",
        socialStructure: result.worldSetting?.socialStructure || "",
        powerSystem: result.worldSetting?.powerSystem || "",
        factions: result.worldSetting?.factions || [],
        rules: result.worldSetting?.rules || [],
        atmosphere: result.worldSetting?.atmosphere || "",
      },
      backgroundInfo: result.backgroundInfo || "",
      themes: result.themes || [],
      writingStyle: {
        genre: result.writingStyle?.genre || "",
        styleDescription: result.writingStyle?.styleDescription || "",
        narrativeTechniques: result.writingStyle?.narrativeTechniques || [],
        languageFeatures: result.writingStyle?.languageFeatures || "",
        pacingDescription: result.writingStyle?.pacingDescription || "",
        tone: result.writingStyle?.tone || "",
        examplePassages: (result.writingStyle?.examplePassages || []).map((p) => ({
          aspect: p.aspect || "",
          text: p.text || "",
        })),
        contentRating: {
          level: result.writingStyle?.contentRating?.level || "",
          description: result.writingStyle?.contentRating?.description || "",
          hasExplicitContent: result.writingStyle?.contentRating?.hasExplicitContent || false,
        },
      },
    };
  }
}
