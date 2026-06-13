"use client";

import { useState } from "react";
import type { StoryInfo } from "@/types";
import { BookOpen, ChevronDown, ChevronUp, Globe, Layers } from "lucide-react";

export default function StoryInfoPanel({ storyInfo }: { storyInfo: StoryInfo }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="w-full p-4 flex items-center justify-between hover:bg-secondary/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-primary" />
          <span className="font-medium text-sm">故事与世界设定</span>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 text-sm">
          <div>
            <h4 className="font-medium text-foreground/80 flex items-center gap-1">
              <BookOpen className="w-3 h-3" /> 情节
            </h4>
            <p className="text-muted-foreground mt-1">{storyInfo.plotSummary}</p>
            {storyInfo.mainStoryline && (
              <p className="text-muted-foreground mt-1"><strong>主线:</strong> {storyInfo.mainStoryline}</p>
            )}
            {storyInfo.themes?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {storyInfo.themes.map((t) => (
                  <span key={t} className="px-2 py-0.5 text-xs rounded-full bg-primary/10 text-primary">{t}</span>
                ))}
              </div>
            )}
          </div>

          <div>
            <h4 className="font-medium text-foreground/80 flex items-center gap-1">
              <Globe className="w-3 h-3" /> 世界观
            </h4>
            <div className="grid grid-cols-2 gap-2 mt-1 text-muted-foreground">
              <div><span className="text-xs text-muted-foreground/60">时代:</span> {storyInfo.worldSetting.timePeriod}</div>
              <div><span className="text-xs text-muted-foreground/60">地点:</span> {storyInfo.worldSetting.location}</div>
              <div><span className="text-xs text-muted-foreground/60">社会:</span> {storyInfo.worldSetting.socialStructure}</div>
              {storyInfo.worldSetting.powerSystem && (
                <div><span className="text-xs text-muted-foreground/60">体系:</span> {storyInfo.worldSetting.powerSystem}</div>
              )}
            </div>
            {storyInfo.worldSetting.factions?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {storyInfo.worldSetting.factions.map((f) => (
                  <span key={f} className="px-2 py-0.5 text-xs rounded-full bg-secondary text-secondary-foreground">{f}</span>
                ))}
              </div>
            )}
          </div>

          {storyInfo.chapterOutlines?.length > 0 && (
            <div>
              <h4 className="font-medium text-foreground/80 flex items-center gap-1">
                <Layers className="w-3 h-3" /> Chapters ({storyInfo.chapterOutlines.length})
              </h4>
              <div className="mt-1 space-y-1 max-h-40 overflow-y-auto">
                {storyInfo.chapterOutlines.slice(0, 10).map((ch, i) => (
                  <div key={i} className="text-xs text-muted-foreground">
                    <span className="font-medium">Ch.{ch.chapterNumber} {ch.title}:</span> {ch.summary}
                  </div>
                ))}
              </div>
            </div>
          )}

          {storyInfo.subPlots?.length > 0 && (
            <div>
              <h4 className="font-medium text-foreground/80">支线情节</h4>
              <ul className="list-disc list-inside text-muted-foreground">
                {storyInfo.subPlots.map((s, i) => <li key={i} className="text-sm">{s}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
