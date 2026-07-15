"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useNovel } from "@/lib/novel-context";
import { BookOpen, Play, PanelRight } from "lucide-react";
import dynamic from "next/dynamic";

const AgentPanel = dynamic(() => import("@/components/agent-panel"), { ssr: false });

export default function NovelLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const {
    novelTitle, novelText, characters, setNovel, setBranches,
    sessionNovelText, sessionContinueOffset, sessionContinueLabel,
    activeBranchId, novelId,
  } = useNovel();
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [panelWidth, setPanelWidth] = useState(480);
  const [dragging, setDragging] = useState(false);

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    const startX = e.clientX;
    const startW = panelWidth;
    const onMove = (ev: MouseEvent) => {
      setPanelWidth(Math.max(320, Math.min(720, startW + startX - ev.clientX)));
    };
    const onUp = () => {
      setDragging(false);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  useEffect(() => {
    if (!novelTitle) {
      fetch(`/api/novels?id=${id}`).then(r => r.json()).then(data => {
        if (data.title) setNovel({
          novelId: id, novelTitle: data.title, novelText: data.text || "",
          characters: data.characters || [], storyInfo: data.storyInfo || null,
          timeline: data.timeline || null, lastChapterStates: data.lastChapterStates || [],
        });
        if (data.branches) setBranches(data.branches);
      }).catch(() => {});
    }
  }, [id]);

  const base = `/novel/${id}`;
  const nav = [
    { href: base, label: "概览", match: pathname === base },
    { href: `${base}/read`, label: "阅读", match: pathname.endsWith("/read") },
    { href: `${base}/write`, label: "写作", match: pathname.endsWith("/write") },
  ];

  return (
    <div className="flex flex-1 overflow-hidden min-h-0">
      {/* Sub-nav + main */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-neutral-800/40 bg-[#0c0c0c] shrink-0">
          {nav.map(n => (
            <Link
              key={n.href}
              href={n.href}
              className={`px-2.5 py-1 rounded text-[11px] font-mono transition-colors ${
                n.match ? "bg-orange-500/15 text-orange-300" : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              {n.label === "阅读" && <BookOpen className="w-3 h-3 inline mr-1 -mt-0.5" />}
              {n.label === "写作" && <Play className="w-3 h-3 inline mr-1 -mt-0.5" />}
              {n.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setShowRightPanel(!showRightPanel)}
            className={`ml-auto p-1 rounded transition-colors ${
              showRightPanel ? "text-orange-400 bg-orange-500/10" : "text-neutral-500 hover:text-neutral-300"
            }`}
            title="助手面板"
          >
            <PanelRight className="w-4 h-4" />
          </button>
        </div>
        <main className="flex-1 overflow-hidden flex flex-col bg-[#0a0a0a] min-h-0">
          {children}
        </main>
      </div>

      {showRightPanel && (
        <>
          <div
            onMouseDown={startDrag}
            className={`w-1 hover:w-1.5 cursor-col-resize transition-all shrink-0 ${
              dragging ? "bg-orange-500 w-1.5" : "bg-neutral-700/30 hover:bg-orange-500/50"
            }`}
          />
          <aside
            style={{ width: panelWidth }}
            className="shrink-0 border-l border-neutral-800/60 bg-[#0c0c0c] flex flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-800/40">
              <span className="text-[10px] font-semibold text-neutral-400 font-mono uppercase tracking-widest">助手</span>
              <button type="button" onClick={() => setShowRightPanel(false)} className="text-neutral-500 hover:text-neutral-300 text-sm leading-none">
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
              <AgentPanel
                novelTitle={novelTitle}
                characters={characters}
                novelText={sessionNovelText || novelText}
                continueFromOffset={sessionContinueOffset}
                continueFromLabel={sessionContinueLabel}
                branchId={activeBranchId}
                novelId={novelId || id}
              />
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
