/**
 * Stage ②: locate + pairwise hierarchical merge in overlap (no network).
 */
import { assert, suite, test } from "../lib/test-harness";
import {
  canMergeInOverlap,
  mergeAdjacentWindowCharacters,
  mergeSegmentPair,
  sharedSurfacesInOverlap,
  type MergedCharacter,
  type Segment,
} from "../../src/core/character-analysis/merge-adjacent";
import { locateCharactersInWindow } from "../../src/core/character-analysis/locate-mentions";
import type {
  AnalysisWindow,
  WindowExtractResult,
} from "../../src/core/character-analysis/types";

export function runCharacterAnalysisMergeTests(): void {
  suite("character-analysis stage2 pairwise overlap merge", () => {
    test("locate surface in window → global offset", () => {
      const w: AnalysisWindow = {
        index: 0,
        label: "窗1",
        start: 100,
        end: 120,
        text: "他说王明来了",
      };
      const located = locateCharactersInWindow(
        [
          {
            mentions: [{ surface: "王明", textAnchor: "说王明来了" }],
          },
        ],
        w,
      );
      assert.equal(located.length, 1);
      const m = located[0]!.mentions[0]!;
      assert.equal(m.offsetAnchor.globalStart, 100 + w.text.indexOf("王明"));
      assert.ok(m.offsetAnchor.globalEnd > m.offsetAnchor.globalStart);
    });

    test("identical mention in overlap = same surface AND same offset", () => {
      const oa = (id: string, g: number): MergedCharacter => ({
        id,
        windowLo: 0,
        windowHi: 0,
        mentions: [
          {
            surface: "甲",
            textAnchor: "甲",
            offsetAnchor: {
              localStart: 0,
              localEnd: 1,
              globalStart: g,
              globalEnd: g + 1,
            },
          },
        ],
      });
      const overlap = { start: 80, end: 100 };
      // same surface + same offset in overlap → match
      const hit = sharedSurfacesInOverlap(oa("a", 85), oa("b", 85), overlap);
      assert.equal(hit.length, 1);
      assert.ok(hit[0]!.startsWith("甲@85"));
      // same surface, different offset (both in overlap) → NO match
      assert.deepEqual(
        sharedSurfacesInOverlap(oa("a", 85), oa("b", 90), overlap),
        [],
      );
      // outside overlap → NO match even if offsets equal
      assert.deepEqual(
        sharedSurfacesInOverlap(oa("a", 10), oa("b", 10), overlap),
        [],
      );
    });

    test("hierarchical merge 4 windows with real offsets", () => {
      // F indices: 0-5 X, 6甲 7乙 8-11 Y, 12乙 13丙 14丙 15Q 16-19 W...
      const F = "XXXXXX甲乙YYYY乙丙丙QWWWW";
      const W: AnalysisWindow[] = [
        { index: 0, label: "窗1", start: 0, end: 12, text: F.slice(0, 12) },
        { index: 1, label: "窗2", start: 6, end: 18, text: F.slice(6, 18) },
        { index: 2, label: "窗3", start: 12, end: 20, text: F.slice(12, 20) },
        { index: 3, label: "窗4", start: 14, end: 22, text: F.slice(14, 22) },
      ];
      // ov 0-1 [6,12) 甲乙YYYY
      // ov 1-2 [12,18) 乙丙丙QWW
      // ov 2-3 [14,20) 丙丙QWWW

      const BW: WindowExtractResult[] = [
        {
          window: { index: 0, label: "窗1", start: 0, end: 12 },
          characters: [
            { mentions: [{ surface: "甲", textAnchor: "甲" }] },
            { mentions: [{ surface: "乙", textAnchor: "乙" }] },
          ],
        },
        {
          window: { index: 1, label: "窗2", start: 6, end: 18 },
          characters: [
            { mentions: [{ surface: "甲", textAnchor: "甲" }] },
            { mentions: [{ surface: "乙", textAnchor: "乙" }] },
            { mentions: [{ surface: "丙", textAnchor: "丙" }] },
          ],
        },
        {
          window: { index: 2, label: "窗3", start: 12, end: 20 },
          characters: [
            { mentions: [{ surface: "乙", textAnchor: "乙" }] },
            { mentions: [{ surface: "丙", textAnchor: "丙" }] },
          ],
        },
        {
          window: { index: 3, label: "窗4", start: 14, end: 22 },
          characters: [
            { mentions: [{ surface: "丙", textAnchor: "丙" }] },
          ],
        },
      ];

      const { characters, traces } = mergeAdjacentWindowCharacters(BW, W);
      const surfaces = characters.map((c) =>
        Array.from(new Set(c.mentions.map((m) => m.surface)))
          .sort()
          .join("/"),
      );
      assert.ok(
        characters.length >= 3,
        `got ${characters.length}: ${surfaces.join(" | ")}`,
      );
      assert.ok(surfaces.some((s) => s.includes("甲")));
      assert.ok(surfaces.some((s) => s.includes("乙")));
      assert.ok(surfaces.some((s) => s.includes("丙")));
      // 4 windows → 2 pair merges + 1 final = 3 traces
      assert.equal(traces.length, 3);
    });

    test("no merge when shared surface is outside overlap", () => {
      const left: MergedCharacter = {
        id: "L",
        windowLo: 0,
        windowHi: 0,
        mentions: [
          {
            surface: "甲",
            textAnchor: "甲",
            offsetAnchor: {
              localStart: 0,
              localEnd: 1,
              globalStart: 1,
              globalEnd: 2,
            },
          },
        ],
      };
      const right: MergedCharacter = {
        id: "R",
        windowLo: 1,
        windowHi: 1,
        mentions: [
          {
            surface: "甲",
            textAnchor: "甲",
            offsetAnchor: {
              localStart: 0,
              localEnd: 1,
              globalStart: 50,
              globalEnd: 51,
            },
          },
        ],
      };
      assert.equal(
        canMergeInOverlap(left, right, { start: 80, end: 100 }).ok,
        false,
      );

      const windows: AnalysisWindow[] = [
        { index: 0, label: "窗1", start: 0, end: 90, text: "x".repeat(90) },
        { index: 1, label: "窗2", start: 80, end: 170, text: "y".repeat(90) },
      ];
      const { segment, trace } = mergeSegmentPair(
        { characters: [left], windowLo: 0, windowHi: 0 },
        { characters: [right], windowLo: 1, windowHi: 1 },
        windows,
        { n: 0 },
      );
      assert.equal(trace.merges.length, 0);
      assert.equal(segment.characters.length, 2);
    });
  });
}
