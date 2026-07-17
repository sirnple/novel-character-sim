"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookMarked, BookOpen, Lightbulb, ChevronDown, ChevronRight,
  PanelLeftClose, PanelLeft, Eye, Trash2,
} from "lucide-react";
import { useNovel } from "@/lib/novel-context";
import type { StyleLibraryEntry, IdeaLibraryEntry } from "@/types";
import LibraryDetailModal from "@/components/library-detail-modal";
import { LIBRARIES_REFRESH_EVENT, notifyLibrariesRefresh } from "@/lib/library-events";

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
  /** Mobile drawer open (below lg) */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export default function GlobalLibrarySidebar({
  collapsed,
  onToggleCollapse,
  onImportClick,
  mobileOpen = false,
  onMobileClose,
}: GlobalLibrarySidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    novelId,
    setNovel,
    clearNovel,
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
    if (id === novelId && pathname.startsWith(`/novel/${id}`)) {
      onMobileClose?.();
      return;
    }
    const res = await fetch(`/api/novels?id=${encodeURIComponent(id)}&meta=1`);
    const data = await res.json();
    if (!res.ok) return;
    setNovel({
      novelId: id,
      novelTitle: data.title,
      novelText: "",
      novelLength:
        typeof data.totalLength === "number"
          ? data.totalLength
          : 0,
      characters: data.characters || [],
      storyInfo: data.storyInfo || null,
      timeline: data.timeline || null,
      lastChapterStates: data.lastChapterStates || [],
      selectedStyleId: null,
      selectedIdeaIds: [],
      branches: data.branches || [],
    });
    onMobileClose?.();
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

  const deleteNovel = async (id: string, title: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const ok = window.confirm(
      `确定删除《${title || id}》？\n将清除该书正文、分析结果、分支，以及从该书提取的文笔/点子库条目。此操作不可恢复。`,
    );
    if (!ok) return;
    try {
      const res = await fetch("/api/novels", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert(data.error || "删除失败");
        return;
      }
      setNovels(prev => prev.filter(n => n.id !== id));
      if (novelId === id) {
        clearNovel();
        if (pathname.startsWith("/novel/")) router.push("/");
      }
      if (selectedStyleId?.includes(id)) setSelectedStyleId(null);
      notifyLibrariesRefresh();
    } catch {
      window.alert("删除失败");
    }
  };

  const libraryScrollBody = (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
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
            className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-primary hover:bg-primary/5 border border-dashed border-border hover:border-primary/30 mb-1 min-h-[44px]"
          >
            + 导入小说
          </button>
        ) : (
          <Link
            href="/"
            onClick={() => onMobileClose?.()}
            className="block px-3 py-2.5 rounded-lg text-sm text-primary hover:bg-primary/5 border border-dashed border-border mb-1 min-h-[44px]"
          >
            + 导入小说
          </Link>
        )}
        {novels.length === 0 && (
          <p className="px-3 py-2 text-xs text-fog">暂无作品</p>
        )}
        {novels.map(n => {
          const active = n.id === novelId;
          return (
            <div
              key={n.id}
              className={`group flex items-stretch rounded-lg text-sm min-w-0 ${
                active
                  ? "bg-primary/10 border-l-2 border-primary text-foreground"
                  : "text-muted-foreground hover:bg-panel-elevated hover:text-foreground"
              }`}
            >
              <button
                type="button"
                onClick={() => openNovel(n.id)}
                className="flex-1 min-w-0 text-left px-3 py-2.5"
                title="打开"
              >
                <div className="truncate font-medium">{n.title}</div>
                <div className="text-xs text-fog mt-0.5">
                  {n.total_length.toLocaleString()} 字
                </div>
              </button>
              <button
                type="button"
                onClick={(e) => deleteNovel(n.id, n.title, e)}
                className="px-2.5 text-fog hover:text-red-400 opacity-70 group-hover:opacity-100 shrink-0"
                title="删除作品"
                aria-label={`删除 ${n.title}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </Section>

      <Section
        label={`文笔库 (${styles.length}) · 单选 · 可嫁接`}
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
              className={`group flex items-stretch rounded-lg text-sm min-w-0 ${
                active
                  ? "bg-primary/10 border-l-2 border-primary text-primary"
                  : "text-muted-foreground hover:bg-panel-elevated"
              }`}
            >
              <button
                type="button"
                onClick={() => setSelectedStyleId(s.id)}
                className="flex-1 min-w-0 text-left px-3 py-2"
                title="点击选用"
              >
                <span className="block truncate">{s.name}</span>
                {sub && (
                  <span className="block text-xs text-fog truncate">{sub}</span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setDetail({ kind: "style", entry: s })}
                className="px-2.5 text-fog hover:text-primary opacity-70 group-hover:opacity-100"
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
            className="flex items-center gap-0.5 px-3 py-2 text-xs text-fog hover:text-muted-foreground"
          >
            {showAllStyles ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {showAllStyles ? "只看本书" : `全部库 +${otherStyles.length}`}
          </button>
        )}
        {styles.length === 0 && (
          <p className="px-3 py-1 text-xs text-fog">分析「文笔」后写入；可套到其他书</p>
        )}
      </Section>

      <Section
        label={`点子库 (${ideas.length}) · ≤${MAX_IDEAS} · 选用`}
        icon={<Lightbulb className="w-3 h-3" />}
        open={expanded.ideas}
        onToggle={() => toggleSection("ideas")}
      >
        <label className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={!!autoPickIdeas}
            onChange={e => setAutoPickIdeas(e.target.checked)}
            className="accent-primary"
          />
          大纲 agent 可自选
        </label>
        {visibleIdeas.map(idea => {
          const on = (selectedIdeaIds || []).includes(idea.id);
          const disabled = !on && (selectedIdeaIds || []).length >= MAX_IDEAS;
          return (
            <div
              key={idea.id}
              className={`group flex items-stretch rounded-lg text-sm min-w-0 ${
                on
                  ? "bg-primary/10 border-l-2 border-primary text-primary"
                  : "text-muted-foreground hover:bg-panel-elevated"
              } ${disabled ? "opacity-40" : ""}`}
            >
              <button
                type="button"
                disabled={disabled}
                onClick={() => toggleIdea(idea.id)}
                className="flex-1 min-w-0 text-left px-3 py-2 disabled:cursor-not-allowed"
                title="点击选用 / 取消"
              >
                <span className="block truncate">{idea.title}</span>
                <span className="block text-xs text-fog truncate">
                  {(idea.tags || []).join(" · ") || "无标签"}
                  {idea.sourceNovelId && idea.sourceNovelId !== novelId && idea.sourceNovelTitle
                    ? ` · ${idea.sourceNovelTitle}`
                    : ""}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setDetail({ kind: "idea", entry: idea })}
                className="px-2.5 text-fog hover:text-primary opacity-70 group-hover:opacity-100"
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
            className="flex items-center gap-0.5 px-3 py-2 text-xs text-fog hover:text-muted-foreground"
          >
            {showAllIdeas ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {showAllIdeas ? "只看本书" : `全部库 +${otherIdeas.length}`}
          </button>
        )}
        {(selectedIdeaIds || []).length > 0 && (
          <p className="px-3 py-1 text-xs text-fog">
            已选 {(selectedIdeaIds || []).length}/{MAX_IDEAS}
          </p>
        )}
        {ideas.length === 0 && (
          <p className="px-3 py-1 text-xs text-fog">分析「点子」后出现</p>
        )}
      </Section>
    </div>
  );

  const detailModal = (
    <LibraryDetailModal
      target={detail}
      onClose={() => setDetail(null)}
      selectedStyleId={selectedStyleId}
      selectedIdeaIds={selectedIdeaIds || []}
      onSelectStyle={setSelectedStyleId}
      onToggleIdea={toggleIdea}
      ideaToggleDisabled={(selectedIdeaIds || []).length >= MAX_IDEAS}
    />
  );

  return (
    <>
      {/* Desktop rail — lg+ */}
      {collapsed ? (
        <aside className="hidden lg:flex w-10 shrink-0 border-r border-border/80 bg-card flex-col items-center py-2 gap-2">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="p-1.5 rounded text-muted-foreground hover:text-foreground/90 hover:bg-panel-elevated"
            title="展开库侧栏"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => { setExpanded(e => ({ ...e, novels: true })); onToggleCollapse(); }} className="p-1.5 text-fog hover:text-primary" title="作品库">
            <BookMarked className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => { setExpanded(e => ({ ...e, styles: true })); onToggleCollapse(); }} className="p-1.5 text-fog hover:text-primary" title="文笔库">
            <BookOpen className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => { setExpanded(e => ({ ...e, ideas: true })); onToggleCollapse(); }} className="p-1.5 text-fog hover:text-primary" title="点子库">
            <Lightbulb className="w-4 h-4" />
          </button>
        </aside>
      ) : (
        <aside className="hidden lg:flex w-[260px] shrink-0 border-r border-border/80 bg-card flex-col overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/60 shrink-0">
            <span className="text-sm font-semibold text-muted-foreground">库</span>
            <button
              type="button"
              onClick={onToggleCollapse}
              className="p-1.5 rounded-lg text-fog hover:text-foreground hover:bg-panel-elevated"
              title="收起"
            >
              <PanelLeftClose className="w-3.5 h-3.5" />
            </button>
          </div>
          {libraryScrollBody}
        </aside>
      )}

      {/* Mobile / tablet drawer — below lg */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex safe-drawer-pad">
          <button
            type="button"
            className="absolute inset-0 bg-black/60 backdrop-blur-[1px]"
            aria-label="关闭库"
            onClick={() => onMobileClose?.()}
          />
          <aside className="relative z-10 w-[min(100vw-2.5rem,280px)] max-w-full h-full bg-card border-r border-border/80 flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/60 shrink-0">
              <span className="text-sm font-semibold text-muted-foreground">库</span>
              <button
                type="button"
                onClick={() => onMobileClose?.()}
                className="p-1.5 rounded text-muted-foreground hover:text-foreground/90"
                title="关闭"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>
            {libraryScrollBody}
          </aside>
        </div>
      )}

      {detailModal}
    </>
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
    <div className="border-b border-border/60">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2.5 text-sm text-muted-foreground hover:bg-panel-elevated"
      >
        <span className="flex items-center gap-1.5">{icon} {label}</span>
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>
      {open && <div className="px-2 pb-2 space-y-0.5">{children}</div>}
    </div>
  );
}
