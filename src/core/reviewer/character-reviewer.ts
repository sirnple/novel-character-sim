import { createLLMProvider } from "@/core/llm/factory";
import type { ReviewIssue, ReviewResult } from "./types";

const CHARACTER_SCHEMA = {
  name: "character_review",
  description: "Character consistency issues found in the generated prose",
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
      summary: { type: "string", description: "总体角色一致性评审一句话" }
    },
    required: ["issues", "summary"]
  }
};

/**
 * Character Consistency Reviewer — checks character behavior matches their profile.
 * - Speaking style drift (a rough mercenary suddenly speaks like a poet)
 * - Motivation/goal alignment (actions contradict stated goals)
 * - Personality break (the cautious person acts reckless without setup)
 * - Relationship fidelity (interactions respect established dynamics)
 */
export class CharacterReviewer {
  async review(input: {
    draft: string;
    characterStates: string;
  }): Promise<ReviewResult> {
    const llm = createLLMProvider();

    const prompt = `你是角色一致性审查员。只检查角色的行为、语言、动机是否与他们的角色设定一致。

**已生成的小说草稿**:
${input.draft.slice(0, 8000)}

**角色当前状态**:
${input.characterStates || "无角色状态数据"}

请检查以下方面：
1. 说话风格突变（一个粗俗佣兵突然文绉绉说话）
2. 行为与核心动机矛盾（嘴上说要救某人，行动却在害人，且没有合理解释）
3. 性格特征断裂（谨慎的人在没有铺垫的情况下突然冒险）
4. 关系动态不一致（仇人之间突然亲密无间）

注意：
- 角色可以变化成长，但需要有迹可循——如果变化是合理的、有铺垫的，不算问题
- 角色可能在压力下做反常的事——要有足够的场景上下文支持
- 只报告明显的、无铺垫的断裂

对每个问题给出: severity, location, description, suggestion, snippet。没有问题返回空数组。`;

    const result = await llm.chatWithTool<{
      issues: ReviewIssue[];
      summary: string;
    }>(
      [{ role: "user", content: prompt }],
      CHARACTER_SCHEMA,
      { temperature: 0.2, maxTokens: 4096 }
    );

    return {
      pass: (result.issues || []).filter(i => i.severity === "critical").length === 0,
      issues: (result.issues || []).map(i => ({
        ...i,
        category: "character" as const
      })),
      summary: result.summary || "无重大角色一致性问题"
    };
  }
}
