import type { LLMProvider } from "@/types";
import type { AgentConfig } from "./agent-config";

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

/**
 * **Agent** (industry term): LLM + tools **loop**.
 * The model chooses tools; runtime runs LLM ↔ tools until the model stops.
 *
 * Carries its own {@link AgentConfig} (`name` from system md frontmatter only —
 * no separate id). Define via system md path; register with `registerAgent(agent)`.
 *
 * @see LangGraph docs — “Workflows have predetermined code paths… Agents are
 * dynamic and define their own processes and tool usage.”
 * @see OpenAI Agents SDK / pi-agent-core — agent owns the tool loop.
 *
 * Not an Agent: fixed program pipelines / background jobs → {@link Workflow}.
 */
export interface Agent {
  /** Identity from system md frontmatter (`name`, tools, …). */
  config: AgentConfig;
  /** Run the agent loop. onChunk / onTrail are UI streams. */
  execute(
    ctx: AgentContext,
    llm: LLMProvider,
    onChunk?: (text: string) => void,
    onTrail?: (messages: TrailMessage[]) => void,
  ): Promise<ToolResult>;
}

/**
 * **Workflow** (industry): predetermined code path.
 * May invoke agents as steps; the path itself is not model-chosen tool use.
 */
export interface Workflow {
  execute(
    ctx: AgentContext,
    llm: LLMProvider,
    onChunk?: (text: string) => void,
    onTrail?: (messages: TrailMessage[]) => void,
  ): Promise<ToolResult>;
}

/** @deprecated use {@link Agent} */
export type AgentDef = Agent;

/** Re-export AgentConfig for callers (canonical definition in agent-config.ts). */
export type { AgentConfig, AgentCategory } from "./agent-config";

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
