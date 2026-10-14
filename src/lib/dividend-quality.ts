/**
 * 배당·분배금 품질 비교 (순수 함수, 실제 지급 기록과 일봉 종가만 사용)
 *
 * - 지급 변동성: 최근 3년 안의 정기 지급 최대 12회, 회당 지급액의 변동 계수(표준편차 ÷ 평균).
 *   분기마다 금액이 다른 계절성도 변동으로 잡힌다.
 * - 연간 변화: 1년 전체가 기록된 가장 최근 연도의 합계를 그 전해와 비교 (올해·자료 첫해는 제외).
 * - 1년 가격 수익률 / 총수익률: 같은 기간 일봉 종가 기준. 총수익률은 배당락일 종가로 분배금 재투자.
 * - 분배금 구성(배당·이자·자본이득·원금 반환): 제공처가 회차별 구성 내역을 주지 않으면 추정하지 않고 '미제공'.
 */
import { annualTotals, isRegular, summarizeDividends } from "./dividend-analytics";
import { periodStart, periodStats, sliceFrom, type DailyPoint } from "./performance";
import { addDays } from "./time";
import type { Dividend } from "./types";

export type VolLevel = "작음" | "보통" | "큼";
export const VOL_LEVEL_RULE = "변동 계수 10% 미만 '작음', 10~25% '보통', 25% 이상 '큼' (이 사이트의 구분 기준)";

export interface PaymentVolatility {
  n: number;
  from: string;
  to: string;
  mean: number;
  cvPct: number;
  min: number;
  max: number;
  /** 직전 회차보다 줄어든 횟수 */
  decreases: number;
  level: VolLevel;
}

export function paymentVolatility(divs: Dividend[], asOf: string, maxN = 12): PaymentVolatility | null {
  const reg = divs
    .filter((d) => isRegular(d) && d.exDate <= asOf && d.exDate > addDays(asOf, -3 * 365))
    .sort((a, b) => a.exDate.localeCompare(b.exDate))
    .slice(-maxN);
  if (reg.length < 4) return null;
  const xs = reg.map((d) => d.amount);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (!(mean > 0)) return null;
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / xs.length);
  const cvPct = (sd / mean) * 100;
  let decreases = 0;
  for (let i = 1; i < xs.length; i++) if (xs[i] < xs[i - 1] * (1 - 1e-6)) decreases++;
  return { n: xs.length, from: reg[0].exDate, to: reg[reg.length - 1].exDate, mean, cvPct, min: Math.min(...xs), max: Math.max(...xs), decreases, level: cvPct < 10 ? "작음" : cvPct < 25 ? "보통" : "큼" };
}

export interface DividendQuality {
  symbol: string;
  ttmSum: number;
  ttmCount: number;
  ttmSpecialSum: number;
  ttmYield: number | null;
  latestChangePct: number | null;
  annual: { year: number; sum: number; prevSum: number; changePct: number } | null;
  priceReturn1y: number | null;
  totalReturn1y: number | null;
  returnPeriod: { start: string; end: string } | null;
  volatility: PaymentVolatility | null;
  /** 제공처가 특별·자본이득으로 구분해 준 최근 12개월 지급 건수 (구성 비율은 아님) */
  flaggedTtm: number;
  /** 회차별 구성(배당·이자·자본이득·원금 반환) 자료 — 현재 제공처에서 받지 않음 */
  composition: null;
  lastExDate: string | null;
}

export function dividendQuality(symbol: string, divs: Dividend[], points: DailyPoint[], asOf: string, price: number | null): DividendQuality {
  const sum = summarizeDividends(divs, asOf, price);
  const totals = annualTotals(divs, asOf);
  const lastFull = [...totals].reverse().find((t) => t.yoy !== null);
  const prev = lastFull ? totals.find((t) => t.year === lastFull.year - 1) : undefined;
  const end = points[points.length - 1]?.date;
  const sl = end ? sliceFrom(points, periodStart(end, "1y")) : null;
  const st = sl ? periodStats(sl, divs.map((d) => ({ exDate: d.exDate, amount: d.amount }))) : null;
  const ttmStart = addDays(asOf, -365);
  return {
    symbol,
    ttmSum: sum.ttmSum,
    ttmCount: sum.ttmCount,
    ttmSpecialSum: sum.ttmSpecialSum,
    ttmYield: sum.ttmYield,
    latestChangePct: sum.latestChangePct,
    annual: lastFull && prev && lastFull.yoy !== null ? { year: lastFull.year, sum: lastFull.sum, prevSum: prev.sum, changePct: lastFull.yoy } : null,
    priceReturn1y: st?.priceReturn ?? null,
    totalReturn1y: st?.totalReturnReinvested ?? null,
    returnPeriod: st ? { start: st.start, end: st.end } : null,
    volatility: paymentVolatility(divs, asOf),
    flaggedTtm: divs.filter((d) => d.exDate > ttmStart && d.exDate <= asOf && (d.kind === "special" || d.kind === "capital_gain")).length,
    composition: null,
    lastExDate: sum.latest?.exDate ?? null,
  };
}
