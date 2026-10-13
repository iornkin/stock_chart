"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const NAV = [
  { group: "오늘", href: "/", label: "대시보드", icon: "M3 12l9-8 9 8M5 10v10h14V10" },
  { group: "오늘", href: "/briefing", label: "일일 브리핑", icon: "M4 5h16M4 10h16M4 15h10M4 20h7" },
  { group: "종목", href: "/stocks", label: "미국 주식·ETF", icon: "M4 6h16M4 12h16M4 18h16" },
  { group: "종목", href: "/compare", label: "종목 비교", icon: "M4 19V9M10 19V5M16 19v-7M22 19H2" },
  { group: "종목", href: "/leverage", label: "레버리지 ETF 분석", icon: "M3 17l6-6 4 4 8-8M15 7h6v6" },
  { group: "종목", href: "/map", label: "ETF 관계 지도", icon: "M6 6a2 2 0 100-.01M18 6a2 2 0 100-.01M12 18a2 2 0 100-.01M7.5 7.5l3.5 9M16.5 7.5l-3.5 9M8 6h8" },
  { group: "배당·분배금", href: "/income", label: "배당·분배금", icon: "M12 2v20M17 6H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" },
  { group: "배당·분배금", href: "/calendar", label: "배당·분배금 캘린더", icon: "M4 6h16v14H4zM4 10h16M9 3v4M15 3v4" },
  { group: "내 투자", href: "/portfolio", label: "내 자산", icon: "M3 7h18v13H3zM3 7l3-4h12l3 4M16 13.5h2" },
  { group: "내 투자", href: "/paper", label: "가상 투자", icon: "M9 3h6M10 3v6L4.5 18.5A1.6 1.6 0 006 21h12a1.6 1.6 0 001.5-2.5L14 9V3M7 15h10" },
  { group: "전략·시뮬레이션", href: "/backtest", label: "백테스팅", icon: "M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8M3 3v5h5M12 7v5l3 2" },
  { group: "전략·시뮬레이션", href: "/simulate", label: "미래 시뮬레이터", icon: "M3 17l5-5 4 3 8-8M15 7h5v5" },
  { group: "전략·시뮬레이션", href: "/stress", label: "스트레스 테스트", icon: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM12 8v5M12 16v.5" },
  { group: "전략·시뮬레이션", href: "/strategies", label: "전략 비교", icon: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5" },
  { group: "관심 종목·설정", href: "/watchlist", label: "관심 종목", icon: "M12 3l2.8 5.9 6.2.8-4.6 4.3 1.2 6.2L12 17.3 6.4 20.2l1.2-6.2L3 9.7l6.2-.8z" },
  { group: "관심 종목·설정", href: "/settings", label: "설정·데이터 관리", icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" },
  { group: "관심 종목·설정", href: "/status", label: "데이터 상태", icon: "M3 12h4l3-8 4 16 3-8h4" },
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
      {NAV.map((n, i) => {
        const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
        const header = !compact && (i === 0 || NAV[i - 1].group !== n.group);
        return (
          <div key={n.href} className="contents">
          {header && <p className={`px-3 pb-1 text-[11px] font-semibold text-muted ${i === 0 ? "" : "pt-3"}`}>{n.group}</p>}
          <Link
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
          </div>
        );
      })}
    </nav>
  );
}
