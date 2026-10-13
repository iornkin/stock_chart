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
