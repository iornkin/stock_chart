/**
 * 기술적 지표 계산 (서버·클라이언트 공용, 순수 함수)
 * 입력 배열 길이와 같은 길이의 배열을 반환하며, 계산 불가 구간은 null.
 */

// 이동평균·RSI·MACD·볼린저는 기술적 지표 모듈(ta.ts)의 정의 하나만 쓴다 (차트·브리핑·백테스트 공통)
export { sma, ema, rsi, macd, bollinger, type Series, type MacdResult, type BandResult as BollingerResult } from "./ta";
import { drawdown } from "./sim/metrics";
import type { Series } from "./ta";

/** 연환산 실현 변동성 (로그수익률 표준편차 × √252) */
export function realizedVol(closes: number[], window = 20, periodsPerYear = 252): number | null {
  if (closes.length < window + 1) return null;
  const rets: number[] = [];
  for (let i = closes.length - window; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(v) * Math.sqrt(periodsPerYear);
}

/** 최대 낙폭 (고점 대비 저점, 비율) — 계산은 sim/metrics 의 drawdown 하나로 통일 */
export function maxDrawdown(values: number[]): { mdd: number; peakIndex: number; troughIndex: number } | null {
  if (values.length < 2) return null;
  const d = drawdown(values);
  return { mdd: d.mddPct / 100, peakIndex: d.peakIndex, troughIndex: d.troughIndex };
}

export interface LevelCandidate {
  price: number;
  kind: "support" | "resistance";
  touches: number;
  basis: string;
}

/**
 * 지지·저항 '후보' 수준: 최근 구간의 스윙 고점/저점(좌우 window 봉 대비 극값)을 찾아
 * 가까운 가격대(tolerance) 끼리 묶고, 현재가 아래/위에서 가장 가까운 수준을 고른다.
 * 확정적인 값이 아니라 분석 참고용 수준이다.
 */
export function supportResistance(
  bars: { h: number; l: number; c: number }[],
  lookback = 120,
  window = 5,
  tolerance = 0.015,
): LevelCandidate[] {
  if (bars.length < window * 2 + 5) return [];
  const slice = bars.slice(-lookback);
  const price = slice[slice.length - 1].c;
  const pivots: { price: number; type: "high" | "low" }[] = [];
  for (let i = window; i < slice.length - window; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      if (slice[j].h >= slice[i].h) isHigh = false;
      if (slice[j].l <= slice[i].l) isLow = false;
    }
    if (isHigh) pivots.push({ price: slice[i].h, type: "high" });
    if (isLow) pivots.push({ price: slice[i].l, type: "low" });
  }
  const clusters: { sum: number; n: number }[] = [];
  for (const p of pivots.sort((a, b) => a.price - b.price)) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(p.price / (last.sum / last.n) - 1) <= tolerance) {
      last.sum += p.price;
      last.n += 1;
    } else clusters.push({ sum: p.price, n: 1 });
  }
  const levels = clusters.map((c) => ({ price: c.sum / c.n, touches: c.n }));
  const supports = levels
    .filter((l) => l.price < price)
    .sort((a, b) => b.price - a.price)
    .slice(0, 2)
    .map<LevelCandidate>((l) => ({ ...l, kind: "support", basis: `최근 ${slice.length}봉 스윙 저·고점 ${l.touches}회 근접` }));
  const resistances = levels
    .filter((l) => l.price > price)
    .sort((a, b) => a.price - b.price)
    .slice(0, 2)
    .map<LevelCandidate>((l) => ({ ...l, kind: "resistance", basis: `최근 ${slice.length}봉 스윙 저·고점 ${l.touches}회 근접` }));
  return [...supports, ...resistances];
}

export function last<T>(arr: (T | null)[]): T | null {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] !== null && arr[i] !== undefined) return arr[i] as T;
  return null;
}

export function lastN<T>(arr: (T | null)[], n: number): (T | null)[] {
  return arr.slice(Math.max(0, arr.length - n));
}
