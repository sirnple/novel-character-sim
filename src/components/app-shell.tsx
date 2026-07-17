"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BookMarked, Settings, X, PanelLeft } from "lucide-react";
import GlobalLibrarySidebar from "@/components/global-library-sidebar";
import NovelUpload from "@/components/novel-upload";
import AuthBar from "@/components/auth-bar";
import { useNovel } from "@/lib/novel-context";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { setNovel, clearNovel, novelTitle, novelText, novelLength } = useNovel();
  /** Desktop rail collapse only */
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  /** Mobile library drawer */
  const [libraryMobileOpen, setLibraryMobileOpen] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  const onImportClick = useCallback(() => {
    setLibraryMobileOpen(false);
    setShowUpload(true);
  }, []);

  // Admin keeps its own chrome (after all hooks)
  if (pathname?.startsWith("/admin")) {
    return <>{children}</>;
  }

  return (
    <div className="app-shell-height flex flex-col overflow-hidden bg-background">
      <header className="flex items-center justify-between gap-2 px-3 sm:px-4 py-3 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {/* Mobile: open libraries drawer */}
          <button
            type="button"
            onClick={() => setLibraryMobileOpen(true)}
            className="lg:hidden p-2 -ml-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-panel-elevated shrink-0"
            title="打开库"
            aria-label="打开作品/风格/点子库"
          >
            <PanelLeft className="w-5 h-5" />
          </button>
          <Link href="/" className="flex items-center gap-2 shrink-0 min-w-0">
            <BookMarked className="w-5 h-5 text-primary shrink-0" />
            <h1 className="text-base font-semibold text-foreground truncate">
              小说工作台
            </h1>
          </Link>
          {novelTitle && pathname?.startsWith("/novel/") && (
            <>
              <span className="w-px h-4 bg-border shrink-0 hidden sm:block" />
              <span className="text-sm text-muted-foreground truncate hidden sm:inline">{novelTitle}</span>
              {(novelLength > 0 || novelText) && (
                <span className="text-xs text-fog shrink-0 hidden md:inline">
                  {(novelLength || novelText.length).toLocaleString()} 字
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <AuthBar />
          <a
            href="/admin"
            className="flex items-center gap-1.5 text-sm text-fog hover:text-muted-foreground px-2.5 py-2 rounded-lg hover:bg-panel-elevated"
          >
            <Settings className="w-4 h-4" />
            <span className="hidden sm:inline">管理</span>
          </a>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden min-h-0">
        <GlobalLibrarySidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(c => !c)}
          onImportClick={onImportClick}
          mobileOpen={libraryMobileOpen}
          onMobileClose={() => setLibraryMobileOpen(false)}
        />
        <div className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col bg-background">
          {children}
        </div>
      </div>

      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
          <div className="w-full max-w-lg bg-card border border-border rounded-t-xl sm:rounded-xl p-5 sm:p-6 shadow-2xl max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-foreground">导入小说</h2>
              <button type="button" onClick={() => setShowUpload(false)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-panel-elevated">
                <X className="w-5 h-5" />
              </button>
            </div>
            <NovelUpload
              onParsed={(title, totalLength, _preview, novelId) => {
                // Prefer server novelId (authoritative after import)
                const id = novelId || "";
                if (!id) return;
                clearNovel();
                setNovel({
                  novelId: id,
                  novelTitle: title,
                  novelText: "",
                  novelLength: totalLength || 0,
                  characters: [],
                  storyInfo: null,
                  timeline: null,
                  lastChapterStates: [],
                  activeBranchId: "",
                });
                setShowUpload(false);
                router.push(`/novel/${id}`);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
