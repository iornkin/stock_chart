/**
 * 종목별 배당·분배금 요약 (서버·브라우저 공용, 순수 함수)
 * - 모든 값은 실제 지급 기록에서 계산한다. 앞으로의 금액을 확정값으로 만들지 않는다.
 * - '최근 지급액 연환산'은 같은 금액이 계속된다는 가정의 참고값이며, 실제 최근 12개월 합계와 따로 둔다.
 */
import { FREQUENCY_KO, inferFrequency, paymentStatus, type FrequencyLabel, type PaymentStatus } from "@/lib/dividend-analytics";
import type { Dividend, DividendKind } from "@/lib/types";
import { addDays, isRegularDiv, type SeriesDiv } from "./series";

export interface IncomeInfo {
  symbol: string;
  kind: "stock" | "etf";
  /** 일반 기업 = 배당금, ETF = 분배금 */
  word: "배당금" | "분배금";
  asOf: string;
  price: number | null;
  /** 최근 12개월(배당락일 기준) 정기 지급 합계 — 주당 */
  ttmPerShare: number;
  ttmCount: number;
  /** 최근 12개월 특별·자본이득 분배 — 정기 지급과 별도 */
  ttmSpecialPerShare: number;
  ttmYield: number | null;
  latest: SeriesDiv | null;
  frequency: FrequencyLabel;
  frequencyKo: string;
  perYear: number | null;
  /** 최근 1회 지급액 × 연간 지급 횟수 (가정) */
  annualizedLatest: number | null;
  annualizedLatestYield: number | null;
  /** 최근 12개월 정기 지급액의 월별 비중 (지급일, 없으면 배당락일 기준). 합계 1, 기록 없으면 모두 0 */
  monthWeights: number[];
  /** 발표됐거나 지급 예정인 건 (확정 금액만) */
  upcoming: (SeriesDiv & { status: PaymentStatus })[];
  /** 최근 24개월 실제 기록 */
  recent: SeriesDiv[];
}

export function toDividend(symbol: string, d: SeriesDiv): Dividend {
  return {
    symbol,
    exDate: d.ex,
    amount: d.amount,
    amountRaw: null,
    splitAdjusted: true,
    payDate: d.pay,
    recordDate: null,
    declaredDate: null,
    kind: d.kind as DividendKind,
    frequencyReported: null,
    sources: [],
  };
}

export function incomeInfo(symbol: string, kind: "stock" | "etf", divs: SeriesDiv[], price: number | null, asOf: string): IncomeInfo {
  const sorted = [...divs].sort((a, b) => a.ex.localeCompare(b.ex));
  const past = sorted.filter((d) => d.ex <= asOf);
  const ttmStart = addDays(asOf, -365);
  const ttm = past.filter((d) => d.ex > ttmStart);
  const ttmRegular = ttm.filter(isRegularDiv);
  const ttmPerShare = ttmRegular.reduce((a, d) => a + d.amount, 0);
  const regularPast = past.filter(isRegularDiv);
  const latest = regularPast[regularPast.length - 1] ?? null;
  const freq = inferFrequency(sorted.map((d) => toDividend(symbol, d)), asOf);
  const annualizedLatest = latest && freq.perYear ? latest.amount * freq.perYear : null;
  const monthSum = Array(12).fill(0) as number[];
  for (const d of ttmRegular) monthSum[Number((d.pay ?? d.ex).slice(5, 7)) - 1] += d.amount;
  const total = monthSum.reduce((a, b) => a + b, 0);
  return {
    symbol,
    kind,
    word: kind === "etf" ? "분배금" : "배당금",
    asOf,
    price,
    ttmPerShare,
    ttmCount: ttmRegular.length,
    ttmSpecialPerShare: ttm.filter((d) => !isRegularDiv(d)).reduce((a, d) => a + d.amount, 0),
    ttmYield: price && ttmRegular.length ? (ttmPerShare / price) * 100 : null,
    latest,
    frequency: freq.label,
    frequencyKo: FREQUENCY_KO[freq.label],
    perYear: freq.perYear,
    annualizedLatest,
    annualizedLatestYield: price && annualizedLatest ? (annualizedLatest / price) * 100 : null,
    monthWeights: total > 0 ? monthSum.map((v) => v / total) : monthSum,
    upcoming: sorted
      .filter((d) => d.ex > asOf || (d.pay !== null && d.pay > asOf))
      .map((d) => ({ ...d, status: paymentStatus(toDividend(symbol, d), asOf) })),
    recent: sorted.filter((d) => d.ex > addDays(asOf, -730) && d.ex <= asOf),
  };
}
