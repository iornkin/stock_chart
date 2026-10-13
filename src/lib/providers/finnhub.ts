/**
 * Finnhub REST API — API 키 필요 (무료 플랜: 분당 60회)
 * 무료로 사용 가능한 엔드포인트만 사용한다:
 * - company-news (북미 기업), news?category=general (시장 뉴스)
 * - calendar/earnings (실적 발표 일정), stock/metric (기본 재무 지표)
 */
import { env } from "../env";
import { ProviderError, requestJson } from "../http";
import { newsId } from "../news-utils";
import type { NewsItem } from "../types";

const P = "finnhub";

export function finnhubEnabled() {
  return Boolean(env.finnhubKey);
}

function url(path: string, params: Record<string, string>) {
  const q = new URLSearchParams({ ...params, token: env.finnhubKey });
  return `${env.finnhubBase}${path}?${q}`;
}

interface FinnhubNews {
  category?: string;
  datetime?: number;
  headline?: string;
  id?: number;
  related?: string;
  source?: string;
  summary?: string;
  url?: string;
}

export function parseFinnhubNews(rows: FinnhubNews[], fetchedAt: number): NewsItem[] {
  const out: NewsItem[] = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r.headline || !r.url || !r.datetime) continue;
    out.push({
      id: newsId(r.url),
      title: r.headline,
      summary: r.summary?.trim() ? r.summary.trim() : null,
      url: r.url,
      publisher: r.source ?? null,
      publishedAt: r.datetime * 1000,
      provider: "Finnhub",
      fetchedAt,
      related: (r.related ?? "")
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    });
  }
  return out;
}

export async function companyNews(symbol: string, from: string, to: string): Promise<NewsItem[]> {
  if (!finnhubEnabled()) throw new ProviderError(P, "FINNHUB_API_KEY 미설정");
  const rows = await requestJson<FinnhubNews[]>(P, url("/company-news", { symbol, from, to }));
  return parseFinnhubNews(rows, Date.now());
}

export async function generalNews(): Promise<NewsItem[]> {
  if (!finnhubEnabled()) throw new ProviderError(P, "FINNHUB_API_KEY 미설정");
  const rows = await requestJson<FinnhubNews[]>(P, url("/news", { category: "general" }));
  return parseFinnhubNews(rows, Date.now());
}

export interface EarningsRow {
  date: string;
  symbol: string;
  hour: string | null; // bmo(장 시작 전), amc(장 마감 후), dmh(장중)
  epsActual: number | null;
  epsEstimate: number | null;
  revenueActual: number | null;
  revenueEstimate: number | null;
  quarter: number | null;
  year: number | null;
}

export function parseEarnings(json: { earningsCalendar?: Array<Record<string, unknown>> }): EarningsRow[] {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return (json.earningsCalendar ?? [])
    .filter((r) => typeof r.date === "string" && typeof r.symbol === "string")
    .map((r) => ({
      date: r.date as string,
      symbol: (r.symbol as string).toUpperCase(),
      hour: typeof r.hour === "string" && r.hour ? (r.hour as string) : null,
      epsActual: n(r.epsActual),
      epsEstimate: n(r.epsEstimate),
      revenueActual: n(r.revenueActual),
      revenueEstimate: n(r.revenueEstimate),
      quarter: n(r.quarter),
      year: n(r.year),
    }));
}

export async function earningsCalendar(from: string, to: string, symbol?: string): Promise<EarningsRow[]> {
  if (!finnhubEnabled()) throw new ProviderError(P, "FINNHUB_API_KEY 미설정");
  const params: Record<string, string> = { from, to };
  if (symbol) params.symbol = symbol;
  const json = await requestJson<{ earningsCalendar?: Array<Record<string, unknown>> }>(P, url("/calendar/earnings", params));
  return parseEarnings(json);
}

export async function basicMetrics(symbol: string): Promise<Record<string, number | string | null>> {
  if (!finnhubEnabled()) throw new ProviderError(P, "FINNHUB_API_KEY 미설정");
  const json = await requestJson<{ metric?: Record<string, number | string | null> }>(P, url("/stock/metric", { symbol, metric: "all" }));
  return json.metric ?? {};
}
