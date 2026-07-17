"use client";

import { X, BookOpen, Lightbulb, Check } from "lucide-react";
import type { StyleLibraryEntry, IdeaLibraryEntry } from "@/types";

type DetailTarget =
  | { kind: "style"; entry: StyleLibraryEntry }
  | { kind: "idea"; entry: IdeaLibraryEntry };

interface LibraryDetailModalProps {
  target: DetailTarget | null;
  onClose: () => void;
  /** Style: currently selected id */
  selectedStyleId?: string | null;
  /** Idea: currently selected ids */
  selectedIdeaIds?: string[];
  onSelectStyle?: (id: string) => void;
  onToggleIdea?: (id: string) => void;
  ideaToggleDisabled?: boolean;
}

export default function LibraryDetailModal({
  target,
  onClose,
  selectedStyleId,
  selectedIdeaIds = [],
  onSelectStyle,
  onToggleIdea,
  ideaToggleDisabled,
}: LibraryDetailModalProps) {
  if (!target) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] bg-card border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {target.kind === "style" ? (
          <StyleBody
            entry={target.entry}
            selected={selectedStyleId === target.entry.id}
            onSelect={() => onSelectStyle?.(target.entry.id)}
            onClose={onClose}
          />
        ) : (
          <IdeaBody
            entry={target.entry}
            selected={selectedIdeaIds.includes(target.entry.id)}
            onToggle={() => onToggleIdea?.(target.entry.id)}
            toggleDisabled={!!ideaToggleDisabled && !selectedIdeaIds.includes(target.entry.id)}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

function Header({
  icon,
  title,
  subtitle,
  onClose,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border/80 shrink-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-primary/90 mb-1">
          {icon}
          <span className="text-xs uppercase tracking-widest text-muted-foreground">
            详情
          </span>
        </div>
        <h2 className="text-sm font-semibold text-foreground truncate">{title}</h2>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="p-1 rounded text-muted-foreground hover:text-foreground/90 shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function StyleBody({
  entry,
  selected,
  onSelect,
  onClose,
}: {
  entry: StyleLibraryEntry;
  selected: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const s = entry.style || ({} as StyleLibraryEntry["style"]);
  const meta = [
    s.genre && `类型 · ${s.genre}`,
    s.tone && `基调 · ${s.tone}`,
    entry.sourceNovelTitle && `来源 · ${entry.sourceNovelTitle}`,
    entry.source === "extracted" ? "分析" : "手动",
  ].filter(Boolean);

  return (
    <>
      <Header
        icon={<BookOpen className="w-3.5 h-3.5" />}
        title={entry.name}
        subtitle={meta.join("  ·  ")}
        onClose={onClose}
      />
      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-3 space-y-4 text-sm">
        {(entry.description || s.styleDescription) && (
          <Block label="文风说明">
            <p className="text-foreground/90 leading-relaxed whitespace-pre-wrap">
              {entry.description || s.styleDescription}
            </p>
          </Block>
        )}
        {s.languageFeatures && (
          <Block label="语言特点">
            <p className="text-foreground/90 leading-relaxed whitespace-pre-wrap">{s.languageFeatures}</p>
          </Block>
        )}
        {s.pacingDescription && (
          <Block label="节奏">
            <p className="text-foreground/90 leading-relaxed whitespace-pre-wrap">{s.pacingDescription}</p>
          </Block>
        )}
        {(s.narrativeTechniques || []).length > 0 && (
          <Block label="叙事手法">
            <ul className="list-disc list-inside space-y-1 text-foreground/90">
              {s.narrativeTechniques.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </Block>
        )}
        {s.contentRating?.level && (
          <Block label="内容尺度">
            <p className="text-foreground/90">
              {s.contentRating.level}
              {s.contentRating.description ? ` — ${s.contentRating.description}` : ""}
              {s.contentRating.hasExplicitContent ? "（含露骨内容）" : ""}
            </p>
          </Block>
        )}
        {(s.examplePassages || []).length > 0 && (
          <Block label="范例片段">
            <div className="space-y-3">
              {s.examplePassages.map((p, i) => (
                <div
                  key={i}
                  className="rounded border border-border/80 bg-background p-3"
                >
                  {p.aspect && (
                    <div className="text-xs text-primary/80 mb-1.5">
                      {p.aspect}
                    </div>
                  )}
                  <p className="text-muted-foreground text-xs leading-relaxed whitespace-pre-wrap font-serif">
                    {p.text}
                  </p>
                </div>
              ))}
            </div>
          </Block>
        )}
        {!entry.description && !s.styleDescription && (s.examplePassages || []).length === 0 && (
          <p className="text-fog text-xs">暂无详细文风数据</p>
        )}
      </div>
      <div className="px-4 py-3 border-t border-border/80 flex items-center justify-end gap-2 shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground/90"
        >
          关闭
        </button>
        <button
          type="button"
          onClick={() => {
            onSelect();
            onClose();
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs ${
            selected
              ? "bg-primary/20 text-primary border border-primary/40"
              : "bg-primary hover:bg-primary text-white"
          }`}
        >
          {selected && <Check className="w-3 h-3" />}
          {selected ? "已选用" : "选用此风格"}
        </button>
      </div>
    </>
  );
}

function IdeaBody({
  entry,
  selected,
  onToggle,
  toggleDisabled,
  onClose,
}: {
  entry: IdeaLibraryEntry;
  selected: boolean;
  onToggle: () => void;
  toggleDisabled: boolean;
  onClose: () => void;
}) {
  return (
    <>
      <Header
        icon={<Lightbulb className="w-3.5 h-3.5" />}
        title={entry.title}
        subtitle={[
          (entry.tags || []).join(" · ") || "无标签",
          entry.sourceNovelTitle && `来源 · ${entry.sourceNovelTitle}`,
          entry.source === "extracted" ? "分析" : "手动",
        ]
          .filter(Boolean)
          .join("  ·  ")}
        onClose={onClose}
      />
      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-3">
        {(entry.tags || []).length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {entry.tags.map(tag => (
              <span
                key={tag}
                className="px-1.5 py-0.5 rounded text-xs bg-secondary text-muted-foreground border border-border/60"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        <Block label="内容">
          <p className="text-foreground/90 leading-relaxed whitespace-pre-wrap text-sm">
            {entry.content || "（空）"}
          </p>
        </Block>
      </div>
      <div className="px-4 py-3 border-t border-border/80 flex items-center justify-end gap-2 shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground/90"
        >
          关闭
        </button>
        <button
          type="button"
          disabled={toggleDisabled}
          onClick={() => {
            onToggle();
            if (!selected) onClose();
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs disabled:opacity-40 ${
            selected
              ? "bg-primary/20 text-primary border border-primary/40"
              : "bg-primary hover:bg-primary text-white"
          }`}
        >
          {selected && <Check className="w-3 h-3" />}
          {selected ? "取消选用" : toggleDisabled ? "已满 3 条" : "选用点子"}
        </button>
      </div>
    </>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-fog mb-1.5">
        {label}
      </div>
      {children}
    </div>
  );
}
