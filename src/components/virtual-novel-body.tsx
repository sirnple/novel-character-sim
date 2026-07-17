"use client";

/**
 * Lightweight virtualized novel body for long scroll.
 * Splits text into fixed-size chunks; only mounts viewport ± overscan.
 * Global char offsets preserved for fork / continue / find.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
} from "react";

/** Chars per chunk — balance DOM nodes vs reflow. */
export const VIRTUAL_CHUNK_CHARS = 4_000;
const OVERSCAN = 2;
/** Rough px per char for Chinese prose (~17px font, ~1.9 line-height, ~28 chars/line). */
const EST_PX_PER_CHAR = 0.85;

export interface VirtualChunk {
  index: number;
  baseOffset: number;
  text: string;
}

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

export interface VirtualNovelBodyProps {
  text: string;
  className?: string;
  /** Optional render for a chunk (highlights, markers). Receives absolute baseOffset. */
  renderChunk?: (chunk: VirtualChunk) => ReactNode;
  /** Scroll container class */
  scrollerClassName?: string;
  onScrollOffsetChange?: (approxCharOffset: number) => void;
  /** Map click local position — parent can use data attributes */
  onBodyClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Optional external ref for the scroll container (find/scroll helpers). */
  scrollerRef?: React.RefObject<HTMLDivElement | null>;
  children?: ReactNode;
}

export default function VirtualNovelBody({
  text,
  className = "",
  renderChunk,
  scrollerClassName = "",
  onScrollOffsetChange,
  onBodyClick,
  scrollerRef: scrollerRefProp,
}: VirtualNovelBodyProps) {
  const innerRef = useRef<HTMLDivElement>(null);
  const scrollerRef = scrollerRefProp || innerRef;
  const chunks = useMemo(() => splitIntoChunks(text), [text]);
  const heights = useMemo(
    () => chunks.map((c) => Math.max(48, Math.ceil(c.text.length * EST_PX_PER_CHAR))),
    [chunks],
  );
  const totalHeight = useMemo(() => heights.reduce((a, b) => a + b, 0), [heights]);
  const prefixHeights = useMemo(() => {
    const p = new Array(heights.length + 1);
    p[0] = 0;
    for (let i = 0; i < heights.length; i++) p[i + 1] = p[i] + heights[i];
    return p;
  }, [heights]);

  const [range, setRange] = useState({ start: 0, end: Math.min(chunks.length, 6) });

  const recompute = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || chunks.length === 0) return;
    const viewTop = el.scrollTop;
    const viewBottom = viewTop + el.clientHeight;
    let start = 0;
    while (start < chunks.length && prefixHeights[start + 1] < viewTop) start++;
    let end = start;
    while (end < chunks.length && prefixHeights[end] < viewBottom) end++;
    start = Math.max(0, start - OVERSCAN);
    end = Math.min(chunks.length, end + OVERSCAN);
    setRange((prev) =>
      prev.start === start && prev.end === end ? prev : { start, end },
    );
    if (onScrollOffsetChange && chunks[start]) {
      onScrollOffsetChange(chunks[start].baseOffset);
    }
  }, [chunks, prefixHeights, onScrollOffsetChange]);

  useEffect(() => {
    recompute();
  }, [text, recompute]);

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    recompute();
  };

  // Short texts: no virtualization overhead
  const setRefs = (node: HTMLDivElement | null) => {
    (innerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    if (scrollerRefProp) {
      (scrollerRefProp as React.MutableRefObject<HTMLDivElement | null>).current = node;
    }
  };

  if (text.length <= VIRTUAL_CHUNK_CHARS * 2) {
    return (
      <div
        ref={setRefs}
        className={`flex-1 overflow-y-auto custom-scrollbar min-h-0 ${scrollerClassName}`}
        onClick={onBodyClick}
      >
        <div className={className} data-virtual-full="1" data-base-offset={0}>
          {renderChunk
            ? renderChunk({ index: 0, baseOffset: 0, text })
            : text}
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
      onScroll={onScroll}
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
            {renderChunk ? renderChunk(chunk) : chunk.text}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Compute absolute char offset from a click inside a VirtualNovelBody chunk.
 */
export function absoluteOffsetFromClick(
  container: HTMLElement,
  clientX: number,
  clientY: number,
  fullTextLength: number,
): number | null {
  const range = document.caretRangeFromPoint?.(clientX, clientY);
  if (!range) return null;

  // Find nearest chunk with data-base-offset
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
    // full mode
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
