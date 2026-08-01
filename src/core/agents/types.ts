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
  /** User-selected style library id (writer / style review fetch via get_style). */
  selectedStyleId?: string | null;
  /**
   * Request abort (client F5 / 停止). Long tools (窗扫) must check between units.
   * Full resumable session modeling is separate work.
   */
  signal?: AbortSignal;
}

/** Sub-agent conversation trail for UI (chat-style, not raw API blocks). */
export interface TrailMessage {
  role: "system" | "user" | "assistant" | "tool_call" | "tool_result";
  content: string;
  /** Set for tool_call / tool_result */
  toolName?: string;
}

/** Sub-agent wants the UI to ask the user (e.g. critical get_* failed). */
export interface AskUserRequest {
  question: string;
  options: string[];
  missKind?: string;
  toolName?: string;
  detail?: string;
}

export interface ToolResult {
  content: string;
  messages: TrailMessage[];
  /** If set, chat route should emit ask_question and pause for user — not master re-ask */
  askUser?: AskUserRequest;
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
  /** Same as ToolContext.signal — F5 / 停止. */
  signal?: AbortSignal;
}

export type StreamEvent =
  | { type: "text_delta"; text: string }
  /** Partial tool-call args while streaming (e.g. long save_prose content). */
  | {
      type: "tool_arg_delta";
      id: string;
      name: string;
      /** Cumulative argument JSON char length so far */
      argsChars: number;
      /** Optional short preview (not full body) */
      preview?: string;
    }
  | { type: "tool_use"; id: string; name: string; args: Record<string, any> }
  | { type: "done" };
