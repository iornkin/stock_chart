/**
 * 기술적 지표 (순수 함수, 서버·브라우저 공용) — 차트와 전략 백테스트가 같은 함수를 쓴다.
 *
 * 공통 규칙
 * - 입력과 같은 길이의 배열을 돌려준다. 계산할 수 없는 자리는 null (0 으로 채우지 않는다).
 * - 첫 유효값 위치(초기화)는 지표마다 아래 주석에 적었다. 그 앞은 null.
 * - 값이 숫자가 아니거나(누락·NaN·무한대) 비정상 봉(고가 < 저가, 가격 ≤ 0)이면 그 자리는 '누락'으로 본다.
 *   · 창(window) 지표(SMA·WMA·볼린저 등): 창 안에 누락이 있으면 null.
 *   · 누적·재귀 지표(EMA·RSI·ATR·ADX·OBV 등): 누락 자리에서 상태를 버리고, 다음 유효값부터 초기화를 다시 한다.
 * - 분모가 0 이면(예: 고가 = 저가, 거래량 0) 그 자리는 null.
 * - 모든 값은 i 번째 봉까지의 데이터만 쓴다(미래 봉을 보지 않음). 예외: 일목균형표 후행스팬은 표시 전용(아래 참고).
 */

export type Series = (number | null)[];

export interface Bars {
  /** 봉 시각 (초) 또는 날짜 문자열 — 지표 계산에는 쓰지 않고 정렬·중복 검사에만 쓴다 */
  t?: (number | string)[];
  o?: number[];
  h: number[];
  l: number[];
  c: number[];
  v?: number[];
}

const ok = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const nulls = (n: number): Series => new Array(n).fill(null);
/** 범위가 정해진 지표(0~100 등)의 부동소수점 오차(1e−9 이내)만 범위 안으로 — 그보다 크게 벗어난 값은 그대로 둔다 */
const bound = (x: Series, lo: number, hi: number): Series => x.map((v) => (v === null ? null : v < lo && v > lo - 1e-9 ? lo : v > hi && v < hi + 1e-9 ? hi : v));

/** 비정상 봉 표시: 가격이 숫자가 아니거나 0 이하, 고가 < 저가, 종가가 고가·저가 밖 */
export function validBar(b: Bars, i: number): boolean {
  const h = b.h[i];
  const l = b.l[i];
  const c = b.c[i];
  return ok(h) && ok(l) && ok(c) && h > 0 && l > 0 && c > 0 && h >= l && c <= h * (1 + 1e-9) && c >= l * (1 - 1e-9);
}

/** 봉 데이터 정리: 시각순 정렬, 같은 시각 중복은 마지막 것만, 비정상 봉은 누락(NaN)으로 — 무엇을 고쳤는지 함께 돌려준다 */
export function cleanBars(raw: { t: number | string; o: number; h: number; l: number; c: number; v: number }[]): { bars: { t: number | string; o: number; h: number; l: number; c: number; v: number }[]; duplicates: number; unsorted: boolean; invalid: number } {
  let unsorted = false;
  for (let i = 1; i < raw.length; i++) if (raw[i].t < raw[i - 1].t) unsorted = true;
  const sorted = unsorted ? [...raw].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0)) : raw;
  const out: typeof raw = [];
  let duplicates = 0;
  for (const b of sorted) {
    if (out.length && out[out.length - 1].t === b.t) {
      out[out.length - 1] = b;
      duplicates++;
    } else out.push(b);
  }
  let invalid = 0;
  const bars = out.map((b) => {
    const good = ok(b.h) && ok(b.l) && ok(b.c) && b.h > 0 && b.l > 0 && b.c > 0 && b.h >= b.l && b.c <= b.h * (1 + 1e-9) && b.c >= b.l * (1 - 1e-9);
    if (good) return { ...b, v: ok(b.v) && b.v >= 0 ? b.v : NaN };
    invalid++;
    return { ...b, h: NaN, l: NaN, c: NaN, o: NaN };
  });
  return { bars, duplicates, unsorted, invalid };
}

// ───────────────────────────── 이동평균 ─────────────────────────────

/** SMA(n) = 최근 n 개 평균. 첫 값: n−1 번째 */
export function sma(x: number[], n: number): Series {
  const out = nulls(x.length);
  if (!(n >= 1)) return out;
  let sum = 0;
  let bad = 0;
  for (let i = 0; i < x.length; i++) {
    if (ok(x[i])) sum += x[i];
    else bad++;
    if (i >= n) {
      if (ok(x[i - n])) sum -= x[i - n];
      else bad--;
    }
    if (i >= n - 1 && bad === 0) out[i] = sum / n;
  }
  return out;
}

/** 시리즈(null 포함)의 SMA — 창 안에 null 이 있으면 null */
export function smaS(x: Series, n: number): Series {
  return sma(x.map((v) => (v === null ? NaN : v)), n);
}

/**
 * EMA(n): α = 2/(n+1), 첫 값 = 처음 n 개의 SMA (n−1 번째), 이후 EMA_t = α·x_t + (1−α)·EMA_(t−1).
 * 누락값을 만나면 그 뒤 n 개로 다시 시작한다.
 */
export function ema(x: Series | number[], n: number): Series {
  return recursive(x, n, (prev, v) => v * (2 / (n + 1)) + prev * (1 - 2 / (n + 1)));
}

/** Wilder 평활(RMA, SMMA): 첫 값 = 처음 n 개 SMA, 이후 (이전 × (n−1) + x) / n */
export function rma(x: Series | number[], n: number): Series {
  return recursive(x, n, (prev, v) => (prev * (n - 1) + v) / n);
}

function recursive(x: Series | number[], n: number, step: (prev: number, v: number) => number): Series {
  const out = nulls(x.length);
  if (!(n >= 1)) return out;
  let seed = 0;
  let cnt = 0;
  let prev: number | null = null;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    if (!ok(v)) {
      seed = 0;
      cnt = 0;
      prev = null;
      continue;
    }
    if (prev === null) {
      seed += v;
      cnt++;
      if (cnt === n) {
        prev = seed / n;
        out[i] = prev;
      }
    } else {
      prev = step(prev, v);
      out[i] = prev;
    }
  }
  return out;
}

/** WMA(n): 가중치 1..n (최근이 n). 첫 값: n−1 번째 */
export function wma(x: number[], n: number): Series {
  const out = nulls(x.length);
  if (!(n >= 1)) return out;
  const denom = (n * (n + 1)) / 2;
  for (let i = n - 1; i < x.length; i++) {
    let s = 0;
    let good = true;
    for (let k = 0; k < n; k++) {
      const v = x[i - n + 1 + k];
      if (!ok(v)) {
        good = false;
        break;
      }
      s += v * (k + 1);
    }
    if (good) out[i] = s / denom;
  }
  return out;
}

/** VWMA(n) = Σ(종가 × 거래량) ÷ Σ거래량 (최근 n 봉). 거래량 합이 0 이면 null */
export function vwma(c: number[], v: number[], n: number): Series {
  const out = nulls(c.length);
  if (!(n >= 1)) return out;
  for (let i = n - 1; i < c.length; i++) {
    let pv = 0;
    let vs = 0;
    let good = true;
    for (let k = i - n + 1; k <= i; k++) {
      if (!ok(c[k]) || !ok(v[k]) || v[k] < 0) {
        good = false;
        break;
      }
      pv += c[k] * v[k];
      vs += v[k];
    }
    if (good && vs > 0) out[i] = pv / vs;
  }
  return out;
}

// ───────────────────────────── 창 극값·표준편차 ─────────────────────────────

function rollingExt(x: number[], n: number, max: boolean): Series {
  const out = nulls(x.length);
  for (let i = n - 1; i < x.length; i++) {
    let m = max ? -Infinity : Infinity;
    let good = true;
    for (let k = i - n + 1; k <= i; k++) {
      if (!ok(x[k])) {
        good = false;
        break;
      }
      m = max ? Math.max(m, x[k]) : Math.min(m, x[k]);
    }
    if (good) out[i] = m;
  }
  return out;
}
export const highest = (x: number[], n: number) => rollingExt(x, n, true);
export const lowest = (x: number[], n: number) => rollingExt(x, n, false);

/** 창 표준편차 (모집단: n 으로 나눔 — 볼린저 밴드 표준 정의) */
export function rollingStd(x: number[], n: number): Series {
  const m = sma(x, n);
  const out = nulls(x.length);
  for (let i = n - 1; i < x.length; i++) {
    if (m[i] === null) continue;
    let s = 0;
    for (let k = i - n + 1; k <= i; k++) s += (x[k] - (m[i] as number)) ** 2;
    out[i] = Math.sqrt(s / n);
  }
  return out;
}

// ───────────────────────────── 추세 ─────────────────────────────

/** True Range: max(고−저, |고−전일 종가|, |저−전일 종가|). 첫 봉(또는 전일 누락)은 고−저 */
export function trueRange(b: Bars): Series {
  const out = nulls(b.c.length);
  for (let i = 0; i < b.c.length; i++) {
    if (!validBar(b, i)) continue;
    const hl = b.h[i] - b.l[i];
    out[i] = i > 0 && validBar(b, i - 1) ? Math.max(hl, Math.abs(b.h[i] - b.c[i - 1]), Math.abs(b.l[i] - b.c[i - 1])) : hl;
  }
  return out;
}

/** ATR(n) = TR 의 Wilder 평활. 첫 값: n−1 번째 (처음 n 개 TR 평균) */
export function atr(b: Bars, n = 14): Series {
  return rma(trueRange(b), n);
}

export interface AdxResult {
  plusDI: Series;
  minusDI: Series;
  adx: Series;
}

/**
 * ADX(n) — Wilder 원래 정의
 * +DM = 고가 상승폭(>저가 하락폭이고 >0일 때), −DM = 저가 하락폭(반대). TR·+DM·−DM 을 1번째 봉부터 Wilder 평활.
 * +DI = 100 × 평활 +DM ÷ 평활 TR (첫 값: n 번째 봉), DX = 100 × |+DI − −DI| ÷ (+DI + −DI), ADX = DX 의 Wilder 평활 (첫 값: 2n−1 번째 봉)
 */
export function adx(b: Bars, n = 14): AdxResult {
  const len = b.c.length;
  const tr = nulls(len);
  const pdm = nulls(len);
  const mdm = nulls(len);
  for (let i = 1; i < len; i++) {
    if (!validBar(b, i) || !validBar(b, i - 1)) continue;
    const up = b.h[i] - b.h[i - 1];
    const dn = b.l[i - 1] - b.l[i];
    pdm[i] = up > dn && up > 0 ? up : 0;
    mdm[i] = dn > up && dn > 0 ? dn : 0;
    tr[i] = Math.max(b.h[i] - b.l[i], Math.abs(b.h[i] - b.c[i - 1]), Math.abs(b.l[i] - b.c[i - 1]));
  }
  // Wilder 원래 방식: 합계로 시작해 S_t = S_(t−1) − S_(t−1)/n + x_t (비율은 RMA 와 같음)
  const sTr = rma(tr, n);
  const sP = rma(pdm, n);
  const sM = rma(mdm, n);
  const plusDI = nulls(len);
  const minusDI = nulls(len);
  const dx = nulls(len);
  for (let i = 0; i < len; i++) {
    if (sTr[i] === null || sP[i] === null || sM[i] === null || !((sTr[i] as number) > 0)) continue;
    const p = (100 * (sP[i] as number)) / (sTr[i] as number);
    const m = (100 * (sM[i] as number)) / (sTr[i] as number);
    plusDI[i] = p;
    minusDI[i] = m;
    dx[i] = p + m > 0 ? (100 * Math.abs(p - m)) / (p + m) : null;
  }
  return { plusDI, minusDI, adx: rma(dx, n) };
}

export interface IchimokuResult {
  tenkan: Series;
  kijun: Series;
  /** 선행스팬 A·B: i 번째 자리 값 = (i − 이동폭) 번째 봉에서 계산한 값 (앞으로 그리는 선을 지금 위치에 맞춘 것 — 미래 정보 없음) */
  spanA: Series;
  spanB: Series;
  /** 후행스팬: i 번째 자리 = (i + 이동폭) 번째 종가 — 표시 전용. 백테스트에 쓰면 미래 정보가 된다 */
  chikou: Series;
}

/** 일목균형표 (전환 9, 기준 26, 선행B 52, 이동 26) — 중간값 = (최고가 + 최저가) ÷ 2 */
export function ichimoku(b: Bars, conv = 9, base = 26, spanB = 52, shift = 26): IchimokuResult {
  const mid = (n: number) => {
    const hh = highest(b.h, n);
    const ll = lowest(b.l, n);
    return hh.map((h, i) => (h !== null && ll[i] !== null ? (h + (ll[i] as number)) / 2 : null));
  };
  const tenkan = mid(conv);
  const kijun = mid(base);
  const a = tenkan.map((t, i) => (t !== null && kijun[i] !== null ? (t + (kijun[i] as number)) / 2 : null));
  const bb = mid(spanB);
  const len = b.c.length;
  const shiftF = (x: Series): Series => Array.from({ length: len }, (_, i) => (i - shift >= 0 ? x[i - shift] : null));
  const chikou = Array.from({ length: len }, (_, i) => (i + shift < len && ok(b.c[i + shift]) ? b.c[i + shift] : null));
  return { tenkan, kijun, spanA: shiftF(a), spanB: shiftF(bb), chikou };
}

export interface SupertrendResult {
  line: Series;
  /** 1 = 상승 추세(선이 가격 아래), −1 = 하락 추세 */
  dir: Series;
}

/**
 * Supertrend(ATR n, 배수 m): 기본 밴드 = (고+저)/2 ± m×ATR.
 * 최종 상단 = 기본 상단이 이전 최종 상단보다 낮거나 전일 종가가 이전 최종 상단 위면 기본 상단, 아니면 이전 값 (하단은 반대).
 * 하락 추세에서 종가가 (이번 봉) 최종 상단을 넘으면 상승, 상승 추세에서 최종 하단 아래면 하락. 첫 값: ATR 첫 값 위치(하락으로 시작).
 */
export function supertrend(b: Bars, n = 10, m = 3): SupertrendResult {
  const a = atr(b, n);
  const len = b.c.length;
  const line = nulls(len);
  const dir = nulls(len);
  let fu: number | null = null;
  let fl: number | null = null;
  let d = -1;
  for (let i = 0; i < len; i++) {
    if (a[i] === null || !validBar(b, i)) {
      fu = fl = null;
      continue;
    }
    const hl2 = (b.h[i] + b.l[i]) / 2;
    const bu = hl2 + m * (a[i] as number);
    const bl = hl2 - m * (a[i] as number);
    const pc = i > 0 && ok(b.c[i - 1]) ? b.c[i - 1] : null;
    if (fu === null || fl === null || pc === null) {
      fu = bu;
      fl = bl;
      d = -1;
    } else {
      const nu: number = bu < fu || pc > fu ? bu : fu;
      const nl: number = bl > fl || pc < fl ? bl : fl;
      // 방향은 이번 봉의 최종 밴드와 비교 (TradingView ta.supertrend 와 같은 순서)
      if (d === -1) d = b.c[i] > nu ? 1 : -1;
      else d = b.c[i] < nl ? -1 : 1;
      fu = nu;
      fl = nl;
    }
    line[i] = d === 1 ? fl : fu;
    dir[i] = d;
  }
  return { line, dir };
}

// ───────────────────────────── 모멘텀 ─────────────────────────────

/**
 * RSI(n) — Wilder 평활. 첫 값: n 번째 (처음 n 개 변화의 평균 상승·하락).
 * 평균 하락 0 → 100, 평균 상승 0 → 0, 둘 다 0(가격 변화 없음) → null(정의되지 않음).
 */
export function rsi(c: number[], n = 14): Series {
  const len = c.length;
  const out = nulls(len);
  let ag = 0;
  let al = 0;
  let cnt = 0;
  let seeded = false;
  for (let i = 1; i < len; i++) {
    if (!ok(c[i]) || !ok(c[i - 1])) {
      ag = al = 0;
      cnt = 0;
      seeded = false;
      continue;
    }
    const d = c[i] - c[i - 1];
    const g = Math.max(d, 0);
    const l = Math.max(-d, 0);
    if (!seeded) {
      ag += g;
      al += l;
      cnt++;
      if (cnt < n) continue;
      ag /= n;
      al /= n;
      seeded = true;
    } else {
      ag = (ag * (n - 1) + g) / n;
      al = (al * (n - 1) + l) / n;
    }
    out[i] = al === 0 ? (ag === 0 ? null : 100) : ag === 0 ? 0 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

export interface MacdResult {
  macd: Series;
  signal: Series;
  hist: Series;
}

/** MACD = EMA(빠름) − EMA(느림) (첫 값: 느림−1 번째), 시그널 = MACD 의 EMA(시그널) (MACD 첫 값부터 다시 초기화), 히스토그램 = MACD − 시그널 */
export function macd(c: number[], fast = 12, slow = 26, sig = 9): MacdResult {
  const ef = ema(c, fast);
  const es = ema(c, slow);
  const line = c.map((_, i) => (ef[i] !== null && es[i] !== null ? (ef[i] as number) - (es[i] as number) : null));
  const signal = ema(line, sig);
  const hist = line.map((v, i) => (v !== null && signal[i] !== null ? v - (signal[i] as number) : null));
  return { macd: line, signal, hist };
}

export interface StochResult {
  k: Series;
  d: Series;
}

/** 스토캐스틱 (슬로우): 원값 = 100 × (종가 − n봉 최저) ÷ (n봉 최고 − n봉 최저), %K = 원값의 SMA(평활), %D = %K 의 SMA. 최고 = 최저면 null */
export function stochastic(b: Bars, n = 14, smoothK = 3, d = 3): StochResult {
  const hh = highest(b.h, n);
  const ll = lowest(b.l, n);
  const raw = b.c.map((c, i) => (hh[i] !== null && ll[i] !== null && (hh[i] as number) > (ll[i] as number) && ok(c) ? (100 * (c - (ll[i] as number))) / ((hh[i] as number) - (ll[i] as number)) : null));
  const k = bound(smoothK > 1 ? smaS(raw, smoothK) : raw, 0, 100);
  return { k, d: bound(smaS(k, d), 0, 100) };
}

/** 스토캐스틱 RSI: RSI 를 n 봉 최고·최저로 0~100 정규화 → %K = SMA(k), %D = SMA(%K, d). 최고 = 최저면 null */
export function stochRsi(c: number[], rsiLen = 14, n = 14, k = 3, d = 3): StochResult {
  const r = rsi(c, rsiLen);
  const rr = r.map((v) => (v === null ? NaN : v));
  const hh = highest(rr, n);
  const ll = lowest(rr, n);
  const raw = r.map((v, i) => (v !== null && hh[i] !== null && ll[i] !== null && (hh[i] as number) > (ll[i] as number) ? (100 * (v - (ll[i] as number))) / ((hh[i] as number) - (ll[i] as number)) : null));
  const kk = bound(smaS(raw, k), 0, 100);
  return { k: kk, d: bound(smaS(kk, d), 0, 100) };
}

/** ROC(n) = 100 × (종가 ÷ n봉 전 종가 − 1). 첫 값: n 번째 */
export function roc(c: number[], n = 12): Series {
  return c.map((v, i) => (i >= n && ok(v) && ok(c[i - n]) && c[i - n] !== 0 ? 100 * (v / c[i - n] - 1) : null));
}

/** 모멘텀(n) = 종가 − n봉 전 종가. 첫 값: n 번째 */
export function momentum(c: number[], n = 10): Series {
  return c.map((v, i) => (i >= n && ok(v) && ok(c[i - n]) ? v - c[i - n] : null));
}

/** CCI(n) = (TP − SMA(TP)) ÷ (0.015 × 평균 절대 편차), TP = (고+저+종)/3. 편차가 0 이면 null. 첫 값: n−1 번째 */
export function cci(b: Bars, n = 20): Series {
  const tp = b.c.map((_, i) => (validBar(b, i) ? (b.h[i] + b.l[i] + b.c[i]) / 3 : NaN));
  const m = sma(tp, n);
  const out = nulls(tp.length);
  for (let i = n - 1; i < tp.length; i++) {
    if (m[i] === null) continue;
    let md = 0;
    for (let k = i - n + 1; k <= i; k++) md += Math.abs(tp[k] - (m[i] as number));
    md /= n;
    out[i] = md > 0 ? (tp[i] - (m[i] as number)) / (0.015 * md) : null;
  }
  return out;
}

/** Williams %R(n) = −100 × (n봉 최고 − 종가) ÷ (n봉 최고 − n봉 최저). 범위 −100~0, 최고 = 최저면 null */
export function williamsR(b: Bars, n = 14): Series {
  const hh = highest(b.h, n);
  const ll = lowest(b.l, n);
  return b.c.map((c, i) => (hh[i] !== null && ll[i] !== null && (hh[i] as number) > (ll[i] as number) && ok(c) ? (-100 * ((hh[i] as number) - c)) / ((hh[i] as number) - (ll[i] as number)) : null));
}

/** TRIX(n) = 100 × (EMA³_t ÷ EMA³_(t−1) − 1), EMA³ = 종가의 EMA 를 세 번. 시그널 = TRIX 의 EMA(시그널). 첫 값: 3(n−1)+1 번째 */
export function trix(c: number[], n = 15, sig = 9): { trix: Series; signal: Series } {
  const e3 = ema(ema(ema(c, n), n), n);
  const t = e3.map((v, i) => (i > 0 && v !== null && e3[i - 1] !== null && (e3[i - 1] as number) !== 0 ? 100 * (v / (e3[i - 1] as number) - 1) : null));
  return { trix: t, signal: ema(t, sig) };
}

// ───────────────────────────── 변동성 ─────────────────────────────

export interface BandResult {
  mid: Series;
  upper: Series;
  lower: Series;
}

/** 볼린저 밴드(n, k): 중간 = SMA(n), 상·하단 = 중간 ± k × 모집단 표준편차(n). 첫 값: n−1 번째 */
export function bollinger(c: number[], n = 20, k = 2): BandResult & { bandwidth: Series; percentB: Series } {
  const mid = sma(c, n);
  const sd = rollingStd(c, n);
  const upper = mid.map((m, i) => (m !== null && sd[i] !== null ? m + k * (sd[i] as number) : null));
  const lower = mid.map((m, i) => (m !== null && sd[i] !== null ? m - k * (sd[i] as number) : null));
  // 밴드폭(%) = (상단 − 하단) ÷ 중간 × 100, %B = (종가 − 하단) ÷ (상단 − 하단)
  const bandwidth = mid.map((m, i) => (m !== null && m !== 0 && upper[i] !== null ? (((upper[i] as number) - (lower[i] as number)) / m) * 100 : null));
  const percentB = c.map((v, i) => (upper[i] !== null && (upper[i] as number) > (lower[i] as number) && ok(v) ? (v - (lower[i] as number)) / ((upper[i] as number) - (lower[i] as number)) : null));
  return { mid, upper, lower, bandwidth, percentB };
}

/** 역사적 변동성(n): 로그수익률 n 개의 표본 표준편차 × √(연간 봉 수) × 100. 첫 값: n 번째 */
export function historicalVol(c: number[], n = 20, periodsPerYear = 252): Series {
  const lr = c.map((v, i) => (i > 0 && ok(v) && ok(c[i - 1]) && v > 0 && c[i - 1] > 0 ? Math.log(v / c[i - 1]) : NaN));
  const out = nulls(c.length);
  if (n < 2) return out;
  for (let i = n; i < c.length; i++) {
    let s = 0;
    let good = true;
    for (let k = i - n + 1; k <= i; k++) {
      if (!ok(lr[k])) {
        good = false;
        break;
      }
      s += lr[k];
    }
    if (!good) continue;
    const m = s / n;
    let v = 0;
    for (let k = i - n + 1; k <= i; k++) v += (lr[k] - m) ** 2;
    out[i] = Math.sqrt(v / (n - 1)) * Math.sqrt(periodsPerYear) * 100;
  }
  return out;
}

/** 켈트너 채널: 중간 = EMA(종가, n), 상·하단 = 중간 ± 배수 × ATR(atrN) */
export function keltner(b: Bars, n = 20, atrN = 10, mult = 2): BandResult {
  const mid = ema(b.c, n);
  const a = atr(b, atrN);
  return {
    mid,
    upper: mid.map((m, i) => (m !== null && a[i] !== null ? m + mult * (a[i] as number) : null)),
    lower: mid.map((m, i) => (m !== null && a[i] !== null ? m - mult * (a[i] as number) : null)),
  };
}

/** 돈치안 채널(n): 상단 = n봉 최고가, 하단 = n봉 최저가 (현재 봉 포함), 중간 = 평균. 돌파 판단에는 '직전 봉까지'의 채널을 쓴다 */
export function donchian(b: Bars, n = 20): BandResult {
  const upper = highest(b.h, n);
  const lower = lowest(b.l, n);
  return { upper, lower, mid: upper.map((u, i) => (u !== null && lower[i] !== null ? (u + (lower[i] as number)) / 2 : null)) };
}

// ───────────────────────────── 거래량 ─────────────────────────────

/** OBV: 0 에서 시작, 종가 상승 봉은 +거래량, 하락 봉은 −거래량, 같으면 0. 누락이 있으면 그 뒤 0 부터 다시 */
export function obv(c: number[], v: number[]): Series {
  const out = nulls(c.length);
  let acc: number | null = null;
  for (let i = 0; i < c.length; i++) {
    if (!ok(c[i]) || !ok(v[i]) || v[i] < 0) {
      acc = null;
      continue;
    }
    if (acc === null || !ok(c[i - 1])) acc = 0;
    else acc += c[i] > c[i - 1] ? v[i] : c[i] < c[i - 1] ? -v[i] : 0;
    out[i] = acc;
  }
  return out;
}

/** MFI(n): TP = (고+저+종)/3, 자금 흐름 = TP × 거래량. TP 상승 봉은 양, 하락 봉은 음. MFI = 100 − 100 ÷ (1 + 양 합 ÷ 음 합). 음 합 0 → 100, 둘 다 0 → null. 첫 값: n 번째 */
export function mfi(b: Bars & { v: number[] }, n = 14): Series {
  const len = b.c.length;
  const tp = b.c.map((_, i) => (validBar(b, i) ? (b.h[i] + b.l[i] + b.c[i]) / 3 : NaN));
  const pos = new Array<number>(len).fill(NaN);
  const neg = new Array<number>(len).fill(NaN);
  for (let i = 1; i < len; i++) {
    if (!ok(tp[i]) || !ok(tp[i - 1]) || !ok(b.v[i]) || b.v[i] < 0) continue;
    const mf = tp[i] * b.v[i];
    pos[i] = tp[i] > tp[i - 1] ? mf : 0;
    neg[i] = tp[i] < tp[i - 1] ? mf : 0;
  }
  const out = nulls(len);
  for (let i = n; i < len; i++) {
    let p = 0;
    let q = 0;
    let good = true;
    for (let k = i - n + 1; k <= i; k++) {
      if (!ok(pos[k])) {
        good = false;
        break;
      }
      p += pos[k];
      q += neg[k];
    }
    if (!good) continue;
    out[i] = q === 0 ? (p === 0 ? null : 100) : 100 - 100 / (1 + p / q);
  }
  return out;
}

/** 자금 흐름 배수 = ((종−저) − (고−종)) ÷ (고−저), 고 = 저면 0 */
function mfMultiplier(b: Bars, i: number): number {
  const range = b.h[i] - b.l[i];
  return range > 0 ? (b.c[i] - b.l[i] - (b.h[i] - b.c[i])) / range : 0;
}

/** CMF(n) = Σ(배수 × 거래량) ÷ Σ거래량 (n봉). 거래량 합 0 → null. 첫 값: n−1 번째 */
export function cmf(b: Bars & { v: number[] }, n = 20): Series {
  const len = b.c.length;
  const out = nulls(len);
  for (let i = n - 1; i < len; i++) {
    let mfv = 0;
    let vs = 0;
    let good = true;
    for (let k = i - n + 1; k <= i; k++) {
      if (!validBar(b, k) || !ok(b.v[k]) || b.v[k] < 0) {
        good = false;
        break;
      }
      mfv += mfMultiplier(b, k) * b.v[k];
      vs += b.v[k];
    }
    if (good && vs > 0) out[i] = mfv / vs;
  }
  return out;
}

/** 누적/분산선(A/D) = 배수 × 거래량의 누적합. 누락이 있으면 그 뒤 0 부터 다시 */
export function adLine(b: Bars & { v: number[] }): Series {
  const out = nulls(b.c.length);
  let acc: number | null = null;
  for (let i = 0; i < b.c.length; i++) {
    if (!validBar(b, i) || !ok(b.v[i]) || b.v[i] < 0) {
      acc = null;
      continue;
    }
    acc = (acc ?? 0) + mfMultiplier(b, i) * b.v[i];
    out[i] = acc;
  }
  return out;
}

/** 이동 VWAP(n) = Σ(TP × 거래량) ÷ Σ거래량 (n봉, TP = (고+저+종)/3) — 일봉 이상용 */
export function rollingVwap(b: Bars & { v: number[] }, n = 20): Series {
  const len = b.c.length;
  const out = nulls(len);
  for (let i = n - 1; i < len; i++) {
    let pv = 0;
    let vs = 0;
    let good = true;
    for (let k = i - n + 1; k <= i; k++) {
      if (!validBar(b, k) || !ok(b.v[k]) || b.v[k] < 0) {
        good = false;
        break;
      }
      pv += ((b.h[k] + b.l[k] + b.c[k]) / 3) * b.v[k];
      vs += b.v[k];
    }
    if (good && vs > 0) out[i] = pv / vs;
  }
  return out;
}

/** 세션 VWAP: 거래일(sessionKey)이 바뀔 때마다 0 에서 다시 누적 — 분봉용. 거래량 누적 0 이면 null */
export function sessionVwap(b: Bars & { v: number[] }, sessionKey: (i: number) => string): Series {
  const out = nulls(b.c.length);
  let key = "";
  let pv = 0;
  let vs = 0;
  for (let i = 0; i < b.c.length; i++) {
    const k = sessionKey(i);
    if (k !== key) {
      key = k;
      pv = 0;
      vs = 0;
    }
    if (!validBar(b, i) || !ok(b.v[i]) || b.v[i] < 0) continue;
    pv += ((b.h[i] + b.l[i] + b.c[i]) / 3) * b.v[i];
    vs += b.v[i];
    out[i] = vs > 0 ? pv / vs : null;
  }
  return out;
}
