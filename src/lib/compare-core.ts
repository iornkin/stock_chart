/**
 * 종목 비교 계산 (순수 함수 — 서버와 정적 사이트의 브라우저에서 함께 사용)
 * - 공통 거래일만 사용해 같은 시작일 기준으로 정규화 (시작값 100)
 * - 가격 수익률과 분배금 포함 총수익률(재투자 가정)을 구분
 * - 비교 기간 전체를 덮는 데이터가 없는 종목은 결과에서 제외하고 사유를 알린다
 */
import { getInstrument } from "./instruments";
import { summarizeDividends, FREQUENCY_KO } from "./dividend-analytics";
import { normalizedPrice, periodStart, periodStats, sliceFrom, totalReturnIndex, COMPARE_PERIODS, type PeriodStats } from "./performance";
import type { Dividend } from "./types";

export interface CompareSeries {
  symbol: string;
  price: { date: string; value: number }[];
  total: { date: string; value: number }[];
}

export interface CompareRow {
  symbol: string;
  name: string;
  kind: string;
  stats: PeriodStats | null;
  expenseRatio: number | null;
  expenseSource: string | null;
  totalAssets: number | null;
  ttmYield: number | null;
  frequency: string;
  firstDate: string | null;
  note: string | null;
}

export interface CompareResult {
  period: string;
  periodLabel: string;
  start: string | null;
  end: string | null;
  series: CompareSeries[];
  rows: CompareRow[];
  excluded: { symbol: string; reason: string }[];
  notes: string[];
  dataAsOf: number | null;
}

/** 종목 하나의 비교 입력 (일봉 종가·거래량, 배당, 최신가, ETF 특성) */
export interface CompareInput {
  symbol: string;
  points: { date: string; close: number; volume: number }[];
  error: string | null;
  fetchedAt: number | null;
  dividends: Dividend[];
  price: number | null;
  expenseRatio: number | null;
  expenseSource: string | null;
  totalAssets: number | null;
}

export function compareFromInputs(inputs: CompareInput[], period: string): CompareResult {
  const excluded: { symbol: string; reason: string }[] = [];
  const loaded: CompareInput[] = [];
  for (const i of inputs) {
    if (!i.points.length) excluded.push({ symbol: i.symbol, reason: i.error ?? "가격 데이터 없음" });
    else loaded.push(i);
  }
  const end = loaded.length ? loaded.map((l) => l.points[l.points.length - 1].date).sort()[0] : null;
  const start = end ? periodStart(end, period) : null;
  const usable: CompareInput[] = [];
  for (const l of loaded) {
    const sl = start ? sliceFrom(l.points.map((p) => ({ date: p.date, close: p.close })), start) : null;
    if (!sl) {
      excluded.push({ symbol: l.symbol, reason: `상장일(${l.points[0].date})이 비교 시작일(${start})보다 늦어 기간 전체 데이터가 없습니다` });
      continue;
    }
    usable.push(l);
  }
  // 공통 거래일
  let commonDates: string[] = [];
  usable.forEach((u, i) => {
    const ds = new Set(u.points.map((p) => p.date));
    commonDates = i === 0 ? [...ds] : commonDates.filter((d) => ds.has(d));
  });
  commonDates.sort();
  // 시작일 직전 마지막 공통 거래일부터
  const startIdx = start ? Math.max(0, commonDates.findIndex((d) => d >= start) - 1) : 0;
  const dates = commonDates.slice(startIdx).filter((d) => !end || d <= end);
  const series: CompareSeries[] = [];
  const rows: CompareRow[] = [];
  for (const u of usable) {
    const map = new Map(u.points.map((p) => [p.date, p]));
    const pts = dates.map((d) => ({ date: d, close: (map.get(d) as { close: number }).close }));
    const vols = dates.map((d) => (map.get(d) as { volume: number }).volume);
    const divs = u.dividends.map((d) => ({ exDate: d.exDate, amount: d.amount }));
    series.push({ symbol: u.symbol, price: normalizedPrice(pts), total: totalReturnIndex(pts, divs) });
    const inst = getInstrument(u.symbol);
    const dsum = summarizeDividends(u.dividends, end ?? pts[pts.length - 1]?.date ?? "", u.price ?? pts[pts.length - 1]?.close ?? null);
    rows.push({
      symbol: u.symbol,
      name: inst?.nameKo ?? u.symbol,
      kind: inst?.kind ?? "",
      stats: periodStats(pts, divs, vols),
      expenseRatio: u.expenseRatio,
      expenseSource: u.expenseSource,
      totalAssets: u.totalAssets,
      ttmYield: dsum.ttmYield,
      frequency: FREQUENCY_KO[dsum.frequency.label],
      firstDate: u.points[0]?.date ?? null,
      note: null,
    });
  }
  const notes = [
    "가격 수익률은 분할 조정 종가 기준이며 배당·분배금은 포함하지 않습니다.",
    "총수익률(재투자)은 배당락일 종가로 분배금을 즉시 재투자했다고 가정한 값이며 세금·수수료는 반영하지 않습니다.",
    "총수익률(현금 수령)은 기간 중 받은 분배금을 재투자하지 않고 더한 값입니다.",
    "변동성은 일간 로그수익률의 연환산 표준편차, 최대 낙폭은 기간 중 종가 고점 대비 최대 하락률입니다.",
  ];
  if (dates.length < 20 && usable.length) notes.unshift("공통 거래일이 20일 미만이라 통계의 신뢰도가 낮습니다.");
  return {
    period,
    periodLabel: COMPARE_PERIODS.find((p) => p.key === period)?.label ?? period,
    start: dates[0] ?? start,
    end: dates[dates.length - 1] ?? end,
    series,
    rows,
    excluded,
    notes,
    dataAsOf: loaded.length ? Math.min(...loaded.map((l) => l.fetchedAt ?? 0)) : null,
  };
}
