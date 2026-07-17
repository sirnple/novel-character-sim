"use client";

/**
 * Large story preview card — click opens floating detail sheet (no accordion).
 */
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
    summary.length > 160
      ? summary.slice(0, 160).replace(/\s+\S*$/, "") + "…"
      : summary || "暂无情节摘要";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          "group relative text-left w-full min-h-[11rem] sm:min-h-[12.5rem] rounded-2xl border border-border/80 bg-card p-5 " +
          "hover:border-primary/35 hover:bg-panel-elevated/30 transition-colors cursor-pointer " +
          className
        }
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary shrink-0" />
            <span className="text-sm font-medium text-foreground">故事 / 世界</span>
          </div>
          <span className="inline-flex items-center gap-0.5 text-xs text-fog group-hover:text-primary transition-colors">
            详情
            <ChevronRight className="w-3.5 h-3.5" />
          </span>
        </div>

        <p className="text-sm text-muted-foreground leading-relaxed line-clamp-4 mb-3">
          {preview}
        </p>

        {(storyInfo.themes?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-auto">
            {storyInfo.themes!.slice(0, 5).map((t) => (
              <span
                key={t}
                className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary"
              >
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
        <div className="space-y-5">
          <section>
            <h3 className="text-xs text-fog mb-1.5">情节摘要</h3>
            <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {summary || "—"}
            </p>
          </section>
          {storyInfo.mainStoryline && (
            <section>
              <h3 className="text-xs text-fog mb-1.5">主线</h3>
              <p className="text-muted-foreground leading-relaxed">
                {storyInfo.mainStoryline}
              </p>
            </section>
          )}
          {(storyInfo.themes?.length ?? 0) > 0 && (
            <section>
              <h3 className="text-xs text-fog mb-1.5">主题</h3>
              <div className="flex flex-wrap gap-1.5">
                {storyInfo.themes!.map((t) => (
                  <span
                    key={t}
                    className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </section>
          )}
          {storyInfo.worldSetting && (
            <section>
              <h3 className="text-xs text-fog mb-2 flex items-center gap-1">
                <Globe className="w-3.5 h-3.5" /> 世界观
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Field label="时代" value={storyInfo.worldSetting.timePeriod} />
                <Field label="地点" value={storyInfo.worldSetting.location} />
                <Field label="社会" value={storyInfo.worldSetting.socialStructure} />
                <Field label="体系" value={storyInfo.worldSetting.powerSystem} />
              </div>
              {(storyInfo.worldSetting.factions?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {storyInfo.worldSetting.factions!.map((f) => (
                    <span
                      key={f}
                      className="text-xs px-2 py-1 rounded-lg bg-secondary text-muted-foreground"
                    >
                      {f}
                    </span>
                  ))}
                </div>
              )}
              {storyInfo.worldSetting.atmosphere && (
                <p className="text-xs text-fog mt-2 leading-relaxed">
                  {storyInfo.worldSetting.atmosphere}
                </p>
              )}
            </section>
          )}
          {(storyInfo.subPlots?.length ?? 0) > 0 && (
            <section>
              <h3 className="text-xs text-fog mb-1.5">支线</h3>
              <ul className="space-y-1.5 text-muted-foreground">
                {storyInfo.subPlots!.map((s, i) => (
                  <li key={i} className="leading-relaxed">
                    · {s}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {(storyInfo.chapterOutlines?.length ?? 0) > 0 && (
            <section>
              <h3 className="text-xs text-fog mb-1.5">
                章纲要（{storyInfo.chapterOutlines!.length}）
              </h3>
              <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar">
                {storyInfo.chapterOutlines!.slice(0, 20).map((ch, i) => (
                  <div key={i} className="text-xs text-muted-foreground leading-relaxed">
                    <span className="text-foreground/80 font-medium">
                      第{ch.chapterNumber}章 {ch.title}
                    </span>
                    {ch.summary ? ` — ${ch.summary}` : ""}
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

/** Character tile + detail sheet */
export function CharacterPreviewCard({
  character,
}: {
  character: CharacterProfile;
}) {
  const [open, setOpen] = useState(false);
  const c = character;
  const sub =
    c.aliases?.[0] || c.drive?.goal?.slice(0, 24) || c.personality?.traits?.[0] || "—";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 w-36 sm:w-40 text-left rounded-2xl border border-border/70 bg-card px-3.5 py-3.5 hover:border-primary/35 hover:bg-panel-elevated/30 transition-colors"
      >
        <div className="flex items-center gap-1.5 mb-1.5 text-primary/80">
          <User className="w-3.5 h-3.5" />
        </div>
        <p className="text-sm font-medium text-foreground truncate">{c.name}</p>
        <p className="text-xs text-fog truncate mt-1">{sub}</p>
      </button>

      <OverviewDetailSheet
        open={open}
        onClose={() => setOpen(false)}
        title={c.name}
        subtitle={(c.aliases || []).join(" / ") || undefined}
      >
        <div className="space-y-4">
          {c.personality?.description && (
            <Block label="性格" text={c.personality.description} />
          )}
          {(c.personality?.traits?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {c.personality!.traits.map((t) => (
                <span
                  key={t}
                  className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground"
                >
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
              <h3 className="text-xs text-fog mb-1.5">关系</h3>
              <ul className="space-y-1 text-muted-foreground text-sm">
                {c.relationships!.slice(0, 12).map((r, i) => (
                  <li key={i}>
                    {r.characterName || r.characterId}：{r.type}
                    {r.dynamics ? ` · ${r.dynamics}` : ""}
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
    <div className="rounded-xl bg-secondary/40 border border-border/40 px-3 py-2">
      <p className="text-[10px] text-fog">{label}</p>
      <p className="text-sm text-foreground/90 mt-0.5">{value}</p>
    </div>
  );
}

function Block({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <h3 className="text-xs text-fog mb-1">{label}</h3>
      <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">{text}</p>
    </div>
  );
}
