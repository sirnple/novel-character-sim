import { NextRequest } from "next/server";
import { createLLMProvider } from "@/core/llm/factory";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import { logSession } from "@/lib/session-log";
import { getTool, buildToolSchemas } from "@/core/agents/registry";
import { getAgent } from "@/core/agents/agent-registry";
import { initRegistry } from "@/core/agents/init";
import { runReviewsParallel } from "@/core/agents/agents/run-reviews";
import {
  resolveAgentSystem,
  getAgentAllowedTools,
} from "@/core/prompts/resolve-agent-prompt";
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
import {
  groupPendingToolsForExecution,
  waveAgentTypes,
} from "@/core/agents/parallel-tool-waves";
import type { LLMMessage, SystemMessage, UserMessage, AssistantMessage, ToolMessage, ToolSchema } from "@/types";
import {
  appendAgentRunEvent,
  createAgentRun,
  getAgentRun,
  setAgentRunStatus,
  type AgentRun,
} from "@/core/agents/agent-run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    /**
     * Analysis only: wipe staging and start full session.
     * Pass true for one-click analyze only (not every multi-turn message).
     */
    forceRefresh: forceRefreshBody = false,
    /**
     * Analysis only: keep full-session semantics without wipe (一键后的多轮).
     * Ordinary chat must omit this so status uses published DB again.
     */
    preserveFull: preserveFullBody = false,
  } = await request.json();
  if (!branchId || !novelId) return new Response(JSON.stringify({ error: "branchId and novelId required" }), { status: 400, headers: { "Content-Type": "application/json" } });

  const isAnalysis = mode === "analysis";
  const forceRefresh = isAnalysis && !!forceRefreshBody;
  const preserveFull = isAnalysis && !forceRefresh && !!preserveFullBody;
  const autoPass = !!autoPassCheckpoints && !isAnalysis;
  const llm = createLLMProvider(isAnalysis ? "analysis" : "write");
  const encoder = new TextEncoder();
  // write 模式白名单来自 master-system.md frontmatter；analysis 用 ANALYSIS_MASTER_TOOL_NAMES
  const WRITE_TOOL_ALLOW = new Set(getAgentAllowedTools("master"));
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
    ? resolveAgentSystem("novel_analysis", "zh")
    : resolveAgentSystem("master", "zh", { novelId, branchId });
  const sysPrompt = autoPass
    ? `${baseSys}\n\n${ONE_CLICK_CONTINUE_SYSTEM_APPEND}`
    : baseSys;

  // Analysis session: full=wipe once; continue+preserveFull=一键多轮; plain continue=认 DB
  if (isAnalysis) {
    try {
      const { ensureAnalysisSession } = await import(
        "@/core/extractor/analysis-session"
      );
      ensureAnalysisSession({
        userId,
        novelId,
        branchId,
        mode: forceRefresh ? "full" : "continue",
        preserveFull,
      });
    } catch (e) {
      console.warn("[agent/chat] analysis session init:", (e as Error).message);
    }
  }

  /**
   * Analysis mode: agent loop owned by AgentRun (server process).
   * SSE only subscribes; client disconnect does not abort the loop.
   * Write mode keeps request-bound loop.
   */
  const agentRun: AgentRun | null = isAnalysis
    ? createAgentRun({
        userId,
        novelId,
        branchId,
        mode: "analysis",
      })
    : null;

  const stream = new ReadableStream({
    async start(controller) {
      const runLoop = async () => {
      await runWithTokenContext(
        {
          userId,
          novelId,
          branchId,
          agentId: isAnalysis ? "novel_analysis" : "master",
          category: "agent",
        },
        async () => {
      const signal = agentRun ? agentRun.abort.signal : request.signal;
      const checkAbort = () => { if (signal.aborted) throw new Error("ABORTED"); };
      const send = (data: Record<string, unknown>) => {
        if (agentRun) {
          try {
            appendAgentRunEvent(agentRun.id, data);
          } catch {
            /* ignore */
          }
        }
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch { /* stream closed — loop may continue */ }
      };
      if (agentRun) {
        send({ type: "agent_run", runId: agentRun.id });
      }
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
            `未知子 Agent: ${agentTypeRaw}` +
              (agentType !== agentTypeRaw ? `（解析为: ${agentType}）` : ""),
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
            signal,
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

        // After outline: visible review card; on fail auto-rewrite outline once then re-review
        if (agentType === "generate_outline") {
          const { getFindings } = await import("@/core/agents/intermediate-store");
          const { outlineReviewFailedFromFindings } = await import(
            "@/core/agents/agents/outline-review"
          );

          const runOutlineReviewCard = async (parentId: string, attempt: number) => {
            const reviewId = `${parentId}__outline_review${attempt > 1 ? `_r${attempt}` : ""}`;
            const reviewDef = getAgent("review_outline");
            if (!reviewDef) {
              return { content: "（无 review_outline agent）", messages: [] as any[], askUser: undefined as any };
            }
            sendTool("review_outline", "running", reviewId);
            const t1 = Date.now();
            try {
              const rev = await reviewDef.execute(
                {
                  prompt:
                    attempt > 1
                      ? "复审：检查改写后的大纲是否已消除上次 critical/major 问题"
                      : "审核刚生成的大纲与前文/类型是否冲突（出场合法性、梦与现实、承接等）",
                  novelId,
                  branchId,
                  userId,
                },
                llm,
                (text) =>
                  send({
                    type: "tool_chunk",
                    toolCallId: reviewId,
                    content: text,
                    tool: "review_outline",
                  }),
                (messages) =>
                  send({
                    type: "tool_trail",
                    toolCallId: reviewId,
                    messages,
                    tool: "review_outline",
                  }),
              );
              logSession({
                ts: new Date().toISOString(),
                type: "tool_exec",
                tool: "review_outline",
                elapsed: Date.now() - t1,
                resultPreview: rev.content.slice(0, 300),
              });
              sendTool(
                "review_outline",
                "done",
                reviewId,
                rev.content.slice(0, 5000),
                rev.messages,
              );
              return rev;
            } catch (e) {
              const err = "大纲审核失败: " + (e as Error).message;
              sendTool("review_outline", "done", reviewId, err);
              return { content: err, messages: [], askUser: undefined };
            }
          };

          let outlineContent = result.content;
          let outlineMessages = [...(result.messages || [])];
          let rev = await runOutlineReviewCard(toolCallId, 1);

          if (rev.askUser) {
            return {
              content:
                outlineContent +
                "\n\n---\n【大纲审核】" +
                rev.content.slice(0, 2000),
              messages: [...outlineMessages, ...(rev.messages || [])],
              askUser: rev.askUser,
            };
          }

          const outlineFindings = () =>
            getFindings(novelId, branchId).filter((f) => f.dimension === "outline");
          let failed =
            outlineReviewFailedFromFindings(outlineFindings()) ||
            /【大纲审核未通过】|大纲审核未通过|大纲审核失败/.test(rev.content || "");

          // Program-level rewrite once when critical/major — master often forgets
          if (failed) {
            const findingsText = outlineFindings()
              .slice(0, 12)
              .map(
                (f, i) =>
                  `${i + 1}. 【${f.severity}】${f.description}${
                    f.suggestion ? ` → ${f.suggestion}` : ""
                  }`,
              )
              .join("\n");
            const fixId = `${toolCallId}__outline_fix`;
            const outlineDef = getAgent("generate_outline");
            if (outlineDef) {
              sendTool("generate_outline", "running", fixId);
              const tFix = Date.now();
              try {
                const fixed = await outlineDef.execute(
                  {
                    prompt:
                      `【任务模式:rewrite】\n` +
                      `【系统强制改写大纲】上一轮大纲审核未通过（含致命/重要问题）。\n` +
                      `在上一稿上按 findings 修改；保留仍成立的情节/角色/时空，禁止无依据整篇推翻。\n` +
                      `改完 save_outline（完整改写后全文）+ save_foreshadowing_plan。\n\n` +
                      `## 审核 findings\n${findingsText || rev.content.slice(0, 2000)}\n\n` +
                      `原任务：${String(prompt || "").slice(0, 500)}`,
                    novelId,
                    branchId,
                    userId,
                    selectedStyleId,
                    selectedIdeaIds: Array.isArray(selectedIdeaIds)
                      ? selectedIdeaIds.slice(0, 3)
                      : [],
                    autoPickIdeas: !!autoPickIdeas,
                  },
                  llm,
                  (text) =>
                    send({
                      type: "tool_chunk",
                      toolCallId: fixId,
                      content: text,
                      tool: "generate_outline",
                    }),
                  (messages) =>
                    send({
                      type: "tool_trail",
                      toolCallId: fixId,
                      messages,
                      tool: "generate_outline",
                    }),
                );
                logSession({
                  ts: new Date().toISOString(),
                  type: "tool_exec",
                  tool: "generate_outline",
                  elapsed: Date.now() - tFix,
                  resultPreview: fixed.content.slice(0, 300),
                });
                sendTool(
                  "generate_outline",
                  "done",
                  fixId,
                  fixed.content.slice(0, 5000),
                  fixed.messages,
                );
                if (fixed.askUser) {
                  return {
                    content:
                      outlineContent +
                      "\n\n---\n【大纲审核未通过 → 改写中断】\n" +
                      rev.content.slice(0, 2000) +
                      "\n" +
                      fixed.content.slice(0, 1000),
                    messages: [
                      ...outlineMessages,
                      ...(rev.messages || []),
                      ...(fixed.messages || []),
                    ],
                    askUser: fixed.askUser,
                  };
                }
                outlineContent =
                  outlineContent +
                  "\n\n---\n【系统：大纲审核未通过，已自动拉起大纲改写】\n" +
                  fixed.content.slice(0, 2000);
                outlineMessages = [
                  ...outlineMessages,
                  ...(rev.messages || []),
                  ...(fixed.messages || []),
                ];
                rev = await runOutlineReviewCard(fixId, 2);
                if (rev.askUser) {
                  return {
                    content:
                      outlineContent +
                      "\n\n---\n【大纲复审】" +
                      rev.content.slice(0, 2000),
                    messages: [...outlineMessages, ...(rev.messages || [])],
                    askUser: rev.askUser,
                  };
                }
                failed =
                  outlineReviewFailedFromFindings(outlineFindings()) ||
                  /【大纲审核未通过】|大纲审核未通过|大纲审核失败/.test(
                    rev.content || "",
                  );
              } catch (e) {
                const err = "自动改写大纲失败: " + (e as Error).message;
                sendTool("generate_outline", "done", fixId, err);
                outlineContent += "\n\n" + err;
              }
            }
          }

          const wrapHint = failed
            ? "\n主 agent：复审仍未通过 → 再 generate_outline 按 findings 改写（一键续写也必须改到通过，禁止带病写正文）。"
            : "\n主 agent：审核已通过 → 可写正文 / 一键模式直接 write_prose。";

          return {
            content:
              outlineContent +
              "\n\n---\n【大纲审核 agent 已完成】\n" +
              rev.content.slice(0, 4000) +
              wrapHint,
            messages: [...outlineMessages, ...(rev.messages || [])],
          };
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
        if (!toolDef) throw new Error(`未知工具: ${name}`);
        const onChunk = (text: string) => {
          send({ type: "tool_chunk", toolCallId, content: text, tool: name });
        };
        const result = await toolDef.execute(
          { ...args, novelId, branchId },
          { novelId, branchId, userId, signal },
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
            checkAbort();
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

          /**
           * Process pending tool calls in waves (see groupPendingToolsForExecution).
           * Analysis: consecutive agent() → Promise.all. Write: serial.
           */
          const execWaves = groupPendingToolsForExecution(
            pendingTools,
            isAnalysis,
          );

          const runOneAgent = async (item: {
            toolId: string;
            toolName: string;
            args: Record<string, any>;
          }) => {
            const agentType = item.args.agent_type as string;
            const prompt = item.args.prompt as string;
            if (!agentType || !prompt) {
              return {
                toolId: item.toolId,
                content: "错误: agent_type 和 prompt 都是必需的",
                askUser: undefined as
                  | import("@/core/agents/types").AskUserRequest
                  | undefined,
              };
            }
            try {
              const result = await runAgent(agentType, prompt, item.toolId);
              return {
                toolId: item.toolId,
                content: result.content.slice(0, 2000),
                askUser: result.askUser,
              };
            } catch (e) {
              const msg = (e as Error).message || String(e);
              // F5 / 停止：向上抛，结束整条 chat 请求
              if (msg === "ABORTED" || (e as Error).name === "AbortError") {
                throw e;
              }
              const err = `子 Agent 失败: ${msg}`;
              sendTool(
                String(item.args.agent_type || "agent"),
                "done",
                item.toolId,
                err,
              );
              return {
                toolId: item.toolId,
                content: err,
                askUser: undefined,
              };
            }
          };

          for (const wave of execWaves) {
            if (stopForUser) break;
            checkAbort();

            // Parallel agent wave (analysis only)
            if (
              wave.parallel &&
              wave.tools.every((t) => t.toolName === "agent")
            ) {
              logSession({
                ts: new Date().toISOString(),
                type: "tool_exec",
                tool: "agent_parallel_wave",
                elapsed: 0,
                resultPreview: waveAgentTypes(wave).join(" ∥ "),
              });
              const tWave = Date.now();
              const results = await Promise.all(wave.tools.map(runOneAgent));
              logSession({
                ts: new Date().toISOString(),
                type: "tool_exec",
                tool: "agent_parallel_wave",
                elapsed: Date.now() - tWave,
                resultPreview: results
                  .map((r) => r.content.slice(0, 80))
                  .join(" | "),
              });
              for (const one of results) {
                pushToolResult(one.toolId, one.content);
                if (one.askUser && !stopForUser) {
                  emitAskUser(one.askUser, one.toolId);
                  stopForUser = true;
                }
              }
              continue;
            }

            // Serial: one tool per wave (or single agent)
            const { toolId, toolName, args } = wave.tools[0];

            if (toolName === "agent") {
              const one = await runOneAgent({ toolId, toolName, args });
              pushToolResult(one.toolId, one.content);
              if (one.askUser) {
                emitAskUser(one.askUser, one.toolId);
                stopForUser = true;
              }
              continue;
            }

            if (toolName === "ask_question") {
              const question = String(args.question || "").trim() || "请选择下一步";
              let options: string[] = [];
              if (Array.isArray(args.options)) {
                options = args.options.map((o: unknown) => String(o).trim()).filter(Boolean).slice(0, 8);
              } else if (typeof args.options === "string" && args.options.trim()) {
                options = args.options.split("|").map((s: string) => s.trim()).filter(Boolean).slice(0, 8);
              }

              // 一键续写：自动代答（有问题优先改，不带病放行），不暂停等用户
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
                  `【一键续写·自动代答】选择：${answer}\n` +
                    `说明：有审核/审查问题时会优先「修改到通过」，不会选「了解风险仍继续」。` +
                    `请立即执行该选项（改大纲 / 改正文 / 通过后写正文或 accept），不要再次 ask 同一卡点。`,
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
                  {
                    prompt: reviewPrompt,
                    novelId,
                    branchId,
                    userId,
                    selectedStyleId: selectedStyleId ?? null,
                  },
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

            if (toolName === "accept_continuation") {
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
        if (agentRun && getAgentRun(agentRun.id)?.status === "running") {
          setAgentRunStatus(agentRun.id, "done");
          send({ type: "done", runId: agentRun.id });
        }
      } catch (e) {
        const msg = (e as Error).message || String(e);
        if (msg === "ABORTED" || (e as Error).name === "AbortError") {
          console.log("[agent/chat] aborted (run cancel or write client abort)");
          send({ type: "stopped" });
          if (agentRun) {
            const st = getAgentRun(agentRun.id)?.status;
            if (st === "running") {
              setAgentRunStatus(agentRun.id, "cancelled", { message: "已停止" });
            }
          }
        } else {
          logSession({ ts: new Date().toISOString(), type: "error", error: msg });
          send({ type: "error", message: msg });
          if (agentRun) {
            setAgentRunStatus(agentRun.id, "error", { error: msg });
          }
        }
      }
        },
      );
      };

      if (agentRun) {
        void runLoop().catch((e) => {
          console.error("[agent/chat] detached loop error:", (e as Error).message);
          setAgentRunStatus(agentRun!.id, "error", {
            error: (e as Error).message || String(e),
          });
          try {
            appendAgentRunEvent(agentRun!.id, {
              type: "error",
              message: (e as Error).message || String(e),
            });
          } catch {
            /* ignore */
          }
        });
        try {
          while (!request.signal.aborted) {
            const r = getAgentRun(agentRun.id);
            if (!r) break;
            if (r.status !== "running") break;
            await new Promise((res) => setTimeout(res, 200));
          }
        } finally {
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        }
      } else {
        await runLoop();
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}

