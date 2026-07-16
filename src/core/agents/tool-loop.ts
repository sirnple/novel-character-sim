import { getTool } from "./registry";
import type { LLMProvider, LLMMessage, AssistantMessage, ToolSchema } from "@/types";
import type { ToolContext, TrailMessage } from "./types";

export interface ToolLoopResult {
  finalText: string;
  trail: TrailMessage[];
}

const TRAIL_TOOL_PREVIEW = 4000;

function formatToolArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (entries.length === 0) return "";
  try {
    return JSON.stringify(Object.fromEntries(entries), null, 2);
  } catch {
    return "";
  }
}

function previewToolBody(text: string): string {
  // Pretty-print JSON tool bodies for the UI (characters/timeline/etc.)
  let display = text;
  const trimmed = text.trim();
  if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && trimmed.length > 1) {
    try {
      display = JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch { /* keep raw */ }
  }
  if (display.length <= TRAIL_TOOL_PREVIEW) return display;
  return display.slice(0, TRAIL_TOOL_PREVIEW) + `\n… (共 ${text.length} 字，预览已截断)`;
}

/**
 * Drive an LLM through chatWithTools, dispatching tool_use events to tools
 * and feeding results back. Reused by both the master route and sub-agents.
 *
 * finalText is ONLY the last step's text (the turn with no tool_use).
 * Intermediate chatter before tool calls must never be concatenated into the
 * deliverable (writer was saving "我先获取大纲…" + prose as one body).
 *
 * trail is built incrementally as human-readable chat turns (never raw
 * tool_use / tool_result JSON blocks).
 */
export interface ToolLoopOptions {
  maxTokens?: number;
  temperature?: number;
}

export async function runToolLoop(
  llm: LLMProvider,
  conversation: LLMMessage[],
  tools: ToolSchema[],
  ctx: ToolContext,
  onChunk?: (text: string) => void,
  initialTrail?: TrailMessage[],
  onTrail?: (messages: TrailMessage[]) => void,
  options?: ToolLoopOptions,
): Promise<ToolLoopResult> {
  const trail: TrailMessage[] = initialTrail ? [...initialTrail] : [];
  const maxTokens = options?.maxTokens ?? 4096;
  const temperature = options?.temperature ?? 0.4;
  // Structural trail updates (tool call/result, committed turns) — always emit
  const pushTrail = (msg: TrailMessage) => {
    trail.push(msg);
    onTrail?.(trail.slice());
  };
  // Provisional streaming assistant (not yet committed) — throttle a bit
  let lastProvEmit = 0;
  const emitProvisional = (text: string) => {
    if (!onTrail || !text) return;
    const now = Date.now();
    if (now - lastProvEmit < 80) return;
    lastProvEmit = now;
    onTrail([...trail, { role: "assistant", content: text }]);
  };

  let maxSteps = 15;
  let finalText = "";
  /** Longest assistant prose before a tool call — outline often lives here, not in final tool-free turn */
  let bestPreToolText = "";
  while (maxSteps-- > 0) {
    let hasToolUse = false;
    let stepText = "";
    let preToolText = "";
    const eventStream = llm.chatWithTools(conversation, tools, { temperature, maxTokens });

    for await (const event of eventStream) {
      if (event.type === "text_delta") {
        stepText += event.text;
        if (!hasToolUse) preToolText = stepText;
        // Stream current step only (not cumulative across tool rounds)
        if (onChunk) onChunk(stepText);
        emitProvisional(stepText);
      } else if (event.type === "tool_use") {
        hasToolUse = true;
        const toolName = event.name;
        const toolId = event.id;
        const args = event.args as Record<string, any>;

        if (preToolText) {
          if (preToolText.length > bestPreToolText.length) {
            bestPreToolText = preToolText;
          }
          conversation.push({ role: "assistant", content: preToolText } as AssistantMessage);
          pushTrail({ role: "assistant", content: preToolText });
          preToolText = "";
        }

        conversation.push({
          role: "assistant",
          content: [{ type: "tool_use", id: toolId, name: toolName, input: args }],
        } as AssistantMessage);
        pushTrail({
          role: "tool_call",
          toolName,
          content: formatToolArgs(args) || "(无参数)",
        });

        const toolDef = getTool(toolName);
        let resultContent = "工具未注册或返回空";
        if (toolDef) {
          try {
            // Always inject route-level ids so tools never write under undefined::*
            const r = await toolDef.execute(
              {
                ...args,
                novelId: ctx.novelId || args.novelId,
                branchId: ctx.branchId || args.branchId || "main",
              },
              {
                ...ctx,
                novelId: ctx.novelId || (args.novelId as string) || "",
                branchId: ctx.branchId || (args.branchId as string) || "main",
                userId: ctx.userId,
              },
              llm,
            );
            resultContent = typeof r.content === "string" ? r.content : JSON.stringify(r.content);
            // 正文/前文类工具需要足够长的窗口，避免审查/改写只看到截断片段
            const limit =
              toolName === "get_prose" ? 80000
              : toolName === "get_branch_text" ? 50000
              : toolName === "get_outline" ? 30000
              : 10000;
            resultContent = resultContent.slice(0, limit);
          } catch (e) {
            resultContent = "工具执行失败: " + (e as Error).message;
          }
        }
        conversation.push({
          role: "user",
          content: [{ type: "tool_result", tool_use_id: toolId, content: resultContent }],
        });
        pushTrail({
          role: "tool_result",
          toolName,
          content: previewToolBody(resultContent),
        });
      }
    }

    if (!hasToolUse) {
      // Deliverable = this final answer turn only
      finalText = stepText;
      if (stepText) {
        conversation.push({ role: "assistant", content: stepText } as AssistantMessage);
        pushTrail({ role: "assistant", content: stepText });
      }
      break;
    }
  }

  // Prefer explicit final turn; if empty/short (model ended on tool_use), fall back to longest pre-tool prose
  const delivered =
    finalText.trim().length >= 50
      ? finalText
      : bestPreToolText.trim().length >= 50
        ? bestPreToolText
        : finalText || bestPreToolText;

  return { finalText: delivered, trail };
}

/** Drive a sub-agent: prepend system+user, run loop, return final text + trail. */
export async function runSubAgentToolLoop(
  llm: LLMProvider,
  systemPrompt: string,
  userPrompt: string,
  tools: ToolSchema[],
  ctx: ToolContext,
  onChunk?: (text: string) => void,
  onTrail?: (messages: TrailMessage[]) => void,
  options?: ToolLoopOptions,
): Promise<ToolLoopResult> {
  const conversation: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
  const initialTrail: TrailMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
  // Show system + task immediately so the card is not empty while waiting on LLM
  onTrail?.(initialTrail.slice());
  return runToolLoop(llm, conversation, tools, ctx, onChunk, initialTrail, onTrail, options);
}
