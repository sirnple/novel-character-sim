import { createLLMProvider } from "@/core/llm/factory";
import type { ReviewIssue, ReviewResult } from "./types";

const CONTINUITY_SCHEMA = {
  name: "continuity_review",
  description: "Continuity/logic issues found in the generated prose",
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
      summary: { type: "string", description: "总体评审一句话" }
    },
    required: ["issues", "summary"]
  }
};

/**
 * Continuity Reviewer — only checks logical consistency.
 * - Can an already-dead character speak? (state check)
 * - Object/reference continuity: did the dagger appear from nowhere?
 * - Causal chain: does X follow from Y without gap?
 * - Timeline alignment: do mentions of past events match the timeline?
 */
export class ContinuityReviewer {
  async review(input: {
    draft: string;
    timelineEvents: string;
    characterStates: string;
  }): Promise<ReviewResult> {
    const llm = createLLMProvider();

    const prompt = `你是严格的小说连贯性审查员。只关注逻辑断裂和事实错误，不评价文学品质。

**已生成的小说草稿**:
${input.draft.slice(0, 8000)}

**时间线（前置已发生事件）**:
${input.timelineEvents || "无时间线数据"}

**角色当前状态（最后已知状态）**:
${input.characterStates || "无角色状态数据"}

请仔细检查并找出以下类型的问题：
1. 已死亡或已离开场景的角色又出现并说话/行动
2. 物体或设定凭空出现（前文未提及的武器、物品等）
3. 因果链断裂（事件B发生了但缺乏前因）
4. 时间线矛盾（提到某事件"刚发生"但它其实在时间线更早）
5. 同一角色在同一场景说出矛盾的信息

对每个问题给出: severity(critical/major/minor), location(位置), description(问题描述), suggestion(修改建议), snippet(有问题的原文片段)。

只报告真实存在的问题，不要无中生有。如果确实没有问题，返回空数组。`;

    const result = await llm.chatWithTool<{
      issues: ReviewIssue[];
      summary: string;
    }>(
      [{ role: "user", content: prompt }],
      CONTINUITY_SCHEMA,
      { temperature: 0.1, maxTokens: 4096 }
    );

    return {
      pass: (result.issues || []).filter(i => i.severity === "critical").length === 0,
      issues: (result.issues || []).map(i => ({
        ...i,
        category: "continuity" as const
      })),
      summary: result.summary || "无重大连贯性问题"
    };
  }
}
