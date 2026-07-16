"use client";
import { useRef, useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { Search, ChevronUp, ChevronDown } from "lucide-react";
import { useNovel } from "@/lib/novel-context";
import ScrollEdgeButtons from "@/components/scroll-edge-buttons";

/** Case-insensitive non-overlapping substring match start offsets. */
function findMatchOffsets(text: string, query: string): number[] {
  if (!query) return [];
  const hay = text.toLowerCase();
  const needle = query.toLowerCase();
  if (!needle) return [];
  const out: number[] = [];
  let from = 0;
  while (from <= hay.length - needle.length) {
    const i = hay.indexOf(needle, from);
    if (i === -1) break;
    out.push(i);
    from = i + needle.length;
  }
  return out;
}

function ContinueMarker({ onContinue }: { onContinue: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 mx-1">
      <span className="inline-block w-2 h-4 bg-orange-500 animate-pulse rounded-sm" />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onContinue();
        }}
        className="text-[10px] bg-orange-600 hover:bg-orange-500 text-white px-1.5 py-0.5 rounded font-mono"
      >
        续写
      </button>
    </span>
  );
}

function markClass(isCurrent: boolean) {
  return isCurrent
    ? "bg-orange-500/50 text-neutral-100 rounded-sm px-0.5"
    : "bg-yellow-500/30 text-neutral-100 rounded-sm px-0.5";
}

/** Render novel text with search highlights and optional continue-point marker. */
function renderReadingBody(
  text: string,
  matches: number[],
  queryLen: number,
  currentIndex: number,
  continueOffset: number | null,
  onContinue: () => void,
): ReactNode {
  if (!text) return null;

  if (queryLen === 0 || matches.length === 0) {
    if (continueOffset == null) return text;
    return (
      <>
        {text.slice(0, continueOffset)}
        <ContinueMarker onContinue={onContinue} />
        {text.slice(continueOffset)}
      </>
    );
  }

  const parts: ReactNode[] = [];
  let cursor = 0;
  let continueInserted = continueOffset == null;

  const flushContinue = (upTo: number) => {
    if (continueInserted || continueOffset == null) return;
    if (continueOffset < cursor || continueOffset > upTo) return;
    if (continueOffset > cursor) {
      parts.push(text.slice(cursor, continueOffset));
    }
    parts.push(<ContinueMarker key="continue" onContinue={onContinue} />);
    cursor = continueOffset;
    continueInserted = true;
  };

  matches.forEach((start, i) => {
    const end = Math.min(start + queryLen, text.length);
    flushContinue(start);
    if (start > cursor) {
      parts.push(text.slice(cursor, start));
      cursor = start;
    }

    const isCurrent = i === currentIndex;
    if (
      !continueInserted &&
      continueOffset != null &&
      continueOffset > start &&
      continueOffset < end
    ) {
      parts.push(
        <mark key={`m-${i}-a`} data-match-index={i} className={markClass(isCurrent)}>
          {text.slice(start, continueOffset)}
        </mark>,
      );
      parts.push(<ContinueMarker key="continue" onContinue={onContinue} />);
      parts.push(
        <mark key={`m-${i}-b`} data-match-index={i} className={markClass(isCurrent)}>
          {text.slice(continueOffset, end)}
        </mark>,
      );
      continueInserted = true;
      cursor = end;
    } else {
      parts.push(
        <mark key={`m-${i}`} data-match-index={i} className={markClass(isCurrent)}>
          {text.slice(start, end)}
        </mark>,
      );
      cursor = end;
    }
  });

  flushContinue(text.length);
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }
  if (!continueInserted && continueOffset === text.length) {
    parts.push(<ContinueMarker key="continue" onContinue={onContinue} />);
  }

  return parts;
}

export default function ReadPage() {
  const { novelText, novelTitle, novelId, timeline, branches, activeBranchId } = useNovel();
  const scrollRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [continueOffset, setContinueOffset] = useState<number | null>(null);
  const [continueLabel, setContinueLabel] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState<string>(activeBranchId || "main");
  const [readingText, setReadingText] = useState(novelText);
  const [loadingText, setLoadingText] = useState(false);

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  const displayText = readingText || novelText || "";

  const matches = useMemo(
    () => findMatchOffsets(displayText, debouncedQuery),
    [displayText, debouncedQuery],
  );

  useEffect(() => {
    setCurrentIndex(0);
  }, [debouncedQuery, displayText]);

  useEffect(() => {
    if (matches.length === 0) return;
    const el = readerRef.current?.querySelector(
      `[data-match-index="${currentIndex}"]`,
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentIndex, matches, debouncedQuery]);

  const goNext = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentIndex((i) => (i + 1) % matches.length);
  }, [matches.length]);

  const goPrev = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentIndex((i) => (i - 1 + matches.length) % matches.length);
  }, [matches.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const fetchBranchText = useCallback(async (branchId: string) => {
    setLoadingText(true);
    try {
      const res = await fetch(`/api/novels?novelId=${novelId}&branchId=${encodeURIComponent(branchId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.text) setReadingText(data.text);
      } else {
        // fallback to main on error
        if (branchId !== "main") {
          const mainRes = await fetch(`/api/novels?novelId=${novelId}&branchId=main`);
          if (mainRes.ok) {
            const d = await mainRes.json();
            setReadingText(d.text || "");
            setSelectedBranchId("main");
          }
        }
      }
    } catch { /* keep current text */ }
    setLoadingText(false);
  }, [novelId]);

  useEffect(() => {
    fetchBranchText(selectedBranchId);
  }, [selectedBranchId, fetchBranchText]);

  const handleClick = (e: React.MouseEvent) => {
    if (!readingText) return;
    const range = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (!range) return;
    const el = readerRef.current; if (!el) return;
    let offset = 0;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      if (node === range.startContainer) { offset += range.startOffset; break; }
      offset += node.textContent?.length || 0;
    }
    let chapterNum = 1;
    if (timeline?.chapters) {
      let cum = 0;
      for (const ch of timeline.chapters) { cum += (ch.events?.length || 0) * 200; if (cum >= offset) break; chapterNum++; }
    }
    setContinueOffset(offset);
    setContinueLabel(`第${chapterNum}章 · 偏移${offset}字`);
  };

  const openWriter = () => {
    if (continueOffset == null) return;
    window.location.href = `/novel/${novelId}/write?offset=${continueOffset}&label=${encodeURIComponent(continueLabel)}`;
  };

  const matchCount = matches.length;
  const counterLabel = matchCount === 0
    ? (debouncedQuery ? "0 / 0" : "")
    : `${currentIndex + 1} / ${matchCount}`;

  return (
    <div className="flex-1 relative min-h-0 flex flex-col overflow-hidden">
      <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
        {/* Header with branch selector + search */}
        <div className="max-w-[800px] mx-auto px-4 sm:px-6 pt-4 flex flex-wrap items-center gap-2 sm:gap-3">
          <h2 className="text-sm font-semibold text-neutral-300 font-mono uppercase tracking-wider min-w-0 truncate">阅读 · {novelTitle}</h2>
          <div className="flex items-center gap-2">
            <select
              value={selectedBranchId}
              onChange={e => setSelectedBranchId(e.target.value)}
              disabled={loadingText}
              className="bg-[#111110] border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-300 font-mono outline-none focus:border-orange-600/50 disabled:opacity-50"
            >
              {branches.length === 0
                ? <option value="main">主线</option>
                : branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
            </select>
            {loadingText && <span className="text-[10px] text-orange-500 font-mono animate-pulse">加载中</span>}
          </div>

          <div className="flex items-center gap-1.5 ml-auto min-w-0 flex-1 sm:flex-initial sm:min-w-[220px] max-w-full">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-neutral-500 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (e.shiftKey) goPrev();
                    else goNext();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setQuery("");
                    setDebouncedQuery("");
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                disabled={loadingText}
                placeholder="搜索正文…"
                aria-label="搜索正文"
                className="w-full bg-[#111110] border border-neutral-700 rounded pl-7 pr-2 py-1 text-xs text-neutral-300 font-mono outline-none focus:border-orange-600/50 disabled:opacity-50 placeholder:text-neutral-600"
              />
            </div>
            {counterLabel && (
              <span className="text-[10px] text-neutral-500 font-mono tabular-nums whitespace-nowrap shrink-0">
                {counterLabel}
              </span>
            )}
            <button
              type="button"
              onClick={goPrev}
              disabled={matchCount === 0}
              title="上一个 (Shift+Enter)"
              aria-label="上一个匹配"
              className="w-6 h-6 flex items-center justify-center rounded border border-neutral-700 text-neutral-400 hover:text-orange-400 hover:border-orange-500/40 disabled:opacity-30 disabled:hover:text-neutral-400 disabled:hover:border-neutral-700"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={matchCount === 0}
              title="下一个 (Enter)"
              aria-label="下一个匹配"
              className="w-6 h-6 flex items-center justify-center rounded border border-neutral-700 text-neutral-400 hover:text-orange-400 hover:border-orange-500/40 disabled:opacity-30 disabled:hover:text-neutral-400 disabled:hover:border-neutral-700"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Text body */}
        <div ref={readerRef} onClick={handleClick} className="max-w-[800px] mx-auto p-6">
          <div className="text-base text-neutral-200 leading-relaxed whitespace-pre-wrap font-serif">
            {renderReadingBody(
              displayText,
              matches,
              debouncedQuery.length,
              currentIndex,
              continueOffset,
              openWriter,
            )}
          </div>
        </div>
      </div>
      <ScrollEdgeButtons scrollRef={scrollRef} />
    </div>
  );
}
