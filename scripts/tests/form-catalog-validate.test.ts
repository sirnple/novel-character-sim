/**
 * Form LLM catalog validation helpers: coherence → name → local window drops.
 */
import { assert, suite, test } from "../lib/test-harness";
import { extractChapterCatalog } from "../../src/core/form/chapter-catalog";
import {
  analyzeCatalogCoherence,
  applyCatalogDrops,
  buildCatalogLlmItems,
  flagSuspiciousChapterName,
} from "../../src/core/form/form-analyzer";
import type { ChapterCatalogEntry } from "../../src/types";

export function runFormCatalogValidateTests(): void {
  suite("form catalog validate", () => {
    test("欲孽灼心 style catalog is coherent", () => {
      const text = [
        "【欲孽灼心】一、兄嫂弟攻的家庭生活",
        "【欲孽灼心】二、妈的贴身高手",
        "【欲孽灼心】三、我的高傲校花女友才不可能成为乡下小鬼的专属游乐园",
      ]
        .map((t) => `${t}\n` + "叙述。" + "字".repeat(80))
        .join("\n\n");
      const cat = extractChapterCatalog(text);
      assert.equal(cat.length, 3);
      const coh = analyzeCatalogCoherence(cat);
      assert.equal(coh.coherent, true);
      assert.equal(coh.sequentialPairs, 2);

      const items = buildCatalogLlmItems(text, cat);
      assert.equal(items.length, 3);
      assert.ok(items[0].rawLine.includes("一、"));
      assert.ok(items[1].rawLine.includes("二、"));
      // Short spicy title is still a chapter name, not body sentence
      assert.equal(items[1].nameSuspicious, false);
      assert.ok(items[0].nearText.includes("兄嫂") || items[0].nearText.includes("欲孽"));
    });

    test("flagSuspiciousChapterName catches body-like titles", () => {
      const a = flagSuspiciousChapterName(
        "他说完就走了，她却站在原地一动不动",
        "他说完就走了，她却站在原地一动不动。",
      );
      assert.equal(a.suspicious, true);

      const b = flagSuspiciousChapterName("妈的贴身高手", "【欲孽灼心】二、妈的贴身高手");
      assert.equal(b.suspicious, false);
    });

    test("applyCatalogDrops rejects bare index on coherent short catalog bulk wipe", () => {
      const catalog: ChapterCatalogEntry[] = [
        { id: "a", number: 1, title: "一", startOffset: 0, source: "regex" },
        { id: "b", number: 2, title: "二", startOffset: 100, source: "regex" },
        { id: "c", number: 3, title: "三", startOffset: 200, source: "regex" },
      ];
      const items = catalog.map((c, index) => ({
        index,
        number: c.number,
        title: c.title,
        startOffset: c.startOffset,
        rawLine: c.title,
        nameSuspicious: false,
        suspicionReasons: [] as string[],
        nearText: c.title,
      }));
      const coh = analyzeCatalogCoherence(catalog);
      const wiped = applyCatalogDrops(
        catalog,
        [
          { index: 0, reason: "legacy_index_only" },
          { index: 1, reason: "legacy_index_only" },
          { index: 2, reason: "legacy_index_only" },
        ],
        items,
        coh,
      );
      // short reasons / no real evidence → keep all
      assert.equal(wiped.length, 3);
    });

    test("applyCatalogDrops allows reasoned drop of one false positive", () => {
      const catalog: ChapterCatalogEntry[] = [
        { id: "a", number: 1, title: "开端", startOffset: 0, source: "regex" },
        {
          id: "b",
          number: 2,
          title: "他说完就走了然后继续",
          startOffset: 100,
          source: "regex",
        },
        { id: "c", number: 3, title: "高潮", startOffset: 200, source: "regex" },
      ];
      const items = catalog.map((c, index) => ({
        index,
        number: c.number,
        title: c.title,
        startOffset: c.startOffset,
        rawLine: c.title,
        nameSuspicious: index === 1,
        suspicionReasons: index === 1 ? ["像叙述"] : [],
        nearText: index === 1 ? "对话中间：他说完就走了然后继续。旁白。" : c.title,
      }));
      const coh = analyzeCatalogCoherence(catalog);
      const next = applyCatalogDrops(
        catalog,
        [
          {
            index: 1,
            reason: "nearText 显示该行在对话段落中间，不是独立章标题",
          },
        ],
        items,
        coh,
      );
      assert.equal(next.length, 2);
      assert.equal(next[0].number, 1);
      assert.equal(next[1].number, 3);
    });
  });
}
