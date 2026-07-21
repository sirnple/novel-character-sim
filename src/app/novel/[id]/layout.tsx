"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useNovel } from "@/lib/novel-context";
import { Play, PanelRight, X, Sparkles } from "lucide-react";
import dynamic from "next/dynamic";
const AgentPanel = dynamic(() => import("@/components/agent-panel"), { ssr: false });

const LG_MQ = "(min-width: 1024px)";

export default function NovelLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const {
    novelTitle, setNovel, setBranches,
    sessionContinueOffset, sessionContinueLabel,
    activeBranchId, novelId,
  } = useNovel();
  const [showRightPanel, setShowRightPanel] = useState(false);
  const [panelWidth, setPanelWidth] = useState(480);
  const [dragging, setDragging] = useState(false);
  /** Desktop rail vs mobile sheet — single AgentPanel mount either way */
  const [isLg, setIsLg] = useState(false);

  const onWritePage = pathname?.endsWith("/write") ?? false;
  const base = `/novel/${id}`;
  const onOverviewPage =
    !!pathname && (pathname === base || pathname === `${base}/`);
  // Write: agent after branch selected. Overview: analysis agent always available.
  const agentMode: "write" | "analysis" | null = onWritePage
    ? activeBranchId
      ? "write"
      : null
    : onOverviewPage
      ? "analysis"
      : null;
  const agentAvailable = agentMode !== null;
  const agentBranchId =
    agentMode === "write" ? activeBranchId || "main" : "main";
  const reloadNovelMeta = useCallback(() => {
    if (!id) return;
    fetch(`/api/novels?id=${encodeURIComponent(id)}&meta=1`)
      .then((r) => r.json())
      .then((data) => {
        // Always apply meta when novel exists (title may be empty; still refresh chars/story)
        if (data.error) return;
        setNovel({
          novelId: id,
          novelTitle: data.title || id,
          novelText: "",
          novelLength: data.totalLength || 0,
          characters: data.characters || [],
          storyInfo: data.storyInfo || null,
          timeline: data.timeline || null,
          lastChapterStates: data.lastChapterStates || [],
        });
        if (data.branches) setBranches(data.branches);
      })
      .catch(() => {});
  }, [id, setNovel, setBranches]);

  useEffect(() => {
    const mq = window.matchMedia(LG_MQ);
    const apply = () => setIsLg(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

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

  // Always reload meta when novel id changes (don't keep previous book's data)
  useEffect(() => {
    reloadNovelMeta();
  }, [reloadNovelMeta]);

  // Desktop: auto-open agent when available. Mobile: do not auto-open.
  useEffect(() => {
    if (!agentAvailable) {
      setShowRightPanel(false);
      return;
    }
    if (isLg) setShowRightPanel(true);
  }, [agentAvailable, isLg, agentMode]);

  const nav = [
    { href: base, label: "概览", match: pathname === base },
    { href: `${base}/write`, label: "写作", match: pathname.endsWith("/write") },
  ];

  return (
    <div className="flex flex-1 overflow-hidden min-h-0 flex-col">
      {/* Sub-nav always above content + agent sheet */}
      <div className="flex items-center gap-1 px-2 sm:px-3 py-1.5 border-b border-border/60 bg-card shrink-0 overflow-x-auto z-30">
        {nav.map(n => (
          <Link
            key={n.href}
            href={n.href}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors shrink-0 ${
              n.match ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {n.label === "写作" && <Play className="w-3 h-3 inline mr-1 -mt-0.5" />}
            {n.label}
          </Link>
        ))}
        {agentAvailable ? (
          <button
            type="button"
            onClick={() => setShowRightPanel(v => !v)}
            className={`ml-auto p-2 rounded transition-colors shrink-0 ${
              showRightPanel ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground/90"
            }`}
            title={agentMode === "analysis" ? "分析助手" : "助手面板"}
            aria-label="切换助手面板"
          >
            <PanelRight className="w-4 h-4" />
          </button>
        ) : (
          <span className="ml-auto text-xs text-fog shrink-0 px-1">
            {onWritePage ? "请先选择分支" : ""}
          </span>
        )}
      </div>

      {/* Content row: main + optional single agent chrome */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        <main className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col bg-background">
          {children}
        </main>

        {agentAvailable && showRightPanel && (
          <>
            {isLg && (
              <div
                onMouseDown={startDrag}
                className={`w-1 hover:w-1.5 cursor-col-resize transition-all shrink-0 ${
                  dragging ? "bg-primary w-1.5" : "bg-neutral-700/30 hover:bg-primary/50"
                }`}
              />
            )}
            <aside
              style={isLg ? { width: panelWidth } : undefined}
              className={
                isLg
                  ? "shrink-0 border-l border-border/80 bg-card flex flex-col overflow-hidden"
                  : "absolute inset-0 z-20 bg-card flex flex-col overflow-hidden safe-drawer-pad"
              }
            >
              <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 border-b border-border/60 shrink-0">
                <span className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                  {agentMode === "analysis" ? (
                    <>
                      <Sparkles className="w-3.5 h-3.5 text-primary" />
                      分析助手
                    </>
                  ) : (
                    "助手"
                  )}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowRightPanel(false)}
                    className="p-2 rounded text-muted-foreground hover:text-foreground/90"
                    aria-label="关闭助手"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
                <AgentPanel
                  key={`${agentMode}-${id}`}
                  novelTitle={novelTitle}
                  characters={[]}
                  novelText=""
                  continueFromOffset={sessionContinueOffset}
                  continueFromLabel={sessionContinueLabel}
                  branchId={agentBranchId}
                  novelId={novelId || id}
                  mode={agentMode === "analysis" ? "analysis" : "write"}
                  onAnalysisDone={() => {
                    reloadNovelMeta();
                    // Overview cards + sidebar libraries listen for this
                    window.dispatchEvent(new Event("libraries:refresh"));
                    window.setTimeout(() => {
                      reloadNovelMeta();
                      window.dispatchEvent(new Event("libraries:refresh"));
                    }, 2_000);
                    window.setTimeout(() => reloadNovelMeta(), 8_000);
                  }}
                />
              </div>
            </aside>
          </>
        )}
      </div>

    </div>
  );
}
