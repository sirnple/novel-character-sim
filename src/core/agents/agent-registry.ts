import type { AgentDef } from "./types";
import { runWithTokenContext } from "@/lib/token-usage-context";

const agentMap = new Map<string, AgentDef>();

export function registerAgent(type: string, def: AgentDef): void {
  if (agentMap.has(type)) {
    throw new Error(`Agent "${type}" is already registered`);
  }
  // Attribute all LLM calls inside this agent to type + request user/novel/branch.
  const wrapped: AgentDef = {
    execute: (ctx, llm, onChunk, onTrail) =>
      runWithTokenContext(
        {
          agentId: type,
          category: "agent",
          userId: ctx.userId,
          novelId: ctx.novelId,
          branchId: ctx.branchId,
        },
        () => def.execute(ctx, llm, onChunk, onTrail),
      ),
  };
  agentMap.set(type, wrapped);
}

export function getAgent(type: string): AgentDef | undefined {
  return agentMap.get(type);
}

export function listAgentTypes(): string[] {
  return Array.from(agentMap.keys());
}
