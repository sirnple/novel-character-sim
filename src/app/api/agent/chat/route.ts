import { NextRequest } from "next/server";
import { createLLMProvider } from "@/core/llm/factory";
import { renderPrompt } from "@/core/prompts/renderer";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const TOOLS = [
  { name: "generate_outline", description: "生成或修改续写大纲。当用户要求规划、设计大纲时调用。" },
  { name: "write_prose", description: "根据大纲撰写小说正文。当用户确认大纲、要求开始写作时调用。" },
  { name: "review_character", description: "审查角色行为/对话是否与原文一致。" },
  { name: "review_continuity", description: "审查有无逻辑矛盾。" },
  { name: "review_foreshadowing", description: "追踪伏笔推进/回收。" },
  { name: "review_style", description: "审查风格是否一致。" },
  { name: "review_world", description: "审查是否违反世界观。" },
  { name: "review_pacing", description: "审查节奏。" },
  { name: "get_novel_context", description: "获取续写点之前的上下文。" },
  { name: "get_characters", description: "获取角色档案。" },
  { name: "get_timeline", description: "获取前文章节摘要。" },
  { name: "get_codex", description: "获取创作法典数据。" },
  { name: "get_world_bible", description: "获取世界观设定。" },
];

const TOOLS_PROMPT = TOOLS.map(t => `- **${t.name}**: ${t.description}`).join("\n");

const SYSTEM_PROMPT = `你是小说创作的主编 Agent。你可以调用工具来完成创作任务。

## 可用工具
${TOOLS_PROMPT}

## 工作方式
1. 续写规划(generate_outline) → 用户确认 → 写作(write_prose) → 审查 → 修改
2. 在调用创作工具前，先用数据工具获取必要上下文
3. 一次只调用一个工具

## 工具调用规则
- 输出 JSON: {"tool": "工具名", "reason": "为什么调用"}

## 重要
- 所有回复用中文
- 直接对用户说话，不要输出思考过程`;

async function executeTool(name: string, context: any, llm: ReturnType<typeof createLLMProvider>, sendChunk: (t: string) => void): Promise<{ result: string; messages: any[] }> {
  switch (name) {
    case "generate_outline": {
      const sys = renderPrompt("outline-system.md", {});
      const prevText = (context.novelText || "").slice(-3000);
      const uc = `请根据以下上下文设计续写大纲。\n\n## 续写点\n${context.continueFromLabel || "未知"}\n\n## 最近前文\n${prevText}`;
      const r = await llm.chat([{ role: "system", content: sys }, { role: "user", content: uc }], { temperature: 0.4, maxTokens: 2048 });
      return { result: r, messages: [{ role: "system", content: sys.slice(0, 600) }, { role: "user", content: uc.slice(0, 1000) }, { role: "assistant", content: r }] };
    }
    case "write_prose": {
      let prose = "";
      const prevText = (context.novelText || "").slice(-5000);
      const uc = `你是小说续写作家。请根据以下大纲撰写正文。\n\n## 前文\n${prevText}\n\n直接输出正文，不要JSON包裹。`;
      await llm.chatStream([{ role: "user", content: uc }], (acc) => { prose = acc; sendChunk(acc); }, { temperature: 0.7, maxTokens: 16384 });
      return { result: prose, messages: [{ role: "user", content: uc.slice(0, 800) }, { role: "assistant", content: prose.slice(0, 500) + "..." }] };
    }
    case "get_novel_context":
      return { result: (context.novelText || "").slice(-6000) || "无前文", messages: [] };
    case "get_characters":
      return { result: JSON.stringify((context.characters || []).map((c: any) => ({ name: c.name, desc: c.personality?.description?.slice(0, 150) })), null, 2), messages: [] };
    case "get_timeline":
      return { result: JSON.stringify((context.chapterSummaries || []).slice(-10), null, 2) || "无数据", messages: [] };
    case "get_codex":
      return { result: JSON.stringify({ world: context.worldBible || {}, foreshadowing: context.activeForeshadowing || [] }, null, 2), messages: [] };
    case "get_world_bible":
      return { result: JSON.stringify(context.worldBible || {}, null, 2), messages: [] };
    default:
      return { result: name.startsWith("review_") ? "审查已完成。" : "未知工具: " + name, messages: [] };
  }
}

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "agent_chat", { windowMs: 60_000, maxRequests: 10 });
  if (!rate.allowed) return new Response(JSON.stringify({ error: rateLimitMessage(rate) }), { status: 429, headers: { "Content-Type": "application/json" } });

  const { messages, context } = await request.json();
  const llm = createLLMProvider();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendChunk = (text: string) => { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "chunk", content: text })}\n\n`)); };
      const sendTool = (tool: string, status: string, result?: string, msgs?: any[]) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "tool_call", tool, status, result, messages: msgs })}\n\n`));
      };

      try {
        const conversation = [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages.map((m: any) => ({ role: m.role === "agent" ? "assistant" : m.role, content: m.content })),
        ];

        let maxSteps = 15;
        while (maxSteps-- > 0) {
          const result = await llm.chatWithTool<any>(
            conversation,
            { name: "master_agent", description: "主编Agent", parameters: { type: "object", properties: { tool: { type: "string", enum: TOOLS.map(t => t.name) }, reason: { type: "string" }, response: { type: "string" } }, required: ["tool"] } },
            { temperature: 0.4, maxTokens: 4096 }
          );

          const tn = result.tool || result.name;
          if (tn && TOOLS.some(t => t.name === tn)) {
            sendTool(tn, "running");
            const tr = await executeTool(tn, context, llm, sendChunk);
            conversation.push({ role: "assistant", content: `[调用 ${tn}]` });
            conversation.push({ role: "user", content: `工具 ${tn} 返回:\n${tr.result.slice(0, 3000)}` });
            sendTool(tn, "done", tr.result.slice(0, 2000), tr.messages);
          } else {
            sendChunk(result.response || result.content || JSON.stringify(result));
            break;
          }
        }
      } catch (e) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message: (e as Error).message })}\n\n`));
      }
      controller.close();
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
}
