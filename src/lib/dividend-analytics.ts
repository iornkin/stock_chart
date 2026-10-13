/**
 * 배당·분배금 분석 (순수 함수, 서버·클라이언트 공용)
 *
 * 계산 원칙
 * - TTM(최근 12개월) 지급액 = 배당락일이 기준일 이전 365일 이내인 지급액의 합 (실제 지급 기록 기준)
 * - TTM 수익률 = TTM 지급액 ÷ 현재 주가
 * - 최근 지급액 연환산 수익률 = 최근 1회 지급액 × 연간 지급 횟수(지급 주기 판정 결과) ÷ 현재 주가
 *   → 앞으로도 같은 금액이 지급된다는 가정의 '참고용' 수치이며 확정 연간 지급액이 아니다.
 *   → 지급 주기가 불규칙하면 계산하지 않는다.
 * - 특별배당·자본이득 분배는 정기 지급과 분리해서 집계한다.
 */
import type { Dividend } from "./types";
import { addDays, daysBetween } from "./time";

export type FrequencyLabel = "monthly" | "quarterly" | "semiannual" | "annual" | "irregular" | "none";

export const FREQUENCY_KO: Record<FrequencyLabel, string> = {
  monthly: "월별",
  quarterly: "분기별",
  semiannual: "반기별",
  annual: "연간",
  irregular: "기타 / 불규칙",
  none: "지급 기록 없음",
};

const PER_YEAR: Partial<Record<FrequencyLabel, number>> = { monthly: 12, quarterly: 4, semiannual: 2, annual: 1 };

export interface FrequencyResult {
  label: FrequencyLabel;
  perYear: number | null;
  medianGapDays: number | null;
  sampleSize: number;
  basis: string;
  /** 데이터 제공처(Polygon)가 밝힌 지급 주기 (있을 때) */
  reportedPerYear: number | null;
  consistentWithReported: boolean | null;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function isRegular(d: Dividend) {
  return d.kind === "regular" || d.kind === "unknown";
}

/** 실제 지급 기록(최근 최대 24개월)으로 지급 주기 판정 */
export function inferFrequency(divs: Dividend[], asOf: string): FrequencyResult {
  const regular = divs
    .filter(isRegular)
    .filter((d) => d.exDate <= asOf && d.exDate > addDays(asOf, -760))
    .sort((a, b) => a.exDate.localeCompare(b.exDate));
  const reported = [...divs].reverse().find((d) => d.frequencyReported)?.frequencyReported ?? null;
  const gaps: number[] = [];
  for (let i = 1; i < regular.length; i++) gaps.push(daysBetween(regular[i - 1].exDate, regular[i].exDate));
  const med = median(gaps);
  let label: FrequencyLabel = "none";
  if (regular.length === 0) label = "none";
  else if (regular.length < 3 && !(regular.length === 2 && med !== null && med >= 340)) label = "irregular";
  else if (med === null) label = "irregular";
  else if (med >= 25 && med <= 36) label = "monthly";
  else if (med >= 80 && med <= 100) label = "quarterly";
  else if (med >= 165 && med <= 200) label = "semiannual";
  else if (med >= 340 && med <= 390) label = "annual";
  else label = "irregular";
  // 간격의 들쭉날쭉함이 크면 불규칙으로 본다
  if (label !== "none" && label !== "irregular" && med !== null && gaps.length >= 3) {
    const outliers = gaps.filter((g) => Math.abs(g - med) / med > 0.45).length;
    if (outliers / gaps.length > 0.34) label = "irregular";
  }
  const perYear = PER_YEAR[label] ?? null;
  return {
    label,
    perYear,
    medianGapDays: med,
    sampleSize: regular.length,
    basis:
      regular.length === 0
        ? "최근 2년 내 정기 지급 기록 없음"
        : `최근 2년 정기 지급 ${regular.length}회, 배당락일 간격 중앙값 ${med ?? "-"}일`,
    reportedPerYear: reported,
    consistentWithReported: reported && perYear ? reported === perYear : null,
  };
}

export interface DividendSummary {
  count: number;
  latest: Dividend | null;
  previous: Dividend | null;
  latestChangePct: number | null;
  /** 최근 지급액과 1년 전 같은 회차 비교 (월별: 12회 전, 분기별: 4회 전) */
  yoyChangePct: number | null;
  ttmSum: number;
  ttmCount: number;
  ttmSpecialSum: number;
  ttmYield: number | null;
  annualizedLatest: number | null;
  annualizedLatestYield: number | null;
  frequency: FrequencyResult;
  upcoming: Dividend[];
  yearly: { year: number; sum: number; count: number; partial: boolean }[];
  asOf: string;
  price: number | null;
}

export function summarizeDividends(divs: Dividend[], asOf: string, price: number | null): DividendSummary {
  const sorted = [...divs].sort((a, b) => a.exDate.localeCompare(b.exDate));
  const past = sorted.filter((d) => d.exDate <= asOf);
  const upcoming = sorted.filter((d) => d.exDate > asOf);
  const regularPast = past.filter(isRegular);
  const latest = regularPast[regularPast.length - 1] ?? null;
  const previous = regularPast[regularPast.length - 2] ?? null;
  const frequency = inferFrequency(sorted, asOf);
  const ttmStart = addDays(asOf, -365);
  const ttm = past.filter((d) => d.exDate > ttmStart);
  const ttmRegular = ttm.filter(isRegular);
  const ttmSum = ttmRegular.reduce((a, d) => a + d.amount, 0);
  const ttmSpecialSum = ttm.filter((d) => !isRegular(d)).reduce((a, d) => a + d.amount, 0);
  const lookbackN = frequency.perYear ?? 0;
  const yearAgo = lookbackN > 0 ? regularPast[regularPast.length - 1 - lookbackN] : undefined;
  const annualizedLatest = latest && frequency.perYear ? latest.amount * frequency.perYear : null;
  const yearlyMap = new Map<number, { sum: number; count: number }>();
  for (const d of past) {
    const y = Number(d.exDate.slice(0, 4));
    const e = yearlyMap.get(y) ?? { sum: 0, count: 0 };
    e.sum += d.amount;
    e.count += 1;
    yearlyMap.set(y, e);
  }
  const currentYear = Number(asOf.slice(0, 4));
  const yearly = [...yearlyMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, e]) => ({ year, sum: e.sum, count: e.count, partial: year === currentYear }));
  return {
    count: past.length,
    latest,
    previous,
    latestChangePct: latest && previous && previous.amount > 0 ? (latest.amount / previous.amount - 1) * 100 : null,
    yoyChangePct: latest && yearAgo && yearAgo.amount > 0 ? (latest.amount / yearAgo.amount - 1) * 100 : null,
    ttmSum,
    ttmCount: ttmRegular.length,
    ttmSpecialSum,
    ttmYield: price && ttmRegular.length ? (ttmSum / price) * 100 : null,
    annualizedLatest,
    annualizedLatestYield: price && annualizedLatest ? (annualizedLatest / price) * 100 : null,
    frequency,
    upcoming,
    yearly,
    asOf,
    price,
  };
}

/** 분할 비율을 반영해 과거 지급액을 현재 주식 수 기준으로 조정 */
export function splitAdjustFactor(exDate: string, splits: { date: string; numerator: number; denominator: number }[]): number {
  let f = 1;
  for (const s of splits) {
    if (s.date > exDate && s.denominator > 0) f *= s.numerator / s.denominator;
  }
  return f;
}

// ─────────────────────────────── 분배금 분석 확장 ───────────────────────────────

export type PaymentStatus = "paid" | "scheduled" | "ex_passed" | "announced";

/**
 * 지급 상태 (실제 기록과 예정 구분)
 * - paid: 지급일이 지났음 / scheduled: 배당락은 지났고 지급일은 아직 / announced: 발표됐지만 배당락 전
 * - ex_passed: 배당락은 지났지만 지급일 정보가 없음
 */
export function paymentStatus(d: Dividend, today: string): PaymentStatus {
  if (d.exDate > today) return "announced";
  if (!d.payDate) return "ex_passed";
  return d.payDate <= today ? "paid" : "scheduled";
}

export const PAYMENT_STATUS_KO: Record<PaymentStatus, string> = {
  paid: "지급 완료",
  scheduled: "지급 예정 (배당락 지남)",
  announced: "발표됨 (배당락 전)",
  ex_passed: "배당락 지남 · 지급일 미제공",
};

/** 연도별 합계와 전년 대비 증감. 자료 첫해와 올해는 1년 전체가 아닐 수 있어 부분 합계로 표시하고 증감률을 계산하지 않는다 */
export function annualTotals(divs: Dividend[], today: string): { year: number; sum: number; count: number; partial: boolean; yoy: number | null }[] {
  const s = summarizeDividends(divs, today, null).yearly.map((y, i) => ({ ...y, partial: y.partial || i === 0 }));
  return s.map((y, i) => {
    const prev = s[i - 1];
    return { ...y, yoy: !y.partial && prev && !prev.partial && prev.sum > 0 ? (y.sum / prev.sum - 1) * 100 : null };
  });
}

/** 완전한 연도 합계 기준 연평균 증가율 (n년) */
export function annualGrowthRate(totals: { year: number; sum: number; partial: boolean }[], years: number): number | null {
  const full = totals.filter((t) => !t.partial);
  if (full.length < years + 1) return null;
  const a = full[full.length - 1 - years].sum;
  const b = full[full.length - 1].sum;
  if (a <= 0 || b <= 0) return null;
  return (Math.pow(b / a, 1 / years) - 1) * 100;
}

/** 최근 n회 정기 지급의 증감 횟수 */
export function changeTrend(divs: Dividend[], today: string, n = 12): { up: number; down: number; same: number; count: number; firstAmount: number | null; lastAmount: number | null } {
  const reg = divs.filter((d) => isRegular(d) && d.exDate <= today).sort((a, b) => a.exDate.localeCompare(b.exDate)).slice(-(n + 1));
  let up = 0;
  let down = 0;
  let same = 0;
  for (let i = 1; i < reg.length; i++) {
    const r = reg[i].amount / reg[i - 1].amount - 1;
    if (Math.abs(r) < 0.0005) same++;
    else if (r > 0) up++;
    else down++;
  }
  return { up, down, same, count: Math.max(0, reg.length - 1), firstAmount: reg[0]?.amount ?? null, lastAmount: reg[reg.length - 1]?.amount ?? null };
}

/** 최근 24개월 실제 지급의 월별 패턴 (지급일, 없으면 배당락일 기준) — 예측이 아닌 과거 기록 */
export function monthPattern(divs: Dividend[], today: string): { month: number; entries: { ym: string; amount: number; basis: "pay" | "ex" }[] }[] {
  const from = addDays(today, -730);
  const out = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, entries: [] as { ym: string; amount: number; basis: "pay" | "ex" }[] }));
  for (const d of divs) {
    if (d.exDate > today || d.exDate <= from) continue;
    const date = d.payDate ?? d.exDate;
    out[Number(date.slice(5, 7)) - 1].entries.push({ ym: date.slice(0, 7), amount: d.amount, basis: d.payDate ? "pay" : "ex" });
  }
  return out;
}

/**
 * 1년 전과 비교한 TTM 수익률 변화 분해
 * 수익률 = 최근 12개월 분배금 ÷ 가격. 변화 = 가격 효과(분배금이 그대로일 때 가격 변화로 생긴 차이) + 분배금 효과(분배금 변화)
 */
export interface YieldDecomposition {
  asOf: string;
  yearAgo: string;
  priceNow: number;
  priceThen: number;
  ttmNow: number;
  ttmThen: number;
  yieldNow: number;
  yieldThen: number;
  priceEffect: number;
  distributionEffect: number;
}

export function yieldDecomposition(divs: Dividend[], points: { date: string; close: number }[], asOf: string): YieldDecomposition | null {
  if (points.length < 260) return null;
  const sorted = divs.filter(isRegular);
  const lastIdx = points.length - 1;
  const now = points[lastIdx];
  const thenDate = addDays(now.date, -365);
  let ti = -1;
  for (let i = lastIdx; i >= 0; i--) {
    if (points[i].date <= thenDate) {
      ti = i;
      break;
    }
  }
  if (ti < 0) return null;
  const then = points[ti];
  const sumIn = (end: string) => sorted.filter((d) => d.exDate > addDays(end, -365) && d.exDate <= end).reduce((a, d) => a + d.amount, 0);
  const ttmNow = sumIn(now.date);
  const ttmThen = sumIn(then.date);
  if (ttmNow <= 0 || ttmThen <= 0 || sorted[0]?.exDate > addDays(then.date, -330)) return null;
  const yieldNow = (ttmNow / now.close) * 100;
  const yieldThen = (ttmThen / then.close) * 100;
  const priceEffect = (ttmThen / now.close - ttmThen / then.close) * 100;
  const distributionEffect = ((ttmNow - ttmThen) / now.close) * 100;
  return { asOf, yearAgo: then.date, priceNow: now.close, priceThen: then.close, ttmNow, ttmThen, yieldNow, yieldThen, priceEffect, distributionEffect };
}

/** 분기 말 시점별 가격·TTM 분배금·TTM 수익률 (최근 n분기) */
export function ttmYieldHistory(divs: Dividend[], points: { date: string; close: number }[], quarters = 12): { date: string; price: number; ttm: number; yield: number }[] {
  const reg = divs.filter(isRegular);
  const out: { date: string; price: number; ttm: number; yield: number }[] = [];
  if (!points.length) return out;
  const last = points[points.length - 1].date;
  for (let q = quarters - 1; q >= 0; q--) {
    const target = addDays(last, -q * 91);
    let p: { date: string; close: number } | undefined;
    for (let i = points.length - 1; i >= 0; i--) {
      if (points[i].date <= target) {
        p = points[i];
        break;
      }
    }
    if (!p || p.date < addDays(points[0].date, 365)) continue;
    const ttm = reg.filter((d) => d.exDate > addDays(p.date, -365) && d.exDate <= p.date).reduce((a, d) => a + d.amount, 0);
    if (ttm > 0) out.push({ date: p.date, price: p.close, ttm, yield: (ttm / p.close) * 100 });
  }
  return out;
}

/**
 * 성장 비교용 지수 (시작 100): 가격만 / 분배금 재투자 / 분배금 현금 수령(재투자 안 함)
 * 주 단위로 줄여 반환
 */
export function incomeGrowthSeries(points: { date: string; close: number }[], divs: Dividend[]): { dates: string[]; price: number[]; reinvest: number[]; cash: number[] } {
  const out = { dates: [] as string[], price: [] as number[], reinvest: [] as number[], cash: [] as number[] };
  if (points.length < 2) return out;
  const byDate = divs.map((d) => ({ exDate: d.exDate, amount: d.amount })).sort((a, b) => a.exDate.localeCompare(b.exDate));
  const p0 = points[0].close;
  let tr = 100;
  let cash = 0;
  let k = 0;
  while (k < byDate.length && byDate[k].exDate <= points[0].date) k++;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      let div = 0;
      while (k < byDate.length && byDate[k].exDate <= points[i].date) div += byDate[k++].amount;
      tr *= (points[i].close + div) / points[i - 1].close;
      cash += div;
    }
    const last = i === points.length - 1;
    const weekEnd = !last && new Date(`${points[i + 1].date}T00:00:00Z`).getUTCDay() < new Date(`${points[i].date}T00:00:00Z`).getUTCDay();
    if (i === 0 || last || weekEnd) {
      out.dates.push(points[i].date);
      out.price.push(Math.round((points[i].close / p0) * 10000) / 100);
      out.reinvest.push(Math.round(tr * 100) / 100);
      out.cash.push(Math.round(((points[i].close + cash) / p0) * 10000) / 100);
    }
  }
  return out;
}
