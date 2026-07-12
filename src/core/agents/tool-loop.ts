import { getTool } from "./registry";
import type { LLMProvider, LLMMessage, AssistantMessage, ToolSchema } from "@/types";
import type { ToolContext } from "./types";

export interface ToolLoopResult {
  finalText: string;
  trail: { role: "system" | "user" | "assistant"; content: string }[];
}

/**
 * Drive an LLM through chatWithTools, dispatching tool_use events to tools
 * and feeding results back. Reused by both the master route and sub-agents.
 */
export async function runToolLoop(
  llm: LLMProvider,
  conversation: LLMMessage[],
  tools: ToolSchema[],
  ctx: ToolContext,
  onChunk?: (text: string) => void
): Promise<ToolLoopResult> {
  let maxSteps = 15;
  let allText = "";
  while (maxSteps-- > 0) {
    let hasToolUse = false;
    const eventStream = llm.chatWithTools(conversation, tools, { temperature: 0.4, maxTokens: 4096 });

    for await (const event of eventStream) {
      if (event.type === "text_delta") {
        allText += event.text;
        if (onChunk) onChunk(allText);
      } else if (event.type === "tool_use") {
        hasToolUse = true;
        const toolName = event.name;
        const toolId = event.id;
        const args = event.args as Record<string, any>;

        conversation.push({
          role: "assistant",
          content: [{ type: "tool_use", id: toolId, name: toolName, input: args }],
        } as AssistantMessage);

        const toolDef = getTool(toolName);
        let resultContent = "工具未注册或返回空";
        if (toolDef) {
          try {
            const r = await toolDef.execute({ ...args, novelId: (ctx as any).novelId, branchId: (ctx as any).branchId }, ctx, llm);
            resultContent = typeof r.content === "string" ? r.content : JSON.stringify(r.content);
            resultContent = resultContent.slice(0, 5000);
          } catch (e) {
            resultContent = "工具执行失败: " + (e as Error).message;
          }
        }
        conversation.push({
          role: "user",
          content: [{ type: "tool_result", tool_use_id: toolId, content: resultContent }],
        });
      }
    }

    if (!hasToolUse) break;
  }

  const trail = conversation
    .filter(m => m.role !== "tool")
    .map(m => ({
      role: m.role as "system" | "user" | "assistant",
      content: typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content) ? JSON.stringify(m.content).slice(0, 8000) : "",
    }));
  return { finalText: allText, trail };
}

/** Drive a sub-agent: prepend system+user, run loop, return final text + trail. */
export async function runSubAgentToolLoop(
  llm: LLMProvider,
  systemPrompt: string,
  userPrompt: string,
  tools: ToolSchema[],
  ctx: ToolContext,
  onChunk?: (text: string) => void
): Promise<ToolLoopResult> {
  const conversation: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
  return runToolLoop(llm, conversation, tools, ctx, onChunk);
}
