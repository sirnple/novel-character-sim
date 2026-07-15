"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookMarked, BookOpen, Lightbulb, ChevronDown, ChevronRight,
  PanelLeftClose, PanelLeft, Eye,
} from "lucide-react";
import { useNovel } from "@/lib/novel-context";
import type { StyleLibraryEntry, IdeaLibraryEntry } from "@/types";
import LibraryDetailModal from "@/components/library-detail-modal";
import { LIBRARIES_REFRESH_EVENT } from "@/lib/library-events";

const MAX_IDEAS = 3;

interface SavedNovel {
  id: string;
  title: string;
  total_length: number;
  created_at: string;
}

interface GlobalLibrarySidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onImportClick?: () => void;
}

export default function GlobalLibrarySidebar({
  collapsed,
  onToggleCollapse,
  onImportClick,
}: GlobalLibrarySidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    novelId,
    setNovel,
    selectedStyleId,
    selectedIdeaIds,
    autoPickIdeas,
    setSelectedStyleId,
    setSelectedIdeaIds,
    setAutoPickIdeas,
  } = useNovel();

  const [novels, setNovels] = useState<SavedNovel[]>([]);
  const [styles, setStyles] = useState<StyleLibraryEntry[]>([]);
  const [ideas, setIdeas] = useState<IdeaLibraryEntry[]>([]);
  const [expanded, setExpanded] = useState({ novels: true, styles: true, ideas: true });
  const [showAllStyles, setShowAllStyles] = useState(false);
  const [showAllIdeas, setShowAllIdeas] = useState(false);
  const [detail, setDetail] = useState<
    | { kind: "style"; entry: StyleLibraryEntry }
    | { kind: "idea"; entry: IdeaLibraryEntry }
    | null
  >(null);

  const refresh = useCallback(async () => {
    try {
      const [nRes, sRes, iRes] = await Promise.all([
        fetch("/api/novels"),
        fetch("/api/styles"),
        fetch("/api/ideas"),
      ]);
      const nData = await nRes.json();
      const sData = await sRes.json();
      const iData = await iRes.json();
      setNovels(nData.novels || []);
      setStyles(sData.styles || []);
      setIdeas(iData.ideas || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refresh();
    const onFocus = () => refresh();
    const onLibraries = () => refresh();
    window.addEventListener("focus", onFocus);
    window.addEventListener(LIBRARIES_REFRESH_EVENT, onLibraries);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(LIBRARIES_REFRESH_EVENT, onLibraries);
    };
  }, [refresh]);

  // Re-fetch when route changes
  useEffect(() => {
    refresh();
  }, [pathname, refresh]);

  const bookStyles = useMemo(
    () => (novelId ? styles.filter(s => s.sourceNovelId === novelId) : styles),
    [styles, novelId],
  );
  const otherStyles = useMemo(
    () => (novelId ? styles.filter(s => s.sourceNovelId !== novelId) : []),
    [styles, novelId],
  );
  const bookIdeas = useMemo(
    () => (novelId ? ideas.filter(i => i.sourceNovelId === novelId) : ideas),
    [ideas, novelId],
  );
  const otherIdeas = useMemo(
    () => (novelId ? ideas.filter(i => i.sourceNovelId !== novelId) : []),
    [ideas, novelId],
  );

  const visibleStyles = showAllStyles || !novelId ? styles : bookStyles;
  const visibleIdeas = showAllIdeas || !novelId ? ideas : bookIdeas;

  // Always keep a concrete style selected when any exist (prefer current novel's)
  useEffect(() => {
    if (styles.length === 0) return;
    if (selectedStyleId && styles.some(s => s.id === selectedStyleId)) return;
    const pool = novelId && bookStyles.length > 0 ? bookStyles : styles;
    const canon =
      (novelId && pool.find(s => s.id === `style_${novelId}_canon`)) ||
      pool.find(s => s.source === "extracted") ||
      pool[0];
    if (canon) setSelectedStyleId(canon.id);
  }, [novelId, bookStyles, styles, selectedStyleId, setSelectedStyleId]);

  // Drop selected idea ids that disappeared after re-extract
  useEffect(() => {
    const cur = selectedIdeaIds || [];
    if (cur.length === 0 || ideas.length === 0) return;
    const valid = cur.filter(id => ideas.some(i => i.id === id));
    if (valid.length !== cur.length) setSelectedIdeaIds(valid);
  }, [ideas, selectedIdeaIds, setSelectedIdeaIds]);

  const openNovel = async (id: string) => {
    if (id === novelId && pathname.startsWith(`/novel/${id}`)) return;
    const res = await fetch(`/api/novels?id=${id}`);
    const data = await res.json();
    if (!res.ok) return;
    setNovel({
      novelId: id,
      novelTitle: data.title,
      novelText: data.text,
      characters: data.characters || [],
      storyInfo: data.storyInfo || null,
      timeline: data.timeline || null,
      lastChapterStates: data.lastChapterStates || [],
      selectedStyleId: null,
      selectedIdeaIds: [],
    });
    if (data.branches) setNovel({ branches: data.branches });
    router.push(`/novel/${id}`);
  };

  const toggleIdea = (id: string) => {
    const cur = selectedIdeaIds || [];
    if (cur.includes(id)) {
      setSelectedIdeaIds(cur.filter(x => x !== id));
      return;
    }
    if (cur.length >= MAX_IDEAS) return;
    setSelectedIdeaIds([...cur, id]);
  };

  const toggleSection = (key: keyof typeof expanded) => {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  };

  if (collapsed) {
    return (
      <aside className="w-10 shrink-0 border-r border-neutral-800/60 bg-[#0c0c0c] flex flex-col items-center py-2 gap-2">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="p-1.5 rounded text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800"
          title="展开库侧栏"
        >
          <PanelLeft className="w-4 h-4" />
        </button>
        <button type="button" onClick={() => { setExpanded(e => ({ ...e, novels: true })); onToggleCollapse(); }} className="p-1.5 text-neutral-600 hover:text-orange-400" title="作品库">
          <BookMarked className="w-4 h-4" />
        </button>
        <button type="button" onClick={() => { setExpanded(e => ({ ...e, styles: true })); onToggleCollapse(); }} className="p-1.5 text-neutral-600 hover:text-orange-400" title="风格库">
          <BookOpen className="w-4 h-4" />
        </button>
        <button type="button" onClick={() => { setExpanded(e => ({ ...e, ideas: true })); onToggleCollapse(); }} className="p-1.5 text-neutral-600 hover:text-orange-400" title="点子库">
          <Lightbulb className="w-4 h-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="w-[260px] shrink-0 border-r border-neutral-800/60 bg-[#0c0c0c] flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800/40 shrink-0">
        <span className="text-[10px] font-semibold text-neutral-500 font-mono uppercase tracking-widest">库</span>
        <button
          type="button"
          onClick={onToggleCollapse}
          className="p-1 rounded text-neutral-600 hover:text-neutral-300"
          title="收起"
        >
          <PanelLeftClose className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {/* Novels */}
        <Section
          label={`作品库 (${novels.length})`}
          icon={<BookMarked className="w-3 h-3" />}
          open={expanded.novels}
          onToggle={() => toggleSection("novels")}
        >
          {onImportClick ? (
            <button
              type="button"
              onClick={onImportClick}
              className="w-full text-left px-3 py-1.5 rounded text-xs text-orange-400 hover:bg-orange-500/5 border border-dashed border-neutral-700 hover:border-orange-500/30 font-mono mb-1"
            >
              + 导入小说
            </button>
          ) : (
            <Link
              href="/"
              className="block px-3 py-1.5 rounded text-xs text-orange-400 hover:bg-orange-500/5 border border-dashed border-neutral-700 font-mono mb-1"
            >
              + 导入小说
            </Link>
          )}
          {novels.length === 0 && (
            <p className="px-3 py-2 text-[10px] text-neutral-600 font-mono">暂无作品</p>
          )}
          {novels.map(n => {
            const active = n.id === novelId;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => openNovel(n.id)}
                className={`w-full text-left px-3 py-2 rounded text-xs font-mono transition-colors ${
                  active
                    ? "bg-orange-500/10 border-l-2 border-orange-500 text-neutral-200"
                    : "text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-300"
                }`}
              >
                <div className="truncate font-medium">{n.title}</div>
                <div className="text-[10px] text-neutral-600 mt-0.5">{n.total_length.toLocaleString()} 字</div>
              </button>
            );
          })}
        </Section>

        {/* Styles — single select for writing */}
        <Section
          label={`风格库 (${styles.length}) · 单选`}
          icon={<BookOpen className="w-3 h-3" />}
          open={expanded.styles}
          onToggle={() => toggleSection("styles")}
        >
          {visibleStyles.map(s => {
            const sub =
              s.style?.genre ||
              s.style?.tone ||
              (s.sourceNovelId === novelId ? "本书" : "") ||
              "";
            const active = selectedStyleId === s.id;
            return (
              <div
                key={s.id}
                className={`group flex items-stretch rounded text-[11px] font-mono min-w-0 ${
                  active
                    ? "bg-orange-500/10 border-l-2 border-orange-500 text-orange-200"
                    : "text-neutral-400 hover:bg-neutral-800/40"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setSelectedStyleId(s.id)}
                  className="flex-1 min-w-0 text-left px-3 py-1.5"
                  title="点击选用"
                >
                  <span className="block truncate">{s.name}</span>
                  {sub && (
                    <span className="block text-[9px] text-neutral-600 truncate">{sub}</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setDetail({ kind: "style", entry: s })}
                  className="px-2 text-neutral-600 hover:text-orange-400 opacity-70 group-hover:opacity-100"
                  title="查看详情"
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
          {novelId && otherStyles.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAllStyles(v => !v)}
              className="flex items-center gap-0.5 px-3 py-1 text-[10px] text-neutral-600 hover:text-neutral-400 font-mono"
            >
              {showAllStyles ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              {showAllStyles ? "只看本书" : `全部库 +${otherStyles.length}`}
            </button>
          )}
          {styles.length === 0 && (
            <p className="px-3 py-1 text-[10px] text-neutral-600 font-mono">拆解「风格」后出现</p>
          )}
        </Section>

        {/* Ideas — multi ≤3 */}
        <Section
          label={`点子库 (${ideas.length}) · ≤${MAX_IDEAS}`}
          icon={<Lightbulb className="w-3 h-3" />}
          open={expanded.ideas}
          onToggle={() => toggleSection("ideas")}
        >
          <label className="flex items-center gap-1.5 px-3 py-1 text-[10px] text-neutral-500 font-mono cursor-pointer">
            <input
              type="checkbox"
              checked={!!autoPickIdeas}
              onChange={e => setAutoPickIdeas(e.target.checked)}
              className="accent-orange-500"
            />
            大纲 agent 可自选
          </label>
          {visibleIdeas.map(idea => {
            const on = (selectedIdeaIds || []).includes(idea.id);
            const disabled = !on && (selectedIdeaIds || []).length >= MAX_IDEAS;
            return (
              <div
                key={idea.id}
                className={`group flex items-stretch rounded text-[11px] font-mono min-w-0 ${
                  on
                    ? "bg-orange-500/10 border-l-2 border-orange-500 text-orange-200"
                    : "text-neutral-400 hover:bg-neutral-800/40"
                } ${disabled ? "opacity-40" : ""}`}
              >
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => toggleIdea(idea.id)}
                  className="flex-1 min-w-0 text-left px-3 py-1.5 disabled:cursor-not-allowed"
                  title="点击选用 / 取消"
                >
                  <span className="block truncate">{idea.title}</span>
                  <span className="block text-[9px] text-neutral-600 truncate">
                    {(idea.tags || []).join(" · ") || "无标签"}
                    {idea.sourceNovelId && idea.sourceNovelId !== novelId && idea.sourceNovelTitle
                      ? ` · ${idea.sourceNovelTitle}`
                      : ""}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setDetail({ kind: "idea", entry: idea })}
                  className="px-2 text-neutral-600 hover:text-orange-400 opacity-70 group-hover:opacity-100"
                  title="查看详情"
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
          {novelId && otherIdeas.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAllIdeas(v => !v)}
              className="flex items-center gap-0.5 px-3 py-1 text-[10px] text-neutral-600 hover:text-neutral-400 font-mono"
            >
              {showAllIdeas ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              {showAllIdeas ? "只看本书" : `全部库 +${otherIdeas.length}`}
            </button>
          )}
          {(selectedIdeaIds || []).length > 0 && (
            <p className="px-3 py-1 text-[9px] text-neutral-600 font-mono">
              已选 {(selectedIdeaIds || []).length}/{MAX_IDEAS}
            </p>
          )}
          {ideas.length === 0 && (
            <p className="px-3 py-1 text-[10px] text-neutral-600 font-mono">拆解「点子」后出现</p>
          )}
        </Section>
      </div>

      <LibraryDetailModal
        target={detail}
        onClose={() => setDetail(null)}
        selectedStyleId={selectedStyleId}
        selectedIdeaIds={selectedIdeaIds || []}
        onSelectStyle={setSelectedStyleId}
        onToggleIdea={toggleIdea}
        ideaToggleDisabled={(selectedIdeaIds || []).length >= MAX_IDEAS}
      />
    </aside>
  );
}

function Section({
  label,
  icon,
  open,
  onToggle,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-neutral-800/40">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 text-[10px] text-neutral-500 font-mono uppercase tracking-widest hover:bg-neutral-800/30"
      >
        <span className="flex items-center gap-1.5">{icon} {label}</span>
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>
      {open && <div className="px-2 pb-2 space-y-0.5">{children}</div>}
    </div>
  );
}
