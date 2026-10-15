/**
 * 성과 지표 (순수 함수)
 * - 수익률 지표(CAGR·변동성·샤프·낙폭·연도/월별 수익률)는 시간가중 수익 지수(TWR)로 계산한다.
 *   → 중간에 추가 납입한 돈이 수익률이나 낙폭을 부풀리거나 가리지 않는다.
 * - 납입 시점까지 반영한 실제 투자자 수익률은 금액가중 수익률(IRR, XIRR)로 따로 계산한다.
 */
import { daysBetween } from "@/lib/time";

export const TRADING_DAYS = 252;

export function yearsBetween(a: string, b: string): number {
  return daysBetween(a, b) / 365.25;
}

/** 연환산 수익률(%) — 1년 미만 기간은 연환산하지 않는다(null) */
export function cagrPct(growth: number, years: number): number | null {
  if (!(growth > 0) || years < 1) return null;
  return (Math.pow(growth, 1 / years) - 1) * 100;
}

export function dailyReturns(index: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < index.length; i++) out.push(index[i] / index[i - 1] - 1);
  return out;
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/** 연환산 변동성(%) — 일간 수익률 표준편차 × √252 */
export function annualVolPct(rets: number[]): number | null {
  return rets.length >= 20 ? stdev(rets) * Math.sqrt(TRADING_DAYS) * 100 : null;
}

/** 표준편차가 부동소수점 오차 수준이면 0 으로 본다 (일정한 수익률에서 1e−19 같은 값으로 나누는 것 방지) */
export function isNegligible(sd: number, scale = 1): boolean {
  return !(sd > 1e-12 * Math.max(1, Math.abs(scale)));
}

/** 샤프 비율 = (연환산 평균 수익률 − 무위험 수익률) ÷ 연환산 변동성. 변동이 없으면 null */
export function sharpe(rets: number[], riskFreePct: number): number | null {
  const sd = stdev(rets);
  if (rets.length < 60 || isNegligible(sd)) return null;
  return (mean(rets) * TRADING_DAYS - riskFreePct / 100) / (sd * Math.sqrt(TRADING_DAYS));
}

export interface DrawdownInfo {
  /** 최대 낙폭(%) — 음수 */
  mddPct: number;
  peakIndex: number;
  troughIndex: number;
  /** 낙폭 직전 고점을 다시 넘은 위치 (회복 못 했으면 null) */
  recoveryIndex: number | null;
  /** 각 시점의 고점 대비 낙폭(%) */
  series: number[];
}

export function drawdown(values: number[]): DrawdownInfo {
  let peak = values[0] ?? 0;
  let peakIdx = 0;
  let mdd = 0;
  let mddPeak = 0;
  let mddTrough = 0;
  const series: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (values[i] > peak) {
      peak = values[i];
      peakIdx = i;
    }
    const dd = peak > 0 ? (values[i] / peak - 1) * 100 : 0;
    series.push(dd);
    if (dd < mdd) {
      mdd = dd;
      mddPeak = peakIdx;
      mddTrough = i;
    }
  }
  let recoveryIndex: number | null = null;
  if (mdd < 0) {
    const level = values[mddPeak];
    for (let i = mddTrough + 1; i < values.length; i++) {
      if (values[i] >= level) {
        recoveryIndex = i;
        break;
      }
    }
  }
  return { mddPct: mdd, peakIndex: mddPeak, troughIndex: mddTrough, recoveryIndex, series };
}

/**
 * 기간별 수익률 (TWR 지수 기준)
 * 각 기간 = 기간 마지막 값 ÷ 직전 기간 마지막 값 − 1. 첫 기간은 시작 값 대비.
 */
export function periodReturns(dates: string[], index: number[], keyOf: (d: string) => string): { key: string; retPct: number; first: string; last: string }[] {
  const out: { key: string; retPct: number; first: string; last: string }[] = [];
  if (!dates.length) return out;
  let base = index[0];
  let cur = keyOf(dates[0]);
  let first = dates[0];
  for (let i = 1; i <= dates.length; i++) {
    const k = i < dates.length ? keyOf(dates[i]) : null;
    if (k !== cur) {
      const endVal = index[i - 1];
      out.push({ key: cur, retPct: (endVal / base - 1) * 100, first, last: dates[i - 1] });
      base = endVal;
      if (k !== null) {
        cur = k;
        first = dates[i];
      }
    }
  }
  return out;
}

/** XIRR — 날짜별 현금흐름(투자는 음수, 회수는 양수)의 연환산 내부수익률(%) */
export function xirrPct(flows: { date: string; amount: number }[]): number | null {
  if (flows.length < 2) return null;
  if (!flows.some((f) => f.amount < 0) || !flows.some((f) => f.amount > 0)) return null;
  const t0 = flows[0].date;
  const ts = flows.map((f) => daysBetween(t0, f.date) / 365);
  const npv = (r: number) => flows.reduce((a, f, i) => a + f.amount / Math.pow(1 + r, ts[i]), 0);
  let lo = -0.9999;
  let hi = 10;
  let fLo = npv(lo);
  const fHi = npv(hi);
  if (fLo * fHi > 0) return null;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-9) return mid * 100;
    if (fLo * fm < 0) hi = mid;
    else {
      lo = mid;
      fLo = fm;
    }
  }
  return ((lo + hi) / 2) * 100;
}

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** 재현 가능한 난수 (같은 시드 → 같은 결과) */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 표준정규 난수 (Box–Muller) */
export function normal(rand: () => number): number {
  let u = 0;
  while (u === 0) u = rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
