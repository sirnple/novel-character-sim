/**
 * acceptContinuation — failure codes + success path with isolated novel ids.
 * Uses shipped acceptContinuation + real SQLite via unique test user/novel.
 */
import { randomUUID } from "node:crypto";
import { assert, suite, test } from "../lib/test-harness";
import {
  acceptContinuation,
  formatAcceptHint,
} from "../../src/core/foreshadowing/accept-continuation";
import {
  _resetStore,
  getProse,
  saveForeshadowRealization,
  saveProse,
} from "../../src/core/agents/intermediate-store";
import {
  deleteNovel,
  getBranch,
  getForeshadowingLedger,
  importNovel,
} from "../../src/lib/db";
import type { ForeshadowingRealization } from "../../src/core/foreshadowing/types";

const DRAFT =
  "雨落在青石板上，发出细碎的声响。顾深把斗笠压低，沿着巷口那盏将灭未灭的灯走去，" +
  "怀中的信纸被雨水洇出一圈淡痕，却仍能辨认出「旧桥」二字。";

export function runAcceptContinuationTests(): void {
  suite("acceptContinuation", () => {
    test("missing novelId → NO_NOVEL", () => {
      const r = acceptContinuation({
        userId: "guest",
        novelId: "",
        branchId: "main",
        content: DRAFT,
      });
      assert.equal(r.ok, false);
      assert.equal(r.code, "NO_NOVEL");
    });

    test("missing / short draft → NO_DRAFT", () => {
      _resetStore();
      const userId = `tu_${randomUUID().slice(0, 8)}`;
      const novelId = `tn_${randomUUID().slice(0, 8)}`;
      try {
        importNovel(userId, novelId, "test-novel", "前文占位。");
        const r = acceptContinuation({
          userId,
          novelId,
          branchId: "main",
          content: "太短",
        });
        assert.equal(r.ok, false);
        assert.equal(r.code, "NO_DRAFT");
      } finally {
        deleteNovel(userId, novelId);
      }
    });

    test("missing non-main branch → NO_BRANCH", () => {
      const userId = `tu_${randomUUID().slice(0, 8)}`;
      const novelId = `tn_${randomUUID().slice(0, 8)}`;
      try {
        importNovel(userId, novelId, "test-novel", "前文。");
        const r = acceptContinuation({
          userId,
          novelId,
          branchId: "no_such_if_branch",
          content: DRAFT,
        });
        assert.equal(r.ok, false);
        assert.equal(r.code, "NO_BRANCH");
      } finally {
        deleteNovel(userId, novelId);
      }
    });

    test("success: appends branch text, commits realized plants, clears store prose", () => {
      _resetStore();
      const userId = `tu_${randomUUID().slice(0, 8)}`;
      const novelId = `tn_${randomUUID().slice(0, 8)}`;
      const baseText = "第一章。晨光穿过薄雾。";
      try {
        importNovel(userId, novelId, "accept-test", baseText);
        saveProse(novelId, "main", DRAFT);

        const realization: ForeshadowingRealization = {
          novelId,
          branchId: "main",
          reviewedAt: new Date().toISOString(),
          pass: true,
          findings: [],
          realized: {
            planted: [
              {
                description: "旧桥三日之约",
                type: "plot",
                importance: "should",
              },
            ],
            advanced: [],
            revealed: [],
            abandoned: [],
          },
          gaps: { planNotRealized: [], realizedNotInPlan: [] },
        };
        saveForeshadowRealization(novelId, "main", realization);

        const beforeLen = (getBranch(userId, novelId, "main")?.text || "").length;
        const r = acceptContinuation({
          userId,
          novelId,
          branchId: "main",
        });

        assert.equal(r.ok, true, r.error || "expected ok");
        assert.ok((r.branchText || "").length > beforeLen, "branch text should grow");
        assert.ok((r.branchText || "").includes("顾深") || (r.branchText || "").includes("旧桥"));
        assert.ok((r.activeCount ?? 0) >= 1, "ledger should plant from realized");
        assert.ok((r.ledgerVersion ?? 0) >= 1);

        // Store prose cleared after accept
        const left = getProse(novelId, "main");
        assert.ok(left === "" || left === undefined, `prose should be cleared, got: ${left}`);

        const ledger = getForeshadowingLedger(userId, novelId, "main");
        assert.ok(
          ledger.active.some((x) => x.description.includes("旧桥")),
          "ledger active should include planted item",
        );

        const hint = formatAcceptHint(r);
        assert.ok(hint.includes("已接受") || hint.includes("接受"));
      } finally {
        _resetStore();
        deleteNovel(userId, novelId);
      }
    });
  });
}
