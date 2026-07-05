import { NextRequest } from "next/server";
import { createLLMProvider } from "@/core/llm/factory";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import { saveGenerationLog } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const theUserId = userId;
  const rate = checkRateLimit(userId, "review_revise", { windowMs: 120_000, maxRequests: 10 });
  if (!rate.allowed) {
    return new Response(
      JSON.stringify({ error: rateLimitMessage(rate) }),
      { status: 429, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const { draft, reviewIssues, sceneDesc, writingStyle } = await request.json();

    if (!draft || !reviewIssues) {
      return new Response(
        JSON.stringify({ error: "draft and reviewIssues required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const llm = createLLMProvider();
    const encoder = new TextEncoder();
    let isClosed = false;

    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: string) => {
          if (isClosed) return;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "revise_progress", chunk: data })}\n\n`));
        };

        try {
          // Build review context
          const reviewContext = reviewIssues.map((i: any, idx: number) =>
            `问题${idx + 1} [${i.category}/${i.severity}] ${i.location}: ${i.description} — 建议: ${i.suggestion}`
          ).join("\n");

          const prompt = `你是小说修订者。以下是一篇草稿和审查意见。请根据审查意见逐一修改草稿，输出修改后的完整小说正文。

## 场景设定
${sceneDesc || "未提供"}

## 原著风格参考
${JSON.stringify(writingStyle || {})}

## 当前草稿
${draft.slice(0, 12000)}

## 审查意见（必须逐一处理）
${reviewContext.slice(0, 4000)}

## 修改要求
- 严格按审查意见修改：逻辑断裂的要修复，角色不一致的要调整，文学品质问题要润色
- 保留未被指出问题的部分不变
- 直接输出修改后的完整小说正文，不要带任何解释
- 不要用JSON包裹，不要标注"修改1""修改2"`;

          const revised = await llm.chat(
            [{ role: "user", content: prompt }],
            { temperature: 0.5, maxTokens: 16384 }
          );

          send("done");
          saveGenerationLog({
            id: crypto.randomUUID(),
            userId: theUserId,
            category: "review",
            label: "审查修改",
            inputSummary: reviewIssues?.length + "条意见",
            outputPreview: revised.slice(0, 300),
            fullOutput: revised,
          });
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "revised", text: revised })}\n\n`));
        } catch (error) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "Revision failed" })}\n\n`));
        }

        controller.close();
      },
      cancel() { isClosed = true; },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Revise error:", error);
    return new Response(
      JSON.stringify({ error: "Revision failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
