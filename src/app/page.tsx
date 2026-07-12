"use client";
import { useState, useEffect } from "react";
import { BookMarked, X } from "lucide-react";
import { useRouter } from "next/navigation";
import NovelUpload from "@/components/novel-upload";
import { useNovel } from "@/lib/novel-context";
import { novelFingerprint } from "@/lib/utils";

interface SavedNovel {
  id: string; title: string; total_length: number; created_at: string;
}

export default function HomePage() {
  const { setNovel } = useNovel();
  const router = useRouter();
  const [showUpload, setShowUpload] = useState(false);
  const [savedNovels, setSavedNovels] = useState<SavedNovel[]>([]);

  useEffect(() => {
    fetch("/api/novels").then(r => r.json()).then(d => setSavedNovels(d.novels || [])).catch(() => {});
  }, []);

  const openNovel = async (id: string) => {
    const res = await fetch(`/api/novels?id=${id}`);
    const data = await res.json();
    if (res.ok) {
      setNovel({ novelId: id, novelTitle: data.title, novelText: data.text, characters: data.characters || [], storyInfo: data.storyInfo || null, timeline: data.timeline || null, lastChapterStates: data.lastChapterStates || [] });
      fetch(`/api/branches?novelId=${id}`).then(r => r.json()).then(d => {
        if (d.branches) setNovel({ branches: d.branches });
      }).catch(() => {});
      router.push(`/novel/${id}`);
    }
  };

  return (
    <div className="h-screen flex flex-col">
      <header className="flex items-center px-5 py-2.5 border-b border-neutral-800/60 bg-[#0c0c0c] shrink-0">
        <BookMarked className="w-4 h-4 text-orange-500 mr-2" />
        <h1 className="text-sm font-bold tracking-wider text-neutral-300 font-mono">NOVEL WORKSPACE</h1>
        <a href="/admin" className="ml-auto text-xs text-neutral-600 hover:text-neutral-400 font-mono">ADMIN</a>
      </header>
      <main className="flex-1 flex items-center justify-center">
        {showUpload ? (
          <div className="w-full max-w-lg bg-[#0e0e0e] border border-neutral-800 rounded-lg p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-neutral-300 font-mono">导入小说</h2>
              <button onClick={() => setShowUpload(false)} className="text-neutral-500 hover:text-neutral-300"><X className="w-4 h-4" /></button>
            </div>
            <NovelUpload onParsed={(title, fullText) => {
              const id = novelFingerprint(fullText);
              setNovel({ novelId: id, novelTitle: title, novelText: fullText, characters: [], storyInfo: null, timeline: null, lastChapterStates: [] });
              setShowUpload(false);
            }} />
          </div>
        ) : (
          <div className="text-center max-w-md">
            <BookMarked className="w-12 h-12 mx-auto mb-4 text-neutral-700" />
            <h2 className="text-lg font-semibold text-neutral-400 mb-2 font-mono">欢迎使用小说写作工作台</h2>
            <p className="text-sm text-neutral-600 mb-6">导入小说，提取角色和世界观，构建创作法典，开始续写。</p>
            <button onClick={() => setShowUpload(true)} className="px-5 py-2.5 bg-orange-600 hover:bg-orange-500 text-white text-sm font-mono rounded-lg transition-colors">
              导入小说
            </button>
            {savedNovels.length > 0 && (
              <div className="mt-8">
                <h3 className="text-xs text-neutral-500 font-mono uppercase tracking-wider mb-3">最近作品</h3>
                <div className="space-y-2">
                  {savedNovels.slice(0, 5).map(n => (
                    <button key={n.id} onClick={() => openNovel(n.id)}
                      className="w-full text-left px-4 py-2.5 rounded-lg bg-[#0c0c0c] border border-neutral-800 hover:border-neutral-700 text-neutral-400 hover:text-neutral-200 transition-colors text-sm">
                      <span className="font-medium">{n.title}</span>
                      <span className="text-neutral-600 ml-2 text-xs">{n.total_length.toLocaleString()} 字</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
