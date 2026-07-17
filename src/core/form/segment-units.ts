/**
 * Narrative unit segmentation when chaptering is disabled.
 * Prefer scene blocks (blank lines); fallback to fixed char windows.
 */
import type { NarrativeUnit } from "@/types";

const WINDOW_CHARS = 6_000;
const MIN_SCENE_CHARS = 200;
const MAX_SCENE_CHARS = 20_000;

/** Split by 2+ newlines or *** / ——— scene breaks. */
export function segmentByScenes(text: string): NarrativeUnit[] {
  if (!text) return [];
  const parts: { start: number; end: number; body: string }[] = [];
  const re = /\n{2,}|\n[ 　]*\*{3,}[ 　]*\n|\n[ 　]*[—–-]{3,}[ 　]*\n/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const end = m.index;
    if (end > last) {
      parts.push({ start: last, end, body: text.slice(last, end) });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    parts.push({ start: last, end: text.length, body: text.slice(last) });
  }

  const units: NarrativeUnit[] = [];
  let bufStart = 0;
  let buf = "";
  const flush = (end: number) => {
    const body = buf.trim();
    if (body.length < MIN_SCENE_CHARS && units.length > 0) {
      // merge into previous
      const prev = units[units.length - 1];
      prev.endOffset = end;
      prev.label = `场景 ${units.length}`;
      buf = "";
      return;
    }
    if (!body) {
      buf = "";
      return;
    }
    units.push({
      unitId: `scene_${units.length + 1}_${bufStart}`,
      unitKind: "scene",
      startOffset: bufStart,
      endOffset: end,
      label: `场景 ${units.length + 1}`,
    });
    buf = "";
  };

  for (const p of parts) {
    if (!buf) bufStart = p.start;
    buf += (buf ? "\n\n" : "") + p.body;
    if (buf.length >= MIN_SCENE_CHARS) {
      // split oversized
      while (buf.length > MAX_SCENE_CHARS) {
        const cut = bufStart + MAX_SCENE_CHARS;
        units.push({
          unitId: `scene_${units.length + 1}_${bufStart}`,
          unitKind: "scene",
          startOffset: bufStart,
          endOffset: cut,
          label: `场景 ${units.length + 1}`,
        });
        buf = text.slice(cut, p.end);
        bufStart = cut;
      }
      flush(p.end);
      bufStart = p.end;
    }
  }
  if (buf.trim()) flush(text.length);

  return units.length > 0 ? units : segmentByWindows(text);
}

export function segmentByWindows(
  text: string,
  windowChars = WINDOW_CHARS,
): NarrativeUnit[] {
  if (!text) return [];
  const units: NarrativeUnit[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(text.length, i + windowChars);
    if (end < text.length) {
      const nearby = text.indexOf("\n\n", Math.max(end - 200, i + 100));
      if (nearby > i && nearby <= end + 200) end = nearby;
    }
    units.push({
      unitId: `win_${units.length + 1}_${i}`,
      unitKind: "window",
      startOffset: i,
      endOffset: end,
      label: `段 ${units.length + 1}（${i}–${end}字）`,
    });
    if (end >= text.length) break;
    i = end;
  }
  return units;
}

/** Prefer scenes; if too few for long text, fall back to windows. */
export function segmentNarrativeUnits(text: string): NarrativeUnit[] {
  if (!text) return [];
  if (text.length < 3_000) {
    return [{
      unitId: `win_1_0`,
      unitKind: "window",
      startOffset: 0,
      endOffset: text.length,
      label: "全文",
    }];
  }
  const scenes = segmentByScenes(text);
  if (text.length > 30_000 && scenes.length < 3) {
    return segmentByWindows(text);
  }
  return scenes;
}
