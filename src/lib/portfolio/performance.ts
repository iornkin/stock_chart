/**
 * 개인 투자 성과 (거래 내역 기반, 순수 함수)
 *
 * - 시간가중수익률(TWR): 외부 입출금의 크기·시점 영향을 빼고 '고른 종목과 운용'의 성과만 본다.
 *   매일 r = (오늘 평가액 − 오늘 외부 입출금) ÷ 어제 평가액 − 1 을 이어 곱한다. (입출금은 그날 종가 전에 들어온 것으로 본다)
 * - 금액가중수익률(XIRR): 실제로 넣고 뺀 날짜·금액과 지금 평가액으로 구한 연환산 내부수익률. 넣은 시점·금액의 영향이 들어간다.
 * - 외부 입출금(입금·출금·기초 보유)은 원금 이동이지 수익이 아니다. 분배금은 계좌 안의 수익이다.
 * - 벤치마크: 같은 날 같은 금액을 벤치마크(분배금 재투자)에 넣고 뺐다면의 결과.
 */
import { computeLedger, ledgerTimeline, sortTxns } from "./ledger";
import type { Txn } from "./types";
import { indexOnOrAfter, indexOnOrBefore, type PriceSeries } from "@/lib/sim/series";
import { cagrPct, xirrPct, yearsBetween } from "@/lib/sim/metrics";

export interface ExternalFlow {
  date: string;
  /** 계좌로 들어온 돈은 +, 나간 돈은 − (투자자 입장의 반대) */
  amount: number;
  kind: "deposit" | "withdraw" | "opening";
}

export interface BenchmarkResult {
  symbol: string;
  /** 같은 입출금을 벤치마크에 했다면의 평가액 */
  value: number;
  twrPct: number;
  twrAnnualPct: number | null;
  xirrPct: number | null;
}

export interface PersonalPerformance {
  ok: true;
  start: string;
  /** 평가 기준일 (마지막 종가 날짜) */
  end: string;
  years: number;
  deposits: number;
  withdrawals: number;
  openings: number;
  /** 순납입 원금 = 입금 − 출금 + 기초 보유 원가 */
  principal: number;
  /** 기준일 종가로 계산한 총자산 */
  value: number;
  gain: number;
  realized: number;
  unrealized: number;
  dividendsGross: number;
  dividendsTax: number;
  /** 세후 분배금 중 재투자한 금액 / 현금으로 남긴 금액 */
  dividendsReinvested: number;
  dividendsAsCash: number;
  twrPct: number;
  /** 1년 미만이면 연환산하지 않음 */
  twrAnnualPct: number | null;
  xirrPct: number | null;
  /** 총자산 − 순납입 원금 = 평가손익 + 실현손익 + 세후 분배금 (외부 입출금이 수익에 섞이지 않았는지) */
  identityDiff: number;
  benchmark: BenchmarkResult | null;
  flows: ExternalFlow[];
  /** 가격이 빠져 평가하지 못한 날 수 */
  skippedDays: number;
}

export type PerformanceResult = PersonalPerformance | { ok: false; reason: string };

export function externalFlows(txns: Txn[]): ExternalFlow[] {
  const out: ExternalFlow[] = [];
  for (const t of sortTxns(txns)) {
    if (t.type === "deposit" && (t.amount ?? 0) > 0) out.push({ date: t.date, amount: t.amount as number, kind: "deposit" });
    else if (t.type === "withdraw" && (t.amount ?? 0) > 0) out.push({ date: t.date, amount: -(t.amount as number), kind: "withdraw" });
    else if (t.type === "opening" && (t.shares ?? 0) > 0) out.push({ date: t.date, amount: (t.shares as number) * (t.price ?? 0), kind: "opening" });
  }
  return out;
}

/** 시간가중수익률: 날짜별 평가액과 누적 외부 입출금으로 이어 곱하기 */
export function timeWeightedReturn(values: number[], contributed: number[]): number | null {
  if (values.length < 2) return null;
  let growth = 1;
  let used = 0;
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    if (!(prev > 1e-9)) continue; // 전액 출금 뒤 빈 계좌인 날은 건너뜀
    const flow = contributed[i] - contributed[i - 1];
    growth *= (values[i] - flow) / prev;
    used++;
  }
  return used ? (growth - 1) * 100 : null;
}

/** 분배금을 재투자한 총수익 지수 (배당락일 종가에 재투자) */
export function totalReturnIndex(s: PriceSeries): number[] {
  const divByDate = new Map<string, number>();
  for (const d of s.divs) divByDate.set(d.ex, (divByDate.get(d.ex) ?? 0) + d.amount);
  const tri = [1];
  for (let i = 1; i < s.dates.length; i++) tri.push(tri[i - 1] * ((s.close[i] + (divByDate.get(s.dates[i]) ?? 0)) / s.close[i - 1]));
  return tri;
}

/** 같은 외부 입출금을 벤치마크(분배금 재투자)로 했다면 */
export function benchmarkSameFlows(flows: ExternalFlow[], bench: PriceSeries, end: string): BenchmarkResult | null {
  if (!flows.length || bench.dates.length < 2) return null;
  const tri = totalReturnIndex(bench);
  let units = 0;
  for (const f of flows) {
    const i = indexOnOrAfter(bench.dates, f.date);
    if (i < 0 || bench.dates[i] > end) return null;
    units += f.amount / tri[i];
  }
  const iEnd = indexOnOrBefore(bench.dates, end);
  const iStart = indexOnOrAfter(bench.dates, flows[0].date);
  if (iEnd < 0 || iStart < 0 || iEnd <= iStart) return null;
  const value = units * tri[iEnd];
  const twr = (tri[iEnd] / tri[iStart] - 1) * 100;
  const years = yearsBetween(bench.dates[iStart], bench.dates[iEnd]);
  return {
    symbol: bench.symbol,
    value,
    twrPct: twr,
    twrAnnualPct: years >= 1 ? cagrPct(tri[iEnd] / tri[iStart], years) : null,
    xirrPct: xirrPct([...flows.map((f) => ({ date: f.date, amount: -f.amount })), { date: bench.dates[iEnd], amount: value }]),
  };
}

export function personalPerformance(input: {
  txns: Txn[];
  /** 평가에 쓸 거래일 달력 (보통 벤치마크·대표 종목의 일봉 날짜) */
  calendar: string[];
  closeOf: (symbol: string, date: string) => number | null;
  benchmark?: PriceSeries | null;
}): PerformanceResult {
  const { txns, calendar, closeOf } = input;
  const flows = externalFlows(txns);
  if (!txns.length) return { ok: false, reason: "거래 내역이 없습니다." };
  if (!flows.length) return { ok: false, reason: "입금·기초 보유 기록이 없어 투자 원금을 알 수 없습니다. 입금 기록을 먼저 넣으세요." };
  const first = sortTxns(txns)[0].date;
  const cal = calendar.filter((d) => d >= first);
  const tl = ledgerTimeline(txns, cal, closeOf);
  if (tl.dates.length < 2) return { ok: false, reason: "일별 가격으로 평가한 날이 2일보다 적어 수익률을 계산할 수 없습니다. 거래일이 더 쌓이면 계산합니다." };
  const end = tl.dates[tl.dates.length - 1];
  const value = tl.value[tl.value.length - 1];
  // 기준일 종가로 회계 요약 (실현·미실현·분배금)
  const prices: Record<string, number | null> = {};
  for (const t of txns) if (t.symbol) prices[t.symbol] = closeOf(t.symbol, end);
  const l = computeLedger(txns, prices, end);
  const reinvested = l.dividendRecords.filter((d) => d.reinvested).reduce((a, d) => a + d.gross - d.tax, 0);
  const asCash = l.dividendRecords.filter((d) => !d.reinvested).reduce((a, d) => a + d.gross - d.tax, 0);
  const twr = timeWeightedReturn(tl.value, tl.contributed);
  if (twr === null) return { ok: false, reason: "평가할 수 있는 기간이 없습니다." };
  const years = yearsBetween(tl.dates[0], end);
  const flowsIn = flows.filter((f) => f.date <= end);
  const xirr = xirrPct([...flowsIn.map((f) => ({ date: f.date, amount: -f.amount })), { date: end, amount: value }]);
  const gain = value - l.netContributions;
  return {
    ok: true,
    start: tl.dates[0],
    end,
    years,
    deposits: l.deposits,
    withdrawals: l.withdrawals,
    openings: l.netContributions - l.deposits + l.withdrawals,
    principal: l.netContributions,
    value,
    gain,
    realized: l.realized,
    unrealized: l.unrealized,
    dividendsGross: l.dividendsGross,
    dividendsTax: l.dividendsTax,
    dividendsReinvested: reinvested,
    dividendsAsCash: asCash,
    twrPct: twr,
    twrAnnualPct: years >= 1 ? cagrPct(1 + twr / 100, years) : null,
    xirrPct: xirr,
    identityDiff: gain - (l.unrealized + l.realized + l.dividendsNet),
    benchmark: input.benchmark ? benchmarkSameFlows(flowsIn, input.benchmark, end) : null,
    flows: flowsIn,
    skippedDays: cal.filter((d) => d <= end).length - tl.dates.length,
  };
}
