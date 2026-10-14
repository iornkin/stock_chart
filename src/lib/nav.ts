/**
 * 사이트 메뉴 구조 (주 메뉴 9개 + 메뉴 안의 하위 화면)
 * 하위 화면이 있는 메뉴는 화면 위쪽에 탭으로 보여 준다.
 */
export interface NavPage {
  href: string;
  label: string;
}

export interface NavSection {
  key: string;
  group: string;
  label: string;
  /** 모바일 하단 탭 등 좁은 곳에서 쓰는 짧은 이름 */
  short: string;
  href: string;
  icon: string;
  pages: NavPage[];
  /** 이 경로로 시작하는 화면도 이 메뉴로 본다 */
  prefixes?: string[];
}

export const SECTIONS: NavSection[] = [
  { key: "home", group: "오늘", label: "대시보드", short: "홈", href: "/", icon: "M3 12l9-8 9 8M5 10v10h14V10", pages: [] },
  { key: "briefing", group: "오늘", label: "일일 브리핑", short: "브리핑", href: "/briefing", icon: "M4 5h16M4 10h16M4 15h10M4 20h7", pages: [] },
  {
    key: "market",
    group: "시장",
    label: "미국 주식·ETF",
    short: "종목",
    href: "/stocks",
    icon: "M3 17l6-6 4 4 8-8M15 7h6v6",
    pages: [
      { href: "/stocks", label: "전체 종목" },
      { href: "/compare", label: "종목 비교" },
      { href: "/leverage", label: "레버리지 ETF" },
      { href: "/map", label: "ETF 관계 지도" },
    ],
    prefixes: ["/stock/"],
  },
  {
    key: "income",
    group: "시장",
    label: "배당·분배금",
    short: "배당",
    href: "/income",
    icon: "M12 2v20M17 6H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6",
    pages: [
      { href: "/income", label: "지급 요약" },
      { href: "/income/target", label: "목표 배당 계산기" },
      { href: "/calendar", label: "배당 캘린더" },
    ],
  },
  { key: "portfolio", group: "내 투자", label: "내 자산", short: "내 자산", href: "/portfolio", icon: "M3 7h18v13H3zM3 7l3-4h12l3 4M16 13.5h2", pages: [] },
  { key: "backtest", group: "전략 연구", label: "백테스팅", short: "백테스트", href: "/backtest", icon: "M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8M3 3v5h5M12 7v5l3 2", pages: [] },
  {
    key: "simulate",
    group: "전략 연구",
    label: "미래 시뮬레이터",
    short: "시뮬레이터",
    href: "/simulate",
    icon: "M3 17l5-5 4 3 8-8M15 7h5v5",
    pages: [
      { href: "/simulate", label: "미래 시나리오" },
      { href: "/stress", label: "스트레스 테스트" },
    ],
  },
  { key: "strategies", group: "전략 연구", label: "전략 비교", short: "전략", href: "/strategies", icon: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5", pages: [] },
  {
    key: "settings",
    group: "관리",
    label: "관심 종목·설정",
    short: "설정",
    href: "/watchlist",
    icon: "M12 3l2.8 5.9 6.2.8-4.6 4.3 1.2 6.2L12 17.3 6.4 20.2l1.2-6.2L3 9.7l6.2-.8z",
    pages: [
      { href: "/watchlist", label: "관심 종목" },
      { href: "/alerts", label: "알림" },
      { href: "/settings", label: "설정·백업" },
      { href: "/status", label: "데이터 상태" },
    ],
  },
];

export function normalizePath(p: string): string {
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

export function sectionOf(pathname: string): NavSection | undefined {
  const p = normalizePath(pathname);
  if (p === "/") return SECTIONS[0];
  // 하위 화면 경로가 정확히 일치하는 메뉴를 먼저 찾는다 (/income/target 등)
  for (const s of SECTIONS) if (s.pages.some((x) => x.href === p) || s.href === p) return s;
  for (const s of SECTIONS) if (s.href !== "/" && (p.startsWith(`${s.href}/`) || s.prefixes?.some((x) => p.startsWith(x)))) return s;
  return undefined;
}

/** 모바일 하단 탭 */
export const BOTTOM_TABS = ["home", "briefing", "market", "portfolio"];
