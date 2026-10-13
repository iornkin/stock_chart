/**
 * 개인 자산 회계 (순수 함수)
 *
 * 회계 규칙 (이동평균법)
 * - 기초 보유(opening): 간편 입력에서 옮긴 보유분. 현금 이동 없이 수량·원가가 생기고, 그 원가만큼 '납입 원금'으로 본다.
 * - 매수: 현금 −(수량×가격+수수료), 원가 +(수량×가격+수수료)
 * - 매도: 현금 +(수량×가격−수수료), 실현 손익 = 매도 대금 − 수수료 − 평균 단가×수량. 보유 수량을 넘는 매도는 오류로 막는다.
 * - 입금/출금: 외부 자금 이동. 현금과 납입 원금만 바뀌고 투자 손익에는 들어가지 않는다.
 * - 분배금 수령: 현금 +(세전−세금). 분배금 수익(세전)과 세금을 따로 기록한다. 납입 원금이 아니다.
 * - 분배금 재투자: 분배금 수익으로 기록한 뒤 같은 날 그 돈으로 매수한 것으로 처리 (현금 = 세후 분배금 − 매수 금액)
 * 항등식: 총자산 − 순납입 원금 = 미실현 손익 + 실현 손익 + 세후 분배금
 */
import type { SimpleHolding, Txn } from "./types";

export interface Position {
  symbol: string;
  shares: number;
  /** 현재 보유분의 매수 원가 (수수료 포함) */
  cost: number;
  avgCost: number;
  /** 거래 당시 환율로 환산한 원가 (모든 매수에 환율이 있을 때만) */
  costKrw: number | null;
  realized: number;
  dividendsGross: number;
  firstDate: string | null;
  price: number | null;
  value: number | null;
  unrealized: number | null;
  unrealizedPct: number | null;
}

export interface LedgerIssue {
  txnId: string;
  message: string;
  level: "error" | "warn";
}

export interface LedgerSummary {
  positions: Position[];
  cash: number;
  /** 입금 − 출금 + 기초 보유 원가 */
  netContributions: number;
  deposits: number;
  withdrawals: number;
  realized: number;
  dividendsGross: number;
  dividendsTax: number;
  dividendsNet: number;
  fees: number;
  /** 평가금액 (시세가 있는 종목만) */
  marketValue: number;
  totalCost: number;
  unrealized: number;
  /** 시세가 없는 종목이 있으면 false — 총자산이 불완전 */
  pricesComplete: boolean;
  missingPrices: string[];
  totalAssets: number;
  totalPnl: number;
  totalReturnPct: number | null;
  /** 원화 납입 원금 (입금·기초 보유에 환율이 모두 있을 때) */
  netContributionsKrw: number | null;
  issues: LedgerIssue[];
  /** 분배금 기록 (날짜순) */
  dividendRecords: { date: string; symbol: string; gross: number; tax: number; reinvested: boolean }[];
}

const EPS = 1e-9;

export function sortTxns(txns: Txn[]): Txn[] {
  return [...txns].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
}

export function computeLedger(txns: Txn[], prices: Record<string, number | null | undefined>, asOf?: string): LedgerSummary {
  const pos = new Map<string, { shares: number; cost: number; costKrw: number | null; realized: number; div: number; first: string | null }>();
  const issues: LedgerIssue[] = [];
  let cash = 0;
  let deposits = 0;
  let withdrawals = 0;
  let openings = 0;
  let contribKrw: number | null = 0;
  let realized = 0;
  let divGross = 0;
  let divTax = 0;
  let fees = 0;
  const dividendRecords: LedgerSummary["dividendRecords"] = [];
  const get = (s: string) => {
    let p = pos.get(s);
    if (!p) {
      p = { shares: 0, cost: 0, costKrw: 0, realized: 0, div: 0, first: null };
      pos.set(s, p);
    }
    return p;
  };
  for (const t of sortTxns(txns)) {
    if (asOf && t.date > asOf) continue;
    const fx = t.fx && t.fx > 0 ? t.fx : null;
    const num = (v: number | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    switch (t.type) {
      case "opening":
      case "buy": {
        if (!t.symbol || !(num(t.shares) > 0) || !(num(t.price) >= 0)) {
          issues.push({ txnId: t.id, message: "종목·수량·가격을 확인하세요.", level: "error" });
          break;
        }
        const p = get(t.symbol);
        const gross = num(t.shares) * num(t.price);
        const fee = t.type === "buy" ? num(t.fee) : 0;
        p.shares += num(t.shares);
        p.cost += gross + fee;
        p.costKrw = p.costKrw !== null && fx ? p.costKrw + (gross + fee) * fx : null;
        p.first ??= t.date;
        fees += fee;
        if (t.type === "buy") {
          cash -= gross + fee;
          if (cash < -0.005) issues.push({ txnId: t.id, message: `${t.date} 매수 후 현금이 ${cash.toFixed(2)}달러로 음수입니다. 입금 기록이 빠졌는지 확인하세요.`, level: "warn" });
        } else {
          openings += gross;
          contribKrw = contribKrw !== null && fx ? contribKrw + gross * fx : null;
        }
        break;
      }
      case "sell": {
        const p = t.symbol ? pos.get(t.symbol) : undefined;
        const q = num(t.shares);
        if (!t.symbol || !(q > 0) || !(num(t.price) >= 0)) {
          issues.push({ txnId: t.id, message: "종목·수량·가격을 확인하세요.", level: "error" });
          break;
        }
        if (!p || p.shares + EPS < q) {
          issues.push({ txnId: t.id, message: `${t.date} ${t.symbol} 매도 수량(${q})이 보유 수량(${p ? round(p.shares) : 0})보다 많아 반영하지 않았습니다.`, level: "error" });
          break;
        }
        const avg = p.cost / p.shares;
        const outCost = avg * q;
        const proceeds = q * num(t.price) - num(t.fee);
        const r = proceeds - outCost;
        if (p.costKrw !== null) p.costKrw -= p.costKrw * (q / p.shares);
        p.shares -= q;
        p.cost -= outCost;
        if (p.shares < 1e-7) {
          p.shares = 0;
          p.cost = 0;
          p.costKrw = 0;
        }
        p.realized += r;
        realized += r;
        cash += proceeds;
        fees += num(t.fee);
        break;
      }
      case "deposit":
        if (!(num(t.amount) > 0)) {
          issues.push({ txnId: t.id, message: "입금액을 확인하세요.", level: "error" });
          break;
        }
        cash += num(t.amount);
        deposits += num(t.amount);
        contribKrw = contribKrw !== null && fx ? contribKrw + num(t.amount) * fx : null;
        break;
      case "withdraw":
        if (!(num(t.amount) > 0)) {
          issues.push({ txnId: t.id, message: "출금액을 확인하세요.", level: "error" });
          break;
        }
        cash -= num(t.amount);
        withdrawals += num(t.amount);
        contribKrw = contribKrw !== null && fx ? contribKrw - num(t.amount) * fx : null;
        if (cash < -0.005) issues.push({ txnId: t.id, message: `${t.date} 출금 후 현금이 음수입니다.`, level: "warn" });
        break;
      case "dividend":
      case "reinvest": {
        const gross = num(t.amount);
        const tax = num(t.tax);
        if (!t.symbol || !(gross > 0) || tax < 0 || tax > gross) {
          issues.push({ txnId: t.id, message: "종목·분배금·세금을 확인하세요.", level: "error" });
          break;
        }
        const p = get(t.symbol);
        p.div += gross;
        divGross += gross;
        divTax += tax;
        cash += gross - tax;
        dividendRecords.push({ date: t.date, symbol: t.symbol, gross, tax, reinvested: t.type === "reinvest" });
        if (t.type === "reinvest") {
          const q = num(t.shares);
          const px = num(t.price);
          if (!(q > 0) || !(px > 0)) {
            issues.push({ txnId: t.id, message: "재투자 수량과 가격을 입력하세요.", level: "error" });
            break;
          }
          p.shares += q;
          p.cost += q * px;
          p.costKrw = p.costKrw !== null && fx ? p.costKrw + q * px * fx : null;
          p.first ??= t.date;
          cash -= q * px;
          if (q * px > gross - tax + 0.01) issues.push({ txnId: t.id, message: `${t.date} ${t.symbol} 재투자 금액이 세후 분배금보다 커 차액을 현금에서 뺐습니다.`, level: "warn" });
        }
        break;
      }
    }
  }
  const positions: Position[] = [...pos.entries()]
    .filter(([, p]) => p.shares > 0 || p.realized !== 0 || p.div > 0)
    .map(([symbol, p]) => {
      const price = prices[symbol] ?? null;
      const value = p.shares > 0 ? (price !== null ? p.shares * price : null) : 0;
      return {
        symbol,
        shares: p.shares,
        cost: p.cost,
        avgCost: p.shares > 0 ? p.cost / p.shares : 0,
        costKrw: p.costKrw,
        realized: p.realized,
        dividendsGross: p.div,
        firstDate: p.first,
        price,
        value,
        unrealized: value !== null ? value - p.cost : null,
        unrealizedPct: value !== null && p.cost > 0 ? (value / p.cost - 1) * 100 : null,
      };
    })
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const held = positions.filter((p) => p.shares > 0);
  const missingPrices = held.filter((p) => p.price === null).map((p) => p.symbol);
  const marketValue = held.reduce((a, p) => a + (p.value ?? 0), 0);
  const totalCost = held.reduce((a, p) => a + p.cost, 0);
  const unrealized = held.reduce((a, p) => a + (p.unrealized ?? 0), 0);
  const netContributions = deposits - withdrawals + openings;
  const totalAssets = marketValue + cash;
  const totalPnl = totalAssets - netContributions;
  return {
    positions,
    cash,
    netContributions,
    deposits,
    withdrawals,
    realized,
    dividendsGross: divGross,
    dividendsTax: divTax,
    dividendsNet: divGross - divTax,
    fees,
    marketValue,
    totalCost,
    unrealized,
    pricesComplete: missingPrices.length === 0,
    missingPrices,
    totalAssets,
    totalPnl,
    totalReturnPct: netContributions > 0 && missingPrices.length === 0 ? (totalPnl / netContributions) * 100 : null,
    netContributionsKrw: contribKrw,
    issues,
    dividendRecords,
  };
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;

/** 간편 입력 요약 (거래 내역 없이 현재 보유 상태만) */
export function computeSimple(holdings: SimpleHolding[], cash: number, prices: Record<string, number | null | undefined>) {
  const positions = holdings
    .filter((h) => h.symbol && h.shares > 0)
    .map((h) => {
      const price = prices[h.symbol] ?? null;
      const cost = h.shares * h.avgCost;
      const value = price !== null ? h.shares * price : null;
      return {
        id: h.id,
        symbol: h.symbol,
        shares: h.shares,
        avgCost: h.avgCost,
        cost,
        costKrw: h.avgFx ? cost * h.avgFx : null,
        price,
        value,
        unrealized: value !== null ? value - cost : null,
        unrealizedPct: value !== null && cost > 0 ? (value / cost - 1) * 100 : null,
        firstDate: h.firstDate ?? null,
      };
    });
  const missingPrices = positions.filter((p) => p.price === null).map((p) => p.symbol);
  const marketValue = positions.reduce((a, p) => a + (p.value ?? 0), 0);
  const totalCost = positions.reduce((a, p) => a + p.cost, 0);
  const unrealized = positions.reduce((a, p) => a + (p.unrealized ?? 0), 0);
  return {
    positions,
    cash,
    marketValue,
    totalCost,
    unrealized,
    unrealizedPct: totalCost > 0 && !missingPrices.length ? (unrealized / totalCost) * 100 : null,
    totalAssets: marketValue + cash,
    missingPrices,
    pricesComplete: missingPrices.length === 0,
  };
}

/**
 * 간편 입력 → 거래 내역 전환
 * 보유 종목은 '기초 보유'로, 현금은 '입금'으로 한 번만 옮긴다. 전환 뒤에는 거래 내역만 계산에 쓰므로 중복 계산되지 않는다.
 */
export function convertSimpleToLedger(holdings: SimpleHolding[], cash: number, cashFx: number | null | undefined, today: string, idGen: () => string): Txn[] {
  const now = Date.now();
  const out: Txn[] = holdings
    .filter((h) => h.symbol && h.shares > 0)
    .map((h, i) => ({
      id: idGen(),
      type: "opening" as const,
      date: h.firstDate && h.firstDate <= today ? h.firstDate : today,
      symbol: h.symbol,
      shares: h.shares,
      price: h.avgCost,
      fx: h.avgFx ?? null,
      memo: h.memo ? `간편 입력에서 전환 · ${h.memo}` : "간편 입력에서 전환",
      createdAt: now + i,
    }));
  if (cash > 0) out.push({ id: idGen(), type: "deposit", date: today, amount: cash, fx: cashFx ?? null, memo: "간편 입력의 현금 잔액에서 전환", createdAt: now + out.length });
  return out;
}

/** 날짜별 보유 수량·현금 (자산 가치 변화 차트용) */
export function ledgerTimeline(txns: Txn[], dates: string[], closeOf: (symbol: string, date: string) => number | null): { dates: string[]; value: number[]; contributed: number[] } {
  const sorted = sortTxns(txns);
  const shares = new Map<string, number>();
  let cash = 0;
  let contributed = 0;
  let p = 0;
  const outD: string[] = [];
  const outV: number[] = [];
  const outC: number[] = [];
  for (const d of dates) {
    while (p < sorted.length && sorted[p].date <= d) {
      const t = sorted[p++];
      const q = t.shares ?? 0;
      const s = t.symbol ?? "";
      switch (t.type) {
        case "opening":
          shares.set(s, (shares.get(s) ?? 0) + q);
          contributed += q * (t.price ?? 0);
          break;
        case "buy":
          shares.set(s, (shares.get(s) ?? 0) + q);
          cash -= q * (t.price ?? 0) + (t.fee ?? 0);
          break;
        case "sell":
          if ((shares.get(s) ?? 0) + EPS >= q) {
            shares.set(s, (shares.get(s) ?? 0) - q);
            cash += q * (t.price ?? 0) - (t.fee ?? 0);
          }
          break;
        case "deposit":
          cash += t.amount ?? 0;
          contributed += t.amount ?? 0;
          break;
        case "withdraw":
          cash -= t.amount ?? 0;
          contributed -= t.amount ?? 0;
          break;
        case "dividend":
          cash += (t.amount ?? 0) - (t.tax ?? 0);
          break;
        case "reinvest":
          cash += (t.amount ?? 0) - (t.tax ?? 0) - q * (t.price ?? 0);
          shares.set(s, (shares.get(s) ?? 0) + q);
          break;
      }
    }
    if (p === 0) continue;
    let v = cash;
    let ok = true;
    for (const [s, q] of shares) {
      if (q <= EPS) continue;
      const c = closeOf(s, d);
      if (c === null) {
        ok = false;
        break;
      }
      v += q * c;
    }
    if (!ok) continue;
    outD.push(d);
    outV.push(v);
    outC.push(contributed);
  }
  return { dates: outD, value: outV, contributed: outC };
}
