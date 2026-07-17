"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useNovel } from "@/lib/novel-context";
import { Play, PanelRight, X } from "lucide-react";
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
  // Agent only after user picked a writing target (branch / main / free)
  const agentAvailable = onWritePage && !!activeBranchId;

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
    // meta=1: skip multi-MB body on shell load; pages fetch branch text on demand
    fetch(`/api/novels?id=${encodeURIComponent(id)}&meta=1`)
      .then((r) => r.json())
      .then((data) => {
        if (data.title) {
          setNovel({
            novelId: id,
            novelTitle: data.title,
            novelText: "",
            novelLength: data.totalLength || 0,
            characters: data.characters || [],
            storyInfo: data.storyInfo || null,
            timeline: data.timeline || null,
            lastChapterStates: data.lastChapterStates || [],
          });
        }
        if (data.branches) setBranches(data.branches);
      })
      .catch(() => {});
  }, [id, setNovel, setBranches]);

  // Desktop: auto-open agent when branch selected. Mobile: do not auto-open (keeps editor + sub-nav usable).
  useEffect(() => {
    if (!agentAvailable) {
      setShowRightPanel(false);
      return;
    }
    if (isLg) setShowRightPanel(true);
  }, [agentAvailable, isLg]);

  const base = `/novel/${id}`;
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
            title="助手面板"
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
            {/*
              Single AgentPanel mount:
              - lg: permanent side rail
              - <lg: absolute sheet covering only main (sub-nav stays outside)
            */}
            <aside
              style={isLg ? { width: panelWidth } : undefined}
              className={
                isLg
                  ? "shrink-0 border-l border-border/80 bg-card flex flex-col overflow-hidden"
                  : "absolute inset-0 z-20 bg-card flex flex-col overflow-hidden safe-drawer-pad"
              }
            >
              <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 border-b border-border/60 shrink-0">
                <span className="text-sm font-semibold text-muted-foreground">助手</span>
                <button
                  type="button"
                  onClick={() => setShowRightPanel(false)}
                  className="p-2 rounded text-muted-foreground hover:text-foreground/90"
                  aria-label="关闭助手"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
                <AgentPanel
                  novelTitle={novelTitle}
                  characters={[]}
                  novelText=""
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
    </div>
  );
}
