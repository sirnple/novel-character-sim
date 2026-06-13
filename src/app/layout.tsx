import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "小说角色模拟器",
  description: "提取小说角色，构建角色代理，在自定义场景中进行剧情演绎",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-background antialiased">
        {children}
      </body>
    </html>
  );
}
