/**
 * 주식분할(기업행위) 처리 (순수 함수)
 *
 * 이 사이트의 일봉·분배금은 분할을 반영한 값(현재 주식 수 기준)이다.
 * 사용자가 분할 전 거래를 '당시 실제 가격·수량'으로 넣으면 평균 단가·보유 수량·수익률이 틀어진다.
 * → 자동으로 고치지 않고, 가격이 '분할 반영 종가 × 분할 비율'에 가까운 거래를 찾아 보여 주고,
 *   사용자가 확인하면 수량 × 비율, 가격 ÷ 비율로 바꾼다 (거래 금액은 그대로).
 */
import { closeOn, type PriceSeries } from "@/lib/sim/series";
import type { SimpleHolding, Txn } from "./types";
import { addDays } from "@/lib/time";

export interface SplitEvent {
  date: string;
  ratio: number;
}

/** 거래일 뒤(다음 날부터)에 일어난 분할의 누적 비율. 분할 날짜 = 분할 반영 첫 거래일이라 그날 거래는 이미 분할 후 기준 */
export function splitFactorAfter(splits: SplitEvent[] | undefined, date: string): number {
  return (splits ?? []).filter((s) => s.date > date && s.ratio > 0 && Number.isFinite(s.ratio)).reduce((a, s) => a * s.ratio, 1);
}

export interface SplitSuspect {
  kind: "txn" | "holding";
  id: string;
  symbol: string;
  date: string;
  /** 곱할 비율 (수량 × factor, 가격 ÷ factor) */
  factor: number;
  entered: number;
  /** 분할 반영 종가 */
  close: number;
  splits: SplitEvent[];
}

const near = (a: number, b: number, tol: number) => Math.abs(a / b - 1) <= tol;

/** 분할 전 기준으로 넣은 것으로 보이는 거래 (입력 가격 ≈ 분할 반영 종가 × 비율, 그리고 분할 반영 종가와는 크게 다름) */
export function detectUnadjustedTrades(ledger: Txn[], series: Record<string, PriceSeries | undefined>): SplitSuspect[] {
  const out: SplitSuspect[] = [];
  for (const t of ledger) {
    if (!(t.type === "buy" || t.type === "sell" || t.type === "opening" || t.type === "reinvest") || !t.symbol || !(t.price && t.price > 0)) continue;
    const s = series[t.symbol];
    if (!s?.splits?.length) continue;
    const f = splitFactorAfter(s.splits, t.date);
    if (f === 1) continue;
    const c = closeOn(s, t.date);
    if (!c || c.date < addDays(t.date, -7)) continue;
    const r = t.price / c.close;
    if (near(r, f, 0.2) && !near(r, 1, 0.3)) out.push({ kind: "txn", id: t.id, symbol: t.symbol, date: t.date, factor: f, entered: t.price, close: c.close, splits: s.splits.filter((x) => x.date > t.date) });
  }
  return out;
}

/** 간편 입력: 최초 매수일이 분할 전이고 평균 단가가 그날 분할 반영 종가 × 비율 근처 */
export function detectUnadjustedHoldings(holdings: SimpleHolding[], series: Record<string, PriceSeries | undefined>): SplitSuspect[] {
  const out: SplitSuspect[] = [];
  for (const h of holdings) {
    if (!h.firstDate || !(h.avgCost > 0) || !(h.shares > 0)) continue;
    const s = series[h.symbol];
    if (!s?.splits?.length) continue;
    const f = splitFactorAfter(s.splits, h.firstDate);
    if (f === 1) continue;
    const c = closeOn(s, h.firstDate);
    if (!c) continue;
    // 평균 단가는 여러 번 산 값이라 더 넓게 본다
    const r = h.avgCost / c.close;
    if (near(r, f, 0.35) && !near(r, 1, 0.35)) out.push({ kind: "holding", id: h.id, symbol: h.symbol, date: h.firstDate, factor: f, entered: h.avgCost, close: c.close, splits: s.splits.filter((x) => x.date > h.firstDate!) });
  }
  return out;
}

const tag = (f: number) => `[분할 ×${Math.round(f * 1000) / 1000} 반영]`;

/** 사용자가 확인한 거래만 수량 × 비율, 가격 ÷ 비율로 바꾼다 (거래 금액·수수료·세금은 그대로) */
export function applySplitToTxns(ledger: Txn[], fixes: { id: string; factor: number }[]): Txn[] {
  const by = new Map(fixes.map((f) => [f.id, f.factor]));
  return ledger.map((t) => {
    const f = by.get(t.id);
    if (!f || !(f > 0)) return t;
    return { ...t, shares: t.shares !== undefined ? t.shares * f : t.shares, price: t.price !== undefined ? t.price / f : t.price, memo: [t.memo, tag(f)].filter(Boolean).join(" ") };
  });
}

export function applySplitToHoldings(holdings: SimpleHolding[], fixes: { id: string; factor: number }[]): SimpleHolding[] {
  const by = new Map(fixes.map((f) => [f.id, f.factor]));
  return holdings.map((h) => {
    const f = by.get(h.id);
    if (!f || !(f > 0)) return h;
    return { ...h, shares: h.shares * f, avgCost: h.avgCost / f, memo: [h.memo, tag(f)].filter(Boolean).join(" ") };
  });
}
