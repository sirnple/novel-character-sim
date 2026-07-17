/**
 * Novel title from filename + body (+ optional LLM).
 */
import { assert, suite, test } from "../lib/test-harness";
import {
  cleanFilenameTitle,
  extractTitle,
  looksLikeChapterHeading,
  resolveNovelTitle,
} from "../../src/lib/utils";

export function runTitleResolveTests(): void {
  suite("title resolve", () => {
    test("cleanFilenameTitle strips site junk and keeps book name", () => {
      assert.equal(
        cleanFilenameTitle(
          "soushu2025.com@《欲孽灼心》1-3作者 佚名[搜书吧].txt",
        ),
        "欲孽灼心",
      );
      assert.equal(cleanFilenameTitle("欲孽灼心.txt"), "欲孽灼心");
      assert.equal(
        cleanFilenameTitle("本书下载自搜书吧：www.soushu2022.com"),
        "",
      );
    });

    test("extractTitle prefers 【书名】 over full chapter line", () => {
      const text =
        "【欲孽灼心】一、兄嫂弟攻的家庭生活\n\n周屿打了转向灯…";
      assert.equal(extractTitle(text), "欲孽灼心");
    });

    test("looksLikeChapterHeading detects chapter lines", () => {
      assert.equal(looksLikeChapterHeading("第1章 开端"), true);
      assert.equal(
        looksLikeChapterHeading("【欲孽灼心】一、兄嫂弟攻的家庭生活"),
        true,
      );
      assert.equal(looksLikeChapterHeading("欲孽灼心"), false);
    });

    test("resolveNovelTitle uses filename when body is chapter heading", () => {
      const title = resolveNovelTitle({
        text: "【欲孽灼心】一、兄嫂弟攻的家庭生活\n正文…",
        fileName: "欲孽灼心.txt",
        llmTitle: "【欲孽灼心】一、兄嫂弟攻的家庭生活",
      });
      assert.equal(title, "欲孽灼心");
    });

    test("resolveNovelTitle prefers cleaned file over download-site first line", () => {
      const title = resolveNovelTitle({
        text: "本书下载自搜书吧：www.example.com\n\n正文开始",
        fileName: "soushu@《春秋风华录》1-10作者甲.txt",
      });
      assert.equal(title, "春秋风华录");
    });
  });
}
