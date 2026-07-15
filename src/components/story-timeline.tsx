"use client";

import { useRef, useState, useEffect } from "react";
import type { ChapterTimeline, TimelineEvent, CharacterChapterState } from "@/types";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";

interface StoryTimelineProps {
  timeline: ChapterTimeline | null;
  lastChapterStates?: CharacterChapterState[];
}

/** 把事件展平成有序列表 */
function flattenEvents(timeline: ChapterTimeline) {
  const events: (TimelineEvent & { chapterTitle: string })[] = [];
  for (const ch of timeline.chapters) {
    for (const evt of ch.events) {
      events.push({ ...evt, chapterTitle: ch.title });
    }
  }
  return events;
}

/**
 * 全局故事时间线 — 一条不断开的横线 + 点
 * 位置：步骤指示器下方，贯穿整个上传后流程
 */
export default function StoryTimeline({ timeline, lastChapterStates }: StoryTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(true);

  const events =
    timeline && timeline.chapters.length > 0 ? flattenEvents(timeline) : [];
  const eventCount = events.length;

  useEffect(() => {
    if (eventCount === 0) return;
    const updateArrows = () => {
      const el = scrollRef.current;
      if (!el) return;
      setCanLeft(el.scrollLeft > 8);
      setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
    };
    updateArrows();
    const el = scrollRef.current;
    if (el) {
      el.addEventListener("scroll", updateArrows, { passive: true });
      return () => el.removeEventListener("scroll", updateArrows);
    }
  }, [eventCount]);

  if (!timeline || timeline.chapters.length === 0) return null;
  if (events.length === 0) return null;

  // 角色配色
  const allChars = Array.from(new Set(events.flatMap(e => e.involvedCharacters)));
  const palette = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316"];
  const charColors: Record<string, string> = {};
  allChars.forEach((c, i) => { charColors[c] = palette[i % palette.length]; });

  const scroll = (dir: -1 | 1) => scrollRef.current?.scrollBy({ left: dir * 320, behavior: "smooth" });

  return (
    <div className="mb-6 bg-secondary/20 border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" /> 故事时间线
          <span className="text-xs text-muted-foreground font-normal">
            · {timeline.totalChapters} 章 · {events.length} 个关键事件
          </span>
        </h3>
        {lastChapterStates && lastChapterStates.length > 0 && (
          <div className="flex flex-wrap gap-1.5 max-w-[60%] justify-end">
            {lastChapterStates.map(s => (
              <span
                key={s.name}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
                  s.alive ? "bg-green-100 text-green-700 border border-green-300"
                          : "bg-red-100 text-red-700 border border-red-300"
                }`}
                title={s.delta || s.location}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${s.alive ? "bg-green-500" : "bg-red-500"}`} />
                {s.name}{s.alive ? "" : " †"}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 横向时间线 */}
      <div className="relative">
        {canLeft && (
          <button
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 bg-card border rounded-full shadow-md flex items-center justify-center hover:bg-secondary"
            onClick={() => scroll(-1)}
            aria-label="向左滚动"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        )}
        {canRight && (
          <button
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 bg-card border rounded-full shadow-md flex items-center justify-center hover:bg-secondary"
            onClick={() => scroll(1)}
            aria-label="向右滚动"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}

        {/* 滚动容器 */}
        <div
          ref={scrollRef}
          className="overflow-x-auto pb-2"
          style={{ scrollbarWidth: "thin" }}
        >
          {/* 横线容器：所有事件 + 一条贯穿的水平线 */}
          <div className="relative flex items-center min-w-full pt-6 pb-2 pl-2 pr-2" style={{ minWidth: "max-content" }}>
            {/* 主横线：绝对定位、贯穿整行 */}
            {events.map((evt, idx) => (
              <div key={evt.id} className="flex items-center shrink-0">
                {/* 连接线（前） */}
                {idx > 0 && <div className="w-6 h-0.5 bg-border shrink-0" />}

                {/* 事件点 + 上方标签 */}
                <button
                  className="relative flex flex-col items-center shrink-0 group"
                  onClick={() => setSelected(selected === idx ? null : idx)}
                >
                  {/* 上方标签：章节 + 事件名 */}
                  <span className="absolute -top-6 w-[120px] text-center">
                    <span className="block text-[10px] text-muted-foreground/60 leading-tight">
                      第{evt.chapterNumber}章
                    </span>
                    <span className="block text-xs font-medium leading-tight truncate">
                      {evt.title}
                    </span>
                  </span>

                  {/* 点 */}
                  <span
                    className={`rounded-full border-2 transition-all ${
                      selected === idx
                        ? "bg-primary border-primary w-3.5 h-3.5 ring-2 ring-primary/30"
                        : "bg-card border-primary w-2.5 h-2.5 group-hover:border-primary/70 group-hover:scale-125"
                    }`}
                  />

                  {/* 下方色点：参与角色 */}
                  <span className="absolute top-3 flex gap-0.5">
                    {evt.involvedCharacters.slice(0, 4).map(c => (
                      <span
                        key={c}
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: charColors[c] }}
                        title={c}
                      />
                    ))}
                    {evt.involvedCharacters.length > 4 && (
                      <span className="text-[9px] text-muted-foreground">+{evt.involvedCharacters.length - 4}</span>
                    )}
                  </span>
                </button>
              </div>
            ))}

            {/* 末尾延伸线 */}
            <div className="w-6 h-0.5 bg-border shrink-0" />
          </div>
        </div>
      </div>

      {/* 选中事件详情 */}
      {selected !== null && events[selected] && (
        <div className="mt-3 p-3 border rounded-lg bg-card">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold">
                #{events[selected].sequence} · {events[selected].title}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                第{events[selected].chapterNumber}章 · {events[selected].chapterTitle}
              </p>
            </div>
            <button
              className="text-muted-foreground hover:text-foreground text-xs"
              onClick={() => setSelected(null)}
            >
              ✕
            </button>
          </div>
          <p className="text-sm mt-2">{events[selected].description}</p>

          {events[selected].outcomes.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-medium text-muted-foreground">结果：</p>
              <ul className="text-xs text-muted-foreground list-disc list-inside mt-0.5">
                {events[selected].outcomes.map((o, i) => <li key={i}>{o}</li>)}
              </ul>
            </div>
          )}

          {Object.keys(events[selected].charactersChanged).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.entries(events[selected].charactersChanged).map(([name, delta]) => (
                <span key={name} className="px-2 py-0.5 text-xs rounded-full bg-secondary">
                  {name}：{delta}
                </span>
              ))}
            </div>
          )}

          {events[selected].involvedCharacters.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {events[selected].involvedCharacters.map(c => (
                <span
                  key={c}
                  className="px-2 py-0.5 text-xs rounded-full text-white"
                  style={{ backgroundColor: charColors[c] }}
                >
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 角色色块图例 */}
      <div className="mt-3 flex flex-wrap gap-2.5 text-xs text-muted-foreground">
        {allChars.slice(0, 10).map(c => (
          <span key={c} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: charColors[c] }} />
            {c}
          </span>
        ))}
        {allChars.length > 10 && <span className="text-muted-foreground/60">+{allChars.length - 10} 个角色</span>}
      </div>
    </div>
  );
}
