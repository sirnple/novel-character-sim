"use client";

import { useMemo, useState } from "react";
import type { ShareCharacter, ShareOverviewPayload } from "@/lib/share-payload";
import { shareCharactersToProfiles } from "@/lib/share-payload";
import OverviewDetailSheet from "@/components/overview-detail-sheet";
import RelationshipGraph from "@/components/relationship-graph";
import { BookOpen, Globe, Users } from "lucide-react";

function formatGeneratedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-CN");
  } catch {
    return iso;
  }
}

/**
 * Story payloads sometimes store structured objects (e.g. subPlots as
 * { title, description }) instead of plain strings — never pass objects to JSX.
 */
function asDisplayText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return String(v);
  }
  if (Array.isArray(v)) {
    return v.map(asDisplayText).filter(Boolean).join("；");
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("title" in o || "description" in o || "summary" in o || "name" in o) {
      const parts = [
        asDisplayText(o.title ?? o.name),
        asDisplayText(o.description ?? o.summary),
      ].filter(Boolean);
      if (parts.length) return parts.join(" — ");
    }
    try {
      return JSON.stringify(v);
    } catch {
      return "";
    }
  }
  return "";
}

export default function ShareOverviewView({
  payload,
}: {
  payload: ShareOverviewPayload;
}) {
  const story = payload.story;
  const characters = payload.characters || [];
  const graphCharacters = useMemo(
    () => shareCharactersToProfiles(characters),
    [characters],
  );
  const hasAnyRel = graphCharacters.some(
    (c) => (c.relationships?.length ?? 0) > 0,
  );

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8 sm:py-10 space-y-8">
      {/* Header */}
      <header className="space-y-2">
        <p className="text-xs font-medium text-fog tracking-wide">分享的小说概览</p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-foreground tracking-tight">
          {payload.title || "未命名"}
        </h1>
        <p className="text-sm text-muted-foreground">
          生成于 {formatGeneratedAt(payload.generatedAt)}
          {payload.language ? (
            <span className="text-fog"> · {payload.language}</span>
          ) : null}
        </p>
      </header>

      {/* Story */}
      {story && (
        <section className="space-y-4">
          <div className="ov-section-label">
            <span className="w-8 h-8 rounded-lg bg-ember-soft flex items-center justify-center">
              <BookOpen className="w-4 h-4 text-primary" />
            </span>
            故事 / 世界
          </div>

          <div className="ov-card p-5 sm:p-6 space-y-6">
            <section>
              <h3 className="text-xs font-medium text-fog mb-2">情节摘要</h3>
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                {asDisplayText(story.plotSummary).trim() || "—"}
              </p>
            </section>

            {asDisplayText(story.mainStoryline) && (
              <section>
                <h3 className="text-xs font-medium text-fog mb-2">主线</h3>
                <p className="text-sm text-muted-foreground leading-relaxed pl-3 border-l-2 border-primary/35">
                  {asDisplayText(story.mainStoryline)}
                </p>
              </section>
            )}

            {(story.themes?.length ?? 0) > 0 && (
              <section>
                <h3 className="text-xs font-medium text-fog mb-2">主题</h3>
                <div className="flex flex-wrap gap-2">
                  {story.themes!.map((t, i) => {
                    const text = asDisplayText(t);
                    if (!text) return null;
                    return (
                      <span key={`${text}-${i}`} className="ov-chip-ok">
                        {text}
                      </span>
                    );
                  })}
                </div>
              </section>
            )}

            {story.worldSetting && (
              <section>
                <h3 className="text-xs font-medium text-fog mb-3 flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5" /> 世界观
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <Field label="时代" value={asDisplayText(story.worldSetting.timePeriod)} />
                  <Field label="地点" value={asDisplayText(story.worldSetting.location)} />
                  <Field label="社会" value={asDisplayText(story.worldSetting.socialStructure)} />
                  <Field label="体系" value={asDisplayText(story.worldSetting.powerSystem)} />
                </div>
                {(story.worldSetting.factions?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {story.worldSetting.factions!.map((f, i) => {
                      const text = asDisplayText(f);
                      if (!text) return null;
                      return (
                        <span key={`${text}-${i}`} className="ov-chip-muted">
                          {text}
                        </span>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {(story.subPlots?.length ?? 0) > 0 && (
              <section>
                <h3 className="text-xs font-medium text-fog mb-2">支线</h3>
                <ul className="space-y-2">
                  {story.subPlots!.map((s, i) => {
                    const text = asDisplayText(s);
                    if (!text) return null;
                    return (
                      <li
                        key={i}
                        className="text-sm text-muted-foreground leading-relaxed pl-3 border-l border-border"
                      >
                        {text}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </div>
        </section>
      )}

      {/* Characters */}
      <section>
        <div className="ov-section-label mb-3.5">
          <span className="w-8 h-8 rounded-lg bg-ember-soft flex items-center justify-center">
            <Users className="w-4 h-4 text-primary" />
          </span>
          角色
          <span className="text-xs text-fog font-normal">{characters.length}</span>
          {characters.length > 0 && (
            <span className="text-xs text-fog font-normal">· 点击查看</span>
          )}
        </div>
        {characters.length === 0 ? (
          <div className="ov-card border-dashed py-10 text-center text-sm text-fog">
            暂无角色
          </div>
        ) : (
          <div className="flex gap-3.5 overflow-x-auto pb-2 custom-scrollbar">
            {characters.map((c) => (
              <ShareCharacterCard key={c.id || c.name} character={c} />
            ))}
          </div>
        )}
      </section>

      {/* Relationship graph — read-only snapshot */}
      {characters.length > 0 && hasAnyRel && (
        <section className="ov-card p-4 sm:p-5">
          <RelationshipGraph
            characters={graphCharacters}
            height={440}
            readOnly
          />
        </section>
      )}

      {/* Footer — attribution only; no navigation (read-only share) */}
      <footer className="pt-4 border-t border-border/50 text-sm text-fog">
        由小说创作工作台生成 · 只读分享
      </footer>
    </div>
  );
}

function ShareCharacterCard({ character }: { character: ShareCharacter }) {
  const [open, setOpen] = useState(false);
  const c = character;
  const initial = (c.name || "?").charAt(0);
  const sub =
    c.aliases?.[0] ||
    c.drive?.goal?.slice(0, 22) ||
    c.personality?.traits?.[0] ||
    "—";

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
          {asDisplayText(c.appearance?.summary) && (
            <Block label="外貌" text={asDisplayText(c.appearance?.summary)} />
          )}
          {asDisplayText(c.personality?.description) && (
            <Block
              label="性格"
              text={asDisplayText(c.personality?.description)}
            />
          )}
          {(c.personality?.traits?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {c.personality!.traits!.map((t, i) => {
                const text = asDisplayText(t);
                if (!text) return null;
                return (
                  <span key={`${text}-${i}`} className="ov-chip-muted">
                    {text}
                  </span>
                );
              })}
            </div>
          )}
          {asDisplayText(c.drive?.goal) && (
            <Block label="目标" text={asDisplayText(c.drive?.goal)} />
          )}
          {asDisplayText(c.drive?.motivation) && (
            <Block label="动机" text={asDisplayText(c.drive?.motivation)} />
          )}
          {asDisplayText(c.drive?.fear) && (
            <Block label="恐惧" text={asDisplayText(c.drive?.fear)} />
          )}
          {(c.relationships?.length ?? 0) > 0 && (
            <div>
              <h3 className="text-xs font-medium text-fog mb-2">关系</h3>
              <ul className="space-y-2">
                {c.relationships!.map((r, i) => (
                  <li
                    key={i}
                    className="text-sm text-muted-foreground rounded-xl bg-secondary/40 border border-border/40 px-3 py-2"
                  >
                    <span className="text-foreground/90 font-medium">
                      {asDisplayText(r.characterName)}
                    </span>
                    <span className="text-fog mx-1.5">·</span>
                    {asDisplayText(r.type)}
                    {asDisplayText(r.description) ? (
                      <span className="block text-xs text-fog mt-0.5">
                        {asDisplayText(r.description)}
                      </span>
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
  const text = asDisplayText(value).trim();
  if (!text) return null;
  return (
    <div className="rounded-xl bg-secondary/40 border border-border/40 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wide text-fog">{label}</p>
      <p className="text-sm text-foreground/90 mt-0.5">{text}</p>
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
