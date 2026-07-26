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
 * 你/他/她：默认仅后重叠区（suffix）且可绑定时才收；前重叠区（prefix）默认不收。
 * 叙述者「我」按 prompt 在整窗可建；集体代词一律忽略。
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
      // CoT files: …-extract_window_characters-w12-enabled.txt (+ full prompt)
      cotTag: `w${window.index}`,
      saveCotPrompt: true,
    },
  );
  return charactersFromLlmWire(raw);
}
