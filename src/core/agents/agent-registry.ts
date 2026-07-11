import type { AgentDef } from "./types";

const agentMap = new Map<string, AgentDef>();

export function registerAgent(type: string, def: AgentDef): void {
  if (agentMap.has(type)) {
    throw new Error(`Agent "${type}" is already registered`);
  }
  agentMap.set(type, def);
}

export function getAgent(type: string): AgentDef | undefined {
  return agentMap.get(type);
}

export function listAgentTypes(): string[] {
  return Array.from(agentMap.keys());
}
