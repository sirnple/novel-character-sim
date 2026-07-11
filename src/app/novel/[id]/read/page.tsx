"use client";
import { useRef, useState } from "react";
import { useNovel } from "@/lib/novel-context";

export default function ReadPage() {
  const { novelText, novelTitle, novelId, timeline } = useNovel();
  const readerRef = useRef<HTMLDivElement>(null);
  const [continueOffset, setContinueOffset] = useState<number | null>(null);
  const [continueLabel, setContinueLabel] = useState("");

  const handleClick = (e: React.MouseEvent) => {
    if (!novelText) return;
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

  return (
    <div ref={readerRef} onClick={handleClick} className="flex-1 overflow-y-auto custom-scrollbar">
      <div className="max-w-[800px] mx-auto p-6">
        <h2 className="text-sm font-semibold text-neutral-300 font-mono uppercase tracking-wider mb-4">阅读 · {novelTitle}</h2>
        <div className="text-base text-neutral-200 leading-relaxed whitespace-pre-wrap font-serif">
          {continueOffset != null ? (
            <>
              {novelText.slice(0, continueOffset)}
              <span className="inline-flex items-center gap-1 mx-1">
                <span className="inline-block w-2 h-4 bg-orange-500 animate-pulse rounded-sm" />
                <button onClick={openWriter} className="text-[10px] bg-orange-600 hover:bg-orange-500 text-white px-1.5 py-0.5 rounded font-mono">续写</button>
              </span>
              {novelText.slice(continueOffset)}
            </>
          ) : novelText}
        </div>
        {continueOffset != null && (
          <div className="mt-3 flex items-center gap-2 text-[10px] text-orange-500 font-mono">
            <span>{continueLabel}</span>
            <button onClick={() => { setContinueOffset(null); setContinueLabel(""); }} className="text-neutral-600 hover:text-neutral-400">取消</button>
          </div>
        )}
      </div>
    </div>
  );
}
