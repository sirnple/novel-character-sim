import { createLLMProvider } from "@/core/llm/factory";
import type { ReviewIssue, ReviewResult } from "./types";

const LITERARY_SCHEMA = {
  name: "literary_review",
  description: "Literary quality issues found in the generated prose",
  parameters: {
    type: "object",
    properties: {
      issues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            severity: { type: "string", description: "critical/major/minor" },
            location: { type: "string", description: "问题所在位置" },
            description: { type: "string", description: "什么问题" },
            suggestion: { type: "string", description: "建议修改" },
            snippet: { type: "string", description: "有问题的原文片段" }
          },
          required: ["severity", "location", "description", "suggestion"]
        }
      },
      summary: { type: "string", description: "总体文学品质评审一句话" }
    },
    required: ["issues", "summary"]
  }
};

/**
 * Literary Quality Reviewer — evaluates narrative craft, not logic.
 * - Pacing: does the scene breathe or suffocate?
 * - Sensory detail: can you see/hear/feel the moment?
 * - Dialogue authenticity: do characters talk like people or puppets?
 * - Rhythm: sentence length variety, paragraph flow
 * - Clarity: are there passages where the reader gets lost?
 * - Show vs tell: over-explaining emotions vs letting action reveal
 */
export class LiteraryReviewer {
  async review(input: {
    draft: string;
    writingStyle: string;
  }): Promise<ReviewResult> {
    const llm = createLLMProvider();

    const prompt = `你是文学品质审查员。只评价写作技艺层面，不评价逻辑或角色一致性。

**已生成的小说草稿**:
${input.draft.slice(0, 8000)}

**原作风格参考**:
${input.writingStyle || "无风格数据"}

请从以下维度审查：
1. 节奏：是否有拖沓或过于仓促的段落？动作场景和情感场景的节奏是否合适？
2. 感官细节：画面感、声音、气味、触觉——读者能否沉浸在场景中？
3. 对话质量：是否自然？每个人说话方式是否不同？有没有"信息倾销"式的对话？
4. 句式变化：长短句搭配、段落呼吸
5. 清晰度：有没有读者会困惑的段落？
6. 展示vs讲述：情感是通过行动和细节展示，还是直接告诉读者？
7. 与原著风格的一致性

对每个问题给出: severity(critical/major/minor), location, description, suggestion, snippet。

critical = 严重影响阅读体验或风格断裂
major = 明显可改进
minor = 锦上添花的建议

只报告真实问题，不要无中生有。`;

    const result = await llm.chatWithTool<{
      issues: ReviewIssue[];
      summary: string;
    }>(
      [{ role: "user", content: prompt }],
      LITERARY_SCHEMA,
      { temperature: 0.3, maxTokens: 4096 }
    );

    return {
      pass: (result.issues || []).filter(i => i.severity === "critical").length === 0,
      issues: (result.issues || []).map(i => ({
        ...i,
        category: "literary" as const
      })),
      summary: result.summary || "文学品质可接受"
    };
  }
}
