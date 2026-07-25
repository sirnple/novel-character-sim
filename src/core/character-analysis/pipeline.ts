/**
 * Full character analysis pipeline:
 * Stage① window extract → ② overlap merge → ③ coref → ④ canonicalName.
 * Used by analysis agent `scan_character_mentions` and eval scripts.
 */

import type { LLMProvider } from "@/types";
import { mergeAdjacentWindowCharacters } from "./merge-adjacent";
import type { MergedCharacter, PairMergeTrace } from "./merge-adjacent";
import {
  resolveCorefWithRulesAndAgent,
  type Stage3Options,
  type Stage3ResolveResult,
} from "./coref";
import {
  applyStage4CanonicalNames,
  applyStage4CanonicalNamesWithLlm,
} from "./stage4-canonical";
import { runStage1WindowScan, type Stage1ScanOptions } from "./stage1-scan";
import type {
  AnalysisWindow,
  Stage1ScanConfig,
  WindowExtractResult,
} from "./types";

export interface CharacterAnalysisPipelineOptions {
  stage1?: Stage1ScanOptions;
  /** Stage3 agent on (default true). */
  stage3Agent?: boolean;
  stage3Concurrency?: number;
  agentContextRadius?: number;
  /**
   * Stage4: use LLM tie-break when top surfaces are close (default true when llm present).
   */
  stage4Llm?: boolean;
  stage4Concurrency?: number;
  maxWindows?: number | null;
  concurrency?: number;
  onStage1Window?: Stage1ScanOptions["onWindowDone"];
  onStage3AgentPair?: Stage3Options["onAgentPair"];
  onProgress?: (msg: string) => void;
}

export interface CharacterAnalysisPipelineResult {
  config: Stage1ScanConfig;
  windows: AnalysisWindow[];
  byWindow: WindowExtractResult[];
  stage2: {
    characters: MergedCharacter[];
    traces: PairMergeTrace[];
  };
  stage3: Stage3ResolveResult;
  /** Stage3 characters after stage4 canonicalName assignment */
  stage4: {
    characters: MergedCharacter[];
  };
  elapsedMs: number;
}

/**
 * Run stages ①→②→③→④ on full novel text.
 */
export async function runCharacterAnalysisPipeline(
  fullText: string,
  llm: LLMProvider,
  options: CharacterAnalysisPipelineOptions = {},
): Promise<CharacterAnalysisPipelineResult> {
  const t0 = Date.now();
  const concurrency = options.concurrency ?? options.stage1?.concurrency ?? 4;
  const maxWindows =
    options.maxWindows ?? options.stage1?.maxWindows ?? null;

  options.onProgress?.(
    `[pipeline] stage1 window scan concurrency=${concurrency}` +
      (maxWindows != null ? ` maxWindows=${maxWindows}` : ""),
  );

  const stage1 = await runStage1WindowScan(fullText, llm, {
    ...options.stage1,
    concurrency,
    maxWindows,
    onWindowDone: options.onStage1Window ?? options.stage1?.onWindowDone,
  });

  options.onProgress?.(
    `[pipeline] stage2 pairwise merge windows=${stage1.windows.length}`,
  );
  const stage2 = mergeAdjacentWindowCharacters(
    stage1.byWindow,
    stage1.windows,
  );

  options.onProgress?.(
    `[pipeline] stage3 coref input=${stage2.characters.length} agent=${
      options.stage3Agent !== false
    }`,
  );
  const stage3Concurrency = Math.max(
    1,
    Math.min(32, options.stage3Concurrency ?? concurrency),
  );
  const stage3 = await resolveCorefWithRulesAndAgent(
    stage2.characters,
    stage1.windows,
    {
      llm: options.stage3Agent === false ? null : llm,
      fullText,
      agentConcurrency: stage3Concurrency,
      agentContextRadius: options.agentContextRadius ?? 220,
      config: {
        agentEnabled: options.stage3Agent !== false,
        agentConcurrency: stage3Concurrency,
      },
      onAgentPair: options.onStage3AgentPair,
    },
  );

  options.onProgress?.(
    `[pipeline] stage4 canonicalName n=${stage3.characters.length}`,
  );
  const useLlm = options.stage4Llm !== false;
  const stage4Chars = useLlm
    ? await applyStage4CanonicalNamesWithLlm(stage3.characters, llm, {
        concurrency: options.stage4Concurrency ?? 8,
        onDone: (i, total, name) => {
          if (i === total || i % 5 === 0) {
            options.onProgress?.(
              `[pipeline] stage4 ${i}/${total} e.g. ${name}`,
            );
          }
        },
      })
    : applyStage4CanonicalNames(stage3.characters);

  // Keep stage3.characters in sync with canonical names for consumers
  stage3.characters = stage4Chars;

  options.onProgress?.(
    `[pipeline] done stage2=${stage2.characters.length} → stage3/4=${stage4Chars.length} ` +
      `(${Math.round((Date.now() - t0) / 1000)}s)`,
  );

  return {
    config: stage1.config,
    windows: stage1.windows,
    byWindow: stage1.byWindow,
    stage2: {
      characters: stage2.characters,
      traces: stage2.traces,
    },
    stage3,
    stage4: { characters: stage4Chars },
    elapsedMs: Date.now() - t0,
  };
}
