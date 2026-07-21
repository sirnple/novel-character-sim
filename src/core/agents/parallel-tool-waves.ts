/**
 * Group master pending tool_calls into execution waves.
 * Analysis mode: consecutive `agent` calls form one parallel wave (Promise.all).
 * Write mode / other tools: one-at-a-time (serial groups of size 1).
 */

export interface PendingToolCall {
  toolId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolExecWave {
  /** True → run tools in this wave with Promise.all */
  parallel: boolean;
  tools: PendingToolCall[];
}

/**
 * @param parallelAgentWaves — analysis master: batch consecutive agent() calls
 */
export function groupPendingToolsForExecution(
  pending: PendingToolCall[],
  parallelAgentWaves: boolean,
): ToolExecWave[] {
  if (!pending.length) return [];
  const waves: ToolExecWave[] = [];
  let i = 0;
  while (i < pending.length) {
    const cur = pending[i];
    if (parallelAgentWaves && cur.toolName === "agent") {
      const batch: PendingToolCall[] = [];
      while (i < pending.length && pending[i].toolName === "agent") {
        batch.push(pending[i++]);
      }
      waves.push({
        parallel: batch.length > 1,
        tools: batch,
      });
      continue;
    }
    waves.push({ parallel: false, tools: [cur] });
    i++;
  }
  return waves;
}

/** agent_type labels in a wave (for logs / tests) */
export function waveAgentTypes(wave: ToolExecWave): string[] {
  return wave.tools
    .filter((t) => t.toolName === "agent")
    .map((t) => String(t.args?.agent_type || "").trim())
    .filter(Boolean);
}
