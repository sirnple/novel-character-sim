/**
 * commitRealization pure path — shipped foreshadowing/commit.ts
 */
import { assert, suite, test } from "../lib/test-harness";
import { commitRealization } from "../../src/core/foreshadowing/commit";
import { emptyLedger } from "../../src/core/foreshadowing/types";
import type { ForeshadowingRealization } from "../../src/core/foreshadowing/types";

function baseRealization(
  partial: Partial<ForeshadowingRealization["realized"]> = {},
): ForeshadowingRealization {
  return {
    novelId: "n1",
    branchId: "main",
    reviewedAt: new Date().toISOString(),
    pass: true,
    findings: [],
    realized: {
      planted: partial.planted || [],
      advanced: partial.advanced || [],
      revealed: partial.revealed || [],
      abandoned: partial.abandoned || [],
    },
    gaps: { planNotRealized: [], realizedNotInPlan: [] },
  };
}

export function runCommitRealizationTests(): void {
  suite("commitRealization", () => {
    test("plant adds active items and bumps version", () => {
      const ledger = emptyLedger("u1", "n1", "main");
      const next = commitRealization(
        ledger,
        baseRealization({
          planted: [
            {
              description: "旧桥夜会",
              type: "plot",
              importance: "must",
              mustResolve: true,
            },
          ],
        }),
      );
      assert.equal(next.version, ledger.version + 1);
      assert.equal(next.active.length, 1);
      assert.equal(next.active[0].description, "旧桥夜会");
      assert.equal(next.active[0].status, "pending");
      assert.equal(next.active[0].mustResolve, true);
      assert.ok(next.active[0].id.startsWith("fs_"));
    });

    test("advance marks pending item advancing", () => {
      let ledger = emptyLedger("u1", "n1", "main");
      ledger = commitRealization(
        ledger,
        baseRealization({
          planted: [{ description: "怀表停摆", type: "mystery" }],
        }),
      );
      const id = ledger.active[0].id;
      const advanced = commitRealization(
        ledger,
        baseRealization({
          advanced: [{ id, how: "主角注意到指针不走" }],
        }),
      );
      assert.equal(advanced.active.length, 1);
      assert.equal(advanced.active[0].status, "advancing");
      assert.ok((advanced.active[0].notes || "").includes("指针"));
    });

    test("reveal moves item from active to history", () => {
      let ledger = emptyLedger("u1", "n1", "main");
      ledger = commitRealization(
        ledger,
        baseRealization({
          planted: [{ description: "信封上的蜡印", type: "plot" }],
        }),
      );
      const id = ledger.active[0].id;
      const revealed = commitRealization(
        ledger,
        baseRealization({
          revealed: [{ id, how: "蜡印属于失踪伯爵" }],
        }),
      );
      assert.equal(revealed.active.length, 0);
      assert.equal(revealed.history.length, 1);
      assert.equal(revealed.history[0].status, "revealed");
      assert.equal(revealed.history[0].id, id);
    });

    test("empty planted description is ignored", () => {
      const ledger = emptyLedger("u1", "n1", "main");
      const next = commitRealization(
        ledger,
        baseRealization({ planted: [{ description: "  " }] }),
      );
      assert.equal(next.active.length, 0);
      assert.equal(next.version, ledger.version + 1);
    });
  });
}
