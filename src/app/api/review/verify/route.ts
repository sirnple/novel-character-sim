import { NextRequest, NextResponse } from "next/server";
import { createLLMProvider } from "@/core/llm/factory";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import { saveGenerationLog } from "@/lib/db";
import { runWithTokenContext } from "@/lib/token-usage-context";

// 这是一个独立的 agent，职责是按条验证审查意见是否有效
// 输入：草稿原文 + 审查结果（issues 列表）+ 时间线/角色状态（用于核实）
// 输出：每个 issue 附带验证结论和理由

const VERIFY_SCHEMA = {
  name: "verified_issues",
  description: "逐个验证审查意见是否有效",
  parameters: {
    type: "object",
    properties: {
      verified: {
        type: "array",
        items: {
          type: "object",
          properties: {
            issueIndex: { type: "number" },
            valid: { type: "boolean", description: "问题是否确实存在" },
            reason: { type: "string", description: "验证理由：为什么有效/无效" },
            overrideSuggestion: { type: "string", description: "如果有效但原建议不够好，提供更好的建议（可选）" },
          },
          required: ["issueIndex", "valid", "reason"],
        },
      },
    },
    required: ["verified"],
  },
};

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "review_verify", { windowMs: 120_000, maxRequests: 10 });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }

  try {
    const { draft, issues, timelineEvents, characterStates } = await request.json();
    if (!draft || !issues?.length) {
      return NextResponse.json({ error: "draft and issues required" }, { status: 400 });
    }

    return await runWithTokenContext(
      { userId, agentId: "review_verify", category: "review" },
      async () => {
        const llm = createLLMProvider("write");

        const issuesDesc = issues.map((iss: any, i: number) =>
          `意见${i + 1} [${iss.category}/${iss.severity}] ${iss.location}: ${iss.description} | 建议: ${iss.suggestion}${iss.snippet ? ` | 原文片段: "${iss.snippet}"` : ""}`
        ).join("\n");

        const prompt = `你是独立的事实核查员。你的工作不是审查小说，而是验证别人提出的审查意见是否真的站得住脚。

## 小说草稿（审查对象）
${draft.slice(0, 8000)}

## 时间线上下文
${timelineEvents || "无"}

## 角色当前状态
${characterStates || "无"}

## 审查意见（需要逐一验证）
${issuesDesc.slice(0, 5000)}

## 你的任务
逐一检查每条意见，判断它是否确实有效。注意：
- 如果意见说"角色X已死但出现在对话中"，请核实：角色X在时间线的最末状态是否真的死了？
- 如果意见说"某个物品凭空出现"，请核实：草稿中是否真的有前文铺垫不足的问题？
- 如果意见说"角色行为矛盾"，请核实：在当前场景压力下这样的行为是否合理？
- 如果意见说"说话风格突变"，请核实：是否有足够的上下文支持这种变化？

给出每条意见的验证结论：valid(true/false)、reason(验证理由，1-2句)。
如果意见有效但修改建议不够好，可以提供更好的建议(overrideSuggestion)。

不要用脑全盘肯定或否定，每条都认真核查。`;

        const result = await llm.chatWithTool<{
          verified: { issueIndex: number; valid: boolean; reason: string; overrideSuggestion?: string }[];
        }>(
          [{ role: "user", content: prompt }],
          VERIFY_SCHEMA,
          { temperature: 0.1, maxTokens: 8192 },
        );

        saveGenerationLog({
          id: crypto.randomUUID(),
          userId,
          category: "review",
          label: "审查验证",
          inputSummary: issues?.length + "条意见待验证",
          outputPreview: (result.verified || []).map((v: any) => `#${v.issueIndex}=${v.valid}`).join(", "),
          fullOutput: JSON.stringify(result.verified),
        });
        return NextResponse.json({ verified: result.verified || [] });
      },
    );
  } catch (error) {
    console.error("Verify error:", error);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
