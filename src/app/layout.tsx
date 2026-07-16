import type { Metadata, Viewport } from "next";
import { Noto_Sans_SC, Noto_Serif_SC } from "next/font/google";
import "./globals.css";
import { NovelProvider } from "@/lib/novel-context";
import AppShell from "@/components/app-shell";

const notoSans = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const notoSerif = Noto_Serif_SC({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-prose",
  display: "swap",
});

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
    <html lang="zh-CN" className={`h-full overflow-hidden ${notoSans.variable} ${notoSerif.variable}`}>
      <body className="h-full min-h-0 bg-background text-foreground font-sans overflow-hidden antialiased">
        <NovelProvider>
          <AppShell>{children}</AppShell>
        </NovelProvider>
      </body>
    </html>
  );
}
