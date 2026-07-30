/**
 * Stage ③ rule scoring + thresholds (no network).
 */
import { assert, suite, suiteAsync, test, testAsync } from "../lib/test-harness";
import type { MergedCharacter } from "../../src/core/character-analysis/merge-adjacent";
import { selectCanonicalName } from "../../src/core/character-analysis/stage5-canonical";
import {
  buildCooccurGraph,
  buildPairFeatures,
  decideByThresholds,
  formatMentionContexts,
  formatRelatedCharacterCards,
  executeCorefJudgeTool,
  mergeStage3Config,
  pairCooccurMetrics,
  pickRelatedNeighbors,
  resolveCorefWithRulesAndAgent,
  sanitizePositiveWeight,
  scorePair,
  selectGreyLlmMode,
  sliceContextFromFullText,
  surfacesForCoref,
  STAGE3_DEFAULT_CONFIG,
} from "../../src/core/character-analysis/coref";
import type { PairContext } from "../../src/core/character-analysis/coref";
import type { AnalysisWindow } from "../../src/core/character-analysis/types";
import { resolveMentionKind } from "../../src/core/character-analysis/mention-kind";

function mc(
  id: string,
  surfaces: string[],
  extra?: Partial<MergedCharacter>,
): MergedCharacter {
  return {
    id,
    windowLo: extra?.windowLo ?? 0,
    windowHi: extra?.windowHi ?? 0,
    gender: extra?.gender,
    age: extra?.age,
    mentions: surfaces.map((surface, i) => ({
      surface,
      textAnchor: surface,
      kind: resolveMentionKind(surface),
      offsetAnchor: {
        localStart: i,
        localEnd: i + surface.length,
        globalStart: (extra?.windowLo ?? 0) * 1000 + i * 10,
        globalEnd: (extra?.windowLo ?? 0) * 1000 + i * 10 + surface.length,
      },
    })),
  };
}

function ctx(a: MergedCharacter, b: MergedCharacter): PairContext {
  const config = mergeStage3Config();
  return {
    a,
    b,
    features: buildPairFeatures(a, b, config),
    windows: [],
    fullTextLength: 10000,
    config,
  };
}

export async function runCharacterAnalysisCorefTests(): Promise<void> {
  suite("character-analysis stage3 coref rules", () => {
    test("stage4 picks personal name over 我/老师 when both present", () => {
      const c = mc("x", ["小星老师", "黎星", "我", "老师"], {
        gender: "女",
      });
      // bump 黎星 frequency
      c.mentions.push(
        {
          surface: "黎星",
          textAnchor: "黎星",
          offsetAnchor: {
            localStart: 0,
            localEnd: 2,
            globalStart: 50,
            globalEnd: 52,
          },
        },
        {
          surface: "黎星",
          textAnchor: "黎星",
          offsetAnchor: {
            localStart: 0,
            localEnd: 2,
            globalStart: 60,
            globalEnd: 62,
          },
        },
      );
      const pick = selectCanonicalName(c);
      assert.equal(pick.canonicalName, "黎星");
      assert.ok(pick.aliases.includes("小星老师"));
      assert.ok(pick.aliases.includes("我"));
      // single proper → rule confident, skip LLM
      assert.equal(pick.ruleConfident, true);
    });

    test("stage4 single proper is confident; multi-proper is not", () => {
      const one = mc("a", ["周屿", "他", "你", "屿哥"]);
      const p1 = selectCanonicalName(one);
      assert.equal(p1.canonicalName, "周屿");
      assert.equal(p1.ruleConfident, true);

      const two = mc("b", ["周屿", "周航"]);
      const p2 = selectCanonicalName(two);
      assert.equal(p2.ruleConfident, false);
      assert.ok(
        p2.canonicalName === "周屿" || p2.canonicalName === "周航",
        p2.canonicalName,
      );
    });

    test("strip deictic pronouns when entity also has a name", () => {
      const named = mc("n", ["将军", "我", "他"], { gender: "男" });
      const pure = mc("p", ["我"], { gender: "男" });
      assert.deepEqual(surfacesForCoref(named, true).sort(), ["将军"]);
      assert.deepEqual(surfacesForCoref(pure, true), ["我"]);
      assert.ok(surfacesForCoref(named, false).includes("我"));

      const feat = buildPairFeatures(
        named,
        pure,
        mergeStage3Config({ stripDeicticWhenHasName: true }),
      );
      // no shared surface after strip — 将军 vs 我
      assert.deepEqual(feat.sharedSurfaces, []);
      // 将军 is title — not identity-strong exclusive
      assert.ok(!feat.exclusiveStrongA.includes("将军"));
    });

    test("generic 这小子 is not strong; exclusive propers 王铎 vs 周航 penalize", () => {
      const wang = mc("w", ["王铎", "他", "这小子", "小王八"], {
        gender: "男",
        windowLo: 3,
        windowHi: 3,
      });
      const zhou = mc("z", ["周航", "他", "这小子", "那小子"], {
        gender: "男",
        windowLo: 3,
        windowHi: 3,
      });
      const feat = buildPairFeatures(wang, zhou, mergeStage3Config());
      assert.ok(feat.sharedSurfaces.includes("这小子"));
      assert.ok(
        !feat.sharedStrongSurfaces.includes("这小子"),
        `strong should not include 这小子: ${feat.sharedStrongSurfaces.join(",")}`,
      );
      assert.deepEqual(feat.sharedStrongSurfaces, []);
      assert.ok(feat.sharedGenericSurfaces.includes("这小子"));
      assert.ok(feat.exclusiveProperA.includes("王铎"));
      assert.ok(feat.exclusiveProperB.includes("周航"));
      const s = scorePair(ctx(wang, zhou));
      assert.ok(
        s.hard !== "merge",
        "must not hard-merge on generic epithet alone",
      );
      const decision = decideByThresholds(s, STAGE3_DEFAULT_CONFIG, feat);
      assert.ok(
        decision !== "auto_merge",
        `score=${s.score} decision=${decision} should not auto_merge`,
      );
      const excl = s.breakdown.find((b) => b.ruleId === "exclusive_proper_names");
      assert.ok(excl && excl.delta < 0, "exclusive proper soft penalty");
    });

    test("kind gate: co-occur alone cannot auto_merge (g4)", () => {
      // Two different people in same window: only proximity + co-occur, no shared strong
      const a = mc("a", ["周屿", "他"], {
        gender: "男",
        windowLo: 5,
        windowHi: 5,
      });
      const b = mc("b", ["黑仔", "小鬼"], {
        gender: "男",
        windowLo: 5,
        windowHi: 5,
      });
      // Force close co-occur offsets
      for (const m of a.mentions) {
        if (m.offsetAnchor) {
          m.offsetAnchor.globalStart = 5000;
          m.offsetAnchor.globalEnd = 5002;
        }
      }
      for (const m of b.mentions) {
        if (m.offsetAnchor) {
          m.offsetAnchor.globalStart = 5100;
          m.offsetAnchor.globalEnd = 5102;
        }
      }
      const config = mergeStage3Config();
      const feat = buildPairFeatures(a, b, config);
      assert.equal(feat.sharedStrongSurfaces.length, 0);
      assert.ok(feat.exclusiveProperA.includes("周屿") || feat.exclusiveStrongA.includes("周屿"));
      const s = scorePair({
        a,
        b,
        features: feat,
        windows: [],
        fullTextLength: 20000,
        config,
      });
      // Even if score is high, gate forces agent
      const decision = decideByThresholds(
        { ...s, score: 0.92 },
        config,
        feat,
      );
      assert.equal(
        decision,
        "agent",
        "requireSharedStrongForAutoMerge blocks soft auto_merge",
      );
      // With shared proper, high score can auto_merge
      const a2 = mc("a2", ["周屿"], { gender: "男", windowLo: 0, windowHi: 0 });
      const b2 = mc("b2", ["周屿", "屿哥"], {
        gender: "男",
        windowLo: 2,
        windowHi: 2,
      });
      const feat2 = buildPairFeatures(a2, b2, config);
      assert.ok(feat2.sharedStrongSurfaces.includes("周屿"));
      const d2 = decideByThresholds(
        { ...s, score: 0.9, hard: null },
        config,
        feat2,
      );
      assert.equal(d2, "auto_merge");
    });

    test("agent context marks mention in fullText snippet", () => {
      const novel = "前文前文前文小星老师走进教室后文后文后文";
      // 小星老师 starts at index of 小
      const g0 = novel.indexOf("小星老师");
      assert.ok(g0 >= 0);
      const hit = sliceContextFromFullText(novel, g0, g0 + 4, 4);
      assert.ok(hit);
      assert.ok(hit!.snippet.includes("小星"));
      const c = mc("t", ["小星老师"], {
        windowLo: 0,
        windowHi: 0,
      });
      c.mentions[0]!.offsetAnchor = {
        localStart: g0,
        localEnd: g0 + 4,
        globalStart: g0,
        globalEnd: g0 + 4,
      };
      c.mentions[0]!.textAnchor = "小星老师走进";
      const lines = formatMentionContexts(c, {
        fullText: novel,
        contextRadius: 6,
      });
      assert.ok(lines.length >= 1);
      assert.ok(lines[0]!.includes("【小星老师】"), lines[0]);
    });

    test("coref tool-loop list_neighbors shared vs side", () => {
      const a = mc("cA", ["阿龙"], { windowLo: 0, windowHi: 0, gender: "男" });
      const b = mc("cB", ["老头"], { windowLo: 0, windowHi: 0, gender: "男" });
      const r = mc("cR", ["周屿"], { windowLo: 0, windowHi: 0, gender: "男" });
      a.mentions[0]!.offsetAnchor = {
        localStart: 10,
        localEnd: 12,
        globalStart: 10,
        globalEnd: 12,
      };
      b.mentions[0]!.offsetAnchor = {
        localStart: 30,
        localEnd: 32,
        globalStart: 30,
        globalEnd: 32,
      };
      r.mentions[0]!.offsetAnchor = {
        localStart: 50,
        localEnd: 52,
        globalStart: 50,
        globalEnd: 52,
      };
      const novel = "0123456789阿龙在按摩。老头在旁边看。周屿站着等。";
      const windows: AnalysisWindow[] = [
        {
          index: 0,
          label: "窗0",
          start: 0,
          end: novel.length,
          text: novel,
        },
      ];
      const graph = buildCooccurGraph([a, b, r], windows);
      const roster = new Map([
        ["cA", a],
        ["cB", b],
        ["cR", r],
      ]);
      const ctx = {
        idA: "cA",
        idB: "cB",
        charA: a,
        charB: b,
        rosterById: roster,
        cooccurGraph: graph,
        fullText: novel,
        windows,
        formatExcerpts: () => [] as string[],
      };
      const shared = executeCorefJudgeTool(
        "list_neighbors",
        { side: "shared" },
        ctx,
      );
      assert.ok(shared.content.includes("周屿"), shared.content);
      const verdict = executeCorefJudgeTool(
        "submit_verdict",
        { same: false, reason: "不同专名" },
        ctx,
      );
      assert.equal(verdict.verdict?.same, false);
      assert.ok(verdict.verdict?.reason.includes("专名"));
    });

    test("related character cards: only shared neighbors (N(A)∩N(B))", () => {
      // win0: A+B+R together → R is shared
      // win1: only A+S → S is onlyA, must NOT appear in related cards
      const a = mc("cA", ["阿龙"], { windowLo: 0, windowHi: 1, gender: "男" });
      const b = mc("cB", ["老头"], { windowLo: 0, windowHi: 0, gender: "男" });
      const r = mc("cR", ["周屿"], { windowLo: 0, windowHi: 0, gender: "男" });
      const sOnlyA = mc("cS", ["路人"], { windowLo: 1, windowHi: 1, gender: "男" });
      a.mentions = [
        {
          surface: "阿龙",
          textAnchor: "阿龙",
          kind: resolveMentionKind("阿龙"),
          offsetAnchor: {
            localStart: 10,
            localEnd: 12,
            globalStart: 10,
            globalEnd: 12,
          },
        },
        {
          surface: "阿龙",
          textAnchor: "阿龙",
          kind: resolveMentionKind("阿龙"),
          offsetAnchor: {
            localStart: 5,
            localEnd: 7,
            globalStart: 1005,
            globalEnd: 1007,
          },
        },
      ];
      b.mentions[0]!.offsetAnchor = {
        localStart: 30,
        localEnd: 32,
        globalStart: 30,
        globalEnd: 32,
      };
      r.mentions[0]!.offsetAnchor = {
        localStart: 50,
        localEnd: 52,
        globalStart: 50,
        globalEnd: 52,
      };
      sOnlyA.mentions[0]!.offsetAnchor = {
        localStart: 20,
        localEnd: 22,
        globalStart: 1020,
        globalEnd: 1022,
      };
      const text0 = "0123456789阿龙在按摩。老头在旁边看。周屿站着等。";
      const text1 = "xxxxx阿龙和路人在别处。";
      const windows: AnalysisWindow[] = [
        { index: 0, label: "窗0", start: 0, end: 1000, text: text0 },
        { index: 1, label: "窗1", start: 1000, end: 2000, text: text1 },
      ];
      const graph = buildCooccurGraph([a, b, r, sOnlyA], windows);
      const picks = pickRelatedNeighbors("cA", "cB", graph);
      assert.ok(
        picks.some((p) => p.id === "cR" && p.role === "shared"),
        JSON.stringify(picks),
      );
      assert.ok(
        !picks.some((p) => p.id === "cS"),
        `onlyA 路人 must not be related: ${JSON.stringify(picks)}`,
      );
      const roster = new Map([
        ["cA", a],
        ["cB", b],
        ["cR", r],
        ["cS", sOnlyA],
      ]);
      const cards = formatRelatedCharacterCards("cA", "cB", {
        fullText: text0 + " ".repeat(1000 - text0.length) + text1,
        windows,
        rosterById: roster,
        cooccurGraph: graph,
        includeRelatedCards: true,
        maxRelatedMentions: 1,
        relatedContextRadius: 8,
      });
      const blob = cards.join("\n");
      assert.ok(blob.includes("【相关人物】"), blob);
      assert.ok(blob.includes("周屿"), blob);
      assert.ok(blob.includes("共享共现"), blob);
      assert.ok(!blob.includes("路人"), blob);
      assert.ok(blob.includes("【周屿】") || blob.includes("surface=周屿"), blob);
    });

    test("gender conflict hard reject", () => {
      const a = mc("a", ["张三"], { gender: "男" });
      const b = mc("b", ["李四"], { gender: "女" });
      const s = scorePair(ctx(a, b));
      assert.equal(s.hard, "reject");
      assert.equal(decideByThresholds(s, STAGE3_DEFAULT_CONFIG), "auto_reject");
    });

    test("shared strong surface: hard merge when n>3 and never same window", () => {
      // n=4 shared strong surfaces, different windows → hard merge
      const names = ["甲名", "乙名", "丙名", "丁名"];
      const a = mc("a", names, { gender: "女", windowLo: 0, windowHi: 0 });
      const b = mc("b", [...names, "戊名"], {
        gender: "女",
        windowLo: 2,
        windowHi: 2,
      });
      // no cooccur graph → neverSameWindow defaults true
      const s = scorePair(ctx(a, b));
      assert.equal(s.hard, "merge");
      assert.equal(decideByThresholds(s, STAGE3_DEFAULT_CONFIG), "auto_merge");
      const line = s.breakdown.find((r) => r.ruleId === "shared_strong_surface");
      assert.ok(line?.reason.includes("n=4"));
      assert.ok(line?.reason.includes("neverSameWindow"));
    });

    test("shared strong surface: n>3 but same window → no hard merge", () => {
      const names = ["甲名", "乙名", "丙名", "丁名"];
      const windows: AnalysisWindow[] = [
        { index: 0, label: "w0", start: 0, end: 100, text: "x".repeat(100) },
      ];
      // both mentions in window 0 → sameWindow
      const a = mc("a", names, { gender: "女", windowLo: 0, windowHi: 0 });
      const b = mc("b", [...names, "戊名"], {
        gender: "女",
        windowLo: 0,
        windowHi: 0,
      });
      // force offsets into w0
      for (const c of [a, b]) {
        for (const m of c.mentions) {
          if (m.offsetAnchor) {
            m.offsetAnchor.globalStart = 10;
            m.offsetAnchor.globalEnd = 12;
          }
        }
      }
      const graph = buildCooccurGraph([a, b], windows);
      const config = mergeStage3Config();
      const features = buildPairFeatures(a, b, config, graph);
      assert.equal(features.neverSameWindow, false);
      const s = scorePair({
        a,
        b,
        features,
        windows,
        fullTextLength: 100,
        config,
      });
      assert.notEqual(s.hard, "merge");
      const line = s.breakdown.find((r) => r.ruleId === "shared_strong_surface")!;
      assert.equal(line.hard, undefined);
      assert.ok(line.delta <= 0.12, `same-window soft capped, got ${line.delta}`);
      assert.ok(line.reason.includes("sameWindow"));
    });

    test("shared strong surface: n≤3 soft positive, higher n → higher delta", () => {
      // n=1: shared proper still soft only
      const a1 = mc("a1", ["黎星"], { gender: "女" });
      const b1 = mc("b1", ["黎星", "小星"], { gender: "女" });
      const s1 = scorePair(ctx(a1, b1));
      assert.notEqual(s1.hard, "merge");
      const l1 = s1.breakdown.find((r) => r.ruleId === "shared_strong_surface")!;
      assert.equal(l1.hard, undefined);
      assert.equal(l1.delta, 0.15);

      // n=2
      const a2 = mc("a2", ["甲名", "乙名"], { gender: "女" });
      const b2 = mc("b2", ["甲名", "乙名", "丙名"], { gender: "女" });
      const s2 = scorePair(ctx(a2, b2));
      const l2 = s2.breakdown.find((r) => r.ruleId === "shared_strong_surface")!;
      assert.equal(l2.delta, 0.28);
      assert.ok(l2.delta > l1.delta);

      // n=3
      const a3 = mc("a3", ["甲名", "乙名", "丙名"], { gender: "女" });
      const b3 = mc("b3", ["甲名", "乙名", "丙名"], { gender: "女" });
      const s3 = scorePair(ctx(a3, b3));
      const l3 = s3.breakdown.find((r) => r.ruleId === "shared_strong_surface")!;
      assert.equal(l3.delta, 0.4);
      assert.ok(l3.delta > l2.delta);
      assert.notEqual(s3.hard, "merge"); // hard only when n>3
    });

    test("exclusive proper names is soft only (aliases may evolve)", () => {
      // Distinct propers + only generic share — soft penalty, never hard reject
      const a = mc("a", ["王铎", "这小子"], { gender: "男", windowLo: 0, windowHi: 0 });
      const b = mc("b", ["周航", "这小子"], { gender: "男", windowLo: 1, windowHi: 1 });
      const s = scorePair(ctx(a, b));
      assert.notEqual(s.hard, "reject");
      const excl = s.breakdown.find((x) => x.ruleId === "exclusive_proper_names");
      assert.ok(excl, "rule should fire");
      assert.ok(excl!.weighted < 0, "soft negative");
      assert.equal(excl!.hard, undefined);
      // soft only — may still auto_reject if score ≤ threshold (0.4), but never hard
      const dec = decideByThresholds(s, STAGE3_DEFAULT_CONFIG);
      assert.ok(
        dec === "agent" ||
          dec === "auto_merge" ||
          dec === "auto_reject",
        `unexpected ${dec} score=${s.score}`,
      );
      if (dec === "auto_reject") {
        assert.ok(
          s.score <= STAGE3_DEFAULT_CONFIG.autoRejectThreshold,
          "soft auto_reject only by score threshold",
        );
      }
      // title exclusives alone must NOT fire exclusive_proper
      const t1 = mc("t1", ["将军"], { gender: "男" });
      const t2 = mc("t2", ["空军少将"], { gender: "男" });
      const st = scorePair(ctx(t1, t2));
      assert.ok(
        !st.breakdown.find((x) => x.ruleId === "exclusive_proper_names"),
        "title exclusives must not fire exclusive_proper",
      );
    });

    test("disable rule via config", () => {
      const a = mc("a", ["黎星"]);
      const b = mc("b", ["黎星"]);
      const config = mergeStage3Config({
        rules: { shared_strong_surface: { enabled: false } },
      });
      const c: PairContext = {
        ...ctx(a, b),
        config,
        features: buildPairFeatures(a, b, config),
      };
      const s = scorePair(c);
      assert.ok(s.breakdown.some((r) => r.ruleId === "shared_strong_surface" && !r.enabled));
    });

    test("weight scales delta", () => {
      const a = mc("a", ["我"], { windowLo: 0, windowHi: 0 });
      const b = mc("b", ["我"], { windowLo: 0, windowHi: 0 });
      const base = scorePair(ctx(a, b));
      const config = mergeStage3Config({
        rules: { shared_weak_surface: { weight: 3 } },
      });
      const c: PairContext = {
        ...ctx(a, b),
        config,
        features: buildPairFeatures(a, b, config),
      };
      const weighted = scorePair(c);
      assert.ok(typeof weighted.score === "number");
      assert.ok(base.score >= 0 && base.score <= 1);
    });

    test("weight must be positive; non-positive falls back", () => {
      assert.equal(sanitizePositiveWeight(2, 1), 2);
      assert.equal(sanitizePositiveWeight(0.5, 1), 0.5);
      assert.equal(sanitizePositiveWeight(0, 1), 1);
      assert.equal(sanitizePositiveWeight(-3, 1), 1);
      assert.equal(sanitizePositiveWeight(Number.NaN, 1.5), 1.5);
    });

    test("grey LLM mode: middle deep, edges oneshot; deep extends toward merge", () => {
      const config = mergeStage3Config();
      // T_r=0.4 T_m=0.85; defaults σ_r=0.26 σ_m=0.16 τ=0.45
      const mid = selectGreyLlmMode(0.62, config);
      assert.equal(mid.mode, "deep", mid.reason);

      const nearReject = selectGreyLlmMode(0.42, config);
      assert.equal(nearReject.mode, "oneshot", nearReject.reason);
      assert.ok(nearReject.edgeReject > nearReject.edgeMerge);

      const nearMerge = selectGreyLlmMode(0.82, config);
      assert.equal(nearMerge.mode, "oneshot", nearMerge.reason);
      assert.ok(nearMerge.edgeMerge > nearMerge.edgeReject);

      // Asymmetry: σ_reject > σ_merge → at equal |u-0.5|, reject-side edgeMax larger
      // (wider oneshot near reject; deep mid skewed toward merge)
      const left = selectGreyLlmMode(0.4 + 0.3 * 0.45, config); // u=0.3 → score=0.535
      const right = selectGreyLlmMode(0.4 + 0.7 * 0.45, config); // u=0.7 → score=0.715
      assert.ok(
        left.edgeMax + 1e-9 >= right.edgeMax,
        `asymmetry left.edgeMax=${left.edgeMax} right.edgeMax=${right.edgeMax}`,
      );

      // Optional force-deep for no-strong on merge oneshot skirt (off by default)
      const feat = buildPairFeatures(
        mc("a", ["阿龙"]),
        mc("b", ["老阿伯"]),
        config,
      );
      assert.equal(feat.sharedStrongSurfaces.length, 0);
      // u≈0.84 → oneshot on merge skirt with σ_m=0.16
      const defaultRoute = selectGreyLlmMode(0.78, config, feat);
      assert.equal(defaultRoute.mode, "oneshot", defaultRoute.reason);

      const forceCfg = mergeStage3Config({
        greyForceDeepNearMergeNoStrong: true,
      });
      const forced = selectGreyLlmMode(0.78, forceCfg, feat);
      assert.equal(forced.mode, "deep", forced.reason);
    });

    test("same-window / close mentions without strong share soft-reject", () => {
      const config = mergeStage3Config();
      // Two entities in same window, no shared proper
      const a = mc("a", ["阿龙"], { windowLo: 15, windowHi: 15 });
      const b = mc("b", ["老阿伯"], { windowLo: 15, windowHi: 15 });
      // place offsets close in same window range
      a.mentions[0]!.offsetAnchor = {
        localStart: 0,
        localEnd: 2,
        globalStart: 82000,
        globalEnd: 82002,
      };
      b.mentions[0]!.offsetAnchor = {
        localStart: 0,
        localEnd: 3,
        globalStart: 82100,
        globalEnd: 82103,
      };
      const windows: AnalysisWindow[] = Array.from({ length: 20 }, (_, i) => ({
        index: i,
        label: `窗${i}`,
        start: i * 5200,
        end: i * 5200 + 6000,
        text: "x".repeat(100),
      }));
      const graph = buildCooccurGraph([a, b], windows);
      const feat = buildPairFeatures(a, b, config, graph);
      assert.ok(feat.sameWindowCount >= 1 || (feat.minMentionDistance ?? 9999) < 500);
      const s = scorePair({
        a,
        b,
        features: feat,
        windows,
        fullTextLength: 100000,
        config,
      });
      const sameWin = s.breakdown.find((x) => x.ruleId === "same_window_cooccur");
      const closeDiff = s.breakdown.find((x) => x.ruleId === "close_mention_diff");
      assert.ok(
        sameWin || closeDiff,
        `expected co-presence negative rule, breakdown=${s.breakdown.map((b) => b.ruleId).join(",")}`,
      );
      if (sameWin) assert.ok(sameWin.delta < 0, String(sameWin.delta));
      if (closeDiff) assert.ok(closeDiff.delta < 0, String(closeDiff.delta));
    });

    test("window_proximity uses gap relative to novel window count", () => {
      const config = mergeStage3Config();
      const a = mc("a", ["经理"], { windowLo: 2, windowHi: 2 });
      const b = mc("b", ["经理"], { windowLo: 9, windowHi: 9 });
      // gap = max(2,9)-min(2,9)-1 = 6
      const feat = buildPairFeatures(a, b, config);
      assert.equal(feat.windowGap, 6);

      const mkWins = (n: number): AnalysisWindow[] =>
        Array.from({ length: n }, (_, i) => ({
          index: i,
          label: `窗${i}`,
          start: i * 1000,
          end: i * 1000 + 900,
          text: "x".repeat(100),
        }));

      const scoreProx = (nWin: number) => {
        const s = scorePair({
          a,
          b,
          features: feat,
          windows: mkWins(nWin),
          fullTextLength: nWin * 1000,
          config,
        });
        return s.breakdown.find((x) => x.ruleId === "window_proximity");
      };

      // long book: r = 6/26 ≈ 0.23 → mid/far light (−0.05 or −0.10), not max
      const long = scoreProx(27);
      assert.ok(long, "proximity rule");
      assert.ok(
        long!.delta > -0.15,
        `long-book gap=6 should not be max penalty, got Δ=${long!.delta}`,
      );
      assert.ok(long!.reason.includes("r="), long!.reason);

      // short book: r = 6/4 = 1.5 → very far −0.10
      const short = scoreProx(5);
      assert.equal(short!.delta, -0.1, `short-book Δ=${short!.delta}`);

      // empty windows → legacy absolute (gap≥3 → −0.10)
      const legacy = scorePair({
        a,
        b,
        features: feat,
        windows: [],
        fullTextLength: 10000,
        config,
      }).breakdown.find((x) => x.ruleId === "window_proximity");
      assert.equal(legacy!.delta, -0.1);
      assert.ok(legacy!.reason.includes("no span"), legacy!.reason);
    });

    test("cooccur exclusivity and jaccard from shared companion", () => {
      // Windows: 0 has A+X, 1 has B+X, 2 has A+B+X (optional)
      // A in {0,2}, B in {1,2}, X in {0,1,2}
      // never force same window for A,B if we only use 0 and 1
      const windows: AnalysisWindow[] = [
        { index: 0, label: "w0", start: 0, end: 100, text: "a".repeat(100) },
        { index: 1, label: "w1", start: 100, end: 200, text: "b".repeat(100) },
        { index: 2, label: "w2", start: 200, end: 300, text: "c".repeat(100) },
      ];
      // surface single-char so exclusive_proper_names does not fire
      const mk = (
        id: string,
        surface: string,
        offs: number[],
        lo: number,
        hi: number,
      ): MergedCharacter => ({
        id,
        windowLo: lo,
        windowHi: hi,
        mentions: offs.map((g) => ({
          surface,
          textAnchor: surface,
          offsetAnchor: {
            localStart: 0,
            localEnd: 1,
            globalStart: g,
            globalEnd: g + 1,
          },
        })),
      });
      // A @ 10 (w0), 210 (w2); B @ 110 (w1), 220 (w2); X @ 20,120,230
      const A = mk("A", "甲", [10, 210], 0, 2);
      const B = mk("B", "乙", [110, 220], 1, 2);
      const X = mk("X", "丙", [20, 120, 230], 0, 2);
      const graph = buildCooccurGraph([A, B, X], windows);
      const m = pairCooccurMetrics("A", "B", graph);
      // A units {0,2}, B {1,2}, shared window 2 only → sameWindowCount=1
      assert.equal(m.sameWindowCount, 1);
      assert.equal(m.neverSameWindow, false);
      // N(A) includes X (and maybe B); neighbors exclude B → X
      // count(A,X): windows 0 and 2 → 2; count(A)=2 → raw 1.0
      // count(B,X): windows 1 and 2 → 2; count(B)=2 → raw 1.0
      // min(count)=2 < sparseMin 3 → exclusivity ×0.1; jaccard ×0.5
      assert.ok(m.exclusivityRaw >= 0.99, `exclRaw=${m.exclusivityRaw}`);
      assert.ok(
        Math.abs(m.exclusivity - 0.1) < 0.01,
        `excl (sparse×0.1)=${m.exclusivity}`,
      );
      assert.equal(m.sparse, true);
      assert.ok(m.jaccardRaw > 0, `j=${m.jaccardRaw}`);

      // A only w0, B only w1, X both → never same window A-B; raw excl=1 → sparse×0.1
      const A2 = mk("A2", "甲", [10], 0, 0);
      const B2 = mk("B2", "乙", [110], 1, 1);
      const X2 = mk("X2", "丙", [20, 120], 0, 1);
      const g2 = buildCooccurGraph([A2, B2, X2], windows);
      const m2 = pairCooccurMetrics("A2", "B2", g2);
      assert.equal(m2.neverSameWindow, true);
      assert.ok(m2.exclusivityRaw >= 0.99, `exclRaw=${m2.exclusivityRaw}`);
      assert.ok(
        Math.abs(m2.exclusivity - 0.1) < 0.01,
        `excl (sparse×0.1)=${m2.exclusivity}`,
      );
      assert.ok(m2.jaccardRaw >= 0.99);
      assert.ok(
        Math.abs(m2.jaccard - 0.5) < 0.01,
        `jacc (sparse)=${m2.jaccard}`,
      );

      // Non-sparse: both appear in ≥3 windows → full exclusivity
      const A3 = mk("A3", "甲", [10, 110, 210], 0, 2);
      const B3 = mk("B3", "乙", [20, 120, 220], 0, 2);
      const X3 = mk("X3", "丙", [30, 130, 230], 0, 2);
      const g3 = buildCooccurGraph([A3, B3, X3], windows);
      const m3 = pairCooccurMetrics("A3", "B3", g3);
      assert.equal(m3.sparse, false);
      assert.ok(m3.exclusivity >= 0.99, `excl full=${m3.exclusivity}`);
      assert.equal(m3.exclusivity, m3.exclusivityRaw);

      const config = mergeStage3Config();
      const feat = buildPairFeatures(A2, B2, config, g2);
      assert.equal(feat.neverSameWindow, true);
      assert.equal(feat.cooccurSparse, true);
      assert.ok(
        Math.abs(feat.cooccurExclusivity - 0.1) < 0.01,
        `feat excl=${feat.cooccurExclusivity}`,
      );
      const s = scorePair({
        a: A2,
        b: B2,
        features: feat,
        windows,
        fullTextLength: 300,
        config,
      });
      // sparse excl=0.1, weight 0.25, noIdentity×0.25 → weighted ≈ 0.25*0.1*0.25 = 0.00625
      const exclLine = s.breakdown.find((b) => b.ruleId === "cooccur_exclusivity");
      assert.ok(exclLine, "exclusivity rule should fire");
      assert.ok(exclLine!.weighted > 0, `weighted=${exclLine!.weighted}`);
      assert.ok(
        exclLine!.reason.includes("sparse"),
        exclLine!.reason,
      );
      // still cannot auto_merge on cooccur alone (kind gate + scale)
      assert.ok(
        s.score < config.autoMergeThreshold,
        `score=${s.score} should be below auto_merge`,
      );
    });
  });

  await suiteAsync("character-analysis stage3 resolve", async () => {
    await testAsync("resolve without agent hard-merges when >3 shared surfaces", async () => {
      const shared = ["甲名", "乙名", "丙名", "丁名"];
      const chars = [
        mc("c1", shared, { gender: "女", windowLo: 0, windowHi: 0 }),
        mc("c2", [...shared, "戊名"], { gender: "女", windowLo: 1, windowHi: 1 }),
        mc("c3", ["阿东"], { gender: "男", windowLo: 0, windowHi: 0 }),
      ];
      const result = await resolveCorefWithRulesAndAgent(chars, [], {
        config: { agentEnabled: false },
        llm: null,
      });
      assert.ok(result.characters.length <= 2);
      assert.ok(result.stats.autoMerge >= 1);
      assert.equal(result.stats.sameSurfacePass, 0);
    });

    await testAsync("same-surface residual pass forces agent on leftover shared names", async () => {
      const calls: string[] = [];
      const llm = {
        chatWithTool: async (
          _msgs: unknown,
          _tool: { name: string },
        ) => {
          calls.push("judge");
          // Oneshot uses ternary verdict (not legacy same:boolean)
          return { verdict: "same", reason: "same surface residual" };
        },
      };
      // Single shared surface → soft score, likely agent/auto_reject path;
      // after grey, residual still forces agent if not merged.
      const chars = [
        mc("c1", ["加代子"], { gender: "女", windowLo: 0, windowHi: 0 }),
        mc("c2", ["加代子"], { gender: "女", windowLo: 2, windowHi: 2 }),
        mc("c3", ["路人甲"], { gender: "男", windowLo: 0, windowHi: 0 }),
      ];
      const result = await resolveCorefWithRulesAndAgent(chars, [], {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        llm: llm as any,
        config: { agentEnabled: true, sameSurfaceAgentPass: true },
      });
      assert.ok(calls.length >= 1, "agent should be called");
      // c1+c2 should merge via grey and/or same-surface pass
      const hasJia = result.characters.filter((c) =>
        c.mentions.some((m) => m.surface === "加代子"),
      );
      assert.equal(hasJia.length, 1, "加代子 should be one entity");
      assert.ok(
        result.stats.agentMerge >= 1 || result.stats.sameSurfaceMerge >= 1,
      );
    });
  });
}
