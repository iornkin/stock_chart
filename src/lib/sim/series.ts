/**
 * 백테스트·시뮬레이션용 일봉 시계열 (서버·브라우저 공용, 순수 함수)
 *
 * - close: 주식분할만 반영한 종가 (분배금은 빼거나 더하지 않은 실제 거래 가격)
 * - divs: 배당락일·지급일·주당 지급액 (현재 주식 수 기준으로 분할 조정)
 * → 총수익률은 '가격 + 분배금 현금'을 한 번씩만 더해 계산한다. 수정주가(adjclose)와 분배금을 함께 쓰면 이중 계산이 된다.
 *
 * 전송 형식(SeriesWire)은 날짜를 '첫 날짜 + 다음 거래일까지의 일수'로 줄여 파일 크기를 줄인다.
 */
import { addDays } from "@/lib/time";

export type SeriesKind = "stock" | "etf" | "market";

export interface SeriesDiv {
  ex: string;
  pay: string | null;
  amount: number;
  /** regular | special | capital_gain | unknown */
  kind: string;
}

export interface PriceSeries {
  symbol: string;
  kind: SeriesKind;
  dates: string[];
  close: number[];
  divs: SeriesDiv[];
  source: string | null;
  fetchedAt: number | null;
  error?: string;
}

export interface SeriesWire {
  symbol: string;
  kind: SeriesKind;
  start: string | null;
  gaps: number[];
  close: number[];
  divs: [string, string | null, number, string][];
  source: string | null;
  fetchedAt: number | null;
  error?: string;
}

const sig = (v: number) => Number(v.toPrecision(8));

export function encodeSeries(s: PriceSeries): SeriesWire {
  const gaps: number[] = [];
  for (let i = 1; i < s.dates.length; i++) gaps.push(Math.round((Date.parse(s.dates[i]) - Date.parse(s.dates[i - 1])) / 86400000));
  return {
    symbol: s.symbol,
    kind: s.kind,
    start: s.dates[0] ?? null,
    gaps,
    close: s.close.map(sig),
    divs: s.divs.map((d) => [d.ex, d.pay, sig(d.amount), d.kind]),
    source: s.source,
    fetchedAt: s.fetchedAt,
    ...(s.error ? { error: s.error } : {}),
  };
}

export function decodeSeries(w: SeriesWire): PriceSeries {
  const dates: string[] = [];
  if (w.start) {
    dates.push(w.start);
    let cur = w.start;
    for (const g of w.gaps) {
      cur = addDays(cur, g);
      dates.push(cur);
    }
  }
  return {
    symbol: w.symbol,
    kind: w.kind,
    dates,
    close: w.close,
    divs: w.divs.map(([ex, pay, amount, kind]) => ({ ex, pay, amount, kind })),
    source: w.source,
    fetchedAt: w.fetchedAt,
    ...(w.error ? { error: w.error } : {}),
  };
}

/** 정적 사이트 파일 이름 (^GSPC, KRW=X 같은 기호를 안전한 문자로) */
export function seriesFileKey(symbol: string): string {
  return symbol.replace(/[^A-Za-z0-9.-]/g, "_");
}

export function firstDate(s: PriceSeries): string | null {
  return s.dates[0] ?? null;
}

export function lastDate(s: PriceSeries): string | null {
  return s.dates[s.dates.length - 1] ?? null;
}

/** date 이하인 마지막 거래일의 위치 (없으면 -1) */
export function indexOnOrBefore(dates: string[], date: string): number {
  let lo = 0;
  let hi = dates.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] <= date) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** date 이상인 첫 거래일의 위치 (없으면 -1) */
export function indexOnOrAfter(dates: string[], date: string): number {
  let lo = 0;
  let hi = dates.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] >= date) {
      ans = mid;
      hi = mid - 1;
    } else lo = mid + 1;
  }
  return ans;
}

/** 해당 날짜(또는 그 이전 마지막 거래일)의 종가 */
export function closeOn(s: PriceSeries, date: string): { date: string; close: number } | null {
  const i = indexOnOrBefore(s.dates, date);
  return i < 0 ? null : { date: s.dates[i], close: s.close[i] };
}

/** 정기 지급(특별·자본이득 제외) 여부 */
export function isRegularDiv(d: SeriesDiv): boolean {
  return d.kind === "regular" || d.kind === "unknown";
}

/** 기간 (시작일 미포함, 종료일 포함) 안의 배당락 */
export function divsBetween(s: PriceSeries, fromExclusive: string, toInclusive: string): SeriesDiv[] {
  return s.divs.filter((d) => d.ex > fromExclusive && d.ex <= toInclusive);
}

export { addDays };
