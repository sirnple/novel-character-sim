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
import { runFormContextTests } from "./tests/form-context.test";
import { runAcceptChapterMetaTests } from "./tests/accept-chapter-meta.test";

function main() {
  resetCounters();
  console.log("novel-character-sim — agent continuation core tests\n");

  runProseGuardTests();
  runIntermediateStoreTests();
  runCriticalMissTests();
  runSaveVerifyTests();
  runCommitRealizationTests();
  runAcceptContinuationTests();
  runTextWindowTests();
  runBranchCowTests();
  runChapterCatalogTests();
  runFormContextTests();
  runAcceptChapterMetaTests();

  const { failed } = summary();
  if (failed > 0) process.exitCode = 1;
}

main();
