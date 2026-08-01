import type { LLMProvider } from "@/types";
import { extractCharactersInWindow } from "./extract-window";
import {
  STAGE1_DEFAULT_CONFIG,
  type AnalysisWindow,
  type Stage1ScanConfig,
  type WindowExtractResult,
} from "./types";
import { buildAnalysisWindows } from "./windows";

export interface Stage1ScanOptions {
  config?: Partial<Stage1ScanConfig>;
  /** Limit windows (smoke test). */
  maxWindows?: number | null;
  concurrency?: number;
  temperature?: number;
  maxTokens?: number;
  cwd?: string;
  onWindowDone?: (result: WindowExtractResult, index: number, total: number) => void;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

/**
 * Stage ① only: build windows → parallel LLM extract per window.
 * Does not merge across windows (step ②).
 */
export async function runStage1WindowScan(
  fullText: string,
  llm: LLMProvider,
  options: Stage1ScanOptions = {},
): Promise<{
  config: Stage1ScanConfig;
  windows: AnalysisWindow[];
  byWindow: WindowExtractResult[];
}> {
  const config: Stage1ScanConfig = {
    windowChars:
      options.config?.windowChars ?? STAGE1_DEFAULT_CONFIG.windowChars,
    overlapChars:
      options.config?.overlapChars ?? STAGE1_DEFAULT_CONFIG.overlapChars,
  };
  const allWindows = buildAnalysisWindows(fullText, config);
  let windows = allWindows;
  if (options.maxWindows != null && options.maxWindows > 0) {
    windows = allWindows.slice(0, options.maxWindows);
  }
  const concurrency = Math.max(1, Math.min(32, options.concurrency ?? 2));

  const byWindow = await mapPool(windows, concurrency, async (window, idx) => {
    // Neighbors from full list so overlap zones stay correct when maxWindows truncates
    const prev = allWindows[window.index - 1] ?? null;
    const next = allWindows[window.index + 1] ?? null;
    try {
      const characters = await extractCharactersInWindow(llm, window, {
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        cwd: options.cwd,
        prev,
        next,
      });
      const result: WindowExtractResult = {
        window: {
          index: window.index,
          label: window.label,
          start: window.start,
          end: window.end,
        },
        characters,
      };
      options.onWindowDone?.(result, idx, windows.length);
      return result;
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      // Log first few failures so production missing-prompt / API issues are visible
      if (idx < 3 || /Missing extract-window prompt/i.test(errMsg)) {
        console.error(
          `[stage1] window ${window.index} extract failed: ${errMsg.slice(0, 240)}`,
        );
      }
      const result: WindowExtractResult = {
        window: {
          index: window.index,
          label: window.label,
          start: window.start,
          end: window.end,
        },
        characters: [],
        error: errMsg,
      };
      options.onWindowDone?.(result, idx, windows.length);
      return result;
    }
  });

  return { config, windows, byWindow };
}
