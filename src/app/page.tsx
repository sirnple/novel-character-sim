"use client";
import { BookMarked } from "lucide-react";
import { useNovel } from "@/lib/novel-context";

export default function HomePage() {
  const { novelId, novelTitle } = useNovel();

  return (
    <div className="flex-1 flex items-center justify-center p-4 sm:p-8 overflow-y-auto custom-scrollbar">
      <div className="text-center max-w-md px-1">
        <BookMarked className="w-12 h-12 mx-auto mb-4 text-neutral-700" />
        <h2 className="text-lg font-semibold text-neutral-400 mb-2 font-mono">小说写作工作台</h2>
        <p className="text-sm text-neutral-600 mb-4 leading-relaxed">
          <span className="hidden lg:inline">左侧可随时浏览</span>
          <span className="lg:hidden">点左上角打开</span>
          <strong className="text-neutral-500 font-normal">作品库</strong>、
          <strong className="text-neutral-500 font-normal">风格库</strong>与
          <strong className="text-neutral-500 font-normal">点子库</strong>。
          导入小说后在概览页勾选模块拆解，再进入写作。
        </p>
        {novelId ? (
          <p className="text-xs text-neutral-500 font-mono break-all">
            当前：{novelTitle || novelId}
            <a href={`/novel/${novelId}`} className="ml-2 text-orange-400 hover:text-orange-300 whitespace-nowrap">打开概览 →</a>
          </p>
        ) : (
          <p className="text-xs text-neutral-600 font-mono">
            <span className="hidden lg:inline">从左侧「+ 导入小说」或选择已有作品开始</span>
            <span className="lg:hidden">点左上角「库」导入或选择作品</span>
          </p>
        )}
      </div>
    </div>
  );
}
