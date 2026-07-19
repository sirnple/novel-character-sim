import { NextRequest } from "next/server";
import { createLLMProvider } from "@/core/llm/factory";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import { logSession } from "@/lib/session-log";
import { getTool, buildToolSchemas } from "@/core/agents/registry";
import { getAgent } from "@/core/agents/agent-registry";
import { initRegistry } from "@/core/agents/init";
import { runReviewsParallel } from "@/core/agents/agents/run-reviews";
import { resolveAgentSystem } from "@/core/prompts/resolve-agent-prompt";
import {
  ONE_CLICK_CONTINUE_SYSTEM_APPEND,
  pickAutoPassAnswer,
} from "@/core/agents/auto-pass";
import { runWithTokenContext } from "@/lib/token-usage-context";
import {
  ANALYSIS_MASTER_TOOL_NAMES,
  buildMasterAgentToolSchema,
  resolveAnalysisAgentType,
} from "@/core/agents/analysis-allowlist";
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
    /** 一键续写：审核卡点（ask_question）自动选推进选项并继续 */
    autoPassCheckpoints = false,
    /** write = 续写主编；analysis = 全书分析主编 */
    mode = "write",
    forceRefresh = false,
  } = await request.json();
  if (!branchId || !novelId) return new Response(JSON.stringify({ error: "branchId and novelId required" }), { status: 400, headers: { "Content-Type": "application/json" } });

  const isAnalysis = mode === "analysis";
  const autoPass = !!autoPassCheckpoints && !isAnalysis;
  const llm = createLLMProvider(isAnalysis ? "analysis" : "write");
  const encoder = new TextEncoder();
  // 主 agent 只调度与展示摘要；域工作走 agent()→runAgent（子卡 + trail），不是 runDataTool
  const WRITE_TOOL_ALLOW = new Set([
    "agent",
    "ask_question",
    "run_reviews",
    "accept_continuation",
    "get_branch_text", "get_branch_characters", "get_branch_timeline", "get_branch_world", "get_branch_meta",
    "get_novel_form",
    "get_outline", "get_findings", "clear_findings",
  ]);
  const ANALYSIS_TOOL_ALLOW = new Set<string>([...ANALYSIS_MASTER_TOOL_NAMES]);
  const MASTER_TOOL_ALLOW = isAnalysis ? ANALYSIS_TOOL_ALLOW : WRITE_TOOL_ALLOW;
  // Mode-scoped agent() schema (write vs analysis enums) — do not use registry's mixed enum
  const agentSchema = buildMasterAgentToolSchema(isAnalysis ? "analysis" : "write");
  const toolSchemas: ToolSchema[] = [
    {
      name: agentSchema.name,
      description: agentSchema.description,
      parameters: agentSchema.parameters,
    },
    ...buildToolSchemas().filter(
      (t) => MASTER_TOOL_ALLOW.has(t.name) && t.name !== "agent",
    ),
  ];
  const baseSys = isAnalysis
    ? resolveAgentSystem("novel_analysis", "zh", {
        novelId,
        branchId,
        modules: "",
        forceRefresh: forceRefresh ? "true" : "false",
        prompt: "",
      })
    : resolveAgentSystem("master", "zh", { novelId, branchId });
  const sysPrompt = autoPass
    ? `${baseSys}\n\n${ONE_CLICK_CONTINUE_SYSTEM_APPEND}`
    : baseSys;

  // Analysis: mount workspace from DB prose so form/story tools have fullText
  if (isAnalysis) {
    try {
      const { getBranchProse, getNovel } = await import("@/lib/db");
      const { beginNovelAnalysisWorkspace, getNovelAnalysisWorkspace } = await import(
        "@/core/extractor/novel-analysis-workspace"
      );
      if (!getNovelAnalysisWorkspace(userId, novelId, branchId)) {
        const { text } = getBranchProse(userId, novelId, branchId);
        const fullText = (text || getNovel(userId, novelId)?.text || "").trim();
        if (fullText) {
          beginNovelAnalysisWorkspace(userId, novelId, branchId, {
            fullText,
            forceRefresh: !!forceRefresh,
          });
        }
      }
    } catch (e) {
      console.warn("[agent/chat] analysis workspace init:", (e as Error).message);
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      await runWithTokenContext(
        {
          userId,
          novelId,
          branchId,
          agentId: isAnalysis ? "novel_analysis" : "master",
          category: "agent",
        },
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

      /** Sub-agent critical get miss → ask user directly (not via master re-ask). */
      const emitAskUser = (
        askUser: { question: string; options?: string[] },
        sourceToolCallId: string,
      ) => {
        const askId = `${sourceToolCallId}__ask_user`;
        const question = String(askUser.question || "").trim() || "关键数据缺失，是否继续？";
        const options = Array.isArray(askUser.options)
          ? askUser.options.map((o) => String(o).trim()).filter(Boolean).slice(0, 8)
          : [];
        send({
          type: "ask_question",
          toolCallId: askId,
          tool: "ask_question",
          question,
          options,
        });
        sendTool(
          "ask_question",
          "awaiting_user",
          askId,
          JSON.stringify({ question, options }),
        );
      };

      /** Sub-agent dispatch (same path as write master) — UI card = agentType + trail, not a flat data tool. */
      const runAgent = async (agentTypeRaw: string, prompt: string, toolCallId: string) => {
        // Always try analysis aliases (analyze_story → analyze_story_world); write ids unchanged
        const agentType = resolveAnalysisAgentType(String(agentTypeRaw || "").trim());
        sendTool(agentType, "running", toolCallId);
        const agentDef = getAgent(agentType) || getAgent(String(agentTypeRaw || "").trim());
        if (!agentDef) {
          throw new Error(
            `Unknown agent: ${agentTypeRaw}` +
              (agentType !== agentTypeRaw ? ` (resolved: ${agentType})` : ""),
          );
        }
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

        // Critical miss from sub-agent: stop here and ask user (skip outline review etc.)
        if (result.askUser) {
          return result;
        }

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
              // Outline review critical miss → ask user directly
              if (rev.askUser) {
                return {
                  content:
                    result.content +
                    "\n\n---\n【大纲审核】" +
                    rev.content.slice(0, 2000),
                  messages: [...(result.messages || []), ...(rev.messages || [])],
                  askUser: rev.askUser,
                };
              }
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

      const runDataTool = async (
        name: string,
        toolCallId: string,
        args: Record<string, unknown> = {},
      ) => {
        if (!MASTER_TOOL_ALLOW.has(name) || name === "agent") {
          // agent must go through runAgent — never execute as a data tool
          const denied = isAnalysis
            ? name === "agent"
              ? `请用 agent(agent_type, prompt) 调度分析子 Agent（系统会打开子 Agent 卡片）。`
              : `分析主编不可调用 ${name}。可用：agent / ask_question / get_current_* / get_analysis_* / finish_novel_analysis。章法用 agent(analyze_form)，其它域同样 agent(agent_type)。`
            : name === "agent"
              ? `请用 agent(agent_type, prompt) 调度子 Agent。`
              : `主 agent 不可调用 ${name}。正文由子 agent 自行 get_prose，你只需调度。`;
          sendTool(name, "done", toolCallId, denied);
          return { content: denied, messages: [] as any[] };
        }
        sendTool(name, "running", toolCallId);
        const toolDef = getTool(name);
        if (!toolDef) throw new Error(`Unknown tool: ${name}`);
        const onChunk = (text: string) => {
          send({ type: "tool_chunk", toolCallId, content: text, tool: name });
        };
        const result = await toolDef.execute(
          { ...args, novelId, branchId },
          { novelId, branchId, userId },
          llm,
          onChunk,
        );
        // 子 agent 消息进 trail；前端预览可短
        sendTool(
          name,
          "done",
          toolCallId,
          result.content.slice(0, 5000),
          result.messages,
        );
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

        /** OpenAI-native tool result (OpenCode/DeepSeek V4 rejects Anthropic tool_use/tool_result blocks). */
        const pushToolResult = (toolCallId: string, content: string) => {
          conversation.push({
            role: "tool",
            content,
            tool_call_id: toolCallId,
          } as ToolMessage);
        };

        let maxSteps = 3000;
        while (maxSteps-- > 0) {
          checkAbort();
          const eventStream = llm.chatWithTools(conversation, toolSchemas, { temperature: 0.4, maxTokens: 4096 });

          let stopForUser = false;
          let fullText = "";
          let thinkingTimer: ReturnType<typeof setTimeout> | null = null;
          let hasTextOutput = false;
          // Collect a full model turn first, then emit one assistant+tool_calls + role:tool results.
          // Sequential Anthropic-style pairs cause 400 Upstream on OpenCode Go / deepseek-v4-flash.
          const pendingTools: Array<{ toolId: string; toolName: string; args: Record<string, any> }> = [];

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
              sendChunk(fullText);
            } else if (event.type === "tool_use") {
              if (thinkingTimer) { clearTimeout(thinkingTimer); thinkingTimer = null; }
              pendingTools.push({
                toolId: event.id,
                toolName: event.name,
                args: (event.args || {}) as Record<string, any>,
              });
            }
          }

          if (thinkingTimer) clearTimeout(thinkingTimer);

          if (pendingTools.length === 0) break;

          const preToolText = fullText.trim();
          conversation.push({
            role: "assistant",
            content: preToolText || null,
            tool_calls: pendingTools.map(({ toolId, toolName, args }) => ({
              id: toolId,
              type: "function" as const,
              function: { name: toolName, arguments: JSON.stringify(args || {}) },
            })),
          } as AssistantMessage);

          for (const { toolId, toolName, args } of pendingTools) {
            if (toolName === "ask_question") {
              const question = String(args.question || "").trim() || "请选择下一步";
              let options: string[] = [];
              if (Array.isArray(args.options)) {
                options = args.options.map((o: unknown) => String(o).trim()).filter(Boolean).slice(0, 8);
              } else if (typeof args.options === "string" && args.options.trim()) {
                options = args.options.split("|").map((s: string) => s.trim()).filter(Boolean).slice(0, 8);
              }

              // 一键续写：审核卡点自动通过，不暂停等用户
              if (autoPass) {
                const answer = pickAutoPassAnswer(question, options);
                send({
                  type: "ask_question_auto",
                  toolCallId: toolId,
                  tool: "ask_question",
                  question,
                  options,
                  answer,
                });
                sendTool(
                  "ask_question",
                  "done",
                  toolId,
                  JSON.stringify({ question, options, answer, autoPassed: true }),
                );
                pushToolResult(
                  toolId,
                  `【一键续写·自动通过审核卡点】用户选择：${answer}\n` +
                    `请立即执行该选项对应的下一步（写正文 / 接受续写等），不要再次 ask_question 确认同一卡点。`,
                );
                continue;
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
              // No tool result yet — client rebuilds history with the user's answer
              stopForUser = true;
              continue;
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
                pushToolResult(toolId, batch.content.slice(0, 8000));
                // Any review dimension critical miss → ask user directly
                if (batch.askUser) {
                  emitAskUser(batch.askUser, toolId);
                  stopForUser = true;
                }
              } catch (e) {
                const err = "并行审查失败: " + (e as Error).message;
                sendTool("run_reviews", "done", toolId, err);
                pushToolResult(toolId, err);
              }
              continue;
            }

            if (toolName === "agent") {
              // Same as write master: special path → runAgent (sub-agent card + trail).
              // Never fall through to runDataTool / registry agent.execute without trail.
              const agentType = args.agent_type as string;
              const prompt = args.prompt as string;
              if (!agentType || !prompt) {
                pushToolResult(toolId, "错误: agent_type 和 prompt 都是必需的");
                continue;
              }

              const result = await runAgent(agentType, prompt, toolId);
              // Master only sees short hint (store holds truth) — same as write_prose
              pushToolResult(toolId, result.content.slice(0, 2000));
              if (result.askUser) {
                emitAskUser(result.askUser, toolId);
                stopForUser = true;
              }
            } else if (toolName === "accept_continuation") {
              // Special: run accept and notify UI with new branch text
              sendTool("accept_continuation", "running", toolId);
              const toolDef = getTool("accept_continuation");
              let resultContent = "工具未注册";
              if (toolDef) {
                try {
                  const r = await toolDef.execute(
                    { ...args, novelId, branchId },
                    { novelId, branchId, userId },
                    llm,
                  );
                  resultContent = typeof r.content === "string" ? r.content : JSON.stringify(r.content);
                } catch (e) {
                  resultContent = "接受失败: " + (e as Error).message;
                }
              }
              sendTool("accept_continuation", "done", toolId, resultContent.slice(0, 3000));
              // Notify UI with length only — avoid multi-MB SSE payloads; client refetches body
              try {
                const { getBranch } = await import("@/lib/db");
                const b = getBranch(userId, novelId, branchId);
                if (b) {
                  send({
                    type: "continuation_accepted",
                    branchId,
                    novelId,
                    totalLength: (b.text || "").length,
                    message: resultContent,
                  });
                }
              } catch { /* ignore */ }
              pushToolResult(toolId, resultContent.slice(0, 4000));
            } else {
              const result = await runDataTool(toolName, toolId, args || {});
              // 主 agent 不读 prose；大纲/前文/分析子结果可适当放宽
              const masterLimit =
                toolName === "get_branch_text" ? 30000
                : toolName === "get_outline" ? 30000
                : toolName === "get_findings" ? 20000
                : toolName.startsWith("run_") ? 12000
                : toolName === "get_analysis_status" ? 8000
                : 10000;
              pushToolResult(toolId, result.content.slice(0, masterLimit));
            }
          }

          if (stopForUser) break;
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
