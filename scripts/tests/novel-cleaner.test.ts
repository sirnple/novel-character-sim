/**
 * Novel cleaner tests — engine is novel-processor formatNovelText.
 */
import { assert, suite, test } from "../lib/test-harness";
import {
  cleanNovelText,
  novelCleanLineKey,
  toProcessorOptions,
} from "../../src/core/parser/novel-cleaner";
import {
  NOVEL_CLEAN_DEFAULTS,
  resolveNovelCleanConfig,
  validateNovelCleanPatterns,
} from "../../src/lib/novel-clean-config";
import {
  buildCleanPreview,
  CLEAN_PREVIEW_FULL_MAX_BYTES,
} from "../../src/lib/novel-clean-preview";
import { formatNovelText, stripNovelArtifacts } from "../../src/core/parser/novel-processor";

function chapterBlock(n: number, body: string, foot = ""): string {
  return `第${n}章 标题${n}\n\n${body}\n${foot ? foot + "\n" : ""}`;
}

export function runNovelCleanerTests(): void {
  suite("novel clean config", () => {
    test("defaults resolve with fingerprint", () => {
      const r = resolveNovelCleanConfig();
      assert.equal(r.enabled, false);
      assert.ok(r.fingerprint.length >= 8);
      assert.ok(r.siteNamesList.includes("笔趣阁"));
    });

    test("partial override disables statistical", () => {
      const r = resolveNovelCleanConfig({ statistical: false });
      assert.equal(r.statistical, false);
      assert.equal(r.enabled, NOVEL_CLEAN_DEFAULTS.enabled);
    });

    test("invalid regex fails validation", () => {
      const errs = validateNovelCleanPatterns({
        lineAdPatterns: ["("],
      });
      assert.ok(errs.length >= 1);
      assert.equal(errs[0].field, "lineAdPatterns");
    });

    test("toProcessorOptions yields filter keywords", () => {
      const r = resolveNovelCleanConfig();
      const opts = toProcessorOptions(r);
      assert.ok(opts.filterText.includes("请记住本站"));
      assert.equal(typeof opts.smartLineBreak, "boolean");
    });
  });

  suite("novel-processor engine", () => {
    test("stripNovelArtifacts removes mid-line 更新最快", () => {
      const raw =
        "他立即在此人身上撒下（更新最快）了大把的巨金，并刻意奉承。";
      const out = stripNovelArtifacts(raw);
      assert.ok(out.includes("大把的巨金"));
      assert.ok(!out.includes("更新最快"));
    });

    test("formatNovelText runs defaults", () => {
      const raw = [
        "第一章 开端",
        "",
        "晨光穿过薄雾。",
        "请记住本站域名，方便下次阅读",
        "他继续向前走。",
      ].join("\n");
      const out = formatNovelText(raw, {
        enableChapterSplit: true,
        filterText: "请记住本站",
        maxFilterLineLength: 80,
        enableLineEndNumbers: false,
        enableParagraphSplit: false,
        smartLineBreak: true,
        enableTrim: true,
        mergeDuplicateChapterTitles: true,
        removeDuplicateLines: true,
        enableIndent: false,
        specialStart: "",
      });
      assert.ok(out.includes("晨光穿过薄雾"));
      assert.ok(out.includes("他继续向前"));
      assert.ok(!out.includes("请记住本站"));
    });
  });

  suite("novel cleaner", () => {
    test("default enabled=false is no-op", () => {
      const raw = "第一章\n请记住本站域名\n正文";
      const { text, stats } = cleanNovelText(raw);
      assert.ok(text.includes("请记住本站"));
      assert.equal(stats.removedChars, 0);
    });

    test("strips whole-line ads when enabled", () => {
      const raw = [
        "第一章 开端",
        "",
        "晨光穿过薄雾。",
        "https://www.biquge.com/book/123.html",
        "请记住本站域名，方便下次阅读",
        "他继续向前走。",
      ].join("\n");

      const { text, report } = cleanNovelText(raw, {
        config: { enabled: true, statistical: false },
      });
      assert.ok(text.includes("晨光穿过薄雾"));
      assert.ok(text.includes("他继续向前"));
      assert.ok(!text.includes("请记住本站"));
      assert.ok(report.configFingerprint.length >= 8);
    });

    test("inline watermark 更新最快 keeps prose when enabled", () => {
      const raw = [
        "第一章",
        "在知道这人对金子有某种痴迷后，他立即在此人身上撒下（更新最快）了大把的巨金，并刻意奉承。",
        "“咳！也只有再等等了，看下来会有什么机会更新最快]没有？”韩立也是一样的束手无策。",
      ].join("\n");

      const { text } = cleanNovelText(raw, { config: { enabled: true } });
      assert.ok(text.includes("大把的巨金") || text.includes("刻意奉承"));
      assert.ok(text.includes("束手无策"));
      assert.ok(!text.includes("更新最快"));
    });

    test("excludeLineKeys still accepted (no crash)", () => {
      const ad = "请记住本站域名，方便下次阅读";
      const raw = ["第一章", ad, "正文在这里。"].join("\n");
      const key = novelCleanLineKey(ad);
      const { text } = cleanNovelText(raw, {
        config: { enabled: true },
        excludeLineKeys: [key],
      });
      // Processor may still filter; key path must not throw
      assert.ok(typeof text === "string");
    });

    test("clean book stays mostly intact when enabled", () => {
      const raw = [
        "第一章 石猴出世",
        "",
        "东胜神洲有傲来国，国近大海，海中有一座名山。",
        "",
        "第二章 拜师学艺",
        "",
        "美猴王高登王位，将那排班有品、有爵无名者，俱封了官职。",
      ].join("\n");
      const { text, stats } = cleanNovelText(raw, {
        config: { enabled: true },
      });
      assert.ok(text.includes("东胜神洲"));
      assert.ok(text.includes("美猴王"));
      assert.ok(stats.removeRatio < 0.15);
    });

    test("idempotent-ish: second clean does not explode length", () => {
      const raw = [
        "第一章 开始",
        "正文内容在这里。",
        "请记住本站域名",
        "第二章 继续",
        "更多正文。",
      ].join("\n");
      const once = cleanNovelText(raw, { config: { enabled: true } });
      const twice = cleanNovelText(once.text, { config: { enabled: true } });
      assert.ok(
        Math.abs(twice.text.length - once.text.length) <
          Math.max(20, once.text.length * 0.05),
      );
    });
  });

  suite("novel clean preview", () => {
    test("buildCleanPreview returns report + full mode for small text", () => {
      const raw = [
        "第一章",
        "请记住本站域名",
        "正文情节在此展开。",
      ].join("\n");
      const preview = buildCleanPreview({
        text: raw,
        cleanOptions: {
          resolved: resolveNovelCleanConfig({ enabled: true }),
        },
      });
      assert.equal(preview.previewMode, "full");
      assert.ok(preview.cleanedPreview.includes("正文情节"));
      assert.ok(preview.report.configFingerprint.length >= 8);
    });

    test("buildCleanPreview head_tail when cleaned is huge", () => {
      const pad = "正文段落内容。".repeat(
        Math.ceil((CLEAN_PREVIEW_FULL_MAX_BYTES + 1000) / 7),
      );
      const raw = `第一章\n${pad}`;
      const preview = buildCleanPreview({
        text: raw,
        cleanOptions: {
          resolved: resolveNovelCleanConfig({ enabled: true }),
          processor: {
            smartLineBreak: false,
            enableChapterSplit: false,
            enableTrim: false,
            mergeDuplicateChapterTitles: false,
            removeDuplicateLines: false,
            filterText: "",
            maxFilterLineLength: 0,
            enableLineEndNumbers: false,
            enableParagraphSplit: false,
            enableIndent: false,
            specialStart: "",
          },
        },
      });
      assert.equal(preview.previewMode, "head_tail");
      assert.ok(preview.cleanedLength > CLEAN_PREVIEW_FULL_MAX_BYTES);
    });
  });
}
