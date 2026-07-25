/**
 * Stage ① window split + LLM wire normalize (no network).
 */
import { assert, suite, test } from "../lib/test-harness";
import {
  buildAnalysisWindows,
  splitWindowByOverlap,
} from "../../src/core/character-analysis/windows";
import { formatWindowBodyForPrompt } from "../../src/core/character-analysis/prompt";
import { charactersFromLlmWire } from "../../src/core/character-analysis/normalize";

export function runCharacterAnalysisWindowsTests(): void {
  suite("character-analysis stage1 windows", () => {
    test("overlap windows step = window - overlap", () => {
      const text = "a".repeat(10_000);
      const wins = buildAnalysisWindows(text, {
        windowChars: 2000,
        overlapChars: 400,
      });
      assert.ok(wins.length >= 5);
      assert.equal(wins[0]!.start, 0);
      assert.equal(wins[0]!.text.length, 2000);
      assert.equal(wins[1]!.start, 1600);
      assert.equal(wins[0]!.end - wins[1]!.start, 400);
    });

    test("splitWindowByOverlap marks head/tail for middle window", () => {
      const text = "a".repeat(10_000);
      const wins = buildAnalysisWindows(text, {
        windowChars: 2000,
        overlapChars: 400,
      });
      const mid = wins[1]!;
      const { prefixOverlap, middle, suffixOverlap, hasAnyOverlap } =
        splitWindowByOverlap(mid, wins[0], wins[2]);
      assert.equal(hasAnyOverlap, true);
      assert.equal(prefixOverlap.length, 400);
      assert.equal(suffixOverlap.length, 400);
      assert.equal(
        prefixOverlap.length + middle.length + suffixOverlap.length,
        mid.text.length,
      );
    });

    test("formatWindowBody labels overlap zones", () => {
      const text = "a".repeat(5000);
      const wins = buildAnalysisWindows(text, {
        windowChars: 2000,
        overlapChars: 400,
      });
      const body = formatWindowBodyForPrompt(wins[0]!, null, wins[1]);
      assert.ok(body.includes("重叠区"));
      assert.ok(body.includes("主体"));
    });

    test("normalize array wire", () => {
      const chars = charactersFromLlmWire([
        {
          mentions: [
            { surface: "王明", textAnchor: "只见王明走来" },
            { surface: "他", textAnchor: "他冷笑道" },
          ],
          gender: "男",
        },
      ]);
      assert.equal(chars.length, 1);
      assert.equal(chars[0]!.mentions.length, 2);
      assert.equal(chars[0]!.mentions[0]!.surface, "王明");
    });

    test("normalize wrapped + name fallback", () => {
      const chars = charactersFromLlmWire({
        characters: [{ name: "李华", textAnchor: "李华说" }],
      });
      assert.equal(chars.length, 1);
      assert.equal(chars[0]!.mentions[0]!.surface, "李华");
    });
  });
}
