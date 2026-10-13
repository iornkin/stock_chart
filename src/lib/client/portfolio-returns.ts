"use client";
/** 내 자산 수익률 (달러 기준 / 원화 기준) — 원/달러 일별 기록과 실제 분배금 기록을 불러와 계산 */
import { useMemo } from "react";
import { portfolioReturns, type PortfolioReturns } from "@/lib/portfolio/returns";
import type { PortfolioData } from "@/lib/portfolio/types";
import { closeOn } from "@/lib/sim/series";
import type { PortfolioSummary } from "./portfolio-summary";
import { etToday, useFx, useSeriesMap } from "./user-data";

export function usePortfolioReturns(p: PortfolioData, s: PortfolioSummary): { r: PortfolioReturns; loading: boolean; fxTime: number | null; fxSource: string | null } {
  const fx = useFx();
  // 간편 입력에서 최초 매수일을 넣은 종목만 분배금을 추정하므로 그 종목의 실제 지급 기록이 필요
  const divSyms = p.mode === "simple" ? p.simple.holdings.filter((h) => h.firstDate && h.shares > 0).map((h) => h.symbol) : [];
  const ser = useSeriesMap(["KRW=X", ...divSyms]);
  const r = useMemo(() => {
    const x = ser.series["KRW=X"];
    return portfolioReturns({
      data: p,
      prices: Object.fromEntries(Object.entries(s.quotes).map(([k, q]) => [k, q.price !== null && q.price > 0 ? q.price : null])),
      today: etToday(),
      fxNow: fx.rate,
      fxOn: (d) => (x ? (closeOn(x, d)?.close ?? null) : null),
      divsOf: (sym) => ser.series[sym]?.divs ?? null,
    });
  }, [p, s.quotes, fx.rate, ser.series]);
  return { r, loading: ser.loading || fx.loading || s.loading, fxTime: fx.time, fxSource: fx.source };
}
