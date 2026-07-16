import { NextRequest } from "next/server";
import { createLLMProvider } from "@/core/llm/factory";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import { logSession } from "@/lib/session-log";
import { getTool, buildToolSchemas } from "@/core/agents/registry";
import { getAgent } from "@/core/agents/agent-registry";
import { initRegistry } from "@/core/agents/init";
import { runReviewsParallel } from "@/core/agents/agents/run-reviews";
import { resolveAgentSystem } from "@/core/prompts/resolve-agent-prompt";
import { runWithTokenContext } from "@/lib/token-usage-context";
import type { LLMMessage, SystemMessage, UserMessage, AssistantMessage, ToolMessage, ToolSchema } from "@/types";

export const dynamic = "force-dynamic";

let initialized = false;
function ensureInit() {
  if (!initialized) { initRegistry(); initialized = true; }
}


export async function POST(request: NextRequest) {
  ensureInit();

  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "agent_chat", { windowMs: 60_000, maxRequests: 10 });
  if (!rate.allowed) return new Response(JSON.stringify({ error: rateLimitMessage(rate) }), { status: 429, headers: { "Content-Type": "application/json" } });

  const {
    messages, branchId, novelId,
    selectedStyleId = null,
    selectedIdeaIds = [],
    autoPickIdeas = true,
  } = await request.json();
  if (!branchId || !novelId) return new Response(JSON.stringify({ error: "branchId and novelId required" }), { status: 400, headers: { "Content-Type": "application/json" } });

  const llm = createLLMProvider();
  const encoder = new TextEncoder();
  // 主 agent 只调度与展示摘要；正文由子 agent 自取，不向主 agent 暴露 get_prose / save_*
  const MASTER_TOOL_ALLOW = new Set([
    "agent",
    "ask_question",
    "run_reviews",
    "get_branch_text", "get_branch_characters", "get_branch_timeline", "get_branch_world", "get_branch_meta",
    "get_outline", "get_findings", "clear_findings",
  ]);
  const toolSchemas: ToolSchema[] = buildToolSchemas().filter(t => MASTER_TOOL_ALLOW.has(t.name));
  const sysPrompt = resolveAgentSystem("master", "zh", { novelId, branchId });

  const stream = new ReadableStream({
    async start(controller) {
      await runWithTokenContext(
        { userId, novelId, branchId, agentId: "master", category: "agent" },
        async () => {
      const signal = request.signal;
      const checkAbort = () => { if (signal.aborted) throw new Error("ABORTED"); };
      const send = (data: Record<string, unknown>) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch { /* stream closed */ }
      };
      const sendChunk = (text: string) => send({ type: "chunk", content: text });
      const sendTool = (tool: string, status: string, toolCallId: string, result?: string, msgs?: any[]) => {
        send({ type: "tool_call", tool, status, toolCallId, result, messages: msgs });
      };

      const runAgent = async (agentType: string, prompt: string, toolCallId: string) => {
        sendTool(agentType, "running", toolCallId);
        const agentDef = getAgent(agentType);
        if (!agentDef) throw new Error(`Unknown agent: ${agentType}`);
        const t0 = Date.now();
        const onChunk = (text: string) => {
          send({ type: "tool_chunk", toolCallId, content: text, tool: agentType });
        };
        const onTrail = (messages: unknown[]) => {
          send({ type: "tool_trail", toolCallId, messages, tool: agentType });
        };
        const result = await agentDef.execute(
          {
            prompt,
            novelId,
            branchId,
            userId,
            selectedStyleId,
            selectedIdeaIds: Array.isArray(selectedIdeaIds) ? selectedIdeaIds.slice(0, 3) : [],
            autoPickIdeas: !!autoPickIdeas,
          },
          llm,
          onChunk,
          onTrail,
        );
        logSession({ ts: new Date().toISOString(), type: "tool_exec", tool: agentType, elapsed: Date.now() - t0, resultPreview: result.content.slice(0, 300) });
        sendTool(agentType, "done", toolCallId, result.content.slice(0, 5000), result.messages);

        // After outline: open a separate visible card for outline review (not buried in generate_outline)
        if (agentType === "generate_outline") {
          const reviewId = `${toolCallId}__outline_review`;
          const reviewDef = getAgent("review_outline");
          if (reviewDef) {
            sendTool("review_outline", "running", reviewId);
            const t1 = Date.now();
            try {
              const rev = await reviewDef.execute(
                {
                  prompt: "审核刚生成的大纲与前文/类型是否冲突（出场合法性、梦与现实、承接等）",
                  novelId,
                  branchId,
                  userId,
                },
                llm,
                (text) => send({ type: "tool_chunk", toolCallId: reviewId, content: text, tool: "review_outline" }),
                (messages) => send({ type: "tool_trail", toolCallId: reviewId, messages, tool: "review_outline" }),
              );
              logSession({
                ts: new Date().toISOString(),
                type: "tool_exec",
                tool: "review_outline",
                elapsed: Date.now() - t1,
                resultPreview: rev.content.slice(0, 300),
              });
              sendTool("review_outline", "done", reviewId, rev.content.slice(0, 5000), rev.messages);
              // Append review into master's conversation so it must surface findings
              return {
                content:
                  result.content +
                  "\n\n---\n【大纲审核 agent 已完成】\n" +
                  rev.content.slice(0, 4000) +
                  "\n主 agent：必须把审核结论告诉用户后再 ask_question；未通过时默认建议改大纲。",
                messages: [...(result.messages || []), ...(rev.messages || [])],
              };
            } catch (e) {
              const err = "大纲审核失败: " + (e as Error).message;
              sendTool("review_outline", "done", reviewId, err);
              return {
                content: result.content + "\n\n" + err + "（可再调 review_outline）",
                messages: result.messages,
              };
            }
          }
        }

        return result;
      };

      const runDataTool = async (name: string, toolCallId: string) => {
        if (!MASTER_TOOL_ALLOW.has(name)) {
          const denied = `主 agent 不可调用 ${name}。正文由审查/写手子 agent 自行 get_prose，你只需调度。`;
          sendTool(name, "done", toolCallId, denied);
          return { content: denied, messages: [] as any[] };
        }
        sendTool(name, "running", toolCallId);
        const toolDef = getTool(name);
        if (!toolDef) throw new Error(`Unknown tool: ${name}`);
        const result = await toolDef.execute({ novelId, branchId }, { novelId, branchId, userId }, llm);
        // 前端卡片预览可短；喂给主 agent 的完整结果在下方 conversation 里按工具类型限长
        sendTool(name, "done", toolCallId, result.content.slice(0, 2000), result.messages);
        return result;
      };

      try {
        const conversation: LLMMessage[] = [
          { role: "system", content: sysPrompt } as SystemMessage,
          ...messages.map((m: any) => {
            if (m.role === "tool" && m.tool_call_id) {
              return { role: "tool", content: m.content, tool_call_id: m.tool_call_id } as ToolMessage;
            }
            if (m.tool_calls) {
              return { role: "assistant", content: m.content, tool_calls: m.tool_calls } as AssistantMessage;
            }
            return { role: m.role === "agent" ? "assistant" : m.role, content: m.content } as UserMessage | AssistantMessage;
          }),
        ];

        let maxSteps = 3000;
        while (maxSteps-- > 0) {
          checkAbort();
          const eventStream = llm.chatWithTools(conversation, toolSchemas, { temperature: 0.4, maxTokens: 4096 });

          let hasToolUse = false;
          let stopForUser = false;
          let fullText = "";
          let preToolText = "";
          let thinkingTimer: ReturnType<typeof setTimeout> | null = null;
          let hasTextOutput = false;

          thinkingTimer = setTimeout(() => {
            if (!hasTextOutput) send({ type: "thinking", status: "deciding" });
          }, 2000);

          for await (const event of eventStream) {
            if (event.type === "text_delta") {
              if (!hasTextOutput) {
                hasTextOutput = true;
                if (thinkingTimer) { clearTimeout(thinkingTimer); thinkingTimer = null; }
              }
              fullText += event.text;
              if (!hasToolUse) preToolText = fullText;
              sendChunk(fullText);
            } else if (event.type === "tool_use") {
              if (thinkingTimer) { clearTimeout(thinkingTimer); thinkingTimer = null; }
              hasToolUse = true;
              const toolName = event.name;
              const toolId = event.id;
              const args = event.args as Record<string, any>;

              // Push any preceding text so the LLM sees its own reasoning on next turn
              if (preToolText) {
                conversation.push({ role: "assistant", content: preToolText } as AssistantMessage);
                preToolText = "";
              }

              // Build assistant message with tool_use content block
              conversation.push({
                role: "assistant",
                content: [{ type: "tool_use", id: toolId, name: toolName, input: args }],
              } as AssistantMessage);

              if (toolName === "ask_question") {
                const question = String(args.question || "").trim() || "请选择下一步";
                let options: string[] = [];
                if (Array.isArray(args.options)) {
                  options = args.options.map((o: unknown) => String(o).trim()).filter(Boolean).slice(0, 8);
                } else if (typeof args.options === "string" && args.options.trim()) {
                  options = args.options.split("|").map((s: string) => s.trim()).filter(Boolean).slice(0, 8);
                }
                // Pause this turn: frontend shows interactive question; user answer continues next request
                send({
                  type: "ask_question",
                  toolCallId: toolId,
                  tool: "ask_question",
                  question,
                  options,
                });
                sendTool(
                  "ask_question",
                  "awaiting_user",
                  toolId,
                  JSON.stringify({ question, options }),
                );
                stopForUser = true;
                break;
              }

              // Parallel six-dimension review: one master tool → 6 concurrent agents
              if (toolName === "run_reviews") {
                const reviewPrompt =
                  String(args.prompt || "").trim() || "正文已写完，请自行 get_prose 后按你的维度审查。";
                sendTool("run_reviews", "running", toolId);
                const t0 = Date.now();
                try {
                  const batch = await runReviewsParallel(
                    { prompt: reviewPrompt, novelId, branchId, userId },
                    llm,
                    (ev) => {
                      const subId = `${toolId}__${ev.agentType}`;
                      if (ev.phase === "start") {
                        sendTool(ev.agentType, "running", subId);
                      } else if (ev.phase === "done") {
                        sendTool(ev.agentType, "done", subId, ev.content, ev.messages);
                      } else if (ev.phase === "error") {
                        sendTool(ev.agentType, "done", subId, `失败: ${ev.error}`);
                      }
                    },
                  );
                  logSession({
                    ts: new Date().toISOString(),
                    type: "tool_exec",
                    tool: "run_reviews",
                    elapsed: Date.now() - t0,
                    resultPreview: batch.content.slice(0, 300),
                  });
                  sendTool("run_reviews", "done", toolId, batch.content.slice(0, 5000));
                  conversation.push({
                    role: "user",
                    content: [{ type: "tool_result", tool_use_id: toolId, content: batch.content.slice(0, 8000) }],
                  });
                } catch (e) {
                  const err = "并行审查失败: " + (e as Error).message;
                  sendTool("run_reviews", "done", toolId, err);
                  conversation.push({
                    role: "user",
                    content: [{ type: "tool_result", tool_use_id: toolId, content: err, is_error: true }],
                  });
                }
                continue;
              }

              if (toolName === "agent") {
                const agentType = args.agent_type as string;
                const prompt = args.prompt as string;
                if (!agentType || !prompt) {
                  conversation.push({
                    role: "user",
                    content: [{ type: "tool_result", tool_use_id: toolId, content: "错误: agent_type 和 prompt 都是必需的", is_error: true }],
                  });
                  continue;
                }

                // Single review_* still allowed, but prefer run_reviews for full suite
                const result = await runAgent(agentType, prompt, toolId);
                conversation.push({
                  role: "user",
                  content: [{ type: "tool_result", tool_use_id: toolId, content: result.content.slice(0, 5000) }],
                });
              } else {
                const result = await runDataTool(toolName, toolId);
                // 主 agent 不读 prose；大纲/前文可适当放宽
                const masterLimit =
                  toolName === "get_branch_text" ? 30000
                  : toolName === "get_outline" ? 30000
                  : toolName === "get_findings" ? 20000
                  : 10000;
                conversation.push({
                  role: "user",
                  content: [{ type: "tool_result", tool_use_id: toolId, content: result.content.slice(0, masterLimit) }],
                });
              }
            }
          }

          if (thinkingTimer) clearTimeout(thinkingTimer);
          if (stopForUser || !hasToolUse) break;
        }

        if (maxSteps <= 0) {
          logSession({ ts: new Date().toISOString(), type: "master_agent", status: "max_steps" });
        }
      } catch (e) {
        if ((e as Error).message === "ABORTED") {
          send({ type: "stopped" });
        } else {
          logSession({ ts: new Date().toISOString(), type: "error", error: (e as Error).message });
          send({ type: "error", message: (e as Error).message });
        }
      }
      controller.close();
        },
      );
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
