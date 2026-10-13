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
import { IS_STATIC } from "@/lib/static-mode";

export const metadata: Metadata = {
  title: { default: "US Stock Insight — 미국 주식·ETF 분석", template: "%s · US Stock Insight" },
  description: "미국 주식·ETF 차트, 거래량, 배당·분배금, 종목별 일일 투자 브리핑",
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
        <div className="flex min-h-screen">
          <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-4 border-r border-line bg-surface px-3 py-4 lg:flex">
            <Link href="/" className="px-3 text-base font-bold tracking-tight">
              US Stock Insight
              <span className="block text-xs font-normal text-muted">미국 주식·ETF 분석</span>
            </Link>
            <div className="px-1">
              <SymbolSearch />
            </div>
            <NavLinks />
            <p className="mt-auto px-3 text-[11px] leading-relaxed text-muted">
              투자 정보 이해를 돕기 위한 자료이며 매수·매도 권유가 아닙니다. 모든 시각은 미국 동부 시간(ET), 금액은 USD 기준입니다.
            </p>
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur">
              <MobileNav />
              <Link href="/" className="font-bold lg:hidden">
                US Stock Insight
              </Link>
              <div className="ml-auto flex items-center gap-3">
                <MarketClock />
              </div>
            </header>
            {IS_STATIC && <SnapshotBanner builtAt={Date.now()} />}
            <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-5 lg:px-6">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
