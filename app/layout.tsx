import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI Soccer Scout — TiDB ハイブリッド検索",
  description: "2026 W杯選手をSQL × ベクトル × 全文検索のハイブリッドで探すスカウトAI",
};

// localStorage から復元するインラインスクリプト (FOUC 回避のため <head> 直下で同期実行)
// 既定はライトモード。OS の prefers-color-scheme には追従しない（明示トグル制）。
const themeBootstrap = `
(function(){
  try {
    var t = localStorage.getItem('theme');
    var el = document.documentElement;
    if (t === 'dark') el.classList.add('dark');
    else el.classList.remove('dark');
  } catch (_) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">{children}</body>
    </html>
  );
}
