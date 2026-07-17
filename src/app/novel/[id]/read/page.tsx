"use client";
import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { useNovel } from "@/lib/novel-context";
import ScrollEdgeButtons from "@/components/scroll-edge-buttons";
import {
  TextFindBar,
  renderHighlightedText,
  useFindShortcut,
  useScrollToMatch,
  useTextFind,
} from "@/components/text-find";
import VirtualNovelBody, {
  absoluteOffsetFromClick,
  type VirtualChunk,
} from "@/components/virtual-novel-body";
import ReaderTimelineRail, {
  catalogToRailUnits,
  useApproxScrollOffset,
  type RailUnit,
} from "@/components/reader-timeline-rail";
import type { ChapterCatalogEntry } from "@/types";

interface BranchMeta {
  id: string;
  name: string;
  char_count?: number;
}

export default function ReadPage() {
  const { novelTitle, novelId, timeline, branches: ctxBranches, activeBranchId } = useNovel();
  const scrollRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  const [continueOffset, setContinueOffset] = useState<number | null>(null);
  const [continueLabel, setContinueLabel] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState<string>(activeBranchId || "main");
  /** Full branch text — virtual scroll only mounts viewport chunks. */
  const [fullBody, setFullBody] = useState("");
  const [loadingText, setLoadingText] = useState(false);
  const [branchList, setBranchList] = useState<BranchMeta[]>([]);
  const [catalog, setCatalog] = useState<ChapterCatalogEntry[]>([]);

  const displayText = fullBody;
  const find = useTextFind(displayText);
  useFindShortcut(find.searchInputRef);
  useScrollToMatch(readerRef, find.currentIndex, find.matchCount, [find.debouncedQuery, displayText]);
  const scrollOffset = useApproxScrollOffset(readerRef, displayText.length);

  const railUnits: RailUnit[] = useMemo(() => {
    if (catalog.length > 0) return catalogToRailUnits(catalog);
    // Fallback: timeline chapter titles without offsets (jump disabled via offset 0)
    const chs = timeline?.chapters || [];
    if (!chs.length) return [];
    return chs.map((c, i) => ({
      id: `tl_${c.chapterNumber}_${i}`,
      label: c.title ? `第${c.chapterNumber}章 ${c.title}` : `第${c.chapterNumber}章`,
      startOffset: 0,
      summary: c.events?.[0]?.description?.slice(0, 80),
      status: "ready" as const,
    }));
  }, [catalog, timeline]);

  useEffect(() => {
    if (!novelId) return;
    fetch(`/api/branches?novelId=${encodeURIComponent(novelId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.branches) setBranchList(d.branches);
      })
      .catch(() => {});
  }, [novelId]);

  useEffect(() => {
    if (!novelId || !selectedBranchId) return;
    fetch(
      `/api/chapter-meta?novelId=${encodeURIComponent(novelId)}&branchId=${encodeURIComponent(selectedBranchId)}`,
    )
      .then((r) => r.json())
      .then((d) => {
        if (d.meta?.chapters) setCatalog(d.meta.chapters);
      })
      .catch(() => {});
  }, [novelId, selectedBranchId]);

  const branches = branchList.length ? branchList : (ctxBranches as BranchMeta[]);

  const jumpToOffset = useCallback(
    (startOffset: number) => {
      const el = readerRef.current;
      if (!el || !displayText.length) return;
      const max = el.scrollHeight - el.clientHeight;
      const ratio = Math.min(1, Math.max(0, startOffset / displayText.length));
      el.scrollTo({ top: max * ratio, behavior: "smooth" });
    },
    [displayText.length],
  );

  const fetchBranchText = useCallback(async (branchId: string) => {
    setLoadingText(true);
    try {
      const res = await fetch(
        `/api/novels?novelId=${encodeURIComponent(novelId)}&branchId=${encodeURIComponent(branchId)}`,
      );
      if (res.ok) {
        const data = await res.json();
        setFullBody(String(data.text || ""));
      } else if (branchId !== "main") {
        const mainRes = await fetch(
          `/api/novels?novelId=${encodeURIComponent(novelId)}&branchId=main`,
        );
        if (mainRes.ok) {
          const d = await mainRes.json();
          setFullBody(String(d.text || ""));
          setSelectedBranchId("main");
        }
      }
    } catch { /* keep current text */ }
    setLoadingText(false);
  }, [novelId]);

  useEffect(() => {
    fetchBranchText(selectedBranchId);
  }, [selectedBranchId, fetchBranchText]);

  const handleClick = (e: React.MouseEvent) => {
    if (!displayText) return;
    const el = readerRef.current;
    if (!el) return;
    const abs = absoluteOffsetFromClick(
      el,
      e.clientX,
      e.clientY,
      displayText.length,
    );
    if (abs == null) return;
    let chapterNum = 1;
    if (timeline?.chapters) {
      let cum = 0;
      for (const ch of timeline.chapters) {
        cum += (ch.events?.length || 0) * 200;
        if (cum >= abs) break;
        chapterNum++;
      }
    }
    setContinueOffset(abs);
    setContinueLabel(`第${chapterNum}章 · 偏移${abs}字`);
  };

  const renderChunk = useCallback(
    (chunk: VirtualChunk) => {
      const matches = (find.matches || [])
        .filter(
          (m) => m >= chunk.baseOffset && m < chunk.baseOffset + chunk.text.length,
        )
        .map((m) => m - chunk.baseOffset);
      let cont: number | null = null;
      let node: React.ReactNode = null;
      if (continueOffset != null) {
        if (
          continueOffset >= chunk.baseOffset &&
          continueOffset <= chunk.baseOffset + chunk.text.length
        ) {
          cont = continueOffset - chunk.baseOffset;
          node = (
            <span key="continue" className="inline-flex items-center gap-1.5 mx-1 align-middle">
              <span className="inline-block w-1.5 h-5 bg-primary animate-pulse rounded-sm" />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (continueOffset == null) return;
                  window.location.href = `/novel/${novelId}/write?offset=${continueOffset}&label=${encodeURIComponent(continueLabel)}`;
                }}
                className="text-xs font-medium bg-primary hover:brightness-110 text-primary-foreground px-2.5 py-1 rounded-md"
              >
                续写
              </button>
            </span>
          );
        }
      }
      return (
        <div className="reader-frame py-2">
          <div className="surface-paper px-5 sm:px-8 lg:px-12 xl:px-16 py-4 sm:py-6 cursor-text">
            <div className="prose-novel whitespace-pre-wrap">
              {renderHighlightedText({
                text: chunk.text,
                matches,
                queryLen: find.queryLen,
                currentIndex: find.currentIndex,
                continueOffset: cont,
                continueNode: node,
              })}
            </div>
          </div>
        </div>
      );
    },
    [
      find.matches,
      find.queryLen,
      find.currentIndex,
      continueOffset,
      continueLabel,
      novelId,
    ],
  );

  return (
    <div className="flex-1 relative min-h-0 flex flex-col overflow-hidden bg-background">
      {/* Chrome: title + branch + search */}
      <div className="reader-frame pt-4 sm:pt-5 pb-2 flex flex-wrap items-center gap-3 shrink-0">
        <h2 className="text-base font-semibold text-foreground min-w-0 truncate">
          阅读 · {novelTitle}
        </h2>
        <div className="flex items-center gap-2">
          <select
            value={selectedBranchId}
            onChange={(e) => setSelectedBranchId(e.target.value)}
            disabled={loadingText}
            className="bg-secondary border border-border rounded-lg px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary/50 disabled:opacity-50"
          >
            {branches.length === 0 ? (
              <option value="main">主线</option>
            ) : (
              branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name || b.id}
                </option>
              ))
            )}
          </select>
          {loadingText && (
            <span className="text-xs text-primary animate-pulse">加载中</span>
          )}
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

      <div ref={scrollRef} className="flex-1 flex min-h-0 overflow-hidden">
        <div className="hidden sm:flex">
          <ReaderTimelineRail
            title={catalog.length ? "目录 / 时间线" : "时间线"}
            units={railUnits}
            scrollOffset={scrollOffset}
            onJump={jumpToOffset}
          />
        </div>
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <VirtualNovelBody
            text={displayText}
            scrollerRef={readerRef}
            onBodyClick={handleClick}
            renderChunk={renderChunk}
          />
          <p className="shrink-0 py-2 text-center text-xs text-fog">
            点击正文任意位置可插入续写标记
            {displayText.length > 0
              ? ` · 共 ${displayText.length.toLocaleString()} 字`
              : ""}
          </p>
        </div>
      </div>
      <ScrollEdgeButtons scrollRef={readerRef} />
    </div>
  );
}
