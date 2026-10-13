import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import NavLinks from "@/components/NavLinks";
import SymbolSearch from "@/components/SymbolSearch";
import MarketClock from "@/components/MarketClock";
import MobileNav from "@/components/MobileNav";
import PrefsApplier from "@/components/PrefsApplier";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-script";
import SnapshotBanner from "@/components/SnapshotBanner";
import HashOpener from "@/components/HashOpener";
import SectionTabs from "@/components/SectionTabs";
import PwaRegister from "@/components/PwaRegister";
import { BASE_PATH, IS_STATIC } from "@/lib/static-mode";

export const metadata: Metadata = {
  title: { default: "US Stock Insight — 미국 주식·ETF 분석", template: "%s · US Stock Insight" },
  description: "미국 주식·ETF 차트, 거래량, 배당·분배금, 종목별 일일 투자 브리핑",
  // public/ 파일 주소는 basePath 를 직접 붙인다 (GitHub Pages: /저장소이름/...)
  manifest: `${BASE_PATH}/manifest.webmanifest`,
  icons: {
    icon: [
      { url: `${BASE_PATH}/icons/icon.svg`, type: "image/svg+xml" },
      { url: `${BASE_PATH}/icons/favicon-32.png`, sizes: "32x32", type: "image/png" },
    ],
    apple: { url: `${BASE_PATH}/icons/apple-touch-icon.png`, sizes: "180x180" },
  },
  appleWebApp: { capable: true, title: "US Stock", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f4f1" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0d" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning data-colors="kr">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-screen">
        <PrefsApplier />
        <HashOpener />
        <PwaRegister />
        <div className="flex min-h-screen">
          <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line bg-surface px-3 py-4 lg:flex">
            <Link href="/" className="px-3 text-base font-bold tracking-tight">
              US Stock Insight
              <span className="block text-xs font-normal text-muted">미국 주식·ETF 분석</span>
            </Link>
            <div className="px-1">
              <SymbolSearch />
            </div>
            <NavLinks />
            <p className="mt-auto px-3 text-[11px] leading-relaxed text-muted">투자 권유가 아닌 정보 자료입니다. 시각은 미국 동부 시간(ET), 금액은 USD 기준.</p>
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur lg:px-6">
              <Link href="/" className="font-bold tracking-tight lg:hidden">
                US Stock Insight
              </Link>
              <div className="ml-auto flex min-w-0 items-center gap-2">
                {IS_STATIC && <SnapshotBanner builtAt={Date.now()} />}
                <MarketClock />
              </div>
            </header>
            <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-24 pt-5 lg:px-8 lg:pb-10">
              <SectionTabs />
              {children}
            </main>
          </div>
        </div>
        <MobileNav />
      </body>
    </html>
  );
}
