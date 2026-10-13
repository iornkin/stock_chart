"use client";
/** 내 자산 요약 (간편 입력·거래 내역 공통) — 내 자산 화면과 대시보드가 함께 쓴다 */
import { useMemo } from "react";
import { computeLedger, computeSimple } from "@/lib/portfolio/ledger";
import type { PortfolioData } from "@/lib/portfolio/types";
import type { IncomeInfo } from "@/lib/sim/income";
import { addDays } from "@/lib/time";
import { etToday, useIncome, useQuotes, type QuoteLite } from "./user-data";

export interface HoldingView {
  symbol: string;
  shares: number;
  avgCost: number;
  cost: number;
  costKrw: number | null;
  price: number | null;
  value: number | null;
  unrealized: number | null;
  unrealizedPct: number | null;
  realized: number | null;
  dividends: number | null;
  /** 보유 수량 × 최근 12개월 실제 주당 정기 지급액 (추정, 확정 아님) */
  expectedAnnual: number | null;
  word: string;
}

/** 이번 달·앞으로의 지급 (현재 보유 수량 기준 — 배당락일 전날 보유 수량이 달랐다면 실제 금액과 다를 수 있음) */
export interface ScheduleItem {
  symbol: string;
  ex: string;
  pay: string | null;
  perShare: number;
  shares: number;
  amount: number;
  status: string;
}

export interface PortfolioSummary {
  mode: "simple" | "ledger";
  empty: boolean;
  holdings: HoldingView[];
  cash: number;
  marketValue: number;
  totalCost: number;
  totalAssets: number;
  unrealized: number;
  realized: number | null;
  /** 순납입 원금 (거래 내역 모드) */
  netContributions: number | null;
  totalPnl: number | null;
  totalReturnPct: number | null;
  /** 실제 수령 기록 (거래 내역 모드) */
  dividendsActualTotal: number | null;
  dividendsActualTtm: number | null;
  dividendsActualTtmNet: number | null;
  expectedAnnual: number;
  expectedAnnualSimple: number;
  thisMonth: ScheduleItem[];
  upcoming: ScheduleItem[];
  missingPrices: string[];
  oldestQuote: QuoteLite | null;
  quotes: Record<string, QuoteLite>;
  quotesError: string | null;
  loading: boolean;
  income: Record<string, IncomeInfo> | null;
  issues: ReturnType<typeof computeLedger>["issues"];
}

export function heldSymbols(p: PortfolioData): string[] {
  if (p.mode === "simple") return [...new Set(p.simple.holdings.filter((h) => h.shares > 0).map((h) => h.symbol))];
  return [...new Set(p.ledger.map((t) => t.symbol).filter((s): s is string => !!s))];
}

export function usePortfolioSummary(p: PortfolioData): PortfolioSummary {
  const symbols = heldSymbols(p);
  const q = useQuotes(symbols);
  const inc = useIncome();
  return useMemo(() => {
    const today = etToday();
    const ym = today.slice(0, 7);
    const income = inc.data?.items ?? null;
    let holdings: HoldingView[];
    let cash: number;
    let realized: number | null = null;
    let netContributions: number | null = null;
    let totalPnl: number | null = null;
    let totalReturnPct: number | null = null;
    let dividendsActualTotal: number | null = null;
    let dividendsActualTtm: number | null = null;
    let dividendsActualTtmNet: number | null = null;
    let issues: PortfolioSummary["issues"] = [];
    let missingPrices: string[];
    if (p.mode === "simple") {
      const s = computeSimple(p.simple.holdings, p.simple.cash, q.prices);
      cash = s.cash;
      missingPrices = s.missingPrices;
      holdings = s.positions.map((h) => ({ symbol: h.symbol, shares: h.shares, avgCost: h.avgCost, cost: h.cost, costKrw: h.costKrw, price: h.price, value: h.value, unrealized: h.unrealized, unrealizedPct: h.unrealizedPct, realized: null, dividends: null, expectedAnnual: null, word: "" }));
      totalPnl = missingPrices.length ? null : s.unrealized;
      totalReturnPct = s.unrealizedPct;
    } else {
      const s = computeLedger(p.ledger, q.prices, today);
      cash = s.cash;
      missingPrices = s.missingPrices;
      issues = s.issues;
      realized = s.realized;
      netContributions = s.netContributions;
      totalPnl = s.pricesComplete ? s.totalPnl : null;
      totalReturnPct = s.totalReturnPct;
      dividendsActualTotal = s.dividendsGross;
      const from = addDays(today, -365);
      const ttm = s.dividendRecords.filter((d) => d.date > from);
      dividendsActualTtm = ttm.reduce((a, d) => a + d.gross, 0);
      dividendsActualTtmNet = ttm.reduce((a, d) => a + d.gross - d.tax, 0);
      holdings = s.positions
        .filter((h) => h.shares > 0)
        .map((h) => ({ symbol: h.symbol, shares: h.shares, avgCost: h.avgCost, cost: h.cost, costKrw: h.costKrw, price: h.price, value: h.value, unrealized: h.unrealized, unrealizedPct: h.unrealizedPct, realized: h.realized, dividends: h.dividendsGross, expectedAnnual: null, word: "" }));
    }
    let expectedAnnual = 0;
    let expectedAnnualSimple = 0;
    const all: ScheduleItem[] = [];
    for (const h of holdings) {
      const info = income?.[h.symbol];
      if (!info) continue;
      h.word = info.word;
      h.expectedAnnual = h.shares * info.ttmPerShare;
      expectedAnnual += h.expectedAnnual;
      expectedAnnualSimple += h.shares * (info.annualizedLatest ?? 0);
      const seen = new Set<string>();
      for (const u of [...info.recent, ...info.upcoming]) {
        const k = `${u.ex}|${u.amount}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const when = u.pay ?? u.ex;
        if (when.slice(0, 7) !== ym && when < today) continue;
        const status = u.ex > today ? "발표됨 (배당락 전)" : !u.pay ? "배당락 지남 · 지급일 미제공" : u.pay <= today ? "지급 완료" : "지급 예정";
        all.push({ symbol: h.symbol, ex: u.ex, pay: u.pay, perShare: u.amount, shares: h.shares, amount: u.amount * h.shares, status });
      }
    }
    all.sort((a, b) => (a.pay ?? a.ex).localeCompare(b.pay ?? b.ex));
    const upcoming = all.filter((u) => (u.pay ?? u.ex) >= today);
    const marketValue = holdings.reduce((a, h) => a + (h.value ?? 0), 0);
    const totalCost = holdings.reduce((a, h) => a + h.cost, 0);
    const qs = symbols.map((s) => q.quotes[s]).filter(Boolean);
    const oldestQuote = qs.length ? qs.reduce((a, b) => ((a.marketTime ?? a.fetchedAt) <= (b.marketTime ?? b.fetchedAt) ? a : b)) : null;
    return {
      mode: p.mode,
      empty: holdings.length === 0 && cash === 0 && (p.mode === "simple" || p.ledger.length === 0),
      holdings,
      cash,
      marketValue,
      totalCost,
      totalAssets: marketValue + cash,
      unrealized: holdings.reduce((a, h) => a + (h.unrealized ?? 0), 0),
      realized,
      netContributions,
      totalPnl,
      totalReturnPct,
      dividendsActualTotal,
      dividendsActualTtm,
      dividendsActualTtmNet,
      expectedAnnual,
      expectedAnnualSimple,
      thisMonth: all.filter((u) => (u.pay ?? u.ex).slice(0, 7) === ym),
      upcoming,
      missingPrices,
      oldestQuote,
      quotes: q.quotes,
      quotesError: q.error,
      loading: q.loading || inc.loading,
      income,
      issues,
    };
    // symbols 는 p 에서 나온 값
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, q.prices, q.quotes, q.loading, q.error, inc.data, inc.loading]);
}
