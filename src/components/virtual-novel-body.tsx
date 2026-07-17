"use client";

/**
 * Virtualized novel body.
 * Jump accuracy: inject data-char-anchor at known offsets, then scrollIntoView
 * after the target chunk is mounted (no fragile px/char estimates for jump).
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
} from "react";

export const VIRTUAL_CHUNK_CHARS = 4_000;
const OVERSCAN = 3;
/** Fallback estimate until ResizeObserver fills measured heights */
export const EST_PX_PER_CHAR = 1.05;
export const CHUNK_CHROME_PX = 56;

export interface VirtualChunk {
  index: number;
  baseOffset: number;
  text: string;
}

export type VirtualNovelBodyHandle = {
  scrollToCharOffset: (charOffset: number) => void;
  getScroller: () => HTMLElement | null;
};

export function splitIntoChunks(
  text: string,
  chunkSize: number = VIRTUAL_CHUNK_CHARS,
): VirtualChunk[] {
  if (!text) return [];
  const out: VirtualChunk[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    out.push({
      index: out.length,
      baseOffset: i,
      text: text.slice(i, i + chunkSize),
    });
  }
  return out;
}

function estimateChunkHeight(charLen: number): number {
  return Math.max(80, Math.ceil(charLen * EST_PX_PER_CHAR) + CHUNK_CHROME_PX);
}

export interface VirtualNovelBodyProps {
  text: string;
  className?: string;
  /**
   * Optional absolute char offsets to mark (e.g. chapter starts).
   * Used for reliable jump via scrollIntoView.
   */
  jumpAnchors?: number[];
  renderChunk?: (chunk: VirtualChunk) => ReactNode;
  scrollerClassName?: string;
  onScrollOffsetChange?: (approxCharOffset: number) => void;
  onBodyClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  scrollerRef?: React.RefObject<HTMLDivElement | null>;
}

const VirtualNovelBody = forwardRef<VirtualNovelBodyHandle, VirtualNovelBodyProps>(
  function VirtualNovelBody(
    {
      text,
      className = "",
      jumpAnchors = [],
      renderChunk,
      scrollerClassName = "",
      onScrollOffsetChange,
      onBodyClick,
      scrollerRef: scrollerRefProp,
    },
    ref,
  ) {
    const innerRef = useRef<HTMLDivElement>(null);
    const chunks = useMemo(() => splitIntoChunks(text), [text]);
    const measuredRef = useRef<Map<number, number>>(new Map());
    const [measureGen, setMeasureGen] = useState(0);
    const pendingJumpRef = useRef<number | null>(null);

    const heights = useMemo(() => {
      return chunks.map((c, i) => {
        const m = measuredRef.current.get(i);
        return m != null ? m : estimateChunkHeight(c.text.length);
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chunks, measureGen]);

    const totalHeight = useMemo(
      () => heights.reduce((a, b) => a + b, 0),
      [heights],
    );
    const prefixHeights = useMemo(() => {
      const p = new Array(heights.length + 1);
      p[0] = 0;
      for (let i = 0; i < heights.length; i++) p[i + 1] = p[i] + heights[i];
      return p;
    }, [heights]);

    // Anchors grouped by chunk index
    const anchorsByChunk = useMemo(() => {
      const map = new Map<number, number[]>();
      if (!text.length || !jumpAnchors.length) return map;
      const sorted = Array.from(new Set(jumpAnchors))
        .filter((o) => o >= 0 && o < text.length)
        .sort((a, b) => a - b);
      for (const off of sorted) {
        const idx = Math.min(
          Math.floor(off / VIRTUAL_CHUNK_CHARS),
          Math.max(0, chunks.length - 1),
        );
        const list = map.get(idx) || [];
        list.push(off);
        map.set(idx, list);
      }
      return map;
    }, [jumpAnchors, text.length, chunks.length]);

    const [range, setRange] = useState({
      start: 0,
      end: Math.min(chunks.length, 8),
    });

    const getEl = useCallback((): HTMLDivElement | null => {
      return (
        (scrollerRefProp && "current" in scrollerRefProp
          ? scrollerRefProp.current
          : null) || innerRef.current
      );
    }, [scrollerRefProp]);

    const charOffsetFromScrollTop = useCallback(
      (scrollTop: number): number => {
        if (!chunks.length) return 0;
        let i = 0;
        while (i < chunks.length && prefixHeights[i + 1] <= scrollTop) i++;
        if (i >= chunks.length) return text.length;
        const localPx = scrollTop - prefixHeights[i];
        const h = heights[i] || 1;
        const ratio = Math.min(1, Math.max(0, localPx / h));
        const localChar = Math.floor(ratio * chunks[i].text.length);
        return Math.min(text.length, chunks[i].baseOffset + localChar);
      },
      [chunks, heights, prefixHeights, text.length],
    );

    const recompute = useCallback(() => {
      const el = getEl();
      if (!el || chunks.length === 0) return;
      const viewTop = el.scrollTop;
      const viewBottom = viewTop + el.clientHeight;
      let start = 0;
      while (start < chunks.length && prefixHeights[start + 1] < viewTop) start++;
      let end = start;
      while (end < chunks.length && prefixHeights[end] < viewBottom) end++;
      start = Math.max(0, start - OVERSCAN);
      end = Math.min(chunks.length, end + OVERSCAN + 1);
      setRange((prev) =>
        prev.start === start && prev.end === end ? prev : { start, end },
      );
      if (pendingJumpRef.current == null) {
        onScrollOffsetChange?.(charOffsetFromScrollTop(viewTop + 12));
      }
    }, [
      chunks,
      prefixHeights,
      onScrollOffsetChange,
      getEl,
      charOffsetFromScrollTop,
    ]);

    useEffect(() => {
      recompute();
    }, [text, recompute, heights]);

    // Measure mounted chunk heights
    useEffect(() => {
      const el = getEl();
      if (!el || text.length <= VIRTUAL_CHUNK_CHARS * 2) return;
      const nodes = el.querySelectorAll<HTMLElement>("[data-chunk-index]");
      if (!nodes.length) return;
      const ro = new ResizeObserver((entries) => {
        let changed = false;
        for (const entry of entries) {
          const node = entry.target as HTMLElement;
          const idx = parseInt(node.dataset.chunkIndex || "-1", 10);
          if (idx < 0) continue;
          const h = Math.ceil(entry.borderBoxSize?.[0]?.blockSize || entry.contentRect.height);
          if (h > 0 && measuredRef.current.get(idx) !== h) {
            measuredRef.current.set(idx, h);
            changed = true;
          }
        }
        if (changed) setMeasureGen((n) => n + 1);
      });
      nodes.forEach((n) => ro.observe(n));
      return () => ro.disconnect();
    }, [range.start, range.end, text, getEl, measureGen]);

    /** After target chunk is in DOM, snap via Range (preferred) or anchor / estimate. */
    const finalizeJump = useCallback(
      (off: number) => {
        const el = getEl();
        if (!el) return;

        const chunkIdx = Math.min(
          Math.floor(off / VIRTUAL_CHUNK_CHARS),
          Math.max(0, chunks.length - 1),
        );
        const chunk = chunks[chunkIdx];
        if (!chunk) {
          pendingJumpRef.current = null;
          return;
        }
        const local = off - chunk.baseOffset;
        const chunkEl = el.querySelector<HTMLElement>(
          `[data-chunk-index="${chunkIdx}"]`,
        );

        // 1) Range API inside mounted chunk (works with custom renderChunk)
        if (chunkEl) {
          const top = measureViewportTopForLocalOffset(chunkEl, local);
          if (top != null) {
            const scRect = el.getBoundingClientRect();
            const next = el.scrollTop + (top - scRect.top) - 8;
            const max = Math.max(0, el.scrollHeight - el.clientHeight);
            el.scrollTop = Math.min(Math.max(0, next), max);
            pendingJumpRef.current = null;
            onScrollOffsetChange?.(off);
            recompute();
            return;
          }
        }

        // 2) Explicit anchor span (plain-text path)
        const anchor = el.querySelector<HTMLElement>(
          `[data-char-anchor="${off}"]`,
        );
        if (anchor) {
          anchor.scrollIntoView({ block: "start", behavior: "auto" });
          el.scrollTop = Math.max(0, el.scrollTop - 8);
          pendingJumpRef.current = null;
          onScrollOffsetChange?.(off);
          recompute();
          return;
        }

        // 3) Fallback estimate
        let topEst = 0;
        for (let i = 0; i < chunkIdx; i++) {
          topEst +=
            measuredRef.current.get(i) ??
            estimateChunkHeight(chunks[i].text.length);
        }
        const h =
          measuredRef.current.get(chunkIdx) ??
          estimateChunkHeight(chunk.text.length);
        const ratio =
          chunk.text.length > 0 ? local / chunk.text.length : 0;
        topEst += ratio * h;
        const max = Math.max(0, el.scrollHeight - el.clientHeight);
        el.scrollTop = Math.min(topEst, max);
        pendingJumpRef.current = null;
        onScrollOffsetChange?.(off);
        recompute();
      },
      [getEl, chunks, onScrollOffsetChange, recompute],
    );

    // When pending jump and range includes target, finalize after paint
    useEffect(() => {
      const off = pendingJumpRef.current;
      if (off == null) return;
      const chunkIdx = Math.min(
        Math.floor(off / VIRTUAL_CHUNK_CHARS),
        Math.max(0, chunks.length - 1),
      );
      if (chunkIdx < range.start || chunkIdx >= range.end) return;
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => finalizeJump(off));
      });
      return () => cancelAnimationFrame(id);
    }, [range.start, range.end, chunks.length, finalizeJump, measureGen]);

    const scrollToCharOffset = useCallback(
      (charOffset: number) => {
        const el = getEl();
        if (!el || !text.length) return;
        const off = Math.max(0, Math.min(Math.floor(charOffset), text.length));
        pendingJumpRef.current = off;
        onScrollOffsetChange?.(off);

        // Short texts: full DOM, use Range immediately
        if (text.length <= VIRTUAL_CHUNK_CHARS * 2) {
          requestAnimationFrame(() => {
            const refined = measureScrollTopForOffsetInFullBody(el, off);
            const max = Math.max(0, el.scrollHeight - el.clientHeight);
            if (refined != null) {
              el.scrollTop = Math.min(Math.max(0, refined), max);
            } else {
              el.scrollTop = max * (off / text.length);
            }
            pendingJumpRef.current = null;
            onScrollOffsetChange?.(off);
          });
          return;
        }

        const chunkIdx = Math.min(
          Math.floor(off / VIRTUAL_CHUNK_CHARS),
          Math.max(0, chunks.length - 1),
        );
        // Mount a window around the target so anchor/Range can work
        const nextStart = Math.max(0, chunkIdx - OVERSCAN);
        const nextEnd = Math.min(chunks.length, chunkIdx + OVERSCAN + 2);
        setRange({ start: nextStart, end: nextEnd });

        // Coarse scroll so virtual padding is in the right ballpark before measure
        let top = 0;
        for (let i = 0; i < chunkIdx; i++) {
          top +=
            measuredRef.current.get(i) ??
            estimateChunkHeight(chunks[i].text.length);
        }
        el.scrollTop = top;
      },
      [getEl, text, chunks, onScrollOffsetChange],
    );

    useImperativeHandle(
      ref,
      () => ({
        scrollToCharOffset,
        getScroller: getEl,
      }),
      [scrollToCharOffset, getEl],
    );

    const setRefs = (node: HTMLDivElement | null) => {
      (innerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      if (scrollerRefProp) {
        (scrollerRefProp as React.MutableRefObject<HTMLDivElement | null>).current =
          node;
      }
    };

    const renderChunkWithAnchors = (chunk: VirtualChunk): ReactNode => {
      const anchors = anchorsByChunk.get(chunk.index);
      // Custom renderer (write page): Range jump only — do not inject DOM React doesn't own
      if (renderChunk) return renderChunk(chunk);
      if (!anchors?.length) return chunk.text;

      const parts: ReactNode[] = [];
      let cursor = 0;
      for (const abs of anchors) {
        const local = abs - chunk.baseOffset;
        if (local < 0 || local > chunk.text.length) continue;
        if (local > cursor) {
          parts.push(chunk.text.slice(cursor, local));
        }
        parts.push(
          <span
            key={`a-${abs}`}
            data-char-anchor={abs}
            id={`char-anchor-${abs}`}
            className="inline-block w-0 h-0 overflow-hidden align-top"
            aria-hidden
          />,
        );
        cursor = local;
      }
      if (cursor < chunk.text.length) {
        parts.push(chunk.text.slice(cursor));
      }
      return parts;
    };

    if (text.length <= VIRTUAL_CHUNK_CHARS * 2) {
      return (
        <div
          ref={setRefs}
          className={`flex-1 overflow-y-auto custom-scrollbar min-h-0 ${scrollerClassName}`}
          onClick={onBodyClick}
          onScroll={() => {
            const el = getEl();
            if (!el || pendingJumpRef.current != null) return;
            const max = el.scrollHeight - el.clientHeight;
            const ratio = max > 0 ? el.scrollTop / max : 0;
            onScrollOffsetChange?.(Math.floor(ratio * text.length));
          }}
        >
          <div className={className} data-virtual-full="1" data-base-offset={0}>
            {renderChunkWithAnchors({ index: 0, baseOffset: 0, text })}
          </div>
        </div>
      );
    }

    const visible = chunks.slice(range.start, range.end);
    const padTop = prefixHeights[range.start] || 0;
    const padBottom = totalHeight - (prefixHeights[range.end] || 0);

    return (
      <div
        ref={setRefs}
        className={`flex-1 overflow-y-auto custom-scrollbar min-h-0 ${scrollerClassName}`}
        onScroll={(_e: UIEvent<HTMLDivElement>) => recompute()}
        onClick={onBodyClick}
      >
        <div style={{ paddingTop: padTop, paddingBottom: padBottom }}>
          {visible.map((chunk) => (
            <div
              key={chunk.index}
              className={className}
              data-chunk-index={chunk.index}
              data-base-offset={chunk.baseOffset}
              style={{ minHeight: heights[chunk.index] }}
            >
              {renderChunkWithAnchors(chunk)}
            </div>
          ))}
        </div>
      </div>
    );
  },
);

export default VirtualNovelBody;

function findTextNodeAtLocalOffset(
  root: HTMLElement,
  localOffset: number,
): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = localOffset;
  let t: Text | null;
  while ((t = walker.nextNode() as Text | null)) {
    // Skip our own empty anchor nodes' adjacent empties
    const len = t.textContent?.length || 0;
    if (remaining <= len) {
      return { node: t, offset: remaining };
    }
    remaining -= len;
  }
  return null;
}

function measureViewportTopForLocalOffset(
  root: HTMLElement,
  localCharOffset: number,
): number | null {
  const pos = findTextNodeAtLocalOffset(root, localCharOffset);
  if (!pos) return null;
  try {
    const range = document.createRange();
    range.setStart(pos.node, Math.min(pos.offset, pos.node.length));
    range.collapse(true);
    const rect = range.getBoundingClientRect();
    if (rect.top === 0 && rect.height === 0 && pos.node.length === 0) return null;
    return rect.top;
  } catch {
    return null;
  }
}

function measureScrollTopForOffsetInFullBody(
  scroller: HTMLElement,
  charOffset: number,
): number | null {
  const root =
    scroller.querySelector("[data-virtual-full='1']") || scroller;
  const top = measureViewportTopForLocalOffset(root as HTMLElement, charOffset);
  if (top == null) return null;
  const scRect = scroller.getBoundingClientRect();
  return scroller.scrollTop + (top - scRect.top) - 8;
}

export function absoluteOffsetFromClick(
  container: HTMLElement,
  clientX: number,
  clientY: number,
  fullTextLength: number,
): number | null {
  const range = document.caretRangeFromPoint?.(clientX, clientY);
  if (!range) return null;

  let node: Node | null = range.startContainer;
  let chunkEl: HTMLElement | null = null;
  while (node && node !== container) {
    if (node instanceof HTMLElement && node.dataset.baseOffset != null) {
      chunkEl = node;
      break;
    }
    node = node.parentNode;
  }
  if (!chunkEl) {
    let offset = 0;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let t: Text | null;
    while ((t = walker.nextNode() as Text | null)) {
      if (t === range.startContainer) {
        offset += range.startOffset;
        break;
      }
      offset += t.textContent?.length || 0;
    }
    return Math.max(0, Math.min(offset, fullTextLength));
  }

  const base = parseInt(chunkEl.dataset.baseOffset || "0", 10) || 0;
  let local = 0;
  const walker = document.createTreeWalker(chunkEl, NodeFilter.SHOW_TEXT);
  let t: Text | null;
  while ((t = walker.nextNode() as Text | null)) {
    if (t === range.startContainer) {
      local += range.startOffset;
      break;
    }
    local += t.textContent?.length || 0;
  }
  return Math.max(0, Math.min(base + local, fullTextLength));
}

/** Kept for tests / external callers */
export function charOffsetToScrollTop(
  textLength: number,
  charOffset: number,
  chunkSize: number = VIRTUAL_CHUNK_CHARS,
): number {
  if (textLength <= 0) return 0;
  const off = Math.max(0, Math.min(charOffset, textLength));
  if (textLength <= chunkSize * 2) return off * EST_PX_PER_CHAR;
  let top = 0;
  let i = 0;
  while (i * chunkSize < textLength) {
    const start = i * chunkSize;
    const len = Math.min(chunkSize, textLength - start);
    const h = estimateChunkHeight(len);
    if (off < start + len || start + len >= textLength) {
      return top + (off - start) * EST_PX_PER_CHAR;
    }
    top += h;
    i++;
  }
  return top;
}

export function scrollScrollerToCharOffset(
  scroller: HTMLElement,
  text: string,
  charOffset: number,
): void {
  const off = Math.max(0, Math.min(charOffset, text.length));
  const refined = measureScrollTopForOffsetInFullBody(scroller, off);
  const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  if (refined != null) {
    scroller.scrollTop = Math.min(Math.max(0, refined), max);
    return;
  }
  scroller.scrollTop = max * (text.length ? off / text.length : 0);
}
