"use client";

import type { RefObject } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";

interface ScrollEdgeButtonsProps {
  /** The element that actually scrolls (overflow-y-auto). */
  scrollRef: RefObject<HTMLElement | null>;
  className?: string;
}

/** Floating 到顶 / 到底 controls for a scroll container. Parent should be `relative`. */
export default function ScrollEdgeButtons({ scrollRef, className = "" }: ScrollEdgeButtonsProps) {
  const scrollToTop = () => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };
  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  return (
    <div
      className={`absolute right-3 bottom-3 z-20 flex flex-col gap-1.5 ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={scrollToTop}
        title="到顶"
        aria-label="滚动到顶部"
        className="w-8 h-8 flex items-center justify-center rounded-full border border-neutral-700/80 bg-[#111110]/90 text-neutral-400 hover:text-orange-400 hover:border-orange-500/40 hover:bg-[#1a1a18] shadow-lg backdrop-blur-sm transition-colors"
      >
        <ChevronUp className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={scrollToBottom}
        title="到底"
        aria-label="滚动到底部"
        className="w-8 h-8 flex items-center justify-center rounded-full border border-neutral-700/80 bg-[#111110]/90 text-neutral-400 hover:text-orange-400 hover:border-orange-500/40 hover:bg-[#1a1a18] shadow-lg backdrop-blur-sm transition-colors"
      >
        <ChevronDown className="w-4 h-4" />
      </button>
    </div>
  );
}
