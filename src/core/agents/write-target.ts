/**
 * Minimal user message for write-mode sub-agents.
 * How-to lives in system md; master only dispatches by agent_type.
 * novelId / branchId bind the session store & branch tools.
 */
export function writeTargetUserPrompt(
  novelId: string,
  branchId?: string | null,
): string {
  return `novelId=${String(novelId || "").trim()}\nbranchId=${String(branchId || "main").trim() || "main"}`;
}
