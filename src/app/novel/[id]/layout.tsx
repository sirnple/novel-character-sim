"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useNovel } from "@/lib/novel-context";
import { BookOpen, Users, Clock, ScrollText, Play, BookMarked, PanelRight, ChevronDown, ChevronRight, Settings, Eye } from "lucide-react";

interface SavedNovel { id: string; title: string; total_length: number; created_at: string; }

export default function NovelLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const { novelTitle, novelText, characters, timeline, storyInfo, setNovel, setCharacters, setStoryInfo, setTimeline } = useNovel();
  const [savedNovels, setSavedNovels] = useState<SavedNovel[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showRightPanel, setShowRightPanel] = useState(false);
  const [rightPanelView, setRightPanelView] = useState<"codex" | "review" | "assistant">("assistant");
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({ library: true, tasks: true, codex: false, review: false });

  useEffect(() => {
    fetch("/api/novels").then(r => r.json()).then(d => setSavedNovels(d.novels || [])).catch(() => {});
  }, []);

  const openNovel = async (nid: string) => {
    if (nid === id) return;
    const res = await fetch(`/api/novels?id=${nid}`);
    const data = await res.json();
    if (res.ok) {
      setNovel({ novelId: nid, novelTitle: data.title, novelText: data.text, characters: data.characters || [], storyInfo: data.storyInfo || null, timeline: data.timeline || null, lastChapterStates: data.lastChapterStates || [] });
      window.location.href = `/novel/${nid}`;
    }
  };

  const toggleSection = (s: string) => setExpandedSections(prev => ({ ...prev, [s]: !prev[s] }));

  return (
    <div className="h-screen flex flex-col">
      {/* Top Bar */}
      <header className="flex items-center justify-between px-5 py-2.5 border-b border-neutral-800/60 bg-[#0c0c0c] shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="p-1 rounded text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 transition-colors">
            <PanelRight className="w-4 h-4 rotate-180" />
          </button>
          <Link href="/" className="flex items-center gap-2">
            <BookMarked className="w-4 h-4 text-orange-500" />
            <h1 className="text-sm font-bold tracking-wider text-neutral-300 font-mono">NOVEL WORKSPACE</h1>
          </Link>
          {novelTitle && (
            <>
              <span className="w-px h-4 bg-neutral-800" />
              <span className="text-sm text-neutral-400">{novelTitle}</span>
              <span className="text-xs text-neutral-600">{novelText.length.toLocaleString()} 字</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => { setShowRightPanel(!showRightPanel); if (!showRightPanel) setRightPanelView("assistant"); }}
            className={`p-1 rounded transition-colors ${showRightPanel ? "text-orange-400 bg-orange-500/10" : "text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800"}`}>
            <PanelRight className="w-4 h-4" />
          </button>
          <a href="/admin" className="flex items-center gap-1 text-xs text-neutral-600 hover:text-neutral-400 transition-colors font-mono">
            <Settings className="w-3 h-3" /> ADMIN
          </a>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        {!sidebarCollapsed && (
          <aside className="w-[260px] shrink-0 border-r border-neutral-800/60 bg-[#0c0c0c] flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              <SidebarSection section="library" icon={<BookMarked className="w-3 h-3" />} label="作品库" expanded={expandedSections.library} onToggle={() => toggleSection("library")}>
                <Link href="/" className="block px-3 py-2 rounded text-xs text-orange-400 hover:bg-orange-500/5 border border-dashed border-neutral-700 hover:border-orange-500/30 transition-colors font-mono mb-1">+ 导入新小说</Link>
                {savedNovels.map(n => (
                  <button key={n.id} onClick={() => openNovel(n.id)}
                    className={`w-full text-left px-3 py-2 rounded text-xs transition-colors ${n.id === id ? "bg-orange-500/5 border-l-2 border-orange-500 text-neutral-200" : "text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-300"}`}>
                    <div className="font-medium truncate">{n.title}</div>
                    <div className="text-[10px] text-neutral-600 mt-0.5">{n.total_length.toLocaleString()} 字</div>
                  </button>
                ))}
              </SidebarSection>
              <SidebarSection section="codex" icon={<BookMarked className="w-3 h-3" />} label="创作法典" expanded={expandedSections.codex} onToggle={() => toggleSection("codex")}>
                {["角色卷宗", "世界观百科", "前文摘要", "伏笔账本"].map(item => (
                  <button key={item} onClick={() => { setShowRightPanel(true); setRightPanelView("codex"); }}
                    className="w-full text-left px-3 py-1.5 rounded text-xs text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-300 transition-colors">{item}</button>
                ))}
              </SidebarSection>
            </div>
          </aside>
        )}

        {/* Main content */}
        <main className="flex-1 overflow-hidden flex flex-col bg-[#0a0a0a]">
          {children}
        </main>

        {/* Right panel */}
        {showRightPanel && (
          <aside className="w-[280px] shrink-0 border-l border-neutral-800/60 bg-[#0c0c0c] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-800/40">
              <div className="flex rounded border border-neutral-700 overflow-hidden">
                {[
                  { key: "codex" as const, label: "CODEX" },
                  { key: "review" as const, label: "REVIEW" },
                  { key: "assistant" as const, label: "助手" },
                ].map(v => (
                  <button key={v.key} onClick={() => setRightPanelView(v.key)}
                    className={`px-2.5 py-1 text-[10px] font-mono transition-colors ${rightPanelView === v.key ? "bg-neutral-700 text-neutral-200" : "bg-transparent text-neutral-500 hover:text-neutral-300"}`}>
                    {v.label}
                  </button>
                ))}
              </div>
              <button onClick={() => setShowRightPanel(false)} className="text-neutral-500 hover:text-neutral-300">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {rightPanelView === "assistant" && (
                <AgentPanelWrapper novelTitle={novelTitle} novelText={novelText} characters={characters} />
              )}
              {rightPanelView === "codex" && (
                <div className="p-4 space-y-3">
                  <h3 className="text-[10px] text-neutral-500 font-mono uppercase tracking-widest">创作法典</h3>
                  {[{ title: "角色卷宗", count: characters.length }, { title: "世界观百科", count: storyInfo ? 1 : 0 }, { title: "前文摘要", count: timeline?.chapters?.length || 0 }].map(item => (
                    <div key={item.title} className="border border-neutral-800/40 rounded p-3">
                      <div className="flex items-center justify-between mb-1"><h4 className="text-xs font-medium text-neutral-400">{item.title}</h4><span className="text-[10px] text-neutral-600 font-mono">{item.count}</span></div>
                      <p className="text-[10px] text-neutral-600">{item.count > 0 ? "已就绪" : "暂无数据"}</p>
                    </div>
                  ))}
                </div>
              )}
              {rightPanelView === "review" && (
                <div className="p-4"><p className="text-xs text-neutral-600">完成写作后可在此查看审查报告。</p></div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function SidebarSection({ section, icon, label, expanded, onToggle, children }: {
  section: string; icon: React.ReactNode; label: string; expanded: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div>
      <button onClick={onToggle} className="w-full flex items-center justify-between px-4 py-2 text-[10px] text-neutral-500 font-mono uppercase tracking-widest hover:bg-neutral-800/30 transition-colors">
        <span className="flex items-center gap-1.5">{icon} {label}</span>
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>
      {expanded && <div className="px-3 pb-2 space-y-1">{children}</div>}
    </div>
  );
}

// Lazy import to avoid SSR issues
import dynamic from "next/dynamic";
const AgentPanel = dynamic(() => import("@/components/agent-panel"), { ssr: false });

function AgentPanelWrapper({ novelTitle, novelText, characters }: { novelTitle?: string; novelText?: string; characters?: any[] }) {
  return <AgentPanel novelTitle={novelTitle} characters={characters} novelText={novelText} />;
}
