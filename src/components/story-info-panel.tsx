"use client";

import { useState } from "react";
import type { CharacterProfile, StoryInfo } from "@/types";
import { BookOpen, ChevronRight, Globe, User } from "lucide-react";
import OverviewDetailSheet from "@/components/overview-detail-sheet";

export default function StoryInfoPanel({
  storyInfo,
  className = "",
}: {
  storyInfo: StoryInfo;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const summary = (storyInfo.plotSummary || "").trim();
  const preview =
    summary.length > 140
      ? summary.slice(0, 140).replace(/\s+\S*$/, "") + "…"
      : summary || "暂无情节摘要";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`ov-card-interactive min-h-[13rem] p-6 flex flex-col ${className}`}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <span className="w-10 h-10 rounded-xl bg-ember-soft flex items-center justify-center shrink-0">
              <BookOpen className="w-5 h-5 text-primary" />
            </span>
            <div className="text-left">
              <p className="text-sm font-semibold text-foreground">故事 / 世界</p>
              <p className="text-xs text-fog mt-0.5">情节 · 主题 · 世界观</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-0.5 text-xs text-fog">
            详情 <ChevronRight className="w-3.5 h-3.5" />
          </span>
        </div>

        <p className="text-sm text-muted-foreground leading-relaxed line-clamp-4 flex-1">
          {preview}
        </p>

        {(storyInfo.themes?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-4">
            {storyInfo.themes!.slice(0, 4).map((t) => (
              <span key={t} className="ov-chip-ok">
                {t}
              </span>
            ))}
          </div>
        )}
      </button>

      <OverviewDetailSheet
        open={open}
        onClose={() => setOpen(false)}
        title="故事 / 世界"
        subtitle={storyInfo.title || undefined}
        wide
      >
        <div className="space-y-6">
          <section>
            <h3 className="text-xs font-medium text-fog mb-2">情节摘要</h3>
            <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {summary || "—"}
            </p>
          </section>
          {storyInfo.mainStoryline && (
            <section>
              <h3 className="text-xs font-medium text-fog mb-2">主线</h3>
              <p className="text-muted-foreground leading-relaxed pl-3 border-l-2 border-primary/35">
                {storyInfo.mainStoryline}
              </p>
            </section>
          )}
          {(storyInfo.themes?.length ?? 0) > 0 && (
            <section>
              <h3 className="text-xs font-medium text-fog mb-2">主题</h3>
              <div className="flex flex-wrap gap-2">
                {storyInfo.themes!.map((t) => (
                  <span key={t} className="ov-chip-ok">
                    {t}
                  </span>
                ))}
              </div>
            </section>
          )}
          {storyInfo.worldSetting && (
            <section>
              <h3 className="text-xs font-medium text-fog mb-3 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5" /> 世界观
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <Field label="时代" value={storyInfo.worldSetting.timePeriod} />
                <Field label="地点" value={storyInfo.worldSetting.location} />
                <Field label="社会" value={storyInfo.worldSetting.socialStructure} />
                <Field label="体系" value={storyInfo.worldSetting.powerSystem} />
              </div>
              {(storyInfo.worldSetting.factions?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {storyInfo.worldSetting.factions!.map((f) => (
                    <span key={f} className="ov-chip-muted">
                      {f}
                    </span>
                  ))}
                </div>
              )}
            </section>
          )}
          {(storyInfo.subPlots?.length ?? 0) > 0 && (
            <section>
              <h3 className="text-xs font-medium text-fog mb-2">支线</h3>
              <ul className="space-y-2">
                {storyInfo.subPlots!.map((s, i) => (
                  <li
                    key={i}
                    className="text-sm text-muted-foreground leading-relaxed pl-3 border-l border-border"
                  >
                    {s}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {(storyInfo.chapterOutlines?.length ?? 0) > 0 && (
            <section>
              <h3 className="text-xs font-medium text-fog mb-2">
                章纲要（{storyInfo.chapterOutlines!.length}）
              </h3>
              <div className="rounded-xl border border-border/50 bg-secondary/20 max-h-56 overflow-y-auto custom-scrollbar divide-y divide-border/30">
                {storyInfo.chapterOutlines!.slice(0, 20).map((ch, i) => (
                  <div key={i} className="px-3 py-2.5 text-xs text-muted-foreground leading-relaxed">
                    <span className="text-foreground/85 font-medium">
                      第{ch.chapterNumber}章 {ch.title}
                    </span>
                    {ch.summary ? (
                      <span className="text-fog"> — {ch.summary}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </OverviewDetailSheet>
    </>
  );
}

export function CharacterPreviewCard({
  character,
}: {
  character: CharacterProfile;
}) {
  const [open, setOpen] = useState(false);
  const c = character;
  const initial = (c.name || "?").charAt(0);
  const sub =
    c.aliases?.[0] || c.drive?.goal?.slice(0, 22) || c.personality?.traits?.[0] || "—";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ov-card-interactive shrink-0 w-40 sm:w-44 p-4 flex flex-col items-start"
      >
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-primary/90 to-primary/50 flex items-center justify-center text-primary-foreground font-semibold text-base shadow-md shadow-primary/20 mb-3">
          {initial}
        </div>
        <p className="text-sm font-semibold text-foreground truncate w-full text-left">
          {c.name}
        </p>
        <p className="text-xs text-fog truncate w-full text-left mt-1">{sub}</p>
      </button>

      <OverviewDetailSheet
        open={open}
        onClose={() => setOpen(false)}
        title={c.name}
        subtitle={(c.aliases || []).join(" / ") || undefined}
      >
        <div className="space-y-5">
          {c.personality?.description && (
            <Block label="性格" text={c.personality.description} />
          )}
          {(c.personality?.traits?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {c.personality!.traits.map((t) => (
                <span key={t} className="ov-chip-muted">
                  {t}
                </span>
              ))}
            </div>
          )}
          {c.drive?.goal && <Block label="目标" text={c.drive.goal} />}
          {c.drive?.motivation && <Block label="动机" text={c.drive.motivation} />}
          {c.drive?.fear && <Block label="恐惧" text={c.drive.fear} />}
          {c.speakingStyle?.description && (
            <Block label="说话风格" text={c.speakingStyle.description} />
          )}
          {c.background?.description && (
            <Block label="背景" text={c.background.description} />
          )}
          {(c.relationships?.length ?? 0) > 0 && (
            <div>
              <h3 className="text-xs font-medium text-fog mb-2">关系</h3>
              <ul className="space-y-2">
                {c.relationships!.slice(0, 12).map((r, i) => (
                  <li
                    key={i}
                    className="text-sm text-muted-foreground rounded-xl bg-secondary/40 border border-border/40 px-3 py-2"
                  >
                    <span className="text-foreground/90 font-medium">
                      {r.characterName || r.characterId}
                    </span>
                    <span className="text-fog mx-1.5">·</span>
                    {r.type}
                    {r.dynamics ? (
                      <span className="block text-xs text-fog mt-0.5">{r.dynamics}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </OverviewDetailSheet>
    </>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="rounded-xl bg-secondary/40 border border-border/40 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wide text-fog">{label}</p>
      <p className="text-sm text-foreground/90 mt-0.5">{value}</p>
    </div>
  );
}

function Block({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <h3 className="text-xs font-medium text-fog mb-1.5">{label}</h3>
      <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">{text}</p>
    </div>
  );
}
