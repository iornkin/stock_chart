/**
 * 성과·위험 지표 (순수 함수) — 백테스트·전략 검증 공용
 *
 * 공통 정의
 * - 입력: 가치 지수(시간가중, 시작값 아무 양수)와 날짜. 수익률 r_t = V_t ÷ V_(t−1) − 1 (일간, 거래일 기준).
 * - 연환산: 일간 → × 252 (평균), × √252 (표준편차). 월간 → × 12, × √12.
 * - 무위험 수익률: 연 % 를 일간으로 나눠(÷252) 뺀다.
 * - 계산할 수 없으면 0 이 아니라 { value: null, note: 이유 } 를 돌려준다 (데이터 부족·분모 0·거래 없음 등).
 */
import { drawdown, isNegligible, mean, stdev } from "./metrics";

export interface Metric {
  value: number | null;
  note: string | null;
}
const val = (value: number): Metric => (Number.isFinite(value) ? { value, note: null } : { value: null, note: "계산 결과가 숫자가 아님" });
const na = (note: string): Metric => ({ value: null, note });

export const PPY = 252;

export function returnsOf(index: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < index.length; i++) if (index[i - 1] > 0 && Number.isFinite(index[i]) && Number.isFinite(index[i - 1])) out.push(index[i] / index[i - 1] - 1);
  return out;
}

/** 하방 변동성(연, %) = √(평균(min(r − 목표, 0)²)) × √252 × 100. 목표(MAR) 기본 0 — 모든 관측치를 분모로 */
export function downsideDev(rets: number[], marDaily = 0, ppy = PPY): Metric {
  if (rets.length < 20) return na(`수익률 ${rets.length}개 — 20개 이상 필요`);
  const s = rets.reduce((a, r) => a + Math.min(r - marDaily, 0) ** 2, 0) / rets.length;
  return val(Math.sqrt(s) * Math.sqrt(ppy) * 100);
}

/** 소르티노 = (연환산 평균 수익률 − 무위험) ÷ 하방 변동성(연). 하락이 한 번도 없으면 계산하지 않음 */
export function sortino(rets: number[], rfPct: number, ppy = PPY): Metric {
  if (rets.length < 60) return na(`수익률 ${rets.length}개 — 60개 이상 필요`);
  const dd = downsideDev(rets, (rfPct / 100) / ppy, ppy);
  if (dd.value === null) return dd;
  if (dd.value === 0) return na("목표보다 낮은 수익률이 한 번도 없어 분모가 0");
  return val((mean(rets) * ppy - rfPct / 100) / (dd.value / 100));
}

/** 칼마 = 연환산 수익률(CAGR %) ÷ |최대 낙폭 %|. 낙폭 0 이면 계산하지 않음 */
export function calmar(cagrPct: number | null, mddPct: number): Metric {
  if (cagrPct === null) return na("연환산 수익률이 없음 (1년 미만)");
  if (!(mddPct < 0)) return na("낙폭이 없어 분모가 0");
  return val(cagrPct / Math.abs(mddPct));
}

/**
 * 역사적 VaR(신뢰수준, %): 수익률을 오름차순으로 놓고 ⌈(1−신뢰수준)·n⌉ 번째 값의 손실 (양수 = 손실).
 * 예: 95%, n=100 → 5번째로 나쁜 날. 표본이 1÷(1−신뢰수준)×2 개(95% → 40개) 미만이면 계산하지 않음.
 */
/** 하위 꼬리 개수 ⌈(1−신뢰수준)·n⌉ — (1−0.95)×100 = 5.000000000000004 같은 부동소수점 오차로 6이 되지 않게 보정 */
const tailCount = (level: number, n: number) => Math.max(1, Math.ceil((1 - level) * n - 1e-9));

export function historicalVaR(rets: number[], level = 0.95): Metric {
  const need = Math.ceil((1 / (1 - level)) * 2);
  if (rets.length < need) return na(`수익률 ${rets.length}개 — ${need}개 이상 필요`);
  const s = [...rets].sort((a, b) => a - b);
  const k = tailCount(level, s.length);
  return val(-s[k - 1] * 100);
}

/** CVaR(기대 손실, %): VaR 위치까지(하위 ⌈(1−신뢰수준)·n⌉ 개) 수익률의 평균 손실 — 항상 VaR 이상 */
export function cvar(rets: number[], level = 0.95): Metric {
  const need = Math.ceil((1 / (1 - level)) * 2);
  if (rets.length < need) return na(`수익률 ${rets.length}개 — ${need}개 이상 필요`);
  const s = [...rets].sort((a, b) => a - b);
  const k = tailCount(level, s.length);
  return val(-mean(s.slice(0, k)) * 100);
}

export interface Relative {
  beta: Metric;
  /** 젠센 알파 (연, %) = (평균 r − rf) × 252 − 베타 × (평균 b − rf) × 252 */
  alpha: Metric;
  /** 추적 오차 (연, %) = 표준편차(r − b) × √252 */
  trackingError: Metric;
  /** 정보 비율 = 연환산 평균 초과 수익 ÷ 추적 오차 */
  informationRatio: Metric;
  correlation: Metric;
  days: number;
}

/** 벤치마크 대비 (같은 날짜끼리 맞춘 수익률 쌍) */
export function relativeMetrics(rets: number[], bench: number[], rfPct: number, ppy = PPY): Relative {
  const n = Math.min(rets.length, bench.length);
  const base: Relative = { beta: na(""), alpha: na(""), trackingError: na(""), informationRatio: na(""), correlation: na(""), days: n };
  if (n < 60) {
    const m = na(`겹치는 수익률 ${n}개 — 60개 이상 필요`);
    return { ...base, beta: m, alpha: m, trackingError: m, informationRatio: m, correlation: m };
  }
  const r = rets.slice(0, n);
  const b = bench.slice(0, n);
  const mr = mean(r);
  const mb = mean(b);
  let cov = 0;
  let vb = 0;
  let vr = 0;
  for (let i = 0; i < n; i++) {
    cov += (r[i] - mr) * (b[i] - mb);
    vb += (b[i] - mb) ** 2;
    vr += (r[i] - mr) ** 2;
  }
  const rfD = rfPct / 100 / ppy;
  const beta = vb > 0 ? val(cov / vb) : na("벤치마크 변동이 없어 분모가 0");
  const alpha = beta.value !== null ? val(((mr - rfD) - beta.value * (mb - rfD)) * ppy * 100) : beta;
  const diff = r.map((x, i) => x - b[i]);
  const te = stdev(diff) * Math.sqrt(ppy);
  const teZero = isNegligible(te);
  const trackingError = !teZero ? val(te * 100) : na("포트폴리오와 벤치마크가 완전히 같아 0");
  const informationRatio = !teZero ? val((mean(diff) * ppy) / te) : na("추적 오차가 0");
  const correlation = vb > 0 && vr > 0 ? val(cov / Math.sqrt(vb * vr)) : na("변동이 없어 계산 불가");
  return { beta, alpha, trackingError, informationRatio, correlation, days: n };
}

export interface DrawdownStats {
  /** 고점 아래에 있던 가장 긴 기간 (거래일·달력일), 회복 못 했으면 끝까지 */
  longestDays: number;
  longestCalendarDays: number;
  longestFrom: string | null;
  longestTo: string | null;
  longestRecovered: boolean;
  /** 최대 낙폭 저점에서 이전 고점 회복까지 (거래일·달력일) — 회복 못 했으면 null */
  recoveryDays: number | null;
  recoveryCalendarDays: number | null;
  /** 지금 고점 대비 (%) */
  currentDrawdownPct: number;
}

export function drawdownStats(dates: string[], index: number[]): DrawdownStats | null {
  if (index.length < 2) return null;
  const d = drawdown(index);
  let peak = index[0];
  let start = 0;
  let best = { len: 0, from: 0, to: 0, recovered: true };
  for (let i = 1; i < index.length; i++) {
    if (index[i] >= peak) {
      if (i - 1 > start && i - start > best.len) best = { len: i - start, from: start, to: i, recovered: true };
      peak = index[i];
      start = i;
    }
  }
  const last = index.length - 1;
  if (last - start > best.len) best = { len: last - start, from: start, to: last, recovered: false };
  const cal = (a: number, b: number) => Math.round((Date.parse(dates[b]) - Date.parse(dates[a])) / 86400000);
  return {
    longestDays: best.len,
    longestCalendarDays: best.len ? cal(best.from, best.to) : 0,
    longestFrom: best.len ? dates[best.from] : null,
    longestTo: best.len ? dates[best.to] : null,
    longestRecovered: best.recovered,
    recoveryDays: d.recoveryIndex !== null ? d.recoveryIndex - d.troughIndex : null,
    recoveryCalendarDays: d.recoveryIndex !== null ? cal(d.troughIndex, d.recoveryIndex) : null,
    currentDrawdownPct: d.series[d.series.length - 1] ?? 0,
  };
}

export interface PeriodRet {
  key: string;
  retPct: number;
  /** 기간 처음이나 끝이 잘린 기간 (첫·마지막 달/분기/연) */
  partial: boolean;
}

/**
 * 월·분기·연 수익률 (지수 기준, 각 기간 = 기간 마지막 값 ÷ 직전 기간 마지막 값 − 1, 첫 기간은 시작 값 대비).
 * 첫 기간은 시작일이 기간 첫 달 4일 이후면, 마지막 기간은 끝 날짜가 기간 마지막 달 25일 이전이면 '부분 기간'(partial)으로 표시한다.
 */
export function calendarReturns(dates: string[], index: number[], unit: "month" | "quarter" | "year"): PeriodRet[] {
  const keyOf = (d: string) => (unit === "year" ? d.slice(0, 4) : unit === "month" ? d.slice(0, 7) : `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`);
  const firstMonthOf = (m: number) => (unit === "year" ? 1 : unit === "month" ? m : Math.floor((m - 1) / 3) * 3 + 1);
  const lastMonthOf = (m: number) => (unit === "year" ? 12 : unit === "month" ? m : Math.floor((m - 1) / 3) * 3 + 3);
  const startsAtBeginning = (d: string) => Number(d.slice(5, 7)) === firstMonthOf(Number(d.slice(5, 7))) && Number(d.slice(8, 10)) <= 4;
  const endsAtEnd = (d: string) => Number(d.slice(5, 7)) === lastMonthOf(Number(d.slice(5, 7))) && Number(d.slice(8, 10)) >= 25;
  const out: PeriodRet[] = [];
  if (index.length < 2) return out;
  let base = index[0];
  let cur = keyOf(dates[0]);
  let first = dates[0];
  for (let i = 1; i <= dates.length; i++) {
    const k = i < dates.length ? keyOf(dates[i]) : null;
    if (k !== cur) {
      const isFirst = out.length === 0;
      const partial = (isFirst && !startsAtBeginning(first)) || (k === null && !endsAtEnd(dates[i - 1]));
      out.push({ key: cur, retPct: (index[i - 1] / base - 1) * 100, partial });
      base = index[i - 1];
      if (k !== null) {
        cur = k;
        first = dates[i];
      }
    }
  }
  return out;
}

export function worstOf(xs: PeriodRet[], completeOnly = true): PeriodRet | null {
  const ys = completeOnly ? xs.filter((x) => !x.partial) : xs;
  if (!ys.length) return null;
  return ys.reduce((a, b) => (b.retPct < a.retPct ? b : a));
}

export interface RollingPoint {
  date: string;
  retPct: number;
  volPct: number;
  sharpe: number | null;
  mddPct: number;
}

/** 이동 창(window 거래일, 기본 252 = 1년) 수익률·변동성·샤프·최대 낙폭. step 거래일마다 계산 */
export function rolling(dates: string[], index: number[], rfPct: number, window = 252, step = 5): RollingPoint[] {
  const out: RollingPoint[] = [];
  if (index.length <= window) return out;
  for (let e = window; e < index.length; e += step) {
    const s = e - window;
    const seg = index.slice(s, e + 1);
    const r = returnsOf(seg);
    const sd = stdev(r);
    out.push({
      date: dates[e],
      retPct: (index[e] / index[s] - 1) * 100,
      volPct: sd * Math.sqrt(PPY) * 100,
      sharpe: !isNegligible(sd) ? (mean(r) * PPY - rfPct / 100) / (sd * Math.sqrt(PPY)) : null,
      mddPct: drawdown(seg).mddPct,
    });
  }
  return out;
}

export interface RiskReport {
  downsideVolPct: Metric;
  sortino: Metric;
  calmar: Metric;
  var95: Metric;
  cvar95: Metric;
  /** 월간 수익률 기준 VaR (월 데이터 24개 이상) */
  monthlyVar95: Metric;
  dd: DrawdownStats | null;
  worstMonth: PeriodRet | null;
  worstQuarter: PeriodRet | null;
  worstYear: PeriodRet | null;
  bestYear: PeriodRet | null;
  positiveMonthsPct: Metric;
  relative: Relative | null;
  rolling: RollingPoint[];
}

/** 한 번에 계산 (bench 는 같은 날짜의 벤치마크 지수, 없으면 상대 지표 생략) */
export function riskReport(dates: string[], index: number[], opts: { rfPct: number; cagrPct: number | null; mddPct: number; bench?: number[] | null }): RiskReport {
  const r = returnsOf(index);
  const months = calendarReturns(dates, index, "month");
  const fullMonths = months.filter((m) => !m.partial).map((m) => m.retPct / 100);
  const years = calendarReturns(dates, index, "year");
  const fy = years.filter((y) => !y.partial);
  return {
    downsideVolPct: downsideDev(r),
    sortino: sortino(r, opts.rfPct),
    calmar: calmar(opts.cagrPct, opts.mddPct),
    var95: historicalVaR(r, 0.95),
    cvar95: cvar(r, 0.95),
    monthlyVar95: fullMonths.length >= 24 ? monthlyQuantileLoss(fullMonths) : na(`완전한 달 ${fullMonths.length}개 — 24개 이상 필요`),
    dd: drawdownStats(dates, index),
    worstMonth: worstOf(months),
    worstQuarter: worstOf(calendarReturns(dates, index, "quarter")),
    worstYear: worstOf(years),
    bestYear: fy.length ? fy.reduce((a, b) => (b.retPct > a.retPct ? b : a)) : null,
    positiveMonthsPct: fullMonths.length ? val((fullMonths.filter((x) => x > 0).length / fullMonths.length) * 100) : na("완전한 달이 없음"),
    relative: opts.bench && opts.bench.length === index.length ? relativeMetrics(r, returnsOf(opts.bench), opts.rfPct) : null,
    rolling: rolling(dates, index, opts.rfPct),
  };
}

/** 월간 VaR(95%): 완전한 달의 수익률 5% 분위수(선형 보간)의 손실 — 표본이 수십 개라 보간을 쓴다 */
function monthlyQuantileLoss(xs: number[]): Metric {
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * 0.05;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return val(-(s[lo] + (s[hi] - s[lo]) * (pos - lo)) * 100);
}
