/**
 * One-shot LLM prompts (not multi-turn agents).
 * Templates live under `src/core/prompts/oneshot/` — not in AGENT_PROMPT_FILES.
 */
import { loadPromptFile, renderTemplate } from "./renderer";

/** Render a oneshot template: `oneshot/<name>.md` (name without path/ext). */
export function renderOneshot(
  name: string,
  vars: Record<string, unknown> = {},
): string {
  const safe = String(name || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) throw new Error("oneshot name required");
  return renderTemplate(loadPromptFile(`oneshot/${safe}.md`), vars);
}
