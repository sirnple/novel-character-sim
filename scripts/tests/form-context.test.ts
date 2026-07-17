/**
 * Form agent context payload — shape + conservative chaptering rules.
 */
import { assert, suite, test } from "../lib/test-harness";
import {
  buildFormAgentContext,
  formatFormAgentContextForTool,
} from "../../src/core/form/form-context";
import type { BranchChapterMeta, NovelFormProfile } from "../../src/types";

function baseForm(over: Partial<NovelFormProfile> = {}): NovelFormProfile {
  return {
    novelId: "n1",
    formType: "web_novel",
    unitHierarchy: { volume: "absent", chapter: "present", section: "absent" },
    chaptering: {
      enabled: true,
      confidence: 0.9,
      numbering: "arabic_di_n_zhang",
      titlePattern: "第N章",
      separator: " ",
      samples: ["第1章 开端", "第2章 发展"],
      chapterEndTendency: "cliffhanger",
    },
    narrativeArchitecture: {
      primaryTemplate: "episodic",
      genreHints: ["玄幻"],
      evidenceNotes: "dense chapter titles",
      povScheme: "第三人称",
      timeScheme: "linear",
    },
    continuationRules: [
      "本书分章：新开章时使用与 samples 一致的章标题格式。",
      "续写同一章时不要无故新起「第N章」。",
    ],
    ...over,
  };
}

function baseMeta(over: Partial<BranchChapterMeta> = {}): BranchChapterMeta {
  return {
    novelId: "n1",
    branchId: "main",
    chapterBoundary: "open",
    openChapter: { number: 2, title: "第2章 发展", startedAtOffset: 100 },
    chapters: [
      {
        id: "c1",
        number: 1,
        title: "第1章 开端",
        startOffset: 0,
        endOffset: 99,
        source: "regex",
      },
      {
        id: "c2",
        number: 2,
        title: "第2章 发展",
        startOffset: 100,
        source: "regex",
      },
    ],
    ...over,
  };
}

export function runFormContextTests(): void {
  suite("form-context", () => {
    test("enabled form exposes samples + rules + boundary", () => {
      const ctx = buildFormAgentContext({
        form: baseForm(),
        chapterMeta: baseMeta(),
        novelId: "n1",
        branchId: "main",
      });
      assert.equal(ctx.chapteringEnabled, true);
      assert.equal(ctx.forbidInventChapterTitles, false);
      assert.ok(ctx.chapterTitleSamples.includes("第1章 开端"));
      assert.equal(ctx.chapterBoundary, "open");
      assert.equal(ctx.catalogCount, 2);
      assert.ok(ctx.continuationRules.length >= 1);
      assert.equal(ctx.formType, "web_novel");
    });

    test("null form → conservative forbid invent titles", () => {
      const ctx = buildFormAgentContext({
        form: null,
        chapterMeta: null,
        novelId: "n1",
        branchId: "main",
      });
      assert.equal(ctx.chapteringEnabled, false);
      assert.equal(ctx.forbidInventChapterTitles, true);
      assert.ok(ctx.continuationRules.some((r) => r.includes("第N章") || r.includes("分章")));
    });

    test("disabled chaptering → forbidInventChapterTitles true", () => {
      const ctx = buildFormAgentContext({
        form: baseForm({
          formType: "essay_prose",
          chaptering: {
            enabled: false,
            confidence: 0.2,
            numbering: "none",
            titlePattern: "",
            separator: "",
            samples: [],
          },
          continuationRules: ["本书按保守策略视为弱分章/不分章：除非用户要求，不要添加「第N章」标题。"],
        }),
        chapterMeta: baseMeta({ chapterBoundary: "closed", chapters: [] }),
        novelId: "n1",
        branchId: "main",
      });
      assert.equal(ctx.chapteringEnabled, false);
      assert.equal(ctx.forbidInventChapterTitles, true);
      assert.equal(ctx.catalogCount, 0);
    });

    test("formatFormAgentContextForTool is parseable JSON with required keys", () => {
      const ctx = buildFormAgentContext({
        form: baseForm(),
        chapterMeta: baseMeta(),
        novelId: "n1",
        branchId: "main",
      });
      const raw = formatFormAgentContextForTool(ctx);
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const k of [
        "novelId",
        "branchId",
        "formType",
        "chapteringEnabled",
        "forbidInventChapterTitles",
        "chapterTitleSamples",
        "continuationRules",
        "chapterBoundary",
        "catalogCount",
        "unitHierarchy",
      ]) {
        assert.ok(k in parsed, `missing key ${k}`);
      }
    });
  });
}
