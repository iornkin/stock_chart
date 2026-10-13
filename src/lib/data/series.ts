/**
 * 저장된 일봉·분배금으로 백테스트용 시계열과 배당 요약을 만든다 (서버 전용, 네트워크 호출 없음)
 */
import { INSTRUMENTS, MARKET_SYMBOLS } from "@/config/instruments";
import { getInstrument } from "../instruments";
import { etDate } from "../time";
import { readBarMeta, readBars } from "./bars";
import { readDividends } from "./dividends";
import { readQuotes } from "./quotes";
import { incomeInfo, type IncomeInfo } from "../sim/income";
import type { PriceSeries, SeriesDiv } from "../sim/series";

export function seriesSymbols(): string[] {
  return [...INSTRUMENTS.map((i) => i.symbol), ...MARKET_SYMBOLS.map((m) => m.symbol)];
}

function seriesDivs(symbol: string): SeriesDiv[] {
  return readDividends(symbol).map((d) => ({ ex: d.exDate, pay: d.payDate, amount: d.amount, kind: d.kind }));
}

export function buildSeries(symbol: string): PriceSeries {
  const inst = getInstrument(symbol);
  const bars = readBars(symbol, "1d");
  const meta = readBarMeta(symbol, "1d");
  const dates: string[] = [];
  const close: number[] = [];
  for (const b of bars) {
    const d = etDate(b.t * 1000);
    if (!(b.c > 0)) continue;
    if (dates[dates.length - 1] === d) {
      close[close.length - 1] = b.c;
      continue;
    }
    dates.push(d);
    close.push(b.c);
  }
  return {
    symbol,
    kind: inst ? inst.kind : "market",
    dates,
    close,
    divs: inst ? seriesDivs(symbol) : [],
    source: meta?.source ?? null,
    fetchedAt: meta?.fetched_at ?? null,
    ...(dates.length ? {} : { error: "수집된 일봉 데이터가 없습니다" }),
  };
}

/** 지원 종목 전체의 배당·분배금 요약 (현재가는 저장된 최근 시세) */
export function buildIncomeMap(asOf = etDate()): Record<string, IncomeInfo> {
  const quotes = readQuotes(INSTRUMENTS.map((i) => i.symbol));
  const out: Record<string, IncomeInfo> = {};
  for (const i of INSTRUMENTS) {
    out[i.symbol] = incomeInfo(i.symbol, i.kind, seriesDivs(i.symbol), quotes.get(i.symbol)?.price ?? null, asOf);
  }
  return out;
}
