/**
 * 백테스트 재현 확인 코드 (순수 함수)
 * - 같은 설정 + 같은 가격·분배금 기록이면 같은 코드가 나온다. 코드가 같으면 결과도 같아야 한다.
 * - 데이터 코드는 계산 기간 안의 날짜·종가·분배금만으로 만든다 (수집 시각은 넣지 않음).
 * - 암호용 해시가 아니라 '같은 입력인지' 확인하는 용도다 (FNV-1a 32비트).
 */
import type { BacktestConfig } from "./backtest";
import type { PriceSeries } from "./series";

export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** 기간 안의 날짜·종가·분배금 지문 */
export function seriesFingerprint(x: PriceSeries, start: string, end: string): string {
  const parts: string[] = [x.symbol];
  for (let i = 0; i < x.dates.length; i++) if (x.dates[i] >= start && x.dates[i] <= end) parts.push(`${x.dates[i]}:${x.close[i]}`);
  for (const d of x.divs) if (d.ex >= start && d.ex <= end) parts.push(`d${d.ex}:${d.amount}:${d.kind}`);
  return fnv1a(parts.join("|"));
}

/** 설정 지문 (환율 시계열 자체는 빼고 방식만) */
export function configFingerprint(cfg: BacktestConfig): string {
  const { capitalGains, ...rest } = cfg;
  const cg = capitalGains ? { method: capitalGains.method, fixedFx: capitalGains.fixedFx, fx: capitalGains.fx ? "historical" : null } : null;
  const keys = Object.keys(rest).sort() as (keyof typeof rest)[];
  return fnv1a(JSON.stringify([keys.map((k) => [k, rest[k]]), cg]));
}

export function dataFingerprint(symbols: string[], series: Record<string, PriceSeries | undefined>, start: string, end: string): string {
  return fnv1a([...symbols].sort().map((s) => (series[s] ? seriesFingerprint(series[s] as PriceSeries, start, end) : `${s}:none`)).join(","));
}
