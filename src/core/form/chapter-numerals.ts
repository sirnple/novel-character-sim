/**
 * Chinese / arabic numeral parsing for chapter titles.
 */
const CN_MAP: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 百: 100, 千: 1000,
};

export function parseChineseNumeral(s: string): number | undefined {
  const t = (s || "").trim();
  if (!t) return undefined;
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  let total = 0;
  let current = 0;
  for (const ch of t) {
    const v = CN_MAP[ch];
    if (v === undefined) return undefined;
    if (v === 10 || v === 100 || v === 1000) {
      if (current === 0) current = 1;
      total += current * v;
      current = 0;
    } else {
      current = v;
    }
  }
  return total + current;
}
