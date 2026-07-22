/**
 * Stage ① overlap windows + stage ② criterion A merge
 */
import assert from "node:assert/strict";
import {
  buildOverlapScanUnits,
  overlapTextBetweenUnits,
  DEFAULT_OVERLAP_CHARS,
} from "../../src/core/extractor/character-name-units";
import {
  criterionASharedMentionInOverlap,
  mergeLocalEntitiesByOverlap,
  mentionSetOf,
} from "../../src/core/extractor/character-overlap-merge";
import type { UnitNameHit } from "../../src/core/extractor/character-name-aggregate";
import type { TextUnit } from "../../src/core/extractor/character-name-units";

// --- overlap windows adjacent share text ---
{
  const body = "甲".repeat(1000) + "唐兰嫣在此。" + "乙".repeat(1000) + "战女王出击。";
  // force small windows
  const units = buildOverlapScanUnits(body, {
    windowChars: 1200,
    overlapChars: 200,
  });
  assert.ok(units.length >= 2, `units=${units.length}`);
  for (let i = 0; i < units.length - 1; i++) {
    const O = overlapTextBetweenUnits(body, units[i], units[i + 1]);
    assert.ok(
      O.length > 0,
      `overlap empty between ${i} and ${i + 1}`,
    );
    // O should equal fullText[next.start, prev.end)
    assert.equal(O, body.slice(units[i + 1].start, units[i].end));
  }
  assert.ok(DEFAULT_OVERLAP_CHARS > 0);
}

// --- criterion A ---
{
  const O = "……唐兰嫣说完，战女王也点头……";
  const hit = criterionASharedMentionInOverlap(
    "唐兰嫣",
    [],
    "战女王",
    ["唐兰嫣"],
    O,
  );
  assert.ok(hit.ok);
  assert.equal(hit.shared, "唐兰嫣");

  const miss = criterionASharedMentionInOverlap(
    "唐兰嫣",
    [],
    "战女王",
    ["唐兰嫣"],
    "这里只有别人的名字",
  );
  assert.ok(!miss.ok);
}

// --- merge chain: W0 唐兰嫣, W1 战女王+alias 唐兰嫣 in overlap ---
{
  const full =
    "前文填充字".repeat(50) +
    "唐兰嫣站在桥上。" +
    "中间填充字".repeat(30) +
    "唐兰嫣与战女王同框。" + // will sit in overlap if windows align
    "后文填充字".repeat(50) +
    "战女王离去。";

  // Manual two units with explicit overlap containing 唐兰嫣
  const mid = full.indexOf("唐兰嫣与战女王");
  assert.ok(mid > 0);
  const units: TextUnit[] = [
    {
      index: 0,
      label: "窗1",
      start: 0,
      end: mid + 20,
      text: full.slice(0, mid + 20),
    },
    {
      index: 1,
      label: "窗2",
      start: mid,
      end: full.length,
      text: full.slice(mid),
    },
  ];
  const O = overlapTextBetweenUnits(full, units[0], units[1]);
  assert.ok(O.includes("唐兰嫣"), O);

  const unitHits: UnitNameHit[][] = [
    [{ name: "唐兰嫣", aliases: [], count: 1 }],
    [{ name: "战女王", aliases: ["唐兰嫣"], count: 1 }],
  ];
  const merged = mergeLocalEntitiesByOverlap(units, unitHits, full);
  assert.equal(merged.length, 1, JSON.stringify(merged));
  assert.ok(
    merged[0].name === "唐兰嫣" ||
      (merged[0].aliases || []).includes("唐兰嫣"),
  );
  assert.ok(
    merged[0].name === "战女王" ||
      (merged[0].aliases || []).includes("战女王"),
  );
}

// --- no merge when shared mention not in overlap text ---
{
  const full = "AAAA唐兰嫣BBBB" + "XXXX" + "YYYY战女王ZZZZ";
  const units: TextUnit[] = [
    { index: 0, label: "a", start: 0, end: 12, text: full.slice(0, 12) },
    {
      index: 1,
      label: "b",
      start: 16,
      end: full.length,
      text: full.slice(16),
    },
  ];
  // no overlap range
  assert.equal(overlapTextBetweenUnits(full, units[0], units[1]), "");
  const unitHits: UnitNameHit[][] = [
    [{ name: "唐兰嫣", aliases: ["战女王"], count: 1 }],
    [{ name: "战女王", aliases: [], count: 1 }],
  ];
  const merged = mergeLocalEntitiesByOverlap(units, unitHits, full);
  assert.equal(merged.length, 2);
}

// --- mention set ---
{
  const s = mentionSetOf("唐兰嫣", ["战女王", "唐兰嫣"]);
  assert.ok(s.has("唐兰嫣"));
  assert.ok(s.has("战女王"));
  assert.equal(s.size, 2);
}

console.log("character-overlap-merge.test.ts OK");
