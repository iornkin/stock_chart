"use client";
/**
 * 사용자별 화면 설정 (브라우저 localStorage).
 * 로그인 없는 개인용 사이트이므로 관심 종목·테마·차트 설정은 이 브라우저에만 저장된다.
 * 저장소 접근이 막힌 환경(사생활 보호 모드 등)에서도 기본값으로 정상 동작한다.
 */
import { useCallback, useSyncExternalStore } from "react";

export interface ChartPrefs {
  type: "candle" | "line" | "area";
  smaPeriods: number[];
  emaPeriods: number[];
  showBB: boolean;
  bbPeriod: number;
  bbMult: number;
  showVWAP: boolean;
  showRSI: boolean;
  rsiPeriod: number;
  showMACD: boolean;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  volMaPeriod: number;
  showDividends: boolean;
}

export interface Prefs {
  theme: "system" | "light" | "dark";
  colors: "kr" | "us";
  watchlist: string[];
  autoRefreshSec: number;
  defaultRange: string;
  chart: ChartPrefs;
}

export const DEFAULT_PREFS: Prefs = {
  theme: "system",
  colors: "kr",
  watchlist: ["QQQ", "JEPI", "NVDA"],
  autoRefreshSec: 300,
  defaultRange: "1Y",
  chart: {
    type: "candle",
    smaPeriods: [20, 50, 200],
    emaPeriods: [],
    showBB: false,
    bbPeriod: 20,
    bbMult: 2,
    showVWAP: false,
    showRSI: true,
    rsiPeriod: 14,
    showMACD: true,
    macdFast: 12,
    macdSlow: 26,
    macdSignal: 9,
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
    cache = { ...DEFAULT_PREFS, ...parsed, chart: { ...DEFAULT_PREFS.chart, ...(parsed.chart ?? {}) } };
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
