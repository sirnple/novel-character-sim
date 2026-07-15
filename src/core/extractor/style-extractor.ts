/**
 * Dedicated writing-style extraction (not bundled with full story extract).
 * Produces a WritingStyle suitable for the global style library.
 * Prompts: style_extract agent (Admin + style-extract-*.md).
 */
import { createLLMProvider } from "@/core/llm/factory";
import { buildNovelContext } from "@/core/parser/novel-parser";
import { isChinese, extractJSON } from "@/lib/utils";
import { resolveAgentPrompt } from "@/core/prompts/resolve-agent-prompt";
import type { ParsedNovel, WritingStyle } from "@/types";

const EMPTY: WritingStyle = {
  genre: "",
  styleDescription: "",
  narrativeTechniques: [],
  languageFeatures: "",
  pacingDescription: "",
  tone: "",
  examplePassages: [],
  contentRating: { level: "", description: "", hasExplicitContent: false },
};

const SCHEMA = {
  name: "writing_style",
  description: "小说文风指纹提取",
  parameters: {
    type: "object",
    properties: {
      genre: { type: "string", description: "类型标签，如都市言情/玄幻/历史" },
      styleDescription: {
        type: "string",
        description: "给模仿者看的文风说明书（150-300字）：句式、用词、叙事距离、修辞习惯",
      },
      narrativeTechniques: {
        type: "array",
        items: { type: "string" },
        description: "叙事手法条目",
      },
      languageFeatures: { type: "string", description: "语言特点" },
      pacingDescription: { type: "string", description: "节奏与对话/叙述比例倾向" },
      tone: { type: "string", description: "基调" },
      examplePassages: {
        type: "array",
        items: {
          type: "object",
          properties: {
            aspect: { type: "string" },
            text: { type: "string", description: "从原文摘取 150-400 字" },
          },
          required: ["aspect", "text"],
        },
        description: "3-5 个代表性原文片段",
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
    required: ["genre", "styleDescription", "tone"],
  },
};

export async function extractWritingStyle(parsed: ParsedNovel): Promise<WritingStyle> {
  const llm = createLLMProvider();
  const zh = isChinese(parsed.fullText);
  const lang = zh ? "zh" : "en";
  const novelContext = buildNovelContext(parsed, 5).slice(0, 14000);

  const { system, user } = resolveAgentPrompt("style_extract", lang, {
    title: parsed.title || "",
    novelContext,
  });

  try {
    const result = await llm.chatWithTool<WritingStyle>(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      SCHEMA as any,
      { temperature: 0.35, maxTokens: 4096 },
    );
    return normalizeStyle(result);
  } catch (e) {
    console.warn("[StyleExtractor] chatWithTool failed:", (e as Error).message);
    try {
      const raw = await llm.chat(
        [
          { role: "system", content: system },
          { role: "user", content: user + (zh ? "\n输出 JSON 对象。" : "\nOutput JSON.") },
        ],
        { temperature: 0.35, maxTokens: 4096 },
      );
      return normalizeStyle(extractJSON<WritingStyle>(raw));
    } catch {
      return { ...EMPTY };
    }
  }
}

function normalizeStyle(r: Partial<WritingStyle> | null | undefined): WritingStyle {
  return {
    genre: r?.genre || "",
    styleDescription: r?.styleDescription || "",
    narrativeTechniques: r?.narrativeTechniques || [],
    languageFeatures: r?.languageFeatures || "",
    pacingDescription: r?.pacingDescription || "",
    tone: r?.tone || "",
    examplePassages: (r?.examplePassages || []).map(p => ({
      aspect: p.aspect || "",
      text: p.text || "",
    })),
    contentRating: {
      level: r?.contentRating?.level || "",
      description: r?.contentRating?.description || "",
      hasExplicitContent: !!r?.contentRating?.hasExplicitContent,
    },
  };
}
