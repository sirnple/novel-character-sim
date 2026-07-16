/**
 * Minimal test harness for agent-continuation pure-logic suites.
 * Failures set process.exitCode = 1 without throwing out of suite.
 */
import assert from "node:assert/strict";

export { assert };

let failed = 0;
let passed = 0;

export function test(name: string, fn: () => void | Promise<void>): void {
  // Sync-friendly wrapper; async suites await via runSuite
  const run = () => {
    console.log(`[test] ${name}...`);
    try {
      const ret = fn();
      if (ret && typeof (ret as Promise<void>).then === "function") {
        throw new Error(
          `Async test "${name}" must be registered with testAsync or run inside runSuite async`,
        );
      }
      console.log("  ✓");
      passed++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  ✗ FAILED: ${msg}`);
      failed++;
      process.exitCode = 1;
    }
  };
  run();
}

export async function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`[test] ${name}...`);
  try {
    await fn();
    console.log("  ✓");
    passed++;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  ✗ FAILED: ${msg}`);
    failed++;
    process.exitCode = 1;
  }
}

export function suite(title: string, fn: () => void): void {
  console.log(`\n== ${title} ==`);
  fn();
}

export async function suiteAsync(title: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n== ${title} ==`);
  await fn();
}

export function summary(): { passed: number; failed: number } {
  console.log(
    failed
      ? `\nSome tests FAILED ✗ (${passed} passed, ${failed} failed)`
      : `\nAll tests passed ✓ (${passed} passed)`,
  );
  return { passed, failed };
}

export function resetCounters(): void {
  failed = 0;
  passed = 0;
}
