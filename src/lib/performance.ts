/**
 * 수익률·변동성·낙폭 계산 (순수 함수, 서버·클라이언트 공용)
 *
 * - 가격 수익률: 분할 조정 종가만 반영 (배당·분배금 제외)
 * - 총수익률(재투자 가정): 배당락일 종가로 분배금을 즉시 재투자했다고 가정. 세금·수수료 미반영.
 * - 총수익률(현금 수령): 기간 중 받은 분배금을 재투자하지 않고 현금으로 합산.
 */
import { maxDrawdown } from "./indicators";

export interface DailyPoint {
  date: string; // YYYY-MM-DD (ET)
  close: number;
}

export interface DivPoint {
  exDate: string;
  amount: number;
}

/** 시작값 100 으로 정규화한 가격 지수 */
export function normalizedPrice(points: DailyPoint[]): { date: string; value: number }[] {
  if (!points.length) return [];
  const base = points[0].close;
  return points.map((p) => ({ date: p.date, value: (p.close / base) * 100 }));
}

/** 분배금 재투자 가정 총수익 지수 (시작값 100) */
export function totalReturnIndex(points: DailyPoint[], divs: DivPoint[]): { date: string; value: number }[] {
  if (!points.length) return [];
  const byDate = new Map<string, number>();
  for (const d of divs) byDate.set(d.exDate, (byDate.get(d.exDate) ?? 0) + d.amount);
  const out = [{ date: points[0].date, value: 100 }];
  let idx = 100;
  for (let i = 1; i < points.length; i++) {
    // 휴장일에 배당락일이 걸린 경우 다음 거래일에 반영
    let div = 0;
    for (const [d, amt] of byDate) if (d > points[i - 1].date && d <= points[i].date) div += amt;
    idx *= (points[i].close + div) / points[i - 1].close;
    out.push({ date: points[i].date, value: idx });
  }
  return out;
}

export interface PeriodStats {
  start: string;
  end: string;
  priceReturn: number;
  totalReturnReinvested: number | null;
  totalReturnCash: number | null;
  distributions: number;
  cagr: number | null;
  volatility: number | null;
  maxDrawdown: number | null;
  avgVolume: number | null;
  days: number;
}

export function periodStats(points: DailyPoint[], divs: DivPoint[] | null, volumes?: number[]): PeriodStats | null {
  if (points.length < 2) return null;
  const first = points[0];
  const lastP = points[points.length - 1];
  const priceReturn = (lastP.close / first.close - 1) * 100;
  let totalReturnReinvested: number | null = null;
  let totalReturnCash: number | null = null;
  let distributions = 0;
  if (divs) {
    const tri = totalReturnIndex(points, divs);
    totalReturnReinvested = tri[tri.length - 1].value - 100;
    distributions = divs.filter((d) => d.exDate > first.date && d.exDate <= lastP.date).reduce((a, d) => a + d.amount, 0);
    totalReturnCash = ((lastP.close + distributions) / first.close - 1) * 100;
  }
  const rets: number[] = [];
  for (let i = 1; i < points.length; i++) rets.push(Math.log(points[i].close / points[i - 1].close));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.length > 1 ? rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1) : 0;
  const years = (Date.parse(lastP.date) - Date.parse(first.date)) / (365.25 * 86400000);
  const growth = divs && totalReturnReinvested !== null ? 1 + totalReturnReinvested / 100 : lastP.close / first.close;
  const dd = maxDrawdown(points.map((p) => p.close));
  return {
    start: first.date,
    end: lastP.date,
    priceReturn,
    totalReturnReinvested,
    totalReturnCash,
    distributions,
    cagr: years >= 1 ? (Math.pow(growth, 1 / years) - 1) * 100 : null,
    volatility: rets.length > 10 ? Math.sqrt(variance) * Math.sqrt(252) * 100 : null,
    maxDrawdown: dd ? dd.mdd * 100 : null,
    avgVolume: volumes && volumes.length ? volumes.reduce((a, b) => a + b, 0) / volumes.length : null,
    days: points.length,
  };
}

export const COMPARE_PERIODS: { key: string; label: string; days: number }[] = [
  { key: "1m", label: "1개월", days: 31 },
  { key: "3m", label: "3개월", days: 92 },
  { key: "6m", label: "6개월", days: 183 },
  { key: "ytd", label: "연초 이후", days: -1 },
  { key: "1y", label: "1년", days: 365 },
  { key: "3y", label: "3년", days: 365 * 3 },
  { key: "5y", label: "5년", days: 365 * 5 },
  { key: "10y", label: "10년", days: 3652 },
];

/** 기간 시작일 계산 (ET 날짜 문자열) */
export function periodStart(endDate: string, key: string): string {
  const p = COMPARE_PERIODS.find((x) => x.key === key);
  if (!p) return endDate;
  if (p.days === -1) return `${endDate.slice(0, 4)}-01-01`;
  const t = Date.parse(`${endDate}T00:00:00Z`) - p.days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/** start 이후(포함) 첫 거래일 기준 슬라이스. 시작 시점 데이터가 없으면 null */
export function sliceFrom(points: DailyPoint[], start: string): DailyPoint[] | null {
  if (!points.length || points[0].date > start) {
    // 상장일이 기간 시작보다 늦어 기간 전체를 덮지 못함
    return null;
  }
  // start 직전 마지막 종가를 기준점으로 사용
  let i = points.findIndex((p) => p.date >= start);
  if (i === -1) return null;
  if (i > 0 && points[i].date > start) i -= 1;
  return points.slice(i);
}
