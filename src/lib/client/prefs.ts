"use client";
/**
 * 사용자별 화면 설정 (브라우저 localStorage).
 * 로그인 없는 개인용 사이트이므로 관심 종목·테마·차트 설정은 이 브라우저에만 저장된다.
 * 저장소 접근이 막힌 환경(사생활 보호 모드 등)에서도 기본값으로 정상 동작한다.
 */
import { useCallback, useSyncExternalStore } from "react";

/** 차트에 올린 지표 하나 (종류·파라미터·숨김) — 같은 종류를 여러 개 올릴 수 있다(예: SMA 20·50·200) */
export interface ChartIndicator {
  id: string;
  key: string;
  params: Record<string, number>;
  hidden?: boolean;
}

export interface ChartPrefs {
  type: "candle" | "line" | "area";
  indicators: ChartIndicator[];
  /** 이름 붙여 저장한 지표 구성 (최대 5개) */
  saved: { name: string; indicators: ChartIndicator[] }[];
  volMaPeriod: number;
  showDividends: boolean;
}

export const DEFAULT_CHART_INDICATORS: ChartIndicator[] = [
  { id: "sma20", key: "sma", params: { n: 20 } },
  { id: "sma50", key: "sma", params: { n: 50 } },
  { id: "sma200", key: "sma", params: { n: 200 } },
  { id: "rsi", key: "rsi", params: { n: 14 } },
  { id: "macd", key: "macd", params: { fast: 12, slow: 26, sig: 9 } },
];

/** 예전 설정(SMA 기간 목록·볼린저/RSI/MACD 켜기)을 지표 목록으로 옮긴다 */
type LegacyChart = { smaPeriods?: number[]; emaPeriods?: number[]; showBB?: boolean; bbPeriod?: number; bbMult?: number; showVWAP?: boolean; showRSI?: boolean; rsiPeriod?: number; showMACD?: boolean; macdFast?: number; macdSlow?: number; macdSignal?: number };
export function migrateChart(c: Partial<ChartPrefs> & LegacyChart): ChartPrefs {
  const base: ChartPrefs = { type: c.type ?? "candle", indicators: [], saved: Array.isArray(c.saved) ? c.saved.slice(0, 5) : [], volMaPeriod: c.volMaPeriod ?? 20, showDividends: c.showDividends ?? true };
  if (Array.isArray(c.indicators)) return { ...base, indicators: c.indicators.filter((x) => x && typeof x.key === "string" && typeof x.id === "string") };
  if (!("smaPeriods" in c) && !("showRSI" in c)) return { ...base, indicators: DEFAULT_CHART_INDICATORS };
  const out: ChartIndicator[] = [];
  for (const n of c.smaPeriods ?? []) out.push({ id: `sma${n}`, key: "sma", params: { n } });
  for (const n of c.emaPeriods ?? []) out.push({ id: `ema${n}`, key: "ema", params: { n } });
  if (c.showBB) out.push({ id: "bb", key: "bb", params: { n: c.bbPeriod ?? 20, k: c.bbMult ?? 2 } });
  if (c.showVWAP) out.push({ id: "vwap", key: "vwap", params: { n: 20 } });
  if (c.showRSI) out.push({ id: "rsi", key: "rsi", params: { n: c.rsiPeriod ?? 14 } });
  if (c.showMACD) out.push({ id: "macd", key: "macd", params: { fast: c.macdFast ?? 12, slow: c.macdSlow ?? 26, sig: c.macdSignal ?? 9 } });
  return { ...base, indicators: out };
}

export interface Prefs {
  theme: "system" | "light" | "dark";
  colors: "kr" | "us";
  watchlist: string[];
  autoRefreshSec: number;
  defaultRange: string;
  /** 금액 옆에 원화 환산(현재 환율)을 함께 표시 */
  showKrw: boolean;
  chart: ChartPrefs;
}

export const DEFAULT_PREFS: Prefs = {
  theme: "system",
  colors: "kr",
  watchlist: ["QQQ", "JEPI", "NVDA"],
  autoRefreshSec: 300,
  defaultRange: "1Y",
  showKrw: false,
  chart: {
    type: "candle",
    indicators: DEFAULT_CHART_INDICATORS,
    saved: [],
    volMaPeriod: 20,
    showDividends: true,
  },
};

export const KEY = "usi-prefs-v1";
const listeners = new Set<() => void>();
let cache: Prefs | null = null;

function read(): Prefs {
  if (cache) return cache;
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
    const parsed = raw ? (JSON.parse(raw) as Partial<Prefs>) : {};
    cache = { ...DEFAULT_PREFS, ...parsed, chart: migrateChart({ ...(parsed.chart ?? {}) }) };
  } catch {
    cache = DEFAULT_PREFS;
  }
  return cache;
}

export function getPrefs(): Prefs {
  return read();
}

export function setPrefs(update: Partial<Prefs> | ((p: Prefs) => Partial<Prefs>)) {
  const cur = read();
  const patch = typeof update === "function" ? update(cur) : update;
  cache = { ...cur, ...patch, chart: { ...cur.chart, ...(patch.chart ?? {}) } };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // 저장 불가 환경: 현재 탭에서만 유지
  }
  applyDocumentPrefs(cache);
  listeners.forEach((l) => l());
}

export function applyDocumentPrefs(p: Prefs) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  if (p.theme === "system") el.removeAttribute("data-theme");
  else el.setAttribute("data-theme", p.theme);
  el.setAttribute("data-colors", p.colors);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function usePrefs(): [Prefs, typeof setPrefs] {
  const p = useSyncExternalStore(subscribe, read, () => DEFAULT_PREFS);
  return [p, setPrefs];
}

export function useWatchlist(): [string[], (symbol: string) => void, boolean] {
  const [p] = usePrefs();
  const toggle = useCallback((symbol: string) => {
    setPrefs((cur) => ({
      watchlist: cur.watchlist.includes(symbol) ? cur.watchlist.filter((s) => s !== symbol) : [...cur.watchlist, symbol],
    }));
  }, []);
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  return [p.watchlist, toggle, hydrated];
}
