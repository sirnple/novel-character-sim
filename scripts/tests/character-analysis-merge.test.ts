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
import {
  findSpan,
  indexOfAllowingNewlines,
  indexOfFuzzy,
  locateCharactersInWindow,
  locateMentionInWindow,
  pickSurfaceByAnchorOverlap,
} from "../../src/core/character-analysis/locate-mentions";
import type {
  AnalysisWindow,
  WindowExtractResult,
} from "../../src/core/character-analysis/types";

export function runCharacterAnalysisMergeTests(): void {
  suite("character-analysis stage2 pairwise overlap merge", () => {
    test("locate: textAnchor first, then surface inside → global offset", () => {
      const w: AnalysisWindow = {
        index: 0,
        label: "窗0",
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
      assert.equal(
        m.offsetAnchor.globalEnd,
        m.offsetAnchor.globalStart + "王明".length,
      );
    });

    test("locate: textAnchor without newlines still hits body with CR/LF", () => {
      // Novel often has blank lines; LLM textAnchor is usually one line
      const body =
        "你是说许老师是你后妈？\r\n\r\n许栀不是家教老师\r\n\r\n先让她跟我熟悉";
      const w: AnalysisWindow = {
        index: 0,
        label: "w",
        start: 500,
        end: 500 + body.length,
        text: body,
      };
      // LLM-style anchors: no newlines
      const m1 = locateMentionInWindow(
        {
          surface: "许栀",
          textAnchor: "许栀不是家教老师",
        },
        w,
        0,
      );
      assert.ok(m1, "should find 许栀 across surrounding newlines");
      assert.equal(
        m1!.offsetAnchor.globalStart,
        500 + body.indexOf("许栀"),
      );
      assert.equal(
        m1!.offsetAnchor.globalEnd - m1!.offsetAnchor.globalStart,
        "许栀".length,
      );

      const m2 = locateMentionInWindow(
        {
          surface: "她",
          textAnchor: "先让她跟我熟悉",
        },
        w,
        0,
      );
      assert.ok(m2);
      assert.equal(m2!.offsetAnchor.globalStart, 500 + body.indexOf("她"));

      // textAnchor itself spans a newline in body
      const m3 = locateMentionInWindow(
        {
          surface: "后妈",
          textAnchor: "你是说许老师是你后妈？许栀不是家教老师",
        },
        w,
        0,
      );
      assert.ok(m3, "anchor chars match across CRLF gaps");
      assert.equal(m3!.offsetAnchor.globalStart, 500 + body.indexOf("后妈"));

      // helper: span includes skipped newlines
      const hit = indexOfAllowingNewlines(
        "说你\n很好",
        "说你很好",
        0,
      );
      assert.ok(hit);
      assert.equal(hit!.start, 0);
      assert.equal(hit!.end, "说你\n很好".length);
    });

    test("locate: fuzzy textAnchor + surface overlap (not first 阿龙)", () => {
      // Real bug: LLM drops chars; first 阿龙 is comparison, real is wechat line
      const body =
        "秦予嫣连阿龙看她一眼都嫌恶心。\n" +
        "周屿连声答应，立刻拿出手机给阿龙发了条微信。";
      const w: AnalysisWindow = {
        index: 15,
        label: "w15",
        start: 78000,
        end: 78000 + body.length,
        text: body,
      };
      // LLM textAnchor missing「连声答应，」
      const anchor = "周屿立刻拿出手机给阿龙发了条微信";
      const fuzzy = indexOfFuzzy(body, anchor, 0);
      assert.ok(fuzzy, "fuzzy should hit wechat sentence");
      assert.ok(
        body.slice(fuzzy!.start, fuzzy!.end).includes("给阿龙发"),
        body.slice(fuzzy!.start, fuzzy!.end),
      );

      const span = findSpan(body, anchor, 0);
      assert.ok(span);
      assert.equal(span!.mode, "fuzzy");

      const hit = locateMentionInWindow(
        { surface: "阿龙", textAnchor: anchor, kind: "proper" },
        w,
        0,
      );
      assert.ok(hit);
      // Must NOT be the first 阿龙 (连阿龙看)
      const first = body.indexOf("阿龙");
      const wechat = body.indexOf("给阿龙发");
      assert.ok(wechat > first);
      assert.equal(
        hit!.offsetAnchor.localStart,
        wechat + "给".length, // 阿龙 inside 给阿龙发
      );
      assert.ok(hit!.offsetAnchor.localStart !== first);

      // surface_overlap path when anchor is totally wrong but surface appears twice
      const pick = pickSurfaceByAnchorOverlap(
        body,
        "阿龙",
        "立刻拿出手机给阿龙发了条微信",
        0,
      );
      assert.ok(pick);
      assert.equal(pick!.start, wechat + "给".length);
    });

    test("locate: legacy fallbacks when surface missing or anchor miss", () => {
      const w: AnalysisWindow = {
        index: 0,
        label: "窗0",
        start: 0,
        end: 20,
        text: "周屿说你很好。许栀看",
      };
      // surface 他 not in textAnchor → whole anchor span (legacy)
      const badSurface = locateMentionInWindow(
        { surface: "他", textAnchor: "周屿说你很好" },
        w,
        0,
      );
      assert.ok(badSurface);
      assert.equal(badSurface!.offsetAnchor.localStart, 0);
      assert.equal(
        badSurface!.offsetAnchor.localEnd,
        "周屿说你很好".length,
      );

      // textAnchor garbage → surface_overlap / surface hit on 许栀
      const bare = locateMentionInWindow(
        { surface: "许栀", textAnchor: "这段锚点根本不存在xxx" },
        w,
        0,
      );
      assert.ok(bare);
      assert.equal(bare!.offsetAnchor.localStart, w.text.indexOf("许栀"));

      // distinct textAnchors → distinct 你 offsets
      const bothYou = locateCharactersInWindow(
        [
          {
            mentions: [{ surface: "你", textAnchor: "说你很好" }],
          },
          {
            mentions: [{ surface: "你", textAnchor: "看你一眼" }],
          },
        ],
        {
          index: 0,
          label: "w",
          start: 1000,
          end: 1030,
          text: "周屿说你很好。许栀看你一眼。",
        },
      );
      assert.equal(bothYou.length, 2);
      const g0 = bothYou[0]!.mentions[0]!.offsetAnchor.globalStart;
      const g1 = bothYou[1]!.mentions[0]!.offsetAnchor.globalStart;
      assert.ok(g0 !== g1, `you offsets must differ: ${g0} vs ${g1}`);
      assert.equal(g0, 1000 + "周屿说".length);
      assert.equal(g1, 1000 + "周屿说你很好。许栀看".length);
    });

    test("identical mention in overlap = same surface AND same offset", () => {
      const oa = (
        id: string,
        g: number,
        surface = "甲",
        kind?: "proper" | "deictic",
      ): MergedCharacter => ({
        id,
        windowLo: 0,
        windowHi: 0,
        mentions: [
          {
            surface,
            textAnchor: surface,
            kind: kind ?? (surface === "你" || surface === "他" ? "deictic" : "proper"),
            offsetAnchor: {
              localStart: 0,
              localEnd: surface.length,
              globalStart: g,
              globalEnd: g + surface.length,
            },
          },
        ],
      });
      const overlap = { start: 80, end: 100 };
      // same surface + same offset in overlap → match (non-deictic)
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
      // deictic-only 1 identical → shared listed but need weak≥3 to merge
      const deicticHit = sharedSurfacesInOverlap(
        oa("xu", 85, "你", "deictic"),
        oa("zhou", 85, "你", "deictic"),
        overlap,
      );
      assert.equal(deicticHit.length, 1);
      const can1 = canMergeInOverlap(
        oa("xu", 85, "你", "deictic"),
        oa("zhou", 85, "你", "deictic"),
        overlap,
      );
      assert.equal(can1.ok, false);
      assert.equal(can1.tiers.weak, 1);
      // generic 这人 single → not enough (weak need 3)
      const gen = (
        id: string,
        g: number,
      ): MergedCharacter => ({
        id,
        windowLo: 0,
        windowHi: 0,
        mentions: [
          {
            surface: "这人",
            textAnchor: "这人",
            kind: "generic",
            offsetAnchor: {
              localStart: 0,
              localEnd: 2,
              globalStart: g,
              globalEnd: g + 2,
            },
          },
        ],
      });
      assert.equal(
        canMergeInOverlap(gen("a", 90), gen("b", 90), overlap).ok,
        false,
      );

      // proper 1 identical → merge
      assert.equal(
        canMergeInOverlap(oa("a", 85), oa("b", 85), overlap).ok,
        true,
      );

      // shared proper surface string — NOT required to be in overlap / same offset
      const leftProper: MergedCharacter = {
        id: "L",
        windowLo: 0,
        windowHi: 0,
        mentions: [
          {
            surface: "周屿",
            textAnchor: "周屿",
            kind: "proper",
            offsetAnchor: {
              localStart: 0,
              localEnd: 2,
              globalStart: 10,
              globalEnd: 12,
            },
          },
        ],
      };
      const rightProper: MergedCharacter = {
        id: "R",
        windowLo: 1,
        windowHi: 1,
        mentions: [
          {
            surface: "周屿",
            textAnchor: "周屿",
            kind: "proper",
            offsetAnchor: {
              localStart: 0,
              localEnd: 2,
              globalStart: 200,
              globalEnd: 202,
            },
          },
        ],
      };
      const byName = canMergeInOverlap(leftProper, rightProper, {
        start: 80,
        end: 100,
      });
      assert.equal(byName.ok, true, "shared proper anywhere should merge");
      assert.ok(byName.sharedStrongAnywhere.includes("周屿"));
      // even with null overlap
      assert.equal(
        canMergeInOverlap(leftProper, rightProper, null).ok,
        true,
      );

      // mid (title): 1 not enough, 2 enough
      const withTitles = (
        id: string,
        offs: number[],
      ): MergedCharacter => ({
        id,
        windowLo: 0,
        windowHi: 0,
        mentions: offs.map((g, i) => ({
          surface: i === 0 ? "经理" : "项目经理",
          textAnchor: i === 0 ? "经理" : "项目经理",
          kind: "title" as const,
          offsetAnchor: {
            localStart: 0,
            localEnd: 2,
            globalStart: g,
            globalEnd: g + 2,
          },
        })),
      });
      assert.equal(
        canMergeInOverlap(withTitles("a", [85]), withTitles("b", [85]), overlap)
          .ok,
        false,
      );
      assert.equal(
        canMergeInOverlap(
          withTitles("a", [85, 90]),
          withTitles("b", [85, 90]),
          overlap,
        ).ok,
        true,
      );

      // weak: 3 identical deictic/generic → merge
      const weak3 = (id: string): MergedCharacter => ({
        id,
        windowLo: 0,
        windowHi: 0,
        mentions: [
          {
            surface: "你",
            textAnchor: "你",
            kind: "deictic",
            offsetAnchor: {
              localStart: 0,
              localEnd: 1,
              globalStart: 85,
              globalEnd: 86,
            },
          },
          {
            surface: "他",
            textAnchor: "他",
            kind: "deictic",
            offsetAnchor: {
              localStart: 0,
              localEnd: 1,
              globalStart: 90,
              globalEnd: 91,
            },
          },
          {
            surface: "这人",
            textAnchor: "这人",
            kind: "generic",
            offsetAnchor: {
              localStart: 0,
              localEnd: 2,
              globalStart: 95,
              globalEnd: 97,
            },
          },
        ],
      });
      const w3 = canMergeInOverlap(weak3("a"), weak3("b"), {
        start: 80,
        end: 100,
      });
      assert.equal(w3.ok, true);
      assert.equal(w3.tiers.weak, 3);
    });

    test("hierarchical merge 4 windows with real offsets", () => {
      // F indices: 0-5 X, 6甲 7乙 8-11 Y, 12乙 13丙 14丙 15Q 16-19 W...
      const F = "XXXXXX甲乙YYYY乙丙丙QWWWW";
      const W: AnalysisWindow[] = [
        { index: 0, label: "窗0", start: 0, end: 12, text: F.slice(0, 12) },
        { index: 1, label: "窗1", start: 6, end: 18, text: F.slice(6, 18) },
        { index: 2, label: "窗2", start: 12, end: 20, text: F.slice(12, 20) },
        { index: 3, label: "窗3", start: 14, end: 22, text: F.slice(14, 22) },
      ];
      // ov 0-1 [6,12) 甲乙YYYY
      // ov 1-2 [12,18) 乙丙丙QWW
      // ov 2-3 [14,20) 丙丙QWWW

      const BW: WindowExtractResult[] = [
        {
          window: { index: 0, label: "窗0", start: 0, end: 12 },
          characters: [
            { mentions: [{ surface: "甲", textAnchor: "甲" }] },
            { mentions: [{ surface: "乙", textAnchor: "乙" }] },
          ],
        },
        {
          window: { index: 1, label: "窗1", start: 6, end: 18 },
          characters: [
            { mentions: [{ surface: "甲", textAnchor: "甲" }] },
            { mentions: [{ surface: "乙", textAnchor: "乙" }] },
            { mentions: [{ surface: "丙", textAnchor: "丙" }] },
          ],
        },
        {
          window: { index: 2, label: "窗2", start: 12, end: 20 },
          characters: [
            { mentions: [{ surface: "乙", textAnchor: "乙" }] },
            { mentions: [{ surface: "丙", textAnchor: "丙" }] },
          ],
        },
        {
          window: { index: 3, label: "窗3", start: 14, end: 22 },
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
        { index: 0, label: "窗0", start: 0, end: 90, text: "x".repeat(90) },
        { index: 1, label: "窗1", start: 80, end: 170, text: "y".repeat(90) },
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
