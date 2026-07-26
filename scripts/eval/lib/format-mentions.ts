/**
 * Format mentions for eval markdown: `surface@u{globalStart}` (u = global offset).
 * Missing anchors fall back to bare surface.
 */
export function formatMentionsWithOffset(
  mentions: Array<{
    surface?: string;
    offsetAnchor?: { globalStart?: number; globalEnd?: number } | null;
  }>,
): string {
  const items = (mentions || []).map((m) => {
    const s = (m.surface || "").trim() || "?";
    const g = m.offsetAnchor?.globalStart;
    return {
      s,
      g: typeof g === "number" ? g : null,
      text: typeof g === "number" ? `${s}@u${g}` : s,
    };
  });
  items.sort((a, b) => {
    if (a.g != null && b.g != null) return a.g - b.g;
    if (a.g != null) return -1;
    if (b.g != null) return 1;
    return a.s.localeCompare(b.s);
  });
  return items.map((x) => x.text).join("、");
}
