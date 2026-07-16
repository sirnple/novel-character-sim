import type { TrailMessage } from "./types";

/** Last tool_result for a given tool name */
export function lastToolResult(trail: TrailMessage[], toolName: string): string {
  const hits = trail.filter((m) => m.role === "tool_result" && m.toolName === toolName);
  return hits.length ? hits[hits.length - 1].content || "" : "";
}

export function toolSaveSucceeded(
  trail: TrailMessage[],
  toolName: string,
  okMarker: string,
): { called: boolean; ok: boolean; detail: string } {
  const hits = trail.filter((m) => m.role === "tool_result" && m.toolName === toolName);
  if (!hits.length) return { called: false, ok: false, detail: "" };
  const detail = hits[hits.length - 1].content || "";
  return { called: true, ok: detail.includes(okMarker), detail };
}
