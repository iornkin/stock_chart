/**
 * 기술적 지표 계산 (서버·클라이언트 공용, 순수 함수)
 * 입력 배열 길이와 같은 길이의 배열을 반환하며, 계산 불가 구간은 null.
 */

export type Series = (number | null)[];

export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** RSI (Wilder 평활) */
export function rsi(closes: number[], period = 14): Series {
  const out: Series = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgG = gain / period;
  let avgL = loss / period;
  out[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

export interface MacdResult {
  macd: Series;
  signal: Series;
  hist: Series;
}

export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const line: Series = closes.map((_, i) => (ef[i] !== null && es[i] !== null ? (ef[i] as number) - (es[i] as number) : null));
  const start = line.findIndex((v) => v !== null);
  const signal: Series = new Array(closes.length).fill(null);
  if (start >= 0) {
    const compact = line.slice(start) as number[];
    const sig = ema(compact, signalPeriod);
    for (let i = 0; i < sig.length; i++) signal[start + i] = sig[i];
  }
  const hist: Series = line.map((v, i) => (v !== null && signal[i] !== null ? v - (signal[i] as number) : null));
  return { macd: line, signal, hist };
}

export interface BollingerResult {
  mid: Series;
  upper: Series;
  lower: Series;
}

export function bollinger(closes: number[], period = 20, mult = 2): BollingerResult {
  const mid = sma(closes, period);
  const upper: Series = new Array(closes.length).fill(null);
  const lower: Series = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const m = mid[i] as number;
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) v += (closes[j] - m) ** 2;
    const sd = Math.sqrt(v / period);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { mid, upper, lower };
}

export interface OhlcvLike {
  t: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** 세션(거래일) 단위로 초기화되는 VWAP — 분봉 차트용 */
export function sessionVwap(bars: OhlcvLike[], sessionKey: (t: number) => string): Series {
  const out: Series = new Array(bars.length).fill(null);
  let key = "";
  let pv = 0;
  let vol = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const k = sessionKey(b.t);
    if (k !== key) {
      key = k;
      pv = 0;
      vol = 0;
    }
    const tp = (b.h + b.l + b.c) / 3;
    pv += tp * b.v;
    vol += b.v;
    out[i] = vol > 0 ? pv / vol : null;
  }
  return out;
}

/** N 기간 이동 VWAP — 일봉 이상 차트용 */
export function rollingVwap(bars: OhlcvLike[], period = 20): Series {
  const out: Series = new Array(bars.length).fill(null);
  let pv = 0;
  let vol = 0;
  for (let i = 0; i < bars.length; i++) {
    const tp = (bars[i].h + bars[i].l + bars[i].c) / 3;
    pv += tp * bars[i].v;
    vol += bars[i].v;
    if (i >= period) {
      const o = bars[i - period];
      pv -= ((o.h + o.l + o.c) / 3) * o.v;
      vol -= o.v;
    }
    if (i >= period - 1 && vol > 0) out[i] = pv / vol;
  }
  return out;
}

/** 연환산 실현 변동성 (로그수익률 표준편차 × √252) */
export function realizedVol(closes: number[], window = 20, periodsPerYear = 252): number | null {
  if (closes.length < window + 1) return null;
  const rets: number[] = [];
  for (let i = closes.length - window; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(v) * Math.sqrt(periodsPerYear);
}

export function maxDrawdown(values: number[]): { mdd: number; peakIndex: number; troughIndex: number } | null {
  if (values.length < 2) return null;
  let peak = values[0];
  let peakI = 0;
  let best = { mdd: 0, peakIndex: 0, troughIndex: 0 };
  for (let i = 1; i < values.length; i++) {
    if (values[i] > peak) {
      peak = values[i];
      peakI = i;
    }
    const dd = values[i] / peak - 1;
    if (dd < best.mdd) best = { mdd: dd, peakIndex: peakI, troughIndex: i };
  }
  return best;
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
