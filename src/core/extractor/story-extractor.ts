import type { StoryInfo, ParsedNovel, WritingStyle } from "@/types";
import { createLLMProvider } from "@/core/llm/factory";
import { buildNovelContext } from "@/core/parser/novel-parser";
import { isChinese } from "@/lib/utils";
import { resolveAgentSystem } from "@/core/prompts/resolve-agent-prompt";

const EMPTY_STYLE: WritingStyle = {
  genre: "",
  styleDescription: "",
  narrativeTechniques: [],
  languageFeatures: "",
  pacingDescription: "",
  tone: "",
  examplePassages: [],
  contentRating: { level: "", description: "", hasExplicitContent: false },
};

/** Story schema without writingStyle — style is a separate extract module. */
const STORY_SCHEMA_ZH = {
  name: "story_info",
  description: "小说故事信息提取（不含文风）",
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
        description: "各章节概要（仅节选中可确认的）",
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
    },
    required: ["plotSummary", "mainStoryline", "worldSetting"],
  },
};

const STORY_SCHEMA_EN = {
  name: "story_info",
  description: "Story information extraction (no writing style)",
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
    },
    required: ["plotSummary", "mainStoryline", "worldSetting"],
  },
};

export class StoryExtractor {
  private novelContext: string;
  private useChinese: boolean;
  private novelTitle: string;

  constructor(parsed: ParsedNovel) {
    this.novelContext = buildNovelContext(parsed, 2);
    this.useChinese = isChinese(this.novelContext);
    this.novelTitle = parsed.title || (this.useChinese ? "未命名小说" : "Untitled Novel");
  }

  async extract(): Promise<StoryInfo> {
    const llm = createLLMProvider("analysis");
    const schema = this.useChinese ? STORY_SCHEMA_ZH : STORY_SCHEMA_EN;
    const lang = this.useChinese ? "zh" : "en";

    console.log(
      `[StoryExtractor] Extracting story info (lang=${lang}, contextLen=${this.novelContext.length})...`
    );
    const t0 = Date.now();

    const prompt = resolveAgentSystem("story_info", lang, {
      novelContext: this.novelContext,
    });

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
    }>(
      [{ role: "user", content: prompt }],
      schema,
      { temperature: 0.5, maxTokens: 8192 }
    );

    console.log(`[StoryExtractor] Done in ${Date.now() - t0}ms`);

    return {
      title: this.novelTitle,
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
      // Style is filled only by the dedicated style extract module
      writingStyle: { ...EMPTY_STYLE },
    };
  }
}
