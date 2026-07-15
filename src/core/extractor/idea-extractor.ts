/**
 * Extract plot/character "idea sparks" from novel context for the idea bank.
 */
import { createLLMProvider } from "@/core/llm/factory";
import { buildNovelContext } from "@/core/parser/novel-parser";
import { isChinese, extractJSON, generateId } from "@/lib/utils";
import type { ParsedNovel, IdeaLibraryEntry } from "@/types";

export async function extractIdeas(
  parsed: ParsedNovel,
  novelId: string,
): Promise<IdeaLibraryEntry[]> {
  const llm = createLLMProvider();
  const zh = isChinese(parsed.text);
  const context = buildNovelContext(parsed, { maxChunks: 4 });

  const schema = {
    name: "idea_bank",
    description: zh ? "从小说中提取可续写的点子" : "Extract continuation ideas from the novel",
    parameters: {
      type: "object",
      properties: {
        ideas: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: zh ? "短标题" : "Short title" },
              content: { type: "string", description: zh ? "点子说明（2-4句）" : "Idea description" },
              tags: {
                type: "array",
                items: { type: "string" },
                description: zh ? "标签如：情感/冲突/伏笔/转折" : "tags",
              },
            },
            required: ["title", "content"],
          },
          description: zh ? "8-15 个可独立选用的续写点子" : "8-15 selectable ideas",
        },
      },
      required: ["ideas"],
    },
  };

  const system = zh
    ? `你是小说创意编辑。从给定小说片段中提炼「续写点子」：可独立选用的情节火花、人物关系推进、场景灵感、伏笔回收方向等。
要求：
- 每个点子具体、可执行，不要空泛口号
- 覆盖情感、冲突、世界观、角色弧光等类型
- 输出 8-12 条
- 严格 JSON`
    : `You extract concrete continuation ideas from novel excerpts. 8-12 specific, actionable ideas. JSON only.`;

  const user = zh
    ? `小说标题：${parsed.title}\n\n## 文本节选\n${context.slice(0, 12000)}\n\n请提取续写点子。`
    : `Title: ${parsed.title}\n\n## Excerpts\n${context.slice(0, 12000)}\n\nExtract ideas.`;

  try {
    const result = await llm.chatWithTool<{ ideas: { title: string; content: string; tags?: string[] }[] }>(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      schema as any,
      { temperature: 0.5, maxTokens: 3000 },
    );

    const ideas = Array.isArray(result?.ideas) ? result.ideas : [];
    return ideas
      .filter(i => i?.title && i?.content)
      .slice(0, 15)
      .map((i) => ({
        id: `idea_${generateId()}`,
        novelId,
        title: String(i.title).slice(0, 80),
        content: String(i.content).slice(0, 800),
        tags: Array.isArray(i.tags) ? i.tags.map(String).slice(0, 6) : [],
        source: "extracted" as const,
      }));
  } catch (e) {
    console.warn("[IdeaExtractor] failed:", (e as Error).message);
    // Fallback: try freeform JSON
    try {
      const raw = await llm.chat(
        [
          { role: "system", content: system },
          { role: "user", content: user + (zh ? "\n输出 {\"ideas\":[...]}" : "\nOutput {\"ideas\":[...]}") },
        ],
        { temperature: 0.5, maxTokens: 3000 },
      );
      const parsedJson = extractJSON<{ ideas: any[] }>(raw);
      return (parsedJson.ideas || []).filter((i: any) => i?.title).slice(0, 12).map((i: any) => ({
        id: `idea_${generateId()}`,
        novelId,
        title: String(i.title).slice(0, 80),
        content: String(i.content || "").slice(0, 800),
        tags: Array.isArray(i.tags) ? i.tags.map(String) : [],
        source: "extracted" as const,
      }));
    } catch {
      return [];
    }
  }
}
