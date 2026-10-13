"use client";
/** 메뉴 안의 하위 화면 탭 (예: 미국 주식·ETF → 전체 종목 · 종목 비교 · 레버리지 ETF · ETF 관계 지도) */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { normalizePath, sectionOf } from "@/lib/nav";

export default function SectionTabs() {
  const pathname = normalizePath(usePathname());
  const s = sectionOf(pathname);
  if (!s || s.pages.length < 2) return null;
  const activeHref = s.pages.find((p) => p.href === pathname)?.href;
  if (!activeHref) return null; // 종목 상세 등 하위 화면 목록에 없는 화면
  return (
    <nav aria-label={`${s.label} 하위 메뉴`} className="-mx-1 mb-4 flex gap-1 overflow-x-auto border-b border-line px-1">
      {s.pages.map((p) => {
        const on = p.href === activeHref;
        return (
          <Link
            key={p.href}
            href={p.href}
            aria-current={on ? "page" : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm ${on ? "border-accent font-semibold text-accent" : "border-transparent text-ink-2 hover:text-ink"}`}
          >
            {p.label}
          </Link>
        );
      })}
    </nav>
  );
}
