"use client";
import { BookMarked } from "lucide-react";
import { useNovel } from "@/lib/novel-context";

export default function HomePage() {
  const { novelId, novelTitle } = useNovel();

  return (
    <div className="flex-1 flex items-center justify-center p-6 sm:p-10 overflow-y-auto custom-scrollbar">
      <div className="text-center max-w-md px-1">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-panel-elevated border border-border">
          <BookMarked className="w-7 h-7 text-primary" />
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">小说写作工作台</h2>
        <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
          <span className="hidden lg:inline">左侧可随时浏览</span>
          <span className="lg:hidden">点左上角打开</span>
          {" "}
          <strong className="text-foreground/80 font-medium">作品库</strong>、
          <strong className="text-foreground/80 font-medium">风格库</strong>
          {" "}与{" "}
          <strong className="text-foreground/80 font-medium">点子库</strong>。
          导入小说后在概览页勾选模块拆解，再进入写作。
        </p>
        {novelId ? (
          <p className="text-sm text-muted-foreground break-all">
            当前：{novelTitle || novelId}
            <a href={`/novel/${novelId}`} className="ml-2 text-primary hover:brightness-110 whitespace-nowrap font-medium">
              打开概览 →
            </a>
          </p>
        ) : (
          <p className="text-sm text-fog">
            <span className="hidden lg:inline">从左侧「+ 导入小说」或选择已有作品开始</span>
            <span className="lg:hidden">点左上角「库」导入或选择作品</span>
          </p>
        )}
      </div>
    </div>
  );
}
