import type { LLMProvider } from "@/types";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
      items?: { type: string };
    }>;
    required: string[];
  };
  execute(args: Record<string, any>, ctx: ToolContext, llm: LLMProvider, onChunk?: (text: string) => void): Promise<ToolResult>;
}

export interface ToolContext {
  novelId: string;
  branchId: string;
  userId: string;
}

/** Sub-agent conversation trail for UI (chat-style, not raw API blocks). */
export interface TrailMessage {
  role: "system" | "user" | "assistant" | "tool_call" | "tool_result";
  content: string;
  /** Set for tool_call / tool_result */
  toolName?: string;
}

export interface ToolResult {
  content: string;
  messages: TrailMessage[];
}

export interface AgentDef {
  /** onChunk: streaming text of current step; onTrail: live conversation turns for UI */
  execute(
    ctx: AgentContext,
    llm: LLMProvider,
    onChunk?: (text: string) => void,
    onTrail?: (messages: TrailMessage[]) => void,
  ): Promise<ToolResult>;
}

export interface AgentContext {
  prompt: string;
  novelId: string;
  branchId: string;
  userId: string;
  /** Writing style from global library (single-select). */
  selectedStyleId?: string | null;
  /** Outline ideas from global library (max 3). */
  selectedIdeaIds?: string[];
  /** Outline agent may auto-pick ideas if none selected. */
  autoPickIdeas?: boolean;
}

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; id: string; name: string; args: Record<string, any> }
  | { type: "done" };
