"use client";

import { useState } from "react";
import type { StoryInfo } from "@/types";
import { BookOpen, ChevronDown, ChevronUp, Globe } from "lucide-react";

export default function StoryInfoPanel({
  storyInfo,
  className = "",
}: {
  storyInfo: StoryInfo;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const summary = (storyInfo.plotSummary || "").trim();
  const preview =
    summary.length > 120 ? summary.slice(0, 120).replace(/\s+\S*$/, "") + "…" : summary;

  return (
    <div
      className={`rounded-xl border border-border/80 bg-card h-full flex flex-col min-h-0 ${className}`}
    >
      <button
        type="button"
        className="w-full p-3 sm:p-3.5 flex items-start gap-2 text-left hover:bg-panel-elevated/40 transition-colors rounded-xl"
        onClick={() => setExpanded(!expanded)}
      >
        <BookOpen className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">故事 / 世界</span>
            {expanded ? (
              <ChevronUp className="w-3.5 h-3.5 text-fog shrink-0" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-fog shrink-0" />
            )}
          </div>
          {!expanded && (
            <p className="text-xs text-foreground/85 leading-relaxed mt-1.5 line-clamp-3">
              {preview || "暂无情节摘要"}
            </p>
          )}
          {!expanded && (storyInfo.themes?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {storyInfo.themes!.slice(0, 4).map((t) => (
                <span
                  key={t}
                  className="px-1.5 py-0.5 text-[10px] rounded-md bg-primary/10 text-primary"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 sm:px-3.5 sm:pb-3.5 space-y-3 text-xs border-t border-border/40 pt-2.5">
          <div>
            <p className="text-[10px] text-fog mb-1">情节</p>
            <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {summary || "—"}
            </p>
            {storyInfo.mainStoryline && (
              <p className="text-muted-foreground mt-1.5">
                <span className="text-fog">主线 · </span>
                {storyInfo.mainStoryline}
              </p>
            )}
            {(storyInfo.themes?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {storyInfo.themes!.map((t) => (
                  <span
                    key={t}
                    className="px-1.5 py-0.5 text-[10px] rounded-md bg-primary/10 text-primary"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>

          {storyInfo.worldSetting && (
            <div>
              <p className="text-[10px] text-fog mb-1.5 flex items-center gap-1">
                <Globe className="w-3 h-3" /> 世界观
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                <Mini label="时代" value={storyInfo.worldSetting.timePeriod} />
                <Mini label="地点" value={storyInfo.worldSetting.location} />
                <Mini label="社会" value={storyInfo.worldSetting.socialStructure} />
                {storyInfo.worldSetting.powerSystem && (
                  <Mini label="体系" value={storyInfo.worldSetting.powerSystem} />
                )}
              </div>
              {(storyInfo.worldSetting.factions?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {storyInfo.worldSetting.factions!.map((f) => (
                    <span
                      key={f}
                      className="px-1.5 py-0.5 text-[10px] rounded-md bg-secondary text-muted-foreground"
                    >
                      {f}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {(storyInfo.subPlots?.length ?? 0) > 0 && (
            <div>
              <p className="text-[10px] text-fog mb-1">支线</p>
              <ul className="space-y-0.5 text-muted-foreground">
                {storyInfo.subPlots!.slice(0, 5).map((s, i) => (
                  <li key={i} className="leading-snug">
                    · {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="rounded-md bg-secondary/40 px-2 py-1 min-w-0">
      <span className="text-[9px] text-fog">{label}</span>
      <p className="truncate text-[11px] text-foreground/90">{value}</p>
    </div>
  );
}
