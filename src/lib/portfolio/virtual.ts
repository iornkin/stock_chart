/**
 * 가상 투자 계좌 계산 (순수 함수) — 실제 주문과 연결되지 않는다
 *
 * - 체결 가격 = 주문 시점에 확인 가능한 최근 시세 × (1 ± 슬리피지). 수수료는 체결 금액 × 수수료율.
 * - 가상 분배금: 실제 지급 기록을 쓴다. 배당락일 전날까지 보유한 수량 × 주당 지급액을 지급일(없으면 배당락일)에 받는다.
 *   지급일이 아직 오지 않은 건은 '지급 예정'으로만 보여 주고 현금에 넣지 않는다.
 * - 재투자를 켜면 지급일 종가(그날 종가가 없으면 직전 거래일 종가)로 같은 종목을 산다.
 * - 거래 기록만 저장하고 분배금은 매번 다시 계산하므로 중복 지급되지 않는다.
 */
import { closeOn, type PriceSeries } from "../sim/series";
import type { VirtualAccount, VirtualTrade } from "./types";

export interface VirtualEvent {
  kind: "buy" | "sell" | "dividend" | "drip";
  date: string;
  symbol: string;
  shares: number;
  price: number | null;
  /** 현금 변화 */
  cash: number;
  gross?: number;
  tax?: number;
  note?: string;
  trade?: VirtualTrade;
}

export interface VirtualPosition {
  symbol: string;
  shares: number;
  cost: number;
  avgCost: number;
  realized: number;
  dividends: number;
  price: number | null;
  value: number | null;
  unrealized: number | null;
  unrealizedPct: number | null;
}

export interface PendingDividend {
  symbol: string;
  ex: string;
  pay: string | null;
  perShare: number;
  shares: number;
  gross: number;
}

export interface VirtualState {
  cash: number;
  positions: VirtualPosition[];
  events: VirtualEvent[];
  pending: PendingDividend[];
  dividendsGross: number;
  dividendsTax: number;
  realized: number;
  fees: number;
  marketValue: number;
  totalValue: number;
  pnl: number;
  returnPct: number;
  missingPrices: string[];
  notes: string[];
}

interface Raw {
  date: string;
  order: number;
  seq: number;
  run: () => void;
}

/**
 * @param today 분배금 지급 여부를 판단하는 기준일
 * @param tradesUntil 이 날짜까지의 거래만 반영 (과거 시점 평가용). 생략하면 모든 거래 — 장 마감 후 주문은 다음 거래일 날짜로 기록되므로 현재 상태에는 포함해야 한다.
 */
export function computeVirtual(acc: VirtualAccount, series: Record<string, PriceSeries | undefined>, prices: Record<string, number | null | undefined>, today: string, tradesUntil?: string): VirtualState {
  const shares = new Map<string, number>();
  const cost = new Map<string, number>();
  const realizedBy = new Map<string, number>();
  const divBy = new Map<string, number>();
  const entitled = new Map<string, number>();
  const events: VirtualEvent[] = [];
  const notes = new Set<string>();
  let cash = acc.initialCash;
  let divGross = 0;
  let divTax = 0;
  let realized = 0;
  let fees = 0;
  const tax = acc.taxPct / 100;
  const raw: Raw[] = [];
  let seq = 0;
  const trades = acc.trades.filter((t) => !tradesUntil || t.date <= tradesUntil).sort((a, b) => a.at - b.at);
  const firstTrade = new Map<string, string>();
  for (const t of trades) if (!firstTrade.has(t.symbol)) firstTrade.set(t.symbol, t.date);

  for (const t of trades) {
    raw.push({
      date: t.date,
      order: 1,
      seq: seq++,
      run: () => {
        const notional = t.shares * t.price;
        if (t.side === "buy") {
          cash -= notional + t.fee;
          shares.set(t.symbol, (shares.get(t.symbol) ?? 0) + t.shares);
          cost.set(t.symbol, (cost.get(t.symbol) ?? 0) + notional + t.fee);
        } else {
          const have = shares.get(t.symbol) ?? 0;
          const avg = have > 0 ? (cost.get(t.symbol) ?? 0) / have : 0;
          const r = notional - t.fee - avg * t.shares;
          cash += notional - t.fee;
          shares.set(t.symbol, have - t.shares);
          cost.set(t.symbol, (cost.get(t.symbol) ?? 0) - avg * t.shares);
          realized += r;
          realizedBy.set(t.symbol, (realizedBy.get(t.symbol) ?? 0) + r);
        }
        fees += t.fee;
        events.push({ kind: t.side, date: t.date, symbol: t.symbol, shares: t.shares, price: t.price, cash: t.side === "buy" ? -(notional + t.fee) : notional - t.fee, trade: t });
      },
    });
  }

  const pending: PendingDividend[] = [];
  for (const [symbol, first] of firstTrade) {
    const x = series[symbol];
    if (!x) {
      notes.add(`${symbol}: 분배금 기록을 불러오지 못해 가상 분배금을 계산하지 않았습니다.`);
      continue;
    }
    for (const d of x.divs) {
      if (d.ex <= first || d.ex > today) continue;
      const key = `${symbol}|${d.ex}|${d.amount}`;
      raw.push({
        date: d.ex,
        order: 0,
        seq: seq++,
        run: () => {
          const q = shares.get(symbol) ?? 0;
          if (q > 1e-9) entitled.set(key, q);
        },
      });
      const credit = d.pay ?? d.ex;
      if (!d.pay) notes.add("지급일이 제공되지 않은 분배금은 배당락일에 받은 것으로 계산했습니다.");
      if (credit > today) {
        raw.push({
          date: d.ex,
          order: 3,
          seq: seq++,
          run: () => {
            const q = entitled.get(key);
            if (q) pending.push({ symbol, ex: d.ex, pay: d.pay, perShare: d.amount, shares: q, gross: q * d.amount });
          },
        });
        continue;
      }
      raw.push({
        date: credit,
        order: 2,
        seq: seq++,
        run: () => {
          const q = entitled.get(key);
          if (!q) return;
          const gross = q * d.amount;
          const t = gross * tax;
          divGross += gross;
          divTax += t;
          divBy.set(symbol, (divBy.get(symbol) ?? 0) + gross);
          cash += gross - t;
          events.push({ kind: "dividend", date: credit, symbol, shares: q, price: d.amount, cash: gross - t, gross, tax: t, note: d.pay ? `배당락 ${d.ex}` : `배당락 ${d.ex} (지급일 미제공)` });
          if (acc.drip) {
            const c = closeOn(x, credit);
            if (!c) {
              notes.add(`${symbol}: 재투자 가격(지급일 종가)이 없어 현금으로 두었습니다.`);
              return;
            }
            const net = gross - t;
            const add = net / c.close;
            cash -= net;
            shares.set(symbol, (shares.get(symbol) ?? 0) + add);
            cost.set(symbol, (cost.get(symbol) ?? 0) + net);
            events.push({ kind: "drip", date: credit, symbol, shares: add, price: c.close, cash: -net, note: c.date !== credit ? `${c.date} 종가 기준` : "지급일 종가 기준" });
          }
        },
      });
    }
  }

  raw.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.seq - b.seq);
  for (const r of raw) r.run();

  const positions: VirtualPosition[] = [...new Set([...shares.keys(), ...realizedBy.keys()])].map((symbol) => {
    const q = Math.max(0, shares.get(symbol) ?? 0);
    const c = q > 1e-9 ? (cost.get(symbol) ?? 0) : 0;
    const price = prices[symbol] ?? null;
    const value = q > 1e-9 ? (price !== null ? q * price : null) : 0;
    return {
      symbol,
      shares: q > 1e-9 ? q : 0,
      cost: c,
      avgCost: q > 1e-9 ? c / q : 0,
      realized: realizedBy.get(symbol) ?? 0,
      dividends: divBy.get(symbol) ?? 0,
      price,
      value,
      unrealized: value !== null ? value - c : null,
      unrealizedPct: value !== null && c > 0 ? (value / c - 1) * 100 : null,
    };
  });
  const missingPrices = positions.filter((p) => p.shares > 0 && p.price === null).map((p) => p.symbol);
  const marketValue = positions.reduce((a, p) => a + (p.value ?? 0), 0);
  const totalValue = marketValue + cash;
  return {
    cash,
    positions: positions.sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
    events: events.reverse(),
    pending,
    dividendsGross: divGross,
    dividendsTax: divTax,
    realized,
    fees,
    marketValue,
    totalValue,
    pnl: totalValue - acc.initialCash,
    returnPct: acc.initialCash > 0 ? (totalValue / acc.initialCash - 1) * 100 : 0,
    missingPrices,
    notes: [...notes],
  };
}

export interface OrderPlan {
  ok: boolean;
  error?: string;
  fillPrice: number;
  fee: number;
  /** 매수 = 필요한 현금, 매도 = 받을 현금 */
  total: number;
}

export function planOrder(state: Pick<VirtualState, "cash" | "positions">, acc: Pick<VirtualAccount, "slippagePct" | "feePct">, side: "buy" | "sell", symbol: string, shares: number, quotePrice: number | null): OrderPlan {
  if (quotePrice === null || !(quotePrice > 0)) return { ok: false, error: "확인 가능한 시세가 없어 주문할 수 없습니다.", fillPrice: 0, fee: 0, total: 0 };
  if (!(shares > 0)) return { ok: false, error: "수량을 0보다 크게 입력하세요.", fillPrice: 0, fee: 0, total: 0 };
  const slip = acc.slippagePct / 100;
  const fillPrice = side === "buy" ? quotePrice * (1 + slip) : quotePrice * (1 - slip);
  const notional = fillPrice * shares;
  const fee = notional * (acc.feePct / 100);
  if (side === "buy") {
    const total = notional + fee;
    if (total > state.cash + 1e-6) return { ok: false, error: `가상 현금이 부족합니다 (필요 $${total.toFixed(2)}, 보유 $${state.cash.toFixed(2)}).`, fillPrice, fee, total };
    return { ok: true, fillPrice, fee, total };
  }
  const have = state.positions.find((p) => p.symbol === symbol)?.shares ?? 0;
  if (shares > have + 1e-9) return { ok: false, error: `보유 수량(${have.toFixed(4)}주)보다 많이 팔 수 없습니다.`, fillPrice, fee, total: notional - fee };
  return { ok: true, fillPrice, fee, total: notional - fee };
}

/** 날짜별 가상 계좌 평가금액 (지급 완료된 분배금·재투자 포함) */
export function virtualHistory(acc: VirtualAccount, series: Record<string, PriceSeries | undefined>, dates: string[]): { dates: string[]; value: number[] } {
  const outD: string[] = [];
  const outV: number[] = [];
  for (const d of dates) {
    if (d < acc.startDate) continue;
    const st = computeVirtual(acc, series, {}, d, d);
    let v = st.cash;
    let ok = true;
    for (const p of st.positions) {
      if (p.shares <= 0) continue;
      const x = series[p.symbol];
      const c = x ? closeOn(x, d) : null;
      if (!c) {
        ok = false;
        break;
      }
      v += p.shares * c.close;
    }
    if (ok) {
      outD.push(d);
      outV.push(v);
    }
  }
  return { dates: outD, value: outV };
}
