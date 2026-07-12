"use client";
import { useRef, useState, useEffect, useCallback } from "react";
import { useNovel } from "@/lib/novel-context";

export default function ReadPage() {
  const { novelText, novelTitle, novelId, timeline, branches, activeBranchId } = useNovel();
  const readerRef = useRef<HTMLDivElement>(null);
  const [continueOffset, setContinueOffset] = useState<number | null>(null);
  const [continueLabel, setContinueLabel] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState<string>(activeBranchId || "main");
  const [readingText, setReadingText] = useState(novelText);
  const [loadingText, setLoadingText] = useState(false);

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

  const branchName = (id: string) => {
    if (id === "main") return "主线";
    const b = branches?.find(b => b.id === id);
    return b?.name || id;
  };

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      {/* Header with branch selector */}
      <div className="max-w-[800px] mx-auto px-6 pt-4 flex items-center gap-3">
        <h2 className="text-sm font-semibold text-neutral-300 font-mono uppercase tracking-wider">阅读 · {novelTitle}</h2>
        <div className="flex items-center gap-2">
          <select
            value={selectedBranchId}
            onChange={e => setSelectedBranchId(e.target.value)}
            disabled={loadingText}
            className="bg-[#111110] border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-300 font-mono outline-none focus:border-orange-600/50 disabled:opacity-50"
          >
            {branches.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          {loadingText && <span className="text-[10px] text-orange-500 font-mono animate-pulse">加载中</span>}
        </div>
      </div>

      {/* Text body */}
      <div ref={readerRef} onClick={handleClick} className="max-w-[800px] mx-auto p-6">
        <div className="text-base text-neutral-200 leading-relaxed whitespace-pre-wrap font-serif">
          {continueOffset != null ? (
            <>
              {readingText.slice(0, continueOffset)}
              <span className="inline-flex items-center gap-1 mx-1">
                <span className="inline-block w-2 h-4 bg-orange-500 animate-pulse rounded-sm" />
                <button onClick={openWriter} className="text-[10px] bg-orange-600 hover:bg-orange-500 text-white px-1.5 py-0.5 rounded font-mono">续写</button>
              </span>
              {readingText.slice(continueOffset)}
            </>
          ) : (
            readingText || novelText
          )}
        </div>
      </div>
    </div>
  );
}
