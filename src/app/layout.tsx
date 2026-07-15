import type { Metadata, Viewport } from "next";
import "./globals.css";
import { NovelProvider } from "@/lib/novel-context";
import AppShell from "@/components/app-shell";

export const metadata: Metadata = {
  title: "小说创作工作台",
  description: "导入小说，提取角色和世界观，构建创作法典，开始续写",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full overflow-hidden">
      <body className="h-full min-h-0 bg-[#0a0a0a] text-neutral-200 font-sans overflow-hidden antialiased">
        <NovelProvider>
          <AppShell>{children}</AppShell>
        </NovelProvider>
      </body>
    </html>
  );
}
