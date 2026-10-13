"use client";
/** 개인 데이터·시세·시계열을 화면에서 쓰는 훅 모음 */
import { useEffect, useMemo, useState } from "react";
import { fetchIncome, fetchQuotes, fetchSeries, type IncomeResponse } from "./data-api";
import { useLocal } from "./local-store";
import { EMPTY_PORTFOLIO, newId, type PortfolioData, type SavedRun, type Strategy, type VirtualAccount } from "@/lib/portfolio/types";
import type { PriceSeries } from "@/lib/sim/series";
import type { Quote } from "@/lib/types";

export function usePortfolio() {
  return useLocal<PortfolioData>("portfolio", EMPTY_PORTFOLIO);
}

export function useVirtual() {
  return useLocal<VirtualAccount | null>("virtual", null);
}

export function useStrategies() {
  return useLocal<Strategy[]>("strategies", []);
}

export function useRuns() {
  const r = useLocal<SavedRun[]>("runs", []);
  const add = (run: Omit<SavedRun, "id" | "at">) => r.set((prev) => [{ ...run, id: newId(), at: Date.now() }, ...prev].slice(0, 20));
  return { ...r, add };
}

export type QuoteLite = Quote & { delay?: { realtime: boolean; text: string }; freshness?: "fresh" | "stale"; refreshError?: string | null };

/** 시세가 이 시간보다 오래되면 '오래된 시세'로 표시한다 (주말·휴장 고려해 4일) */
export const QUOTE_OLD_MS = 4 * 86400_000;

export function useQuotes(symbols: string[]) {
  const key = [...new Set(symbols)].sort().join(",");
  const [state, setState] = useState<{ key: string | null; quotes: Record<string, QuoteLite>; missing: string[]; error: string | null; serverTime: number | null }>({
    key: null,
    quotes: {},
    missing: [],
    error: null,
    serverTime: null,
  });
  useEffect(() => {
    if (!key) {
      setState({ key, quotes: {}, missing: [], error: null, serverTime: null });
      return;
    }
    let alive = true;
    fetchQuotes<QuoteLite>(key.split(","))
      .then((r) => alive && setState({ key, quotes: Object.fromEntries(r.quotes.map((q) => [q.symbol, q])), missing: r.missing, error: null, serverTime: r.serverTime }))
      .catch((e) => alive && setState({ key, quotes: {}, missing: key.split(","), error: String((e as Error).message ?? e), serverTime: null }));
    return () => {
      alive = false;
    };
  }, [key]);
  // 요청한 종목 묶음의 응답이 올 때까지는 '불러오는 중' (이전 묶음의 결과로 계산하지 않음)
  const loading = state.key !== key;
  const prices = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const s of key.split(",").filter(Boolean)) {
      const q = state.quotes[s];
      out[s] = q && q.price !== null && q.price > 0 ? q.price : null;
    }
    return out;
  }, [state.quotes, key]);
  return { quotes: state.quotes, missing: state.missing, error: loading ? null : state.error, serverTime: state.serverTime, loading, prices };
}

/** 원/달러 환율 (최근 시세) */
export function useFx() {
  const q = useQuotes(["KRW=X"]);
  const fx = q.quotes["KRW=X"];
  return {
    rate: fx?.price ?? null,
    time: fx?.marketTime ?? fx?.fetchedAt ?? null,
    source: fx?.source ?? null,
    loading: q.loading,
    error: q.error ?? (!q.loading && !fx ? "원/달러 환율 시세가 아직 수집되지 않았습니다" : null),
  };
}

export function useSeriesMap(symbols: string[]) {
  const key = [...new Set(symbols.filter(Boolean))].sort().join(",");
  const [state, setState] = useState<{ key: string | null; series: Record<string, PriceSeries>; errors: Record<string, string> }>({ key: null, series: {}, errors: {} });
  useEffect(() => {
    if (!key) {
      setState({ key, series: {}, errors: {} });
      return;
    }
    let alive = true;
    const list = key.split(",");
    Promise.all(list.map((s) => fetchSeries(s).then((x) => ({ s, x, e: null as string | null })).catch((e) => ({ s, x: null, e: String((e as Error).message ?? e) })))).then((rs) => {
      if (!alive) return;
      const series: Record<string, PriceSeries> = {};
      const errors: Record<string, string> = {};
      for (const r of rs) {
        if (r.x && r.x.dates.length) series[r.s] = r.x;
        else errors[r.s] = r.e ?? r.x?.error ?? "데이터 없음";
      }
      setState({ key, series, errors });
    });
    return () => {
      alive = false;
    };
  }, [key]);
  // 새 종목 묶음을 받는 동안에는 이미 받은 시계열을 그대로 두고 loading 으로 표시
  return { series: state.series, errors: state.errors, loading: state.key !== key };
}

export function useIncome() {
  const [state, setState] = useState<{ data: IncomeResponse | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  useEffect(() => {
    let alive = true;
    fetchIncome()
      .then((d) => alive && setState({ data: d, error: null, loading: false }))
      .catch((e) => alive && setState({ data: null, error: String((e as Error).message ?? e), loading: false }));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

/** 오늘 날짜 (미국 동부 기준) */
export function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
