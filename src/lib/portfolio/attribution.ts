/**
 * 기간 변화 분석 (순수 함수) — 자산이 왜 변했는지를 확인 가능한 항목으로 나눈다
 *
 * 총자산 변화 = 외부 입출금 + 세후 분배금 − 수수료 + 종목별 가격 변화 효과 + 매매 시점 효과
 * - 가격 변화 효과: 매일 (전날 보유 수량 × (오늘 종가 − 어제 종가))의 합
 * - 매매 시점 효과: 거래 가격과 그날 종가의 차이 (매수 = 수량 × (종가 − 매수가), 매도 = 수량 × (매도가 − 종가))
 * - 평가는 일별 종가로만 한다 (장중 가격 아님). 원인(뉴스 등)은 추정하지 않는다.
 */
import { computeLedger, sortTxns, type LedgerSummary } from "./ledger";
import { timeWeightedReturn } from "./performance";
import type { SimpleHolding, Txn } from "./types";

export interface SymbolEffect {
  symbol: string;
  sharesStart: number;
  sharesEnd: number;
  valueStart: number;
  valueEnd: number;
  priceEffect: number;
  tradeEffect: number;
  dividendsNet: number;
  /** 가격 + 매매 시점 + 세후 분배금 */
  total: number;
  /** 기간 시작 대비 종가 변화율 (%) */
  pricePct: number | null;
}

export interface Attribution {
  /** 평가 기준일 (시작 = 이 날 종가 기준) */
  start: string;
  end: string;
  startValue: number;
  endValue: number;
  change: number;
  deposits: number;
  withdrawals: number;
  openings: number;
  dividendsGross: number;
  dividendsNet: number;
  fees: number;
  priceEffect: number;
  tradeEffect: number;
  bySymbol: SymbolEffect[];
  /** 위 항목 합과 실제 변화의 차이 (0 이면 빠진 항목 없음) */
  residual: number;
  /** 기간 시간가중 수익률 (입출금 영향 제외) */
  twrPct: number | null;
  /** 간편 입력처럼 거래 기록 없이 지금 수량으로 계산했는지 */
  assumedConstant: boolean;
}

export function attributeLedger(txns: Txn[], calendar: string[], closeOf: (s: string, d: string) => number | null, start: string, end: string): Attribution | { error: string } {
  const cal = calendar.filter((d) => d <= end);
  const bi = cal.findIndex((d, i) => d <= start && (i === cal.length - 1 || cal[i + 1] > start));
  if (bi < 0) return { error: "시작일 이전의 가격 기록이 없습니다." };
  const days = cal.slice(bi);
  if (days.length < 2) return { error: "기간 안에 거래일이 2일 이상 있어야 합니다." };
  const sorted = sortTxns(txns);
  const shares = new Map<string, number>();
  let cash = 0;
  let p = 0;
  const effects = new Map<string, { price: number; trade: number; div: number; s0: number }>();
  const eff = (s: string) => effects.get(s) ?? (effects.set(s, { price: 0, trade: 0, div: 0, s0: 0 }).get(s) as { price: number; trade: number; div: number; s0: number });
  let deposits = 0;
  let withdrawals = 0;
  let openings = 0;
  let divGross = 0;
  let divNet = 0;
  let fees = 0;
  let contributed = 0;
  const value = (d: string) => cash + [...shares.entries()].reduce((a, [s, q]) => a + q * (closeOf(s, d) ?? 0), 0);
  const apply = (t: Txn, d: string, record: boolean) => {
    const s = t.symbol ?? "";
    const q = t.shares ?? 0;
    const px = t.price ?? 0;
    const c = s ? (closeOf(s, d) ?? px) : 0;
    switch (t.type) {
      case "opening":
        shares.set(s, (shares.get(s) ?? 0) + q);
        contributed += q * px;
        if (record) {
          openings += q * px;
          eff(s).trade += q * (c - px);
        }
        break;
      case "buy":
        shares.set(s, (shares.get(s) ?? 0) + q);
        cash -= q * px + (t.fee ?? 0);
        if (record) {
          eff(s).trade += q * (c - px);
          fees += t.fee ?? 0;
        }
        break;
      case "sell": {
        const have = shares.get(s) ?? 0;
        if (have + 1e-9 < q) break;
        shares.set(s, have - q);
        cash += q * px - (t.fee ?? 0);
        if (record) {
          eff(s).trade += q * (px - c);
          fees += t.fee ?? 0;
        }
        break;
      }
      case "deposit":
        cash += t.amount ?? 0;
        contributed += t.amount ?? 0;
        if (record) deposits += t.amount ?? 0;
        break;
      case "withdraw":
        cash -= t.amount ?? 0;
        contributed -= t.amount ?? 0;
        if (record) withdrawals += t.amount ?? 0;
        break;
      case "dividend": {
        const net = (t.amount ?? 0) - (t.tax ?? 0);
        cash += net;
        if (record) {
          divGross += t.amount ?? 0;
          divNet += net;
          eff(s).div += net;
        }
        break;
      }
      case "reinvest": {
        const net = (t.amount ?? 0) - (t.tax ?? 0);
        cash += net - q * px;
        shares.set(s, (shares.get(s) ?? 0) + q);
        if (record) {
          divGross += t.amount ?? 0;
          divNet += net;
          eff(s).div += net;
          eff(s).trade += q * (c - px);
        }
        break;
      }
    }
  };
  // 시작 기준일까지의 거래 → 시작 상태
  while (p < sorted.length && sorted[p].date <= days[0]) apply(sorted[p++], days[0], false);
  const startShares = new Map(shares);
  const startValue = value(days[0]);
  const vals = [startValue];
  const contrib = [contributed];
  for (let i = 1; i < days.length; i++) {
    const d = days[i];
    const prev = days[i - 1];
    for (const [s, q] of shares) {
      if (!q) continue;
      const c1 = closeOf(s, d);
      const c0 = closeOf(s, prev);
      if (c1 !== null && c0 !== null) eff(s).price += q * (c1 - c0);
    }
    while (p < sorted.length && sorted[p].date <= d) apply(sorted[p++], d, true);
    vals.push(value(d));
    contrib.push(contributed);
  }
  const endD = days[days.length - 1];
  const endValue = vals[vals.length - 1];
  const syms = [...new Set([...startShares.keys(), ...shares.keys(), ...effects.keys()])].filter(Boolean);
  const bySymbol: SymbolEffect[] = syms
    .map((s) => {
      const e = eff(s);
      const s0 = startShares.get(s) ?? 0;
      const s1 = shares.get(s) ?? 0;
      const c0 = closeOf(s, days[0]);
      const c1 = closeOf(s, endD);
      return { symbol: s, sharesStart: s0, sharesEnd: s1, valueStart: s0 * (c0 ?? 0), valueEnd: s1 * (c1 ?? 0), priceEffect: e.price, tradeEffect: e.trade, dividendsNet: e.div, total: e.price + e.trade + e.div, pricePct: c0 && c1 ? (c1 / c0 - 1) * 100 : null };
    })
    .filter((x) => x.sharesStart || x.sharesEnd || x.total)
    .sort((a, b) => b.total - a.total);
  const priceEffect = bySymbol.reduce((a, x) => a + x.priceEffect, 0);
  const tradeEffect = bySymbol.reduce((a, x) => a + x.tradeEffect, 0);
  // 기초 보유: 원가(수량 × 입력 단가)는 원금, 그날 종가와의 차이는 매매 시점 효과에 들어 있다
  const explained = deposits - withdrawals + openings + divNet - fees + priceEffect + tradeEffect;
  const change = endValue - startValue;
  return {
    start: days[0],
    end: endD,
    startValue,
    endValue,
    change,
    deposits,
    withdrawals,
    openings,
    dividendsGross: divGross,
    dividendsNet: divNet,
    fees,
    priceEffect,
    tradeEffect,
    bySymbol,
    residual: change - explained,
    twrPct: timeWeightedReturn(vals, contrib),
    assumedConstant: false,
  };
}

/** 간편 입력: 지금 수량을 기간 내내 들고 있었다고 보고 가격 변화·분배금(실제 지급 기록 × 수량, 세전)을 나눈다 */
export function attributeSimple(holdings: SimpleHolding[], cash: number, calendar: string[], closeOf: (s: string, d: string) => number | null, divsOf: (s: string, from: string, to: string) => number, start: string, end: string): Attribution | { error: string } {
  const cal = calendar.filter((d) => d <= end);
  const bi = cal.findIndex((d, i) => d <= start && (i === cal.length - 1 || cal[i + 1] > start));
  if (bi < 0 || cal.length - bi < 2) return { error: "기간 안의 가격 기록이 부족합니다." };
  const d0 = cal[bi];
  const d1 = cal[cal.length - 1];
  const bySymbol: SymbolEffect[] = holdings
    .filter((h) => h.shares > 0)
    .map((h) => {
      const c0 = closeOf(h.symbol, d0);
      const c1 = closeOf(h.symbol, d1);
      const pe = c0 !== null && c1 !== null ? h.shares * (c1 - c0) : 0;
      const div = h.shares * divsOf(h.symbol, d0, d1);
      return { symbol: h.symbol, sharesStart: h.shares, sharesEnd: h.shares, valueStart: h.shares * (c0 ?? 0), valueEnd: h.shares * (c1 ?? 0), priceEffect: pe, tradeEffect: 0, dividendsNet: div, total: pe + div, pricePct: c0 && c1 ? (c1 / c0 - 1) * 100 : null };
    })
    .sort((a, b) => b.total - a.total);
  const startValue = bySymbol.reduce((a, x) => a + x.valueStart, 0) + cash;
  const endValue = bySymbol.reduce((a, x) => a + x.valueEnd, 0) + cash;
  const priceEffect = bySymbol.reduce((a, x) => a + x.priceEffect, 0);
  const div = bySymbol.reduce((a, x) => a + x.dividendsNet, 0);
  return {
    start: d0,
    end: d1,
    startValue,
    endValue,
    change: endValue - startValue,
    deposits: 0,
    withdrawals: 0,
    openings: 0,
    dividendsGross: div,
    dividendsNet: div,
    fees: 0,
    priceEffect,
    tradeEffect: 0,
    bySymbol,
    residual: endValue - startValue - priceEffect,
    twrPct: startValue > 0 ? ((endValue + div) / startValue - 1) * 100 : null,
    assumedConstant: true,
  };
}

/** 그날 종가 기준으로 다시 만든 과거 보유 상태 (거래 내역 모드) */
export function snapshotAt(txns: Txn[], date: string, closeOf: (s: string, d: string) => number | null): LedgerSummary {
  const syms = [...new Set(txns.map((t) => t.symbol).filter((s): s is string => !!s))];
  const prices: Record<string, number | null> = {};
  for (const s of syms) prices[s] = closeOf(s, date);
  return computeLedger(txns, prices, date);
}
