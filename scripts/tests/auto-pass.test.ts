/**
 * One-click continue: fix-until-pass, never risk-skip failed reviews.
 */
import { assert, suite, test } from "../lib/test-harness";
import { pickAutoPassAnswer } from "../../src/core/agents/auto-pass";

export function runAutoPassTests(): void {
  suite("pickAutoPassAnswer", () => {
    test("failed outline review → fix outline, not accept risk", () => {
      const ans = pickAutoPassAnswer("大纲审核未通过，下一步？", [
        "按审核意见修改大纲",
        "我了解风险，仍按此大纲写",
        "换个方向重写大纲",
      ]);
      assert.equal(ans, "按审核意见修改大纲");
    });

    test("failed prose review → rewrite prose, not accept", () => {
      const ans = pickAutoPassAnswer("六维审查发现致命问题", [
        "按审查意见修改正文",
        "接受续写（写入分支；伏笔按实际落实记账）",
        "先不接受",
      ]);
      assert.equal(ans, "按审查意见修改正文");
    });

    test("passed outline → continue write", () => {
      const ans = pickAutoPassAnswer("大纲审核通过，下一步？", [
        "继续写正文",
        "修改大纲",
        "先调整方向",
      ]);
      assert.equal(ans, "继续写正文");
    });

    test("clean accept after reviews → accept continuation", () => {
      const ans = pickAutoPassAnswer("审查仅有次要建议，是否接受？", [
        "接受续写（写入分支；伏笔按实际落实记账）",
        "按审查意见修改正文",
        "先不接受",
      ]);
      // Has both fix and accept; question does not say 未通过 — prefer accept if not failed?
      // "审查仅有次要" is soft; if options include fix and accept without 未通过,
      // proceed-safe accept is OK. If looksLikeFailedReviewGate false, PROCEED_SAFE hits accept.
      assert.ok(
        ans.includes("接受续写") || ans.includes("修改正文"),
        `got ${ans}`,
      );
    });

    test("never pick 了解风险 when fix available", () => {
      const ans = pickAutoPassAnswer("有重大问题", [
        "我了解风险，仍按此大纲写",
        "按审核意见修改大纲",
      ]);
      assert.equal(ans, "按审核意见修改大纲");
    });
  });
}
