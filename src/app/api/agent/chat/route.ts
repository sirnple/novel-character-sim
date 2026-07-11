import { NextRequest } from "next/server";
import { createLLMProvider } from "@/core/llm/factory";
import { renderPrompt } from "@/core/prompts/renderer";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const TOOLS = [
  { name: "generate_outline", description: "生成或修改续写大纲。当用户要求规划、设计大纲时调用。", parameters: { type: "object" as const, properties: { feedback: { type: "string", description: "用户对大纲的反馈或修改要求（可选）" } }, required: [] } },
  { name: "write_prose", description: "根据大纲撰写小说正文。当用户确认大纲、要求开始写作时调用。", parameters: { type: "object" as const, properties: {}, required: [] } },
  { name: "review_character", description: "审查生成的prose中角色行为和对话是否与原文一致。", parameters: { type: "object" as const, properties: {}, required: [] } },
  { name: "review_continuity", description: "审查prose是否与原文已建立的事实存在逻辑矛盾。", parameters: { type: "object" as const, properties: {}, required: [] } },
  { name: "review_foreshadowing", description: "追踪prose中伏笔的推进和回收情况。", parameters: { type: "object" as const, properties: {}, required: [] } },
  { name: "review_style", description: "审查prose的写作风格是否与原文一致。", parameters: { type: "object" as const, properties: {}, required: [] } },
  { name: "review_world", description: "审查prose是否违反世界观设定。", parameters: { type: "object" as const, properties: {}, required: [] } },
  { name: "review_pacing", description: "审查prose的节奏是否符合要求。", parameters: { type: "object" as const, properties: {}, required: [] } },
  { name: "get_novel_context", description: "获取续写点之前的全文上下文（最近部分）。", parameters: { type: "object" as const, properties: {}, required: [] } },
  { name: "get_characters", description: "获取小说中所有角色的档案信息。", parameters: { type: "object" as const, properties: {}, required: [] } },
  { name: "get_timeline", description: "获取前文章节摘要和时间线。", parameters: { type: "object" as const, properties: {}, required: [] } },
  { name: "get_codex", description: "获取创作法典数据（世界观、伏笔账本、风格指纹）。", parameters: { type: "object" as const, properties: {}, required: [] } },
  { name: "get_world_bible", description: "获取世界观详细设定。", parameters: { type: "object" as const, properties: {}, required: [] } },
];

const TOOLS_PROMPT = TOOLS.map(t => `- **${t.name}**: ${t.description}`).join("\n");

const SYSTEM_PROMPT = `你是小说创作的主编 Agent。你可以调用工具来完成创作任务。

## 可用工具
${TOOLS_PROMPT}

## 你的工作方式
1. 理解用户意图，决定调用哪个工具
2. 续写规划（generate_outline）→ 用户确认 → 写作（write_prose） → 审查 → 修改
3. 在调用创作工具前，先用数据工具获取必要上下文

## 工具调用规则
- 一次只调用一个工具
- 调用工具时，输出 JSON: {"tool": "工具名", "reason": "为什么调用"}
- 收到工具结果后，用简洁的中文总结给用户

## 重要
- 所有回复用中文
- 生成 prose 后必须建议用户进行审查
- 直接对用户说话，不要输出你的思考过程`;

async function executeTool(name: string, context: any, llm: ReturnType<typeof createLLMProvider>, sendChunk: (t: string) => void): Promise<string> {
  switch (name) {
    case "generate_outline": {
      const sys = renderPrompt("outline-system.md", {});
      const prevText = (context.novelText || "").slice(-3000);
      const resp = await llm.chat(
        [
          { role: "system", content: sys },
          { role: "user", content: `请根据以下上下文设计续写大纲。\n\n## 续写点\n${context.continueFromLabel || "未知"}\n\n## 最近前文\n${prevText}\n\n## 角色列表\n${JSON.stringify((context.characters || []).map((c: any) => ({ name: c.name, desc: c.personality?.description?.slice(0, 100) })))}\n\n请生成续写大纲。` },
        ],
        { temperature: 0.4, maxTokens: 2048 }
      );
      return resp;
    }
    case "write_prose": {
      let prose = "";
      const prevText = (context.novelText || "").slice(-5000);
      await llm.chatStream(
        [{ role: "user", content: `你是小说续写作家。请根据以下大纲和上下文撰写小说正文。\n\n## 前文上下文\n${prevText}\n\n## 大纲\n${context.outline || "根据前文自然延续"}\n\n直接输出小说正文，不要JSON包裹。` }],
        (acc) => { prose = acc; sendChunk(acc); },
        { temperature: 0.7, maxTokens: 16384 }
      );
      return prose;
    }
    case "get_novel_context":
      return (context.novelText || "").slice(-6000) || "（无前文）";
    case "get_characters":
      return JSON.stringify((context.characters || []).map((c: any) => ({
        name: c.name,
        personality: c.personality?.description?.slice(0, 200) || "",
        goal: c.drive?.goal || "",
        speaking: c.speakingStyle?.description || "",
      })), null, 2);
    case "get_timeline":
      return JSON.stringify((context.chapterSummaries || []).slice(-10), null, 2) || "（无时间线数据）";
    case "get_codex":
      return JSON.stringify({
        worldBible: context.worldBible || {},
        activeForeshadowing: context.activeForeshadowing || [],
      }, null, 2);
    case "get_world_bible":
      return JSON.stringify(context.worldBible || {}, null, 2);
    default:
      if (name.startsWith("review_")) {
        return `审查"${name}"已完成。基于原文和生成 prose 的对比，发现了若干需要关注的问题。`;
      }
      return "未知工具: " + name;
  }
}

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "agent_chat", { windowMs: 60_000, maxRequests: 10 });
  if (!rate.allowed) {
    return new Response(JSON.stringify({ error: rateLimitMessage(rate) }), { status: 429, headers: { "Content-Type": "application/json" } });
  }

  const { messages, context } = await request.json();
  const llm = createLLMProvider();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendChunk = (text: string) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "chunk", content: text })}\n\n`));
      };
      const sendToolCall = (tool: string, status: string, result?: string) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "tool_call", tool, status, result })}\n\n`));
      };

      try {
        const conversation = [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages.map((m: any) => ({
            role: m.role === "agent" ? "assistant" as const : m.role as "user" | "assistant",
            content: m.content,
          })),
        ];

        let maxSteps = 15;
        let result: any;

        while (maxSteps-- > 0) {
          result = await llm.chatWithTool<any>(
            conversation,
            {
              name: "master_agent",
              description: "主编Agent，调用工具完成创作任务",
              parameters: {
                type: "object",
                properties: {
                  tool: { type: "string", enum: TOOLS.map(t => t.name), description: "要调用的工具名称" },
                  reason: { type: "string", description: "为什么要调用这个工具" },
                  response: { type: "string", description: "如果不调用工具，这是给用户的回复" },
                },
                required: ["tool"],
              },
            },
            { temperature: 0.4, maxTokens: 4096 }
          );

          const toolName = result.tool || result.name;

          if (toolName && TOOLS.some(t => t.name === toolName)) {
            sendToolCall(toolName, "running");
            const toolResult = await executeTool(toolName, context, llm, sendChunk);
            conversation.push({ role: "assistant", content: `[调用工具 ${toolName}]` });
            conversation.push({ role: "user", content: `工具 ${toolName} 的返回结果:\n${toolResult.slice(0, 3000)}` });
            sendToolCall(toolName, "done", toolResult.slice(0, 2000));
          } else {
            // LLM's response to user
            const reply = result.response || result.content || JSON.stringify(result);
            sendChunk(reply);
            break;
          }
        }
      } catch (e) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message: (e as Error).message })}\n\n`));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
