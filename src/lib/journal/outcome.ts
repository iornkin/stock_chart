/**
 * 투자 판단의 사후 결과 (순수 함수, 실제 일봉·분배금 기록만 사용)
 * - 가격 수익률 = 지금 종가 ÷ 당시 가격 − 1
 * - 분배금 포함 수익률 = (지금 종가 + 기록일 이후 배당락 분배금 합) ÷ 당시 가격 − 1 (재투자하지 않았다고 봄)
 * - 최대 하락 = 기록일 이후 가장 낮은 종가 ÷ 당시 가격 − 1 → 감수 손실 기준과 비교
 * 매도·관찰 기록은 '그 뒤 가격이 어떻게 움직였는지'로 본다 (내 수익이 아님).
 */
import { closeOn, type PriceSeries } from "@/lib/sim/series";
import type { JournalEntry } from "./types";

export interface JournalOutcome {
  basePrice: number | null;
  baseDate: string | null;
  lastPrice: number | null;
  lastDate: string | null;
  days: number;
  priceReturnPct: number | null;
  dividendsPerShare: number;
  totalReturnPct: number | null;
  /** 기록일 이후 가장 낮은 종가 기준 (%) */
  maxDrawdownPct: number | null;
  /** 감수 손실 기준을 넘은 적이 있는지 (기준이 없으면 null) */
  breachedMaxLoss: boolean | null;
  reviewDue: boolean;
  error: string | null;
}

export function journalOutcome(e: JournalEntry, s: PriceSeries | undefined, today: string): JournalOutcome {
  const reviewDue = !!e.reviewDate && e.reviewDate <= today;
  const empty = { basePrice: e.price, baseDate: null, lastPrice: null, lastDate: null, days: 0, priceReturnPct: null, dividendsPerShare: 0, totalReturnPct: null, maxDrawdownPct: null, breachedMaxLoss: null, reviewDue };
  if (!s || !s.dates.length) return { ...empty, error: "일별 가격 기록이 없어 계산하지 않았습니다." };
  const base = closeOn(s, e.date);
  if (!base && e.price === null) return { ...empty, error: "기록일의 가격을 찾을 수 없습니다 (상장 전이거나 기록 없음)." };
  const basePrice = e.price ?? (base as { close: number }).close;
  const i0 = s.dates.findIndex((d) => d > e.date);
  const last = s.dates.length - 1;
  const lastPrice = s.close[last];
  const lastDate = s.dates[last];
  if (i0 < 0) return { ...empty, basePrice, baseDate: base?.date ?? e.date, lastPrice, lastDate, error: "기록일 이후 가격 기록이 아직 없습니다." };
  let min = Infinity;
  for (let i = i0; i <= last; i++) min = Math.min(min, s.close[i]);
  const divs = s.divs.filter((d) => d.ex > e.date && d.ex <= lastDate).reduce((a, d) => a + d.amount, 0);
  const maxDd = (min / basePrice - 1) * 100;
  return {
    basePrice,
    baseDate: base?.date ?? e.date,
    lastPrice,
    lastDate,
    days: Math.round((Date.parse(lastDate) - Date.parse(e.date)) / 86400000),
    priceReturnPct: (lastPrice / basePrice - 1) * 100,
    dividendsPerShare: divs,
    totalReturnPct: ((lastPrice + divs) / basePrice - 1) * 100,
    maxDrawdownPct: Math.min(0, maxDd),
    breachedMaxLoss: e.maxLossPct === null ? null : maxDd <= -Math.abs(e.maxLossPct),
    reviewDue,
    error: null,
  };
}
