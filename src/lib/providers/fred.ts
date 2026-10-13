/**
 * FRED (St. Louis Fed) API — 무료 API 키 필요
 * - 국채금리(DGS10, DGS2), 달러지수(DTWEXBGS) 등 거시 시계열
 * - 경제지표 발표 일정 (releases/dates)
 */
import { env } from "../env";
import { ProviderError, requestJson } from "../http";

const P = "fred";

export function fredEnabled() {
  return Boolean(env.fredKey);
}

export async function fetchObservations(seriesId: string, limit = 60): Promise<{ date: string; value: number }[]> {
  if (!fredEnabled()) throw new ProviderError(P, "FRED_API_KEY 미설정");
  const q = new URLSearchParams({
    series_id: seriesId,
    api_key: env.fredKey,
    file_type: "json",
    sort_order: "desc",
    limit: String(limit),
  });
  const json = await requestJson<{ observations?: { date: string; value: string }[]; error_message?: string }>(
    P,
    `${env.fredBase}/fred/series/observations?${q}`,
  );
  if (json.error_message) throw new ProviderError(P, json.error_message);
  return (json.observations ?? [])
    .filter((o) => o.value !== "." && Number.isFinite(Number(o.value)))
    .map((o) => ({ date: o.date, value: Number(o.value) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface ReleaseDate {
  releaseId: number;
  releaseName: string;
  date: string;
}

export async function fetchReleaseDates(start: string, end: string): Promise<ReleaseDate[]> {
  if (!fredEnabled()) throw new ProviderError(P, "FRED_API_KEY 미설정");
  const q = new URLSearchParams({
    api_key: env.fredKey,
    file_type: "json",
    realtime_start: start,
    realtime_end: end,
    include_release_dates_with_no_data: "true",
    order_by: "release_date",
    sort_order: "asc",
    limit: "1000",
  });
  const json = await requestJson<{ release_dates?: { release_id: number; release_name: string; date: string }[]; error_message?: string }>(
    P,
    `${env.fredBase}/fred/releases/dates?${q}`,
  );
  if (json.error_message) throw new ProviderError(P, json.error_message);
  return (json.release_dates ?? []).map((r) => ({ releaseId: r.release_id, releaseName: r.release_name, date: r.date }));
}

/** 브리핑에 포함할 주요 경제지표 (FRED 발표 명칭 → 한국어) */
export const KEY_RELEASES: { match: RegExp; ko: string; importance: "high" | "medium" }[] = [
  { match: /^Consumer Price Index$/i, ko: "소비자물가지수(CPI)", importance: "high" },
  { match: /^Employment Situation$/i, ko: "고용보고서(비농업 고용·실업률)", importance: "high" },
  { match: /^Gross Domestic Product$/i, ko: "국내총생산(GDP)", importance: "high" },
  { match: /^Personal Income and Outlays$/i, ko: "개인소득·지출(PCE 물가)", importance: "high" },
  { match: /FOMC/i, ko: "FOMC 관련 발표", importance: "high" },
  { match: /^Producer Price Index$/i, ko: "생산자물가지수(PPI)", importance: "medium" },
  { match: /Advance Monthly Sales for Retail/i, ko: "소매판매", importance: "medium" },
  { match: /Job Openings and Labor Turnover/i, ko: "구인·이직 보고서(JOLTS)", importance: "medium" },
  { match: /Unemployment Insurance Weekly Claims/i, ko: "주간 신규 실업수당 청구", importance: "medium" },
  { match: /^Surveys of Consumers$/i, ko: "미시간대 소비자심리지수", importance: "medium" },
];

export const MACRO_SERIES: { id: string; ko: string; unit: string }[] = [
  { id: "DGS10", ko: "미국 10년 국채금리", unit: "%" },
  { id: "DGS2", ko: "미국 2년 국채금리", unit: "%" },
  { id: "DTWEXBGS", ko: "미 달러 지수(광의, 무역가중)", unit: "pt" },
];
