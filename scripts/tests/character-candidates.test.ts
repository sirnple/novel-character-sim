/**
 * Program character candidate scan (full-text heuristics).
 */
import { assert, suite, test } from "../lib/test-harness";
import {
  formatCandidatesForPrompt,
  scanCharacterCandidates,
} from "../../src/core/extractor/character-candidates";

export function runCharacterCandidatesTests(): void {
  suite("character-candidates", () => {
    test("speech patterns pick up speakers", () => {
      const text = [
        "周屿看着许栀，轻声说道：「你是周航的老师？」",
        "许栀笑道：「是的。」",
        "秦予嫣问：「她住哪？」",
        "周屿道：「三楼。」",
        "许栀说道：「麻烦你了。」",
        "周屿说：「不麻烦。」",
        "秦予嫣冷笑道：「是吗。」",
        "周屿没有回答。",
        "王铎喊：「屿哥！」",
        "周屿道：「什么事。」",
        "王铎说：「没事。」",
      ].join("\n");

      const cands = scanCharacterCandidates(text, { minCount: 1, maxCandidates: 20 });
      const names = cands.map((c) => c.name);
      assert.ok(names.includes("周屿"), `got ${names.join(",")}`);
      assert.ok(names.includes("许栀") || names.includes("秦予嫣"), `got ${names.join(",")}`);
    });

    test("blacklist filters common non-names", () => {
      const text = "他们说道：「好。」我们说道：「行。」什么说道：「嗯。」".repeat(5);
      const cands = scanCharacterCandidates(text, { minCount: 1 });
      const names = cands.map((c) => c.name);
      assert.ok(!names.includes("他们"));
      assert.ok(!names.includes("我们"));
      assert.ok(!names.includes("什么"));
    });

    test("formatCandidatesForPrompt non-empty", () => {
      const text = "周屿说道：「你好。」许栀笑道：「你好。」".repeat(3);
      const cands = scanCharacterCandidates(text, { minCount: 1 });
      const s = formatCandidatesForPrompt(cands);
      assert.ok(s.includes("周屿") || s.includes("许栀"));
    });

    test("narrative mentions without speech still find surnamed names", () => {
      // First-person style: names as objects, almost never "X说"
      // Separate paragraphs so span crosses buckets; avoid function-word n-grams
      const chunks: string[] = [];
      for (let i = 0; i < 25; i++) {
        chunks.push(
          `【第${i}章】未婚妻洛雪棠啊。洛雪棠的身影停在不远处。洛雪棠，你还好吗。`,
          `妹妹洛雨棠才十岁。洛雨棠，长得粉雕玉琢。洛雨棠跟在后面。`,
          `战略家李志宇的下场。李志宇的气息逼近。李志宇留下了遗产。`,
          `赵芷然咬住嘴唇，想起李志宇与洛雪棠、洛雨棠。`,
        );
      }
      const text = chunks.join("\n\n");
      const cands = scanCharacterCandidates(text, { minCount: 2, maxCandidates: 30 });
      const names = cands.map((c) => c.name);
      assert.ok(names.includes("洛雪棠"), `missing 洛雪棠, got ${names.join(",")}`);
      assert.ok(names.includes("洛雨棠"), `missing 洛雨棠, got ${names.join(",")}`);
      assert.ok(names.includes("李志宇"), `missing 李志宇, got ${names.join(",")}`);
    });

    test("does not rank function words above real names", () => {
      const text =
        "可以说这是一段故事。都不知道发生了什么。每一天都如此。".repeat(10) +
        "洛雪棠走了过来。洛雪棠的眼睛亮了。洛雪棠，你在吗？".repeat(15);
      const cands = scanCharacterCandidates(text, { minCount: 2, maxCandidates: 20 });
      const names = cands.map((c) => c.name);
      assert.ok(names.includes("洛雪棠"), `got ${names.join(",")}`);
      const top5 = names.slice(0, 5);
      assert.ok(!top5.includes("可以"), `function word in top: ${top5.join(",")}`);
      assert.ok(!top5.includes("都不"), `function word in top: ${top5.join(",")}`);
    });

    test("nicknames without surname: speech and 阿X/X仔/*大叔", () => {
      const text = [
        "阿龙说道：「走。」",
        "黑仔喊道：「等等。」",
        "短发大叔道：「上车。」",
        "阿龙说：「好。」",
        "黑仔说：「行。」",
        "短发大叔说：「快。」",
        "老吴问道：「谁？」",
        "阿龙道：「我。」",
        "黑仔道：「他。」",
        "短发大叔道：「走。」",
        // pure narrative nicknames
        "阿龙来了。阿龙走了。阿龙又来了。阿龙坐下。阿龙点头。",
        "黑仔笑了。黑仔走了。黑仔又来。黑仔点头。黑仔离开。",
        // mid-sentence with Han lead-in
        "我小名叫黑仔，他是黑仔。",
        "教务处副主任老吴。门外老吴的脚步声。",
        "一个长脸大叔端着托盘。旁边长脸大叔点头。那个长脸大叔也跟着。",
      ].join("\n");
      const cands = scanCharacterCandidates(text, { minCount: 1, maxCandidates: 40 });
      const names = cands.map((c) => c.name);
      assert.ok(names.includes("阿龙"), `missing 阿龙, got ${names.join(",")}`);
      assert.ok(names.includes("黑仔"), `missing 黑仔, got ${names.join(",")}`);
      assert.ok(
        names.includes("短发大叔") || names.some((n) => n.includes("大叔")),
        `missing 短发大叔, got ${names.join(",")}`,
      );
      assert.ok(names.includes("老吴"), `missing 老吴, got ${names.join(",")}`);
      // *大叔 nicknames: at least one descriptive 大叔 form
      assert.ok(
        names.includes("长脸大叔") || names.includes("短发大叔"),
        `missing *大叔, got ${names.join(",")}`,
      );
    });
  });
}
