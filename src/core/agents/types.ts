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
    }>;
    required: string[];
  };
  execute(args: Record<string, any>, ctx: ToolContext, llm: LLMProvider, onChunk?: (text: string) => void): Promise<ToolResult>;
}

export interface ToolContext {
  novelText: string;
  novelTitle?: string;
  characters: any[];
  timeline?: any;
  worldBible?: any;
  continueFromOffset?: number;
  continueFromLabel?: string;
}

export interface ToolResult {
  content: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
}

export interface AgentDef {
  execute(ctx: AgentContext, llm: LLMProvider, onChunk?: (text: string) => void): Promise<ToolResult>;
}

export interface AgentContext {
  prompt: string;
  novelText: string;
  novelTitle?: string;
  characters: any[];
  timeline?: any;
  worldBible?: any;
  continueFromOffset?: number;
  continueFromLabel?: string;
}

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; id: string; name: string; args: Record<string, any> }
  | { type: "done" };
