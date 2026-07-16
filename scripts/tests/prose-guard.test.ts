/**
 * Exercises shipped prose-guard: validateProseContent / looksLike* / stripLeadingMeta.
 */
import { assert, suite, test } from "../lib/test-harness";
import {
  looksLikeFindingsNotProse,
  looksLikeRevisionPlanNotProse,
  stripLeadingMeta,
  validateProseContent,
} from "../../src/core/agents/prose-guard";

const NARRATIVE =
  "夜色沉沉，江城的雾气贴着江面游走。林晚推开木窗，远处塔楼的灯一盏盏亮起，像谁把星子随手洒在了人间。" +
  "她捏着那封未署名的信，纸角已被汗水洇开，却仍能辨出「三日后，旧桥」几个字。";

export function runProseGuardTests(): void {
  suite("prose-guard", () => {
    test("validateProseContent accepts representative narrative prose", () => {
      const r = validateProseContent(NARRATIVE);
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.ok(r.prose.length >= 50);
        assert.ok(r.prose.includes("林晚"));
      }
    });

    test("validateProseContent rejects empty / too short", () => {
      const empty = validateProseContent("");
      assert.equal(empty.ok, false);
      if (!empty.ok) assert.equal(empty.reason, "empty_or_short");

      const short = validateProseContent("只有一句。");
      assert.equal(short.ok, false);
      if (!short.ok) assert.equal(short.reason, "empty_or_short");
    });

    test("validateProseContent rejects findings-like JSON", () => {
      const findingsJson = JSON.stringify([
        {
          dimension: "character",
          severity: "major",
          description: "性格崩坏",
          suggestion: "改回冷静",
        },
      ]);
      assert.equal(looksLikeFindingsNotProse(findingsJson), true);
      const r = validateProseContent(findingsJson);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, "findings_like");
    });

    test("validateProseContent rejects findings list markdown", () => {
      const list =
        "【审查问题清单 · 共 2 条 · 不是正文】\n\n" +
        "共 2 个问题\n\n" +
        "## 角色一致性（2）\n" +
        "1. 【重要】角色语气突变\n" +
        "2. 【次要】称呼不一致\n";
      assert.equal(looksLikeFindingsNotProse(list), true);
      const r = validateProseContent(list);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, "findings_like");
    });

    test("validateProseContent rejects revision-plan-like text", () => {
      const plan =
        "核心修改方向：\n" +
        "1. 增加过渡段落，缓冲情绪落差\n" +
        "2. 精简大段独白，压缩篇幅\n" +
        "3. 调整结尾留白，改写收束\n";
      assert.equal(looksLikeRevisionPlanNotProse(plan), true);
      const r = validateProseContent(plan);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, "revision_plan");
    });

    test("stripLeadingMeta drops tool chatter before prose", () => {
      const raw =
        "好的，我先获取大纲。\n现在开始创作。\n" +
        NARRATIVE;
      const stripped = stripLeadingMeta(raw);
      assert.ok(!stripped.startsWith("好的"));
      assert.ok(stripped.includes("林晚"));
      const r = validateProseContent(raw);
      assert.equal(r.ok, true);
    });

    test("validateProseContent rejects too_short_vs_original when previous is long", () => {
      const prev = NARRATIVE.repeat(8); // >> 500
      // Must clear minLen (50) but stay under 35% of previous length
      const shortRewrite =
        "她站在窗前，看了一眼江面，把信折好放进抽屉，转身离开了那间屋子。" +
        "窗外的雾仍未散尽，灯火在远处一明一灭。";
      assert.ok(prev.length > 500);
      assert.ok(shortRewrite.length >= 50, `rewrite len=${shortRewrite.length}`);
      assert.ok(
        shortRewrite.length < prev.length * 0.35,
        `rewrite ${shortRewrite.length} vs 35% of ${prev.length}`,
      );
      const r = validateProseContent(shortRewrite, { previousProse: prev });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, "too_short_vs_original");
    });
  });
}
