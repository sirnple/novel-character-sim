// 统一换行符为 \n（将 Windows 的 \r\n 和旧 Mac 的 \r 规范为 \n），对已为 \n 的内容不做多余替换
export const normalizeNewlines = (text: string): string => (text.includes("\r") ? text.replace(/\r\n?/g, "\n") : text);

interface SplitOptions {
  removeEmptyLines?: boolean; // 如果为 true, 将移除结果数组中的所有严格空字符串行 ("")
}
export const splitTextIntoLines = (text: string, options: SplitOptions = {}): string[] => {
  if (!text) {
    return [];
  }
  // 先统一换行符，避免在此处重复书写换行正则
  const normalized = normalizeNewlines(text);
  let lines = normalized.split("\n");
  // 现在这里的 options 永远不会是 undefined，代码是安全的
  if (options.removeEmptyLines) {
    lines = lines.filter(Boolean);
  }
  return lines;
};

// 过滤掉只包含空白的行，并根据 shouldTrim 参数决定是否去掉每行的首尾空白
export const cleanLines = (text: string, shouldTrim: boolean = false): string[] =>
  splitTextIntoLines(text)
    .filter((line) => line.trim())
    .map((line) => (shouldTrim ? line.trim() : line));

/**
 * 多行合并为一行：丢弃空白行后用 separator 连接。
 *
 * 丢空行是有意的——保留会在结果里产出连续分隔符（"a,,b"），几乎没有场景想要。
 * separator 传入的是【已解转义】的字符串，解转义留给调用方（同 text-splitter 的
 * getMergedText / text-joiner 的 lineSeparator：存字面串、用时才解）。
 */
export const joinLines = (text: string, separator: string = "", shouldTrim: boolean = true): string => cleanLines(text, shouldTrim).join(separator);

// 截断字符串到指定长度，默认长度为 100K
const MAX_DISPLAY_LENGTH = 100000;
export const truncate = (str: string, num: number = MAX_DISPLAY_LENGTH): string => (str.length <= num ? str : `${str.slice(0, num)}...`);

// 中文段落分割处理
const splitCNParagraph = (text: string) => {
  // ⚠ 正则【字面量】,转义必须是单反斜杠。此前整条正则是字符串形式粘贴过来
  // 的双反斜杠(\\n、\\w、\\u4e00):在字面量里 \\n 匹配「反斜杠+字母n」而非
  // 换行 —— 13 处换行守卫全部失效(已有换行仍重复插空行)、[\\u4e00-\\u9fa5]
  // 解析成乱码字符类(对话归因「”他说道。“」永不分段)、\\b/\\w 分支要求
  // 输入含字面反斜杠(死分支)。
  // ⚠ 字符类交集 [\w&&[^\d]] 只在 v flag 下存在:无 v 时类在首个 ] 闭合,
  // 残余 ]{2,11} 变成字面量 —— 标签分支既不命中本意场景,还对 "x]]：" 误分段。
  // 本意 = \w 去掉数字,直接写 [A-Za-z_･]。
  const paragraphCNSplitRegex =
    /(如下：(?!\n)|[^\n“”][。；！？]”?\b(?=[A-Za-z_･]{2,11}：[^\n“])|(?:\w」?；)(?=[^\n“”：；]{14})|(?<=\w：“[^\n“”]{1,39}[。！？—…]”)(?=[^\n“”：；]{1,39}：“)|(?:[^\n【】]】)(?=【\w{1,7}：)|(?:\w[：；。！？]{1,2}[”]?)(?=[第其][一二三四五六七八九][，、]|[一二三四五六七八九][则来是者]?[，、]|[①-⓿][^\n]|（[^\n（）]{17,29}[。！？…]）\n)|(?:[^\n“”][。！？—…]”)(?:[一-龥]{1,14}[说道]。)?(?=“[^\n“”])|(?<=[^\n]{4})(?:[^\n]{24}[。！？—…][』”’】］）]?)(?=[^\n]{29})(?<![。！？—…]\w{1,4}[！？…]{1,2})(?![、，。：；！？—…]|(?<=(\w{1,3})……)\2|(?<=[—…”])[^“”。：；！？—…]{1,14}[。：；！？—…]|(?<=……)(?:[等略]|以?及|的[^的确士])|(?<=[』”’】］）])[的地]))(?<!“[^\n”]{1,34}|‘[^\n’]{1,34}|「[^\n」]{1,34}|『[^\n』]{1,34}|（[^\n）]{1,34}|【[^\n】]{1,34}|［[^\n］]{1,34})(?![^\n“]{0,34}”|[^\n‘]{0,34}’|[^\n「]{0,34}」|[^\n『]{0,34}』|[^\n（]{0,34}）|[^\n【]{0,34}】|[^\n［]{0,34}］)/g;
  return text.replace(paragraphCNSplitRegex, "$1\n");
};

// 智能英文段落分割
const splitEnglishParagraph = async (text: string): Promise<string> => text;

type ParagraphSplitMethod = "cn" | "en";
export const splitParagraphSync = (text: string): string => splitCNParagraph(text);

export const splitParagraph = async (text: string, method: ParagraphSplitMethod = "cn"): Promise<string> => {
  switch (method) {
    case "cn":
      return splitCNParagraph(text);
    case "en":
      return await splitEnglishParagraph(text);
  }
};

// 将字符串中的全角数字和字母转为半角
export const toHalfWidth = (text: string): string => text.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 65248));

// 过滤文本中的行；filters 可为字符串（按逗号/换行切分，两种写法等价——单行输入框
// 用逗号、多行黑名单用换行，不该是两个概念）或已切好的字符串数组
// exact：整行精确匹配（比较时两侧都 trim），默认按子串包含
// maxLen：长度阈值。0、undefined、负数 均视作"未启用"（不保留超长行的豁免规则）
export interface FilterLinesOptions {
  exact?: boolean;
  maxLen?: number;
}
export const filterLines = (text: string, filters: string | string[], options: FilterLinesOptions = {}): string => {
  const { exact = false, maxLen } = options;
  const list = (Array.isArray(filters) ? filters : filters.split(/[\n,]/)).map((w) => w.trim()).filter(Boolean);
  const exactSet = exact ? new Set(list) : undefined;
  const hasMaxLen = typeof maxLen === "number" && maxLen > 0;
  return splitTextIntoLines(text)
    .filter((line) => {
      if (hasMaxLen && line.trim().length > maxLen) return true;
      if (exactSet) return !exactSet.has(line.trim());
      return !list.some((f) => line.includes(f));
    })
    .join("\n");
};

// 移除相邻重复行（比较时会 trim）
export const dedupeAdjacentLines = (lines: string[]): string[] => {
  if (lines.length === 0) return lines;
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i].trim();
    const prev = i > 0 ? lines[i - 1].trim() : "";
    if (i === 0 || cur !== prev) out.push(lines[i]);
  }
  return out;
};

// 整行只由句子标点（？！。…，、；：等）组成时不算分隔符——可能是正文里的反应/停顿行（？？？、……？、。。。）
const SENTENCE_PUNCT_ONLY = /^[？！。…，、；：?!.,;:]+$/u;
// 分隔行：整行仅由符号组成（≥3 个非字母/数字/空白字符，如 =====、---、***、~~~、→→→），但排除纯句子标点行 = 段落分隔，由排版步骤删掉并转成断点
export const isSeparatorBar = (s: string): boolean => {
  const t = s.trim();
  // emoji 行(😂😂😂、❤️❤️❤️)是正文里的反应行,与纯句标点行同类,不算横幅 ——
  // 排版步骤会把横幅整行删除,误判即静默丢内容。只测 Emoji_Presentation 与
  // VS16(️):★★★/❉❉❉ 这类文本呈现的装饰符仍按横幅处理(行为不变)。
  return t.length >= 3 && /^[^\p{L}\p{N}\s]+$/u.test(t) && !SENTENCE_PUNCT_ONLY.test(t) && !/[\p{Emoji_Presentation}️]/u.test(t);
};

// 通用：移除所有重复行（非相邻去重），支持 trim 比较
// 曾有 exclude 选项（顺带删掉黑名单行）——那是 filterLines 的活，混在去重里只会
// 让"点去重却少了不重复的行"变得无法解释，已移交 filterLines({ exact: true })
export interface DedupeOptions {
  trim?: boolean;
}
export const dedupeLines = (lines: string[], options: DedupeOptions = {}): string[] => {
  const { trim = true } = options;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const key = trim ? line.trim() : line;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(line);
    }
  }
  return out;
};

// Cache for compressNewlines regexes to avoid recompilation
const compressNewlinesRegexCache = new Map<number, RegExp>();

// 压缩连续换行符，默认将 3 个及以上换行压缩为 2 个
export const compressNewlines = (text: string, maxConsecutive: number = 2): string => {
  if (maxConsecutive < 1) return text.replace(/\n+/g, "\n");

  let re = compressNewlinesRegexCache.get(maxConsecutive);
  if (!re) {
    re = new RegExp(`\\n{${maxConsecutive + 1},}`, "g");
    compressNewlinesRegexCache.set(maxConsecutive, re);
  }

  return text.replace(re, "\n".repeat(maxConsecutive));
};

export const escapeRegExp = (str: string): string =>
  str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

