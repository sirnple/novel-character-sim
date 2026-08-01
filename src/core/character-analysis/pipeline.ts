/**
 * Full character analysis pipeline:
 * Stage① window extract → ② overlap merge → ③ oneshot coref → ④ canonicalName.
 *
 * After pipeline ends, the outer character-list agent may resolve
 * `stage3.uncertainPairs` with co-occur query tools (not a pipeline stage).
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
import {
  formatCharacterPipelineProgress,
  type CharacterPipelineProgressEvent,
} from "./progress";
import { runStage1WindowScan, type Stage1ScanOptions } from "./stage1-scan";
import type {
  AnalysisWindow,
  Stage1ScanConfig,
  WindowExtractResult,
} from "./types";

export interface CharacterAnalysisPipelineOptions {
  stage1?: Stage1ScanOptions;
  stage3Agent?: boolean;
  stage3Concurrency?: number;
  agentContextRadius?: number;
  stage4Llm?: boolean;
  stage4Concurrency?: number;
  maxWindows?: number | null;
  concurrency?: number;
  /** Client F5 / 停止 — stop starting new stage① windows */
  signal?: AbortSignal;
  onStage1Window?: Stage1ScanOptions["onWindowDone"];
  onStage3AgentPair?: Stage3Options["onAgentPair"];
  onProgress?: (msg: string) => void;
  onStageProgress?: (ev: CharacterPipelineProgressEvent) => void;
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
  /** Stage④ canonicalName */
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

  const emitStage = (ev: CharacterPipelineProgressEvent) => {
    options.onStageProgress?.(ev);
    options.onProgress?.(formatCharacterPipelineProgress(ev));
  };

  options.onProgress?.(
    `[pipeline] stage1 window scan concurrency=${concurrency}` +
      (maxWindows != null ? ` maxWindows=${maxWindows}` : ""),
  );
  emitStage({
    stage: 1,
    stageDone: 0,
    stageTotal: 1,
    detail: `准备 concurrency=${concurrency}`,
  });

  // Concurrent windows finish out of order — progress by completed count, not window index.
  let stage1Completed = 0;
  const stage1 = await runStage1WindowScan(fullText, llm, {
    ...options.stage1,
    concurrency,
    maxWindows,
    signal: options.signal ?? options.stage1?.signal,
    onWindowDone: (result, index, total) => {
      const done = ++stage1Completed;
      options.onStage1Window?.(result, index, total);
      emitStage({
        stage: 1,
        stageDone: done,
        stageTotal: total,
        detail: `窗${result.window?.index ?? index} · ${result.characters?.length ?? 0}人`,
      });
    },
  });

  if (options.signal?.aborted) throw new Error("ABORTED");

  emitStage({
    stage: 2,
    stageDone: 0,
    stageTotal: 1,
    detail: "overlap 合并",
  });
  const stage2 = mergeAdjacentWindowCharacters(
    stage1.byWindow,
    stage1.windows,
  );
  emitStage({
    stage: 2,
    stageDone: 1,
    stageTotal: 1,
    detail: `${stage2.characters.length}人`,
  });

  if (options.signal?.aborted) throw new Error("ABORTED");

  const agentOn = options.stage3Agent !== false;
  options.onProgress?.(
    `[pipeline] stage3 oneshot coref n=${stage2.characters.length} agent=${agentOn}`,
  );
  emitStage({
    stage: 3,
    stageDone: 0,
    stageTotal: 1,
    detail: agentOn ? "oneshot 消解" : "仅规则",
  });

  const stage3 = await resolveCorefWithRulesAndAgent(
    stage2.characters,
    stage1.windows,
    {
      llm: agentOn ? llm : null,
      agentConcurrency: options.stage3Concurrency ?? 6,
      fullText,
      agentContextRadius: options.agentContextRadius ?? 200,
      config: {
        agentEnabled: agentOn,
        agentConcurrency: options.stage3Concurrency ?? 6,
      },
      onAgentPair: (info) => {
        options.onStage3AgentPair?.(info);
        // Prefer completed count (concurrent pool); fall back to index+1.
        const done = info.completed ?? info.index + 1;
        emitStage({
          stage: 3,
          stageDone: done,
          stageTotal: info.total,
          detail: `oneshot ${info.idA}~${info.idB}`,
        });
      },
    },
  );

  if (stage3.uncertainPairs?.length) {
    options.onProgress?.(
      `[pipeline] stage3 uncertain pairs=${stage3.uncertainPairs.length} (outer agent may resolve)`,
    );
  }

  if (options.signal?.aborted) throw new Error("ABORTED");

  emitStage({
    stage: 4,
    stageDone: 0,
    stageTotal: Math.max(1, stage3.characters.length),
    detail: "选 canonicalName",
  });
  const useLlm = options.stage4Llm !== false;
  const stage4Chars = useLlm
    ? await applyStage4CanonicalNamesWithLlm(stage3.characters, llm, {
        concurrency: options.stage4Concurrency ?? 8,
        onDone: (i, total, name) => {
          emitStage({
            stage: 4,
            stageDone: i,
            stageTotal: total,
            detail: name,
          });
        },
      })
    : applyStage4CanonicalNames(stage3.characters);

  stage3.characters = stage4Chars;

  emitStage({
    stage: 4,
    stageDone: stage4Chars.length,
    stageTotal: Math.max(1, stage4Chars.length),
    detail: `完成 ${stage4Chars.length}人 · ${Math.round((Date.now() - t0) / 1000)}s`,
  });

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
