import type { ToolDefinition } from "./types";

const toolMap = new Map<string, ToolDefinition>();

export function register(def: ToolDefinition): void {
  if (toolMap.has(def.name)) {
    throw new Error(`Tool "${def.name}" is already registered`);
  }
  toolMap.set(def.name, def);
}

export function getTool(name: string): ToolDefinition | undefined {
  return toolMap.get(name);
}

export function listTools(): ToolDefinition[] {
  return Array.from(toolMap.values());
}

export function buildToolSchemas() {
  return listTools().map(def => ({
    name: def.name,
    description: def.description,
    parameters: def.parameters as Record<string, unknown>,
  }));
}
