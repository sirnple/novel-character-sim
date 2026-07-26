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
      // label 与 index 一致、从 0 起
      assert.equal(wins[0]!.index, 0);
      assert.equal(wins[0]!.label, "窗0");
      assert.equal(wins[1]!.label, "窗1");
      for (const w of wins) assert.equal(w.label, `窗${w.index}`);
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
      // first window: no prefix, has suffix + middle
      const body0 = formatWindowBodyForPrompt(wins[0]!, null, wins[1]);
      assert.ok(body0.includes("后重叠区"));
      assert.ok(body0.includes("主体"));
      assert.ok(!body0.includes("前重叠区"));
      // middle window: prefix (no deictic) + middle + suffix
      const body1 = formatWindowBodyForPrompt(wins[1]!, wins[0], wins[2]);
      assert.ok(body1.includes("前重叠区"));
      assert.ok(body1.includes("后重叠区"));
      assert.ok(body1.includes("默认不收单数你/他"));
      assert.ok(body1.includes("仅在能明确绑定"));
    });

    test("normalize array wire", () => {
      const chars = charactersFromLlmWire([
        {
          mentions: [
            { surface: "王明", textAnchor: "只见王明走来", kind: "proper" },
            { surface: "他", textAnchor: "他冷笑道", kind: "deictic" },
            { surface: "这小子", textAnchor: "这小子真行", kind: "proper" },
          ],
          gender: "男",
        },
      ]);
      assert.equal(chars.length, 1);
      assert.equal(chars[0]!.mentions.length, 3);
      assert.equal(chars[0]!.mentions[0]!.surface, "王明");
      assert.equal(chars[0]!.mentions[0]!.kind, "proper");
      assert.equal(chars[0]!.mentions[1]!.kind, "deictic");
      // rule override: LLM said proper on 这小子 → still generic
      assert.equal(chars[0]!.mentions[2]!.kind, "generic");
    });

    test("normalize wrapped + name fallback", () => {
      const chars = charactersFromLlmWire({
        characters: [{ name: "李华", textAnchor: "李华说" }],
      });
      assert.equal(chars.length, 1);
      assert.equal(chars[0]!.mentions[0]!.surface, "李华");
      assert.equal(chars[0]!.mentions[0]!.kind, "proper");
    });
  });
}
