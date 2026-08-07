/**
 * novel-processor core (MIT, rockbenben) — formatting / cleanup engine.
 * @see ./NOTICE.md
 */
export {
  formatNovelText,
  stripNovelArtifacts,
  reorderChaptersByTitle,
  splitInlineChapterTitles,
  type NovelFormatOptions,
} from "./format-novel";
export {
  normalizeNewlines,
  splitTextIntoLines,
  compressNewlines,
  filterLines,
  toHalfWidth,
} from "./text-utils";

/** novel-processor UI defaults adapted for our server pipeline. */
export const NOVEL_PROCESSOR_DEFAULT_OPTIONS = {
  enableChapterSplit: true,
  filterText: [
    "请记住本站",
    "本站域名",
    "求月票",
    "求推荐票",
    "上一章",
    "下一章",
    "返回目录",
    "天才一秒记住",
  ].join("\n"),
  maxFilterLineLength: 80,
  enableLineEndNumbers: false,
  enableParagraphSplit: false,
  smartLineBreak: true,
  enableTrim: true,
  mergeDuplicateChapterTitles: true,
  removeDuplicateLines: true,
  enableIndent: false,
  specialStart: "",
} as const;
