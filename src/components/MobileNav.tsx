"use client";
/** 모바일 하단 탭 (홈·브리핑·종목·내 자산·전체 메뉴) */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import NavLinks, { NavIcon } from "./NavLinks";
import SymbolSearch from "./SymbolSearch";
import { InstallApp } from "./PwaRegister";
import { BOTTOM_TABS, SECTIONS, sectionOf } from "@/lib/nav";

export default function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const current = sectionOf(pathname)?.key;
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);
  const tabs = BOTTOM_TABS.map((k) => SECTIONS.find((s) => s.key === k)!);
  const inMenu = current !== undefined && !BOTTOM_TABS.includes(current);
  return (
    <div className="lg:hidden">
      {open && (
        <div className="fixed inset-0 z-40 flex flex-col bg-surface" role="dialog" aria-modal="true" aria-label="전체 메뉴">
          <div className="flex h-14 items-center justify-between border-b border-line px-4">
            <span className="font-bold">전체 메뉴</span>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-line px-3 py-1.5 text-sm" aria-label="메뉴 닫기">
              닫기
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 pb-24">
            <div className="mb-4">
              <SymbolSearch onDone={() => setOpen(false)} />
            </div>
            <NavLinks onNavigate={() => setOpen(false)} />
            <div className="mt-5">
              <InstallApp compact />
            </div>
          </div>
        </div>
      )}
      <nav aria-label="하단 메뉴" className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        {tabs.map((t) => {
          const on = current === t.key && !open;
          return (
            <Link key={t.key} href={t.href} aria-current={on ? "page" : undefined} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${on ? "font-semibold text-accent" : "text-ink-2"}`}>
              <NavIcon d={t.icon} size={20} />
              {t.short}
            </Link>
          );
        })}
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="메뉴 열기" className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${open || inMenu ? "font-semibold text-accent" : "text-ink-2"}`}>
          <NavIcon d="M4 7h16M4 12h16M4 17h16" size={20} />
          메뉴
        </button>
      </nav>
    </div>
  );
}
