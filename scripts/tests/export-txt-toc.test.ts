/**
 * TXT export TOC prepend.
 */
import { assert, suite, test } from "../lib/test-harness";
import {
  formatChapterTocLine,
  prependTocToTxt,
} from "../../src/lib/export-txt-toc";
import type { ChapterCatalogEntry } from "../../src/types";

export function runExportTxtTocTests(): void {
  suite("export-txt-toc", () => {
    test("formatChapterTocLine with number + title", () => {
      const c: ChapterCatalogEntry = {
        id: "1",
        number: 2,
        title: "雨夜",
        startOffset: 0,
        source: "regex",
      };
      assert.equal(formatChapterTocLine(c), "第2章 雨夜");
    });

    test("prependTocToTxt empty catalog leaves body", () => {
      assert.equal(prependTocToTxt("正文", []), "正文");
      assert.equal(prependTocToTxt("正文", null), "正文");
    });

    test("prependTocToTxt adds 目录 block", () => {
      const chapters: ChapterCatalogEntry[] = [
        { id: "a", number: 1, title: "开端", startOffset: 0, source: "regex" },
        { id: "b", number: 2, title: "发展", startOffset: 10, source: "regex" },
      ];
      const out = prependTocToTxt("第一章正文…", chapters);
      assert.ok(out.startsWith("【目录】"));
      assert.ok(out.includes("1. 第1章 开端"));
      assert.ok(out.includes("2. 第2章 发展"));
      assert.ok(out.includes("第一章正文…"));
      assert.ok(out.indexOf("【目录】") < out.indexOf("第一章正文…"));
    });
  });
}
