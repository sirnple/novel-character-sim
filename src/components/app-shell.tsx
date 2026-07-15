"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BookMarked, Settings, X } from "lucide-react";
import GlobalLibrarySidebar from "@/components/global-library-sidebar";
import NovelUpload from "@/components/novel-upload";
import { useNovel } from "@/lib/novel-context";
import { novelFingerprint } from "@/lib/utils";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { setNovel, clearNovel, novelTitle, novelText } = useNovel();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  const onImportClick = useCallback(() => setShowUpload(true), []);

  // Admin keeps its own chrome (after all hooks)
  if (pathname?.startsWith("/admin")) {
    return <>{children}</>;
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-800/60 bg-[#0c0c0c] shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <BookMarked className="w-4 h-4 text-orange-500" />
            <h1 className="text-sm font-bold tracking-wider text-neutral-300 font-mono">NOVEL WORKSPACE</h1>
          </Link>
          {novelTitle && pathname?.startsWith("/novel/") && (
            <>
              <span className="w-px h-4 bg-neutral-800 shrink-0" />
              <span className="text-sm text-neutral-400 truncate">{novelTitle}</span>
              {novelText && (
                <span className="text-xs text-neutral-600 shrink-0">{novelText.length.toLocaleString()} 字</span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a
            href="/admin"
            className="flex items-center gap-1 text-xs text-neutral-600 hover:text-neutral-400 font-mono px-2 py-1"
          >
            <Settings className="w-3 h-3" /> ADMIN
          </a>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden min-h-0">
        <GlobalLibrarySidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(c => !c)}
          onImportClick={onImportClick}
        />
        <div className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col">
          {children}
        </div>
      </div>

      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-[#0e0e0e] border border-neutral-800 rounded-lg p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-neutral-300 font-mono">导入小说</h2>
              <button type="button" onClick={() => setShowUpload(false)} className="text-neutral-500 hover:text-neutral-300">
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
