/**
 * Review pass gate: critical/major + too many minors (AI stricter).
 */
import { assert, suite, test } from "../lib/test-harness";
import {
  evaluateReviewPass,
  formatReviewPassLine,
  outlineReviewFailedFromFindings,
  REVIEW_MAX_MINOR_AI_TASTE,
  REVIEW_MAX_MINOR_TOTAL,
} from "../../src/core/agents/review-pass";

export function runReviewPassTests(): void {
  suite("evaluateReviewPass", () => {
    test("empty findings pass", () => {
      const v = evaluateReviewPass([]);
      assert.equal(v.pass, true);
      assert.ok(formatReviewPassLine(v).includes("通过"));
    });

    test("any critical fails", () => {
      const v = evaluateReviewPass([
        { severity: "critical", dimension: "continuity", description: "x" },
      ]);
      assert.equal(v.pass, false);
      assert.ok(v.reasons.some((r) => /critical/i.test(r)));
    });

    test("any major fails", () => {
      const v = evaluateReviewPass([
        { severity: "major", dimension: "character", description: "x" },
      ]);
      assert.equal(v.pass, false);
    });

    test("few minors pass", () => {
      const v = evaluateReviewPass([
        { severity: "minor", dimension: "style" },
        { severity: "minor", dimension: "pacing" },
      ]);
      assert.equal(v.pass, true);
    });

    test("too many minors overall fail", () => {
      const findings = Array.from({ length: REVIEW_MAX_MINOR_TOTAL + 1 }, (_, i) => ({
        severity: "minor",
        dimension: i % 2 === 0 ? "style" : "pacing",
      }));
      const v = evaluateReviewPass(findings);
      assert.equal(v.pass, false);
      assert.ok(v.reasons.some((r) => /次要问题过多/.test(r)));
    });

    test("AI taste minors over limit fail even if total minors low", () => {
      const findings = Array.from(
        { length: REVIEW_MAX_MINOR_AI_TASTE + 1 },
        () => ({
          severity: "minor",
          dimension: "ai_taste",
        }),
      );
      const v = evaluateReviewPass(findings);
      assert.equal(v.pass, false);
      assert.ok(v.reasons.some((r) => /AI痕迹/.test(r)));
      assert.equal(v.counts.aiTasteMinor, REVIEW_MAX_MINOR_AI_TASTE + 1);
    });

    test("outlineReviewFailedFromFindings matches evaluate", () => {
      assert.equal(outlineReviewFailedFromFindings([]), false);
      assert.equal(
        outlineReviewFailedFromFindings([
          { severity: "minor", dimension: "outline" },
        ]),
        false,
      );
      assert.equal(
        outlineReviewFailedFromFindings([
          { severity: "major", dimension: "outline" },
        ]),
        true,
      );
    });
  });
}
