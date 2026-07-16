"use client";
import { useRef, useState, useEffect, useCallback } from "react";
import { useNovel } from "@/lib/novel-context";
import ScrollEdgeButtons from "@/components/scroll-edge-buttons";
import {
  TextFindBar,
  renderHighlightedText,
  useFindShortcut,
  useScrollToMatch,
  useTextFind,
} from "@/components/text-find";

export default function ReadPage() {
  const { novelText, novelTitle, novelId, timeline, branches, activeBranchId } = useNovel();
  const scrollRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  const [continueOffset, setContinueOffset] = useState<number | null>(null);
  const [continueLabel, setContinueLabel] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState<string>(activeBranchId || "main");
  const [readingText, setReadingText] = useState(novelText);
  const [loadingText, setLoadingText] = useState(false);

  const displayText = readingText || novelText || "";
  const find = useTextFind(displayText);
  useFindShortcut(find.searchInputRef);
  useScrollToMatch(readerRef, find.currentIndex, find.matchCount, [find.debouncedQuery]);

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

  const continueNode =
    continueOffset != null ? (
      <span key="continue" className="inline-flex items-center gap-1 mx-1">
        <span className="inline-block w-2 h-4 bg-orange-500 animate-pulse rounded-sm" />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openWriter();
          }}
          className="text-[10px] bg-orange-600 hover:bg-orange-500 text-white px-1.5 py-0.5 rounded font-mono"
        >
          续写
        </button>
      </span>
    ) : null;

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

          <TextFindBar
            className="ml-auto min-w-0 flex-1 sm:flex-initial sm:min-w-[220px] max-w-full"
            query={find.query}
            onQueryChange={find.setQuery}
            matchCount={find.matchCount}
            currentIndex={find.currentIndex}
            counterLabel={find.counterLabel}
            onPrev={find.goPrev}
            onNext={find.goNext}
            onClear={find.clearSearch}
            inputRef={find.searchInputRef}
            disabled={loadingText}
          />
        </div>

        {/* Text body */}
        <div ref={readerRef} onClick={handleClick} className="max-w-[800px] mx-auto p-6">
          <div className="text-base text-neutral-200 leading-relaxed whitespace-pre-wrap font-serif">
            {renderHighlightedText({
              text: displayText,
              matches: find.matches,
              queryLen: find.queryLen,
              currentIndex: find.currentIndex,
              continueOffset,
              continueNode,
            })}
          </div>
        </div>
      </div>
      <ScrollEdgeButtons scrollRef={scrollRef} />
    </div>
  );
}
