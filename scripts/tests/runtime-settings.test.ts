/**
 * Runtime settings + mention-scan resolve (privileged concurrency ~20, admin batch 1).
 */
import { assert, suite, test } from "../lib/test-harness";
import {
  envRuntimeSettings,
  getRuntimeSettings,
  patchRuntimeSettings,
  resetRuntimeSettings,
  resolveMentionScanOptions,
  MENTION_SCAN_BATCH_UNITS_DEFAULT,
  MENTION_SCAN_CONCURRENCY_DEFAULT,
  MENTION_SCAN_PRIVILEGED_CONCURRENCY_DEFAULT,
} from "../../src/lib/runtime-settings";
import { packUnitsForMentionScan } from "../../src/core/extractor/character-name-units";
import type { TextUnit } from "../../src/core/extractor/character-name-units";

function fakeUnits(n: number, chars = 100): TextUnit[] {
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    label: `u${i}`,
    start: i * chars,
    end: (i + 1) * chars,
    text: "字".repeat(chars),
  }));
}

export function runRuntimeSettingsTests(): void {
  suite("runtime-settings", () => {
    test("defaults: batch units 4, concurrency 4, privileged 20", () => {
      resetRuntimeSettings();
      const env = envRuntimeSettings();
      assert.equal(env.mentionScanBatchUnits, MENTION_SCAN_BATCH_UNITS_DEFAULT);
      assert.equal(env.mentionScanConcurrency, MENTION_SCAN_CONCURRENCY_DEFAULT);
      assert.equal(
        env.privilegedMentionScanConcurrency,
        MENTION_SCAN_PRIVILEGED_CONCURRENCY_DEFAULT,
      );
      assert.equal(MENTION_SCAN_BATCH_UNITS_DEFAULT, 4);
      assert.equal(MENTION_SCAN_PRIVILEGED_CONCURRENCY_DEFAULT, 20);
    });

    test("resolve: normal user uses base batch/concurrency", () => {
      resetRuntimeSettings();
      const r = resolveMentionScanOptions({
        isAdmin: false,
        isDebug: false,
      });
      assert.equal(r.mode, "user");
      assert.equal(r.batchUnits, 4);
      assert.equal(r.concurrency, 4);
      assert.equal(r.privilegedConcurrency, false);
    });

    test("resolve: admin concurrency 20 + batch 1 (not uncapped)", () => {
      resetRuntimeSettings();
      const r = resolveMentionScanOptions({
        isAdmin: true,
        isDebug: false,
      });
      assert.equal(r.mode, "admin");
      assert.equal(r.batchUnits, 1);
      assert.equal(r.concurrency, 20);
      assert.equal(r.privilegedConcurrency, true);
    });

    test("resolve: debug concurrency 20, keeps user batch units", () => {
      resetRuntimeSettings();
      const r = resolveMentionScanOptions({
        isAdmin: false,
        isDebug: true,
      });
      assert.equal(r.mode, "debug");
      assert.equal(r.batchUnits, 4);
      assert.equal(r.concurrency, 20);
      assert.equal(r.privilegedConcurrency, true);
    });

    test("patchRuntimeSettings overrides effective values", () => {
      resetRuntimeSettings();
      patchRuntimeSettings({
        mentionScanBatchUnits: 2,
        mentionScanConcurrency: 8,
        privilegedMentionScanConcurrency: 12,
      });
      const user = resolveMentionScanOptions({ isAdmin: false, isDebug: false });
      assert.equal(user.batchUnits, 2);
      assert.equal(user.concurrency, 8);
      const admin = resolveMentionScanOptions({ isAdmin: true, isDebug: false });
      assert.equal(admin.concurrency, 12);
      resetRuntimeSettings();
    });

    test("packUnitsForMentionScan respects maxUnits", () => {
      const units = fakeUnits(8, 50);
      const batches = packUnitsForMentionScan(units, {
        maxChars: 100_000,
        maxUnits: 4,
      });
      assert.ok(batches.every((b) => b.length <= 4));
      assert.equal(
        batches.reduce((n, b) => n + b.length, 0),
        8,
      );
    });

    test("getRuntimeSettings merges patch", () => {
      resetRuntimeSettings();
      patchRuntimeSettings({ adminMentionScanBatchUnits: 1 });
      assert.equal(getRuntimeSettings().adminMentionScanBatchUnits, 1);
      resetRuntimeSettings();
    });
  });
}
