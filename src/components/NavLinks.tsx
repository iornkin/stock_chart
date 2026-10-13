"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const NAV = [
  { href: "/", label: "대시보드", icon: "M3 12l9-8 9 8M5 10v10h14V10" },
  { href: "/briefing", label: "일일 브리핑", icon: "M4 5h16M4 10h16M4 15h10M4 20h7" },
  { href: "/compare", label: "종목 비교", icon: "M4 19V9M10 19V5M16 19v-7M22 19H2" },
  { href: "/calendar", label: "배당·분배금 캘린더", icon: "M4 6h16v14H4zM4 10h16M9 3v4M15 3v4" },
  { href: "/watchlist", label: "관심 종목", icon: "M12 3l2.8 5.9 6.2.8-4.6 4.3 1.2 6.2L12 17.3 6.4 20.2l1.2-6.2L3 9.7l6.2-.8z" },
  { href: "/stocks", label: "전체 지원 종목", icon: "M4 6h16M4 12h16M4 18h16" },
  { href: "/status", label: "데이터 상태", icon: "M3 12h4l3-8 4 16 3-8h4" },
  { href: "/settings", label: "설정", icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" },
];

export function NavIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export default function NavLinks({ onNavigate, compact = false }: { onNavigate?: () => void; compact?: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="주 메뉴" className={compact ? "flex gap-1 overflow-x-auto" : "flex flex-col gap-0.5"}>
      {NAV.map((n) => {
        const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors ${
              active ? "bg-accent-soft text-accent font-semibold" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
            }`}
          >
            <NavIcon d={n.icon} />
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
