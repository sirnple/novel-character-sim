/**
 * Program chapter catalog + form segmentation.
 */
import { assert, suite, test } from "../lib/test-harness";
import {
  extractChapterCatalog,
  inferChapteringFromCatalog,
  parseChineseNumeral,
} from "../../src/core/form/chapter-catalog";
import { needsContinuationTrackChoice } from "../../src/core/form/chapter-track";
import { segmentNarrativeUnits } from "../../src/core/form/segment-units";

export function runChapterCatalogTests(): void {
  suite("chapter-catalog + segments", () => {
    test("parseChineseNumeral", () => {
      assert.equal(parseChineseNumeral("十二"), 12);
      assert.equal(parseChineseNumeral("二十"), 20);
      assert.equal(parseChineseNumeral("3"), 3);
    });

    test("extractChapterCatalog finds 第N章 titles", () => {
      const text =
        "前文铺垫不匹配\n\n第1章 开端\n正文甲" +
        "\n\n第2章 发展\n" +
        "乙".repeat(100) +
        "\n\n第3章 高潮\n" +
        "丙".repeat(50);
      const cat = extractChapterCatalog(text);
      assert.ok(cat.length >= 3, `got ${cat.length}`);
      assert.equal(cat[0].number, 1);
      assert.ok(cat[0].title.includes("开端") || cat[0].title.includes("第1章"));
      assert.ok((cat[0].endOffset ?? 0) > cat[0].startOffset);
    });

    test("extractChapterCatalog finds 第一章 without space", () => {
      const text = ["第一章", "第二章", "第三章"]
        .map((t, i) => `${t}\n` + "文".repeat(60 + i))
        .join("\n\n");
      const cat = extractChapterCatalog(text);
      assert.ok(cat.length >= 3, `got ${cat.length}`);
      assert.equal(cat[0].number, 1);
      assert.equal(cat[1].number, 2);
    });

    test("extractChapterCatalog finds 【书名】一、标题 style", () => {
      const text = [
        "【欲孽灼心】一、兄嫂弟攻的家庭生活",
        "【欲孽灼心】二、妈的贴身高手",
        "【欲孽灼心】三、我的高傲校花女友才不可能成为乡下小鬼的专属游乐园",
      ]
        .map((t) => `${t}\n` + "叙述内容。" + "字".repeat(80))
        .join("\n\n");
      const cat = extractChapterCatalog(text);
      assert.ok(cat.length >= 3, `got ${cat.length}: ${cat.map((c) => c.title).join(" | ")}`);
      assert.equal(cat[0].number, 1);
      assert.ok(cat[0].title.includes("兄嫂") || cat[0].title.includes("家庭"));
      assert.equal(cat[2].number, 3);
      const style = inferChapteringFromCatalog(text, cat);
      assert.equal(style.enabled, true);
    });

    test("inferChaptering enables when enough chapters", () => {
      const text = [1, 2, 3, 4, 5]
        .map((n) => `第${n}章 标题${n}\n` + "文".repeat(80))
        .join("\n\n");
      const cat = extractChapterCatalog(text);
      const style = inferChapteringFromCatalog(text, cat);
      assert.equal(style.enabled, true);
      assert.ok(style.confidence >= 0.55);
      assert.ok(style.samples.length >= 1);
    });

    test("segmentNarrativeUnits returns units", () => {
      const text = ("场景一内容。" + "啊".repeat(300) + "\n\n\n" + "场景二内容。" + "吧".repeat(300)).repeat(2);
      const units = segmentNarrativeUnits(text);
      assert.ok(units.length >= 1);
      assert.ok(units[0].endOffset > units[0].startOffset);
    });

    test("番外 is track=extra; mainline numbers stay sequential", () => {
      const text = [
        "第1章 开端",
        "甲".repeat(80),
        "第2章 发展",
        "乙".repeat(80),
        "番外 某人往事",
        "丙".repeat(80),
        "第3章 高潮",
        "丁".repeat(80),
      ].join("\n\n");
      const cat = extractChapterCatalog(text);
      assert.ok(cat.length >= 4, `got ${cat.length}`);
      const extra = cat.find((c) => c.track === "extra");
      assert.ok(extra, "should find track=extra");
      assert.ok(
        /往事|番外/.test(extra!.title),
        `extra title=${extra!.title}`,
      );
      const main = cat.filter((c) => !c.track || c.track === "main");
      assert.ok(main.length >= 3);
      assert.equal(main[0].number, 1);
      assert.equal(main[1].number, 2);
      assert.equal(main[2].number, 3);
    });

    test("needsContinuationTrackChoice when book ends on 番外", () => {
      const text = [
        "第1章 开端",
        "甲".repeat(80),
        "第2章 发展",
        "乙".repeat(80),
        "番外 某人往事",
        "丙".repeat(80),
      ].join("\n\n");
      const cat = extractChapterCatalog(text);
      assert.equal(needsContinuationTrackChoice(true, cat), true);
      assert.equal(needsContinuationTrackChoice(false, cat), false);
      const mainOnly = cat.filter((c) => c.track === "main");
      assert.equal(needsContinuationTrackChoice(true, mainOnly), false);
    });
  });
}
