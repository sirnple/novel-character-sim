/**
 * Program chapter catalog + form segmentation.
 */
import { assert, suite, test } from "../lib/test-harness";
import {
  extractChapterCatalog,
  inferChapteringFromCatalog,
  parseChineseNumeral,
} from "../../src/core/form/chapter-catalog";
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
        "序章忽略\n\n第1章 开端\n正文甲".repeat(1) +
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
  });
}
