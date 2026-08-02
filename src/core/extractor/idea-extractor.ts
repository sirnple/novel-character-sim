/**
 * Extract tagged continuation ideas for the global idea bank.
 * Ideas must be novel-agnostic (portable craft templates, not book-specific plot).
 * Prompts: idea_extract agent (Admin + idea-extract-*.md).
 */
import { createLLMProvider } from "@/core/llm/factory";
import { buildNovelContext } from "@/core/parser/novel-parser";
import { isChinese, extractJSON, generateId } from "@/lib/utils";
import { renderOneshot } from "@/core/prompts/oneshot";
import { normalizeIdeaEntries } from "@/lib/db";
import type { ParsedNovel, IdeaLibraryEntry } from "@/types";

const TAG_HINT = "设定|剧情|角色|冲突|伏笔|氛围|对白";

export async function extractIdeas(
  parsed: ParsedNovel,
  novelId: string,
  novelTitle: string,
): Promise<IdeaLibraryEntry[]> {
  const llm = createLLMProvider("analysis");
  const zh = isChinese(parsed.fullText);
  const lang = zh ? "zh" : "en";
  const novelContext = buildNovelContext(parsed, 4).slice(0, 12000);

  const schema = {
    name: "idea_bank",
    description: zh
      ? "与本书解耦的可迁移续写点子（禁用具体人名/地名等专有名词）"
      : "Novel-agnostic portable continuation ideas (no proper nouns)",
    parameters: {
      type: "object",
      properties: {
        ideas: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: zh
                  ? "短标题，不含角色名/书名/专有名词"
                  : "Short title without character/book proper nouns",
              },
              content: {
                type: "string",
                description: zh
                  ? "2-4 句可执行说明：用主角/对立方等功能位，禁止本书人名地名"
                  : "2-4 actionable sentences using role labels only; no book-specific names",
              },
              tags: {
                type: "array",
                items: { type: "string" },
                description: `标签，优先：${TAG_HINT}`,
              },
            },
            required: ["title", "content", "tags"],
          },
        },
      },
      required: ["ideas"],
    },
  };

  const system = renderOneshot("idea-extract-system", {});
  const user = renderOneshot("idea-extract-user", {
    title: parsed.title || "",
    novelContext,
  });

  try {
    const result = await llm.chatWithTool<{ ideas: { title: string; content: string; tags?: string[] }[] }>(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      schema as any,
      { temperature: 0.45, maxTokens: 3000 },
    );
    return mapIdeas(result?.ideas, novelId, novelTitle);
  } catch (e) {
    console.warn("[IdeaExtractor] failed:", (e as Error).message);
    try {
      const raw = await llm.chat(
        [
          { role: "system", content: system },
          { role: "user", content: user + (zh ? '\n输出 {"ideas":[...]}' : '\nOutput {"ideas":[...]}') },
        ],
        { temperature: 0.45, maxTokens: 3000 },
      );
      const parsedJson = extractJSON<{ ideas: any[] }>(raw);
      return mapIdeas(parsedJson.ideas, novelId, novelTitle);
    } catch {
      return [];
    }
  }
}

function mapIdeas(
  ideas: { title?: string; content?: string; tags?: string[] }[] | undefined,
  novelId: string,
  novelTitle: string,
): IdeaLibraryEntry[] {
  const { entries } = normalizeIdeaEntries(ideas || [], {
    novelId,
    novelTitle,
  });
  return entries.slice(0, 15).map((e) => ({
    ...e,
    id: e.id?.startsWith("idea_") ? e.id : `idea_${generateId()}`,
    content: e.content.slice(0, 800),
    tags: e.tags.slice(0, 6),
    source: "extracted" as const,
    sourceNovelId: novelId,
    sourceNovelTitle: novelTitle || "",
  }));
}
