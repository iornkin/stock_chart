"use client";
/** 주 메뉴 (사이드바·모바일 전체 메뉴) */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SECTIONS, sectionOf } from "@/lib/nav";

export function NavIcon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export default function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const current = sectionOf(pathname)?.key;
  return (
    <nav aria-label="주 메뉴" className="flex flex-col gap-0.5">
      {SECTIONS.map((n, i) => {
        const active = n.key === current;
        const header = i === 0 || SECTIONS[i - 1].group !== n.group;
        return (
          <div key={n.key} className="contents">
            {header && <p className={`px-3 pb-1 text-[11px] font-semibold tracking-wide text-muted ${i === 0 ? "" : "pt-4"}`}>{n.group}</p>}
            <Link
              href={n.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[14px] whitespace-nowrap transition-colors ${
                active ? "bg-accent-soft font-semibold text-accent" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
              }`}
            >
              <NavIcon d={n.icon} />
              {n.label}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}
