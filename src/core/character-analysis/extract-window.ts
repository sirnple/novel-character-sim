import type { LLMProvider, ToolSchema } from "@/types";
import { EXTRACT_WINDOW_CHARACTERS_SCHEMA } from "./schema";
import { renderExtractWindowPrompt } from "./prompt";
import { charactersFromLlmWire } from "./normalize";
import type { AnalysisWindow, Character } from "./types";

const TOOL = EXTRACT_WINDOW_CHARACTERS_SCHEMA as unknown as ToolSchema;

export interface ExtractWindowOptions {
  temperature?: number;
  maxTokens?: number;
  cwd?: string;
  /** Neighbors — used to mark overlap zones for pronoun policy. */
  prev?: AnalysisWindow | null;
  next?: AnalysisWindow | null;
}

/**
 * Stage ① single-window LLM extract + in-window coref.
 * Pronouns (我/你/他…) only requested in overlap strips with prev/next.
 */
export async function extractCharactersInWindow(
  llm: LLMProvider,
  window: AnalysisWindow,
  options: ExtractWindowOptions = {},
): Promise<Character[]> {
  const prompt = renderExtractWindowPrompt(window, {
    cwd: options.cwd,
    prev: options.prev,
    next: options.next,
  });
  const raw = await llm.chatWithTool<unknown>(
    [{ role: "user", content: prompt }],
    TOOL,
    {
      temperature: options.temperature ?? 0.2,
      maxTokens: options.maxTokens ?? 30_000,
    },
  );
  return charactersFromLlmWire(raw);
}
