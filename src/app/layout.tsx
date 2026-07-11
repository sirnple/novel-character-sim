import type { Metadata } from "next";
import "./globals.css";
import { NovelProvider } from "@/lib/novel-context";

export const metadata: Metadata = {
  title: "小说创作工作台",
  description: "导入小说，提取角色和世界观，构建创作法典，开始续写",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-[#0a0a0a] text-neutral-200 font-sans overflow-hidden">
        <NovelProvider>{children}</NovelProvider>
      </body>
    </html>
  );
}
