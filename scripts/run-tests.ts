/**
 * Unified npm test entry for agent-continuation core logic.
 * Run: npm test  →  npx tsx scripts/run-tests.ts
 */
import { resetCounters, summary } from "./lib/test-harness";
import { runProseGuardTests } from "./tests/prose-guard.test";
import { runIntermediateStoreTests } from "./tests/intermediate-store.test";
import { runCriticalMissTests } from "./tests/critical-miss.test";
import { runSaveVerifyTests } from "./tests/save-verify.test";
import { runCommitRealizationTests } from "./tests/commit-realization.test";
import { runAcceptContinuationTests } from "./tests/accept-continuation.test";
import { runTextWindowTests } from "./tests/text-window.test";
import { runBranchCowTests } from "./tests/branch-cow.test";
import { runChapterCatalogTests } from "./tests/chapter-catalog.test";
import { runFormCatalogValidateTests } from "./tests/form-catalog-validate.test";
import { runFormContextTests } from "./tests/form-context.test";
import { runAcceptChapterMetaTests } from "./tests/accept-chapter-meta.test";
import { runTimelineBranchScopeTests } from "./tests/timeline-branch-scope.test";
import { runExportTxtTocTests } from "./tests/export-txt-toc.test";
import { runTitleResolveTests } from "./tests/title-resolve.test";
import { runCharacterCandidatesTests } from "./tests/character-candidates.test";
import { runCharacterNameFrequencyTests } from "./tests/character-name-frequency.test";
import { runAnalysisWiringTests } from "./tests/analysis-wiring.test";
import { runAnalysisCommitTests } from "./tests/analysis-commit.test";
import { runAnalysisForceRefreshFlagTests } from "./tests/analysis-force-refresh-flag.test";
import { runAgentRunTests } from "./tests/agent-run.test";
import { runAgentFrontmatterTests } from "./tests/agent-frontmatter.test";
import { runAgentPromptRenderTests } from "./tests/agent-prompt-render.test";
import { runSharePayloadTests } from "./tests/share-payload.test";
import { runShareStoreTests } from "./tests/share-store.test";
import { runAnalysisParallelReadyTests } from "./tests/analysis-parallel-ready.test";
import { runAutoPassTests } from "./tests/auto-pass.test";
import { runParseToolArgsTests } from "./tests/parse-tool-args.test";
import { runRuntimeSettingsTests } from "./tests/runtime-settings.test";
import { runCharacterAnalysisWindowsTests } from "./tests/character-analysis-windows.test";
import { runCharacterAnalysisMergeTests } from "./tests/character-analysis-merge.test";
import { runCharacterAnalysisCorefTests } from "./tests/character-analysis-coref.test";
import { runNovelCleanerTests } from "./tests/novel-cleaner.test";

async function main() {
  resetCounters();
  console.log("novel-character-sim — agent continuation core tests\n");

  runNovelCleanerTests();
  runCharacterAnalysisWindowsTests();
  runCharacterAnalysisMergeTests();
  await runCharacterAnalysisCorefTests();
  runAgentFrontmatterTests();
  runAgentPromptRenderTests();
  runAnalysisParallelReadyTests();
  runAutoPassTests();
  runParseToolArgsTests();
  runRuntimeSettingsTests();
  runProseGuardTests();
  await runIntermediateStoreTests();
  runCriticalMissTests();
  runSaveVerifyTests();
  runCommitRealizationTests();
  await runAcceptContinuationTests();
  runTextWindowTests();
  runBranchCowTests();
  runChapterCatalogTests();
  runFormCatalogValidateTests();
  runFormContextTests();
  await runAcceptChapterMetaTests();
  runTimelineBranchScopeTests();
  runExportTxtTocTests();
  runTitleResolveTests();
  runCharacterCandidatesTests();
  await runCharacterNameFrequencyTests();
  await runAnalysisWiringTests();
  await runAnalysisCommitTests();
  await runAnalysisForceRefreshFlagTests();
  runAgentRunTests();
  runSharePayloadTests();
  runShareStoreTests();

  const { failed } = summary();
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
