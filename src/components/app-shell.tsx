"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BookMarked, Settings, X, PanelLeft } from "lucide-react";
import GlobalLibrarySidebar from "@/components/global-library-sidebar";
import NovelUpload from "@/components/novel-upload";
import { useNovel } from "@/lib/novel-context";
import { novelFingerprint } from "@/lib/utils";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { setNovel, clearNovel, novelTitle, novelText } = useNovel();
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
    <div className="app-shell-height flex flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 border-b border-neutral-800/60 bg-[#0c0c0c] shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {/* Mobile: open libraries drawer */}
          <button
            type="button"
            onClick={() => setLibraryMobileOpen(true)}
            className="lg:hidden p-2 -ml-1 rounded text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60 shrink-0"
            title="打开库"
            aria-label="打开作品/风格/点子库"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
          <Link href="/" className="flex items-center gap-2 shrink-0 min-w-0">
            <BookMarked className="w-4 h-4 text-orange-500 shrink-0" />
            <h1 className="text-sm font-bold tracking-wider text-neutral-300 font-mono truncate">
              NOVEL WORKSPACE
            </h1>
          </Link>
          {novelTitle && pathname?.startsWith("/novel/") && (
            <>
              <span className="w-px h-4 bg-neutral-800 shrink-0 hidden sm:block" />
              <span className="text-sm text-neutral-400 truncate hidden sm:inline">{novelTitle}</span>
              {novelText && (
                <span className="text-xs text-neutral-600 shrink-0 hidden md:inline">
                  {novelText.length.toLocaleString()} 字
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <a
            href="/admin"
            className="flex items-center gap-1 text-xs text-neutral-600 hover:text-neutral-400 font-mono px-2 py-1.5"
          >
            <Settings className="w-3 h-3" />
            <span className="hidden sm:inline">ADMIN</span>
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
        <div className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col">
          {children}
        </div>
      </div>

      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4">
          <div className="w-full max-w-lg bg-[#0e0e0e] border border-neutral-800 rounded-t-xl sm:rounded-lg p-5 sm:p-6 shadow-2xl max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-neutral-300 font-mono">导入小说</h2>
              <button type="button" onClick={() => setShowUpload(false)} className="p-1 text-neutral-500 hover:text-neutral-300">
                <X className="w-4 h-4" />
              </button>
            </div>
            <NovelUpload
              onParsed={(title, fullText) => {
                const id = novelFingerprint(fullText);
                clearNovel();
                setNovel({
                  novelId: id,
                  novelTitle: title,
                  novelText: fullText,
                  characters: [],
                  storyInfo: null,
                  timeline: null,
                  lastChapterStates: [],
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
