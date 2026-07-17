"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Search, ChevronUp, ChevronDown } from "lucide-react";

import { FIND_MATCH_CAP } from "@/lib/text-window";

/**
 * Non-overlapping substring match start offsets.
 * For pure CJK queries skip toLowerCase (avoids full-string copy).
 * Caps at FIND_MATCH_CAP to prevent highlight DOM blow-up.
 */
export function findMatchOffsets(
  text: string,
  query: string,
  maxMatches: number = FIND_MATCH_CAP,
): number[] {
  if (!query || !text) return [];
  const needleRaw = query;
  if (!needleRaw) return [];
  // ASCII-ish → case-insensitive; pure CJK / mixed without A-Z → direct
  const needsLower = /[A-Za-z]/.test(needleRaw);
  const hay = needsLower ? text.toLowerCase() : text;
  const needle = needsLower ? needleRaw.toLowerCase() : needleRaw;
  if (!needle) return [];
  const out: number[] = [];
  let from = 0;
  const limit = Math.max(1, maxMatches);
  while (from <= hay.length - needle.length && out.length < limit) {
    const i = hay.indexOf(needle, from);
    if (i === -1) break;
    out.push(i);
    from = i + needle.length;
  }
  return out;
}

function markClass(isCurrent: boolean) {
  return isCurrent
    ? "bg-primary/40 text-paper-foreground rounded-sm px-0.5"
    : "bg-amber-300/50 text-paper-foreground rounded-sm px-0.5";
}

export interface RenderHighlightedOptions {
  text: string;
  matches: number[];
  queryLen: number;
  currentIndex: number;
  /** Absolute match index for the first match in this region (for multi-region search). */
  matchIndexBase?: number;
  continueOffset?: number | null;
  /** Zero-width UI chrome inserted at continueOffset (not part of searchable text). */
  continueNode?: ReactNode;
}

/** Render text with search highlights and optional continue/fork marker. */
export function renderHighlightedText({
  text,
  matches,
  queryLen,
  currentIndex,
  matchIndexBase = 0,
  continueOffset = null,
  continueNode,
}: RenderHighlightedOptions): ReactNode {
  if (!text) return null;

  if (queryLen === 0 || matches.length === 0) {
    if (continueOffset == null || !continueNode) return text;
    return (
      <>
        {text.slice(0, continueOffset)}
        {continueNode}
        {text.slice(continueOffset)}
      </>
    );
  }

  const parts: ReactNode[] = [];
  let cursor = 0;
  let continueInserted = continueOffset == null || !continueNode;

  const flushContinue = (upTo: number) => {
    if (continueInserted || continueOffset == null || !continueNode) return;
    if (continueOffset < cursor || continueOffset > upTo) return;
    if (continueOffset > cursor) {
      parts.push(text.slice(cursor, continueOffset));
    }
    parts.push(continueNode);
    cursor = continueOffset;
    continueInserted = true;
  };

  matches.forEach((start, i) => {
    const end = Math.min(start + queryLen, text.length);
    const globalIndex = matchIndexBase + i;
    flushContinue(start);
    if (start > cursor) {
      parts.push(text.slice(cursor, start));
      cursor = start;
    }

    const isCurrent = globalIndex === currentIndex;
    if (
      !continueInserted &&
      continueOffset != null &&
      continueNode &&
      continueOffset > start &&
      continueOffset < end
    ) {
      parts.push(
        <mark key={`m-${globalIndex}-a`} data-match-index={globalIndex} className={markClass(isCurrent)}>
          {text.slice(start, continueOffset)}
        </mark>,
      );
      parts.push(continueNode);
      parts.push(
        <mark key={`m-${globalIndex}-b`} data-match-index={globalIndex} className={markClass(isCurrent)}>
          {text.slice(continueOffset, end)}
        </mark>,
      );
      continueInserted = true;
      cursor = end;
    } else {
      parts.push(
        <mark key={`m-${globalIndex}`} data-match-index={globalIndex} className={markClass(isCurrent)}>
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
  if (!continueInserted && continueOffset === text.length && continueNode) {
    parts.push(continueNode);
  }

  return parts;
}

export interface UseTextFindResult {
  query: string;
  setQuery: (q: string) => void;
  debouncedQuery: string;
  matches: number[];
  currentIndex: number;
  matchCount: number;
  queryLen: number;
  counterLabel: string;
  searchInputRef: RefObject<HTMLInputElement>;
  goNext: () => void;
  goPrev: () => void;
  clearSearch: () => void;
}

function useDebouncedQuery(query: string, ms = 150) {
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), ms);
    return () => clearTimeout(t);
  }, [query, ms]);
  return debouncedQuery;
}

/** Debounced find-in-page state for a single searchable string. */
export function useTextFind(text: string): UseTextFindResult {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedQuery(query);
  const [currentIndex, setCurrentIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(
    () => findMatchOffsets(text, debouncedQuery),
    [text, debouncedQuery],
  );

  useEffect(() => {
    setCurrentIndex(0);
  }, [debouncedQuery, text]);

  const goNext = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentIndex((i) => (i + 1) % matches.length);
  }, [matches.length]);

  const goPrev = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentIndex((i) => (i - 1 + matches.length) % matches.length);
  }, [matches.length]);

  const clearSearch = useCallback(() => {
    setQuery("");
  }, []);

  const matchCount = matches.length;
  const counterLabel =
    matchCount === 0
      ? debouncedQuery
        ? "0 / 0"
        : ""
      : matchCount >= FIND_MATCH_CAP
        ? `${currentIndex + 1} / ${matchCount}+`
        : `${currentIndex + 1} / ${matchCount}`;

  return {
    query,
    setQuery,
    debouncedQuery,
    matches,
    currentIndex,
    matchCount,
    queryLen: debouncedQuery.length,
    counterLabel,
    searchInputRef,
    goNext,
    goPrev,
    clearSearch,
  };
}

export interface UseTextFindSegmentsResult {
  query: string;
  setQuery: (q: string) => void;
  debouncedQuery: string;
  /** Match offsets per segment (same order as input segments). */
  segmentMatches: number[][];
  currentIndex: number;
  matchCount: number;
  queryLen: number;
  counterLabel: string;
  searchInputRef: RefObject<HTMLInputElement>;
  goNext: () => void;
  goPrev: () => void;
  clearSearch: () => void;
  /** Global match index base for segment `i`. */
  matchIndexBase: (segmentIndex: number) => number;
}

/** Find across multiple independent text regions (e.g. novel body + generated prose). */
export function useTextFindSegments(segments: readonly string[]): UseTextFindSegmentsResult {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedQuery(query);
  const [currentIndex, setCurrentIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Avoid joining multi-MB bodies every render — lengths + refs identity
  const segmentsKey = useMemo(
    () => segments.map((s) => s.length).join(",") + ":" + segments.length,
    // segments array identity changes when body/prose change; length key is cheap
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [segments.length, ...segments.map((s) => s.length)],
  );
  // Hold latest segments for search without putting full strings in dep array as join
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  const segmentMatches = useMemo(() => {
    const segs = segmentsRef.current;
    return segs.map((s) => findMatchOffsets(s, debouncedQuery));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- segmentsKey + query
  }, [segmentsKey, debouncedQuery]);

  const matchCount = useMemo(
    () => segmentMatches.reduce((n, m) => n + m.length, 0),
    [segmentMatches],
  );

  useEffect(() => {
    setCurrentIndex(0);
  }, [debouncedQuery, segmentsKey]);

  const matchIndexBase = useCallback(
    (segmentIndex: number) => {
      let base = 0;
      for (let i = 0; i < segmentIndex; i++) base += segmentMatches[i]?.length ?? 0;
      return base;
    },
    [segmentMatches],
  );

  const goNext = useCallback(() => {
    if (matchCount === 0) return;
    setCurrentIndex((i) => (i + 1) % matchCount);
  }, [matchCount]);

  const goPrev = useCallback(() => {
    if (matchCount === 0) return;
    setCurrentIndex((i) => (i - 1 + matchCount) % matchCount);
  }, [matchCount]);

  const clearSearch = useCallback(() => {
    setQuery("");
  }, []);

  const counterLabel =
    matchCount === 0
      ? debouncedQuery
        ? "0 / 0"
        : ""
      : matchCount >= FIND_MATCH_CAP
        ? `${currentIndex + 1} / ${matchCount}+`
        : `${currentIndex + 1} / ${matchCount}`;

  return {
    query,
    setQuery,
    debouncedQuery,
    segmentMatches,
    currentIndex,
    matchCount,
    queryLen: debouncedQuery.length,
    counterLabel,
    searchInputRef,
    goNext,
    goPrev,
    clearSearch,
    matchIndexBase,
  };
}

/** Scroll the current match into view inside a container (or document). */
export function useScrollToMatch(
  containerRef: RefObject<HTMLElement | null>,
  currentIndex: number,
  matchCount: number,
  deps: unknown[] = [],
) {
  useEffect(() => {
    if (matchCount === 0) return;
    const root = containerRef.current ?? document;
    const el = root.querySelector(
      `[data-match-index="${currentIndex}"]`,
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps is intentional external list
  }, [currentIndex, matchCount, containerRef, ...deps]);
}

/** Focus search on Ctrl/Cmd+F (prevents browser find). */
export function useFindShortcut(searchInputRef: RefObject<HTMLInputElement>, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchInputRef, enabled]);
}

export interface TextFindBarProps {
  query: string;
  onQueryChange: (q: string) => void;
  matchCount: number;
  currentIndex: number;
  counterLabel: string;
  onPrev: () => void;
  onNext: () => void;
  onClear: () => void;
  inputRef: RefObject<HTMLInputElement>;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  compact?: boolean;
}

export function TextFindBar({
  query,
  onQueryChange,
  matchCount,
  counterLabel,
  onPrev,
  onNext,
  onClear,
  inputRef,
  disabled,
  placeholder = "搜索正文…",
  className = "",
  compact = false,
}: TextFindBarProps) {
  return (
    <div className={`flex items-center gap-1.5 min-w-0 ${className}`}>
      <div className={`relative min-w-0 ${compact ? "w-[140px] sm:w-[180px]" : "flex-1"}`}>
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-neutral-500 pointer-events-none" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (e.shiftKey) onPrev();
              else onNext();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClear();
              (e.target as HTMLInputElement).blur();
            }
          }}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={placeholder}
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
        onClick={onPrev}
        disabled={matchCount === 0}
        title="上一个 (Shift+Enter)"
        aria-label="上一个匹配"
        className="w-6 h-6 flex items-center justify-center rounded border border-neutral-700 text-neutral-400 hover:text-orange-400 hover:border-orange-500/40 disabled:opacity-30 disabled:hover:text-neutral-400 disabled:hover:border-neutral-700"
      >
        <ChevronUp className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={matchCount === 0}
        title="下一个 (Enter)"
        aria-label="下一个匹配"
        className="w-6 h-6 flex items-center justify-center rounded border border-neutral-700 text-neutral-400 hover:text-orange-400 hover:border-orange-500/40 disabled:opacity-30 disabled:hover:text-neutral-400 disabled:hover:border-neutral-700"
      >
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
