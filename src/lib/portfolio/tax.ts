/**
 * 한국 거주자의 해외주식 세금 추정 (참고용 — 실제 신고는 증권사 자료·홈택스로 확인)
 *
 * 양도소득세
 * - 1월~12월 해외주식 매매 손익을 모두 합산(손익통산)한 뒤 기본공제 연 250만 원을 빼고 22%(소득세 20% + 지방소득세 2%)
 * - 손실은 그해 안에서만 상계되고 다음 해로 넘어가지 않는다. 다음 해 5월에 신고·납부
 * - 취득가액: 선입선출법 또는 이동평균법 (증권사마다 기본 방식이 다름 — 선택)
 * - 원화 환산: 실제로는 매수·매도 결제일의 기준환율. 여기서는 거래에 입력한 환율, 없으면 거래일(또는 직전 거래일) 원/달러 종가로 근사
 * - 수수료는 필요경비로 차감
 *
 * 배당(분배금)
 * - 미국에서 15% 원천징수되고 국내 추가 세금은 보통 없음. 이자·배당 등 금융소득이 연 2,000만 원을 넘으면 종합과세 대상
 */
import { sortTxns } from "./ledger";
import type { Txn } from "./types";

export const CG_RATE = 0.22;
export const CG_DEDUCTION_KRW = 2_500_000;
export const FIN_INCOME_THRESHOLD_KRW = 20_000_000;

export type CostMethod = "fifo" | "average";
export const COST_METHOD_KO: Record<CostMethod, string> = { fifo: "선입선출법", average: "이동평균법" };

/** 보유 수량의 원가 장부 (원화·달러 함께) — 백테스트와 내 자산이 같이 쓴다 */
export class CostBook {
  private lots: { shares: number; usd: number; krw: number }[] = [];
  private shares = 0;
  private usd = 0;
  private krw = 0;
  constructor(private method: CostMethod) {}

  buy(shares: number, usd: number, krw: number) {
    if (!(shares > 0)) return;
    if (this.method === "fifo") this.lots.push({ shares, usd, krw });
    this.shares += shares;
    this.usd += usd;
    this.krw += krw;
  }

  /** 매도 수량의 취득원가 (보유 수량을 넘는 부분은 원가 0) */
  sell(q: number): { usd: number; krw: number; shortfall: number } {
    if (!(q > 0) || this.shares <= 0) return { usd: 0, krw: 0, shortfall: Math.max(0, q) };
    const take = Math.min(q, this.shares);
    let usd = 0;
    let krw = 0;
    if (this.method === "average") {
      usd = (this.usd * take) / this.shares;
      krw = (this.krw * take) / this.shares;
    } else {
      let left = take;
      while (left > 1e-12 && this.lots.length) {
        const lot = this.lots[0];
        const t = Math.min(left, lot.shares);
        const fu = (lot.usd * t) / lot.shares;
        const fk = (lot.krw * t) / lot.shares;
        usd += fu;
        krw += fk;
        lot.shares -= t;
        lot.usd -= fu;
        lot.krw -= fk;
        left -= t;
        if (lot.shares <= 1e-12) this.lots.shift();
      }
    }
    this.shares -= take;
    this.usd -= usd;
    this.krw -= krw;
    if (this.shares <= 1e-12) {
      this.shares = 0;
      this.usd = 0;
      this.krw = 0;
      this.lots = [];
    }
    return { usd, krw, shortfall: q - take };
  }

  get position() {
    return { shares: this.shares, usd: this.usd, krw: this.krw };
  }
}

/** 연간 양도차익 → 세액 (원화) */
export function capitalGainsTax(netGainKrw: number): { taxableKrw: number; taxKrw: number } {
  const taxableKrw = Math.max(0, netGainKrw - CG_DEDUCTION_KRW);
  return { taxableKrw, taxKrw: Math.round(taxableKrw * CG_RATE) };
}

export interface SellRecord {
  date: string;
  symbol: string;
  shares: number;
  proceedsKrw: number;
  costKrw: number;
  feeKrw: number;
  gainKrw: number;
  fxSell: number;
  fxEstimated: boolean;
}

export interface TaxYear {
  year: number;
  sells: SellRecord[];
  gainKrw: number;
  lossKrw: number;
  netKrw: number;
  taxableKrw: number;
  taxKrw: number;
  /** 세전 분배금 원화 환산 (지급일 환율) */
  dividendsKrw: number;
  dividendsUsd: number;
}

export interface TaxReport {
  method: CostMethod;
  years: TaxYear[];
  /** 환율을 알 수 없어 계산하지 못한 거래 */
  missingFx: string[];
  /** 입력 환율이 없어 원/달러 기록으로 근사한 거래 수 */
  estimatedFx: number;
  /** 지금 전부 판다면 (올해 실현분과 합산) */
  liquidation: { gainKrw: number; taxKrw: number; extraTaxKrw: number } | null;
}

/**
 * 거래 내역으로 연도별 양도차익·예상 세액 계산
 * @param fxOn 날짜의 원/달러 환율 (거래에 환율을 입력하지 않았을 때 사용)
 * @param current 현재가·현재 환율 (전부 판다고 가정한 계산용)
 */
export function taxReport(txns: Txn[], method: CostMethod, fxOn: (date: string) => number | null, current?: { prices: Record<string, number | null>; fx: number | null; year: number }): TaxReport {
  const books = new Map<string, CostBook>();
  const book = (s: string) => {
    let b = books.get(s);
    if (!b) books.set(s, (b = new CostBook(method)));
    return b;
  };
  const years = new Map<number, TaxYear>();
  const yearOf = (y: number) => {
    let t = years.get(y);
    if (!t) years.set(y, (t = { year: y, sells: [], gainKrw: 0, lossKrw: 0, netKrw: 0, taxableKrw: 0, taxKrw: 0, dividendsKrw: 0, dividendsUsd: 0 }));
    return t;
  };
  const missing: string[] = [];
  let estimated = 0;
  const rate = (t: Txn): { fx: number; est: boolean } | null => {
    if (t.fx && t.fx > 0) return { fx: t.fx, est: false };
    const r = fxOn(t.date);
    if (r && r > 0) {
      estimated++;
      return { fx: r, est: true };
    }
    missing.push(`${t.date} ${t.symbol ?? ""}`.trim());
    return null;
  };
  for (const t of sortTxns(txns)) {
    const n = (v: number | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    if (!t.symbol && t.type !== "deposit" && t.type !== "withdraw") continue;
    switch (t.type) {
      case "opening":
      case "buy":
      case "reinvest": {
        const q = n(t.shares);
        if (!(q > 0) || !t.symbol) break;
        const usd = q * n(t.price) + (t.type === "buy" ? n(t.fee) : 0);
        const r = rate(t);
        book(t.symbol).buy(q, usd, r ? usd * r.fx : NaN);
        if (t.type === "reinvest") {
          const y = yearOf(Number(t.date.slice(0, 4)));
          y.dividendsUsd += n(t.amount);
          if (r) y.dividendsKrw += n(t.amount) * r.fx;
        }
        break;
      }
      case "sell": {
        const q = n(t.shares);
        if (!(q > 0) || !t.symbol) break;
        const b = book(t.symbol);
        if (b.position.shares + 1e-9 < q) break; // 회계 화면에서 오류로 표시되는 기록
        const r = rate(t);
        const cost = b.sell(q);
        if (!r || !Number.isFinite(cost.krw)) break;
        const proceedsKrw = q * n(t.price) * r.fx;
        const feeKrw = n(t.fee) * r.fx;
        const gainKrw = proceedsKrw - feeKrw - cost.krw;
        const y = yearOf(Number(t.date.slice(0, 4)));
        y.sells.push({ date: t.date, symbol: t.symbol, shares: q, proceedsKrw, costKrw: cost.krw, feeKrw, gainKrw, fxSell: r.fx, fxEstimated: r.est });
        if (gainKrw >= 0) y.gainKrw += gainKrw;
        else y.lossKrw += -gainKrw;
        break;
      }
      case "dividend": {
        const y = yearOf(Number(t.date.slice(0, 4)));
        y.dividendsUsd += n(t.amount);
        const r = rate(t);
        if (r) y.dividendsKrw += n(t.amount) * r.fx;
        break;
      }
    }
  }
  const out = [...years.values()].sort((a, b) => a.year - b.year);
  for (const y of out) {
    y.netKrw = y.gainKrw - y.lossKrw;
    const tx = capitalGainsTax(y.netKrw);
    y.taxableKrw = tx.taxableKrw;
    y.taxKrw = tx.taxKrw;
  }
  let liquidation: TaxReport["liquidation"] = null;
  if (current?.fx) {
    let gain = 0;
    let ok = true;
    for (const [sym, b] of books) {
      const p = b.position;
      if (p.shares <= 0) continue;
      const px = current.prices[sym];
      if (px === null || px === undefined || !Number.isFinite(p.krw)) {
        ok = false;
        break;
      }
      gain += p.shares * px * current.fx - p.krw;
    }
    if (ok) {
      const thisYear = out.find((y) => y.year === current.year);
      const realized = thisYear ? thisYear.netKrw : 0;
      const before = capitalGainsTax(realized).taxKrw;
      const after = capitalGainsTax(realized + gain).taxKrw;
      liquidation = { gainKrw: gain, taxKrw: after, extraTaxKrw: after - before };
    }
  }
  return { method, years: out, missingFx: [...new Set(missing)], estimatedFx: estimated, liquidation };
}
