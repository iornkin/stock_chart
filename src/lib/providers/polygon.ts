/**
 * Polygon.io (Massive) REST API — API 키 필요 (무료 플랜: 분당 5회)
 * - v3/reference/dividends: 배당락일·지급일·기준일·선언일·지급 주기·유형
 * - v2/reference/news: 종목 뉴스 (요약 포함)
 */
import { env } from "../env";
import { ProviderError, requestJson } from "../http";
import { newsId, safeImageUrl } from "../news-utils";
import type { NewsItem } from "../types";

const P = "polygon";

export function polygonEnabled() {
  return Boolean(env.polygonKey);
}

export interface PolygonDividend {
  exDate: string;
  amount: number;
  payDate: string | null;
  recordDate: string | null;
  declaredDate: string | null;
  frequency: number | null;
  type: string | null; // CD, SC, LT, ST
}

export function parsePolygonDividends(json: { results?: Array<Record<string, unknown>>; status?: string; error?: string }): PolygonDividend[] {
  if (json.status === "ERROR" || json.error) throw new ProviderError(P, String(json.error ?? "ERROR"));
  return (json.results ?? [])
    .filter((r) => typeof r.ex_dividend_date === "string" && typeof r.cash_amount === "number")
    .map((r) => ({
      exDate: r.ex_dividend_date as string,
      amount: r.cash_amount as number,
      payDate: (r.pay_date as string) ?? null,
      recordDate: (r.record_date as string) ?? null,
      declaredDate: (r.declaration_date as string) ?? null,
      frequency: typeof r.frequency === "number" ? (r.frequency as number) : null,
      type: (r.dividend_type as string) ?? null,
    }));
}

export async function fetchDividends(symbol: string): Promise<PolygonDividend[]> {
  if (!polygonEnabled()) throw new ProviderError(P, "POLYGON_API_KEY 미설정");
  const url = `${env.polygonBase}/v3/reference/dividends?ticker=${encodeURIComponent(symbol)}&limit=1000&order=desc&sort=ex_dividend_date&apiKey=${env.polygonKey}`;
  const json = await requestJson<{ results?: Array<Record<string, unknown>>; status?: string; error?: string }>(P, url);
  return parsePolygonDividends(json);
}

export function parsePolygonNews(json: { results?: Array<Record<string, unknown>> }, fetchedAt: number): NewsItem[] {
  const out: NewsItem[] = [];
  for (const r of json.results ?? []) {
    const url = r.article_url as string;
    const title = r.title as string;
    const pub = Date.parse(String(r.published_utc ?? ""));
    if (!url || !title || !Number.isFinite(pub)) continue;
    const publisher = (r.publisher as { name?: string } | undefined)?.name ?? null;
    out.push({
      id: newsId(url),
      title,
      summary: typeof r.description === "string" ? (r.description as string) : null,
      url,
      publisher,
      publishedAt: pub,
      provider: "Polygon.io",
      fetchedAt,
      image: safeImageUrl(r.image_url),
      related: Array.isArray(r.tickers) ? (r.tickers as string[]).map((t) => t.toUpperCase()) : [],
    });
  }
  return out;
}

export async function fetchNews(symbol: string, limit = 20): Promise<NewsItem[]> {
  if (!polygonEnabled()) throw new ProviderError(P, "POLYGON_API_KEY 미설정");
  const url = `${env.polygonBase}/v2/reference/news?ticker=${encodeURIComponent(symbol)}&limit=${limit}&order=desc&sort=published_utc&apiKey=${env.polygonKey}`;
  const json = await requestJson<{ results?: Array<Record<string, unknown>> }>(P, url);
  return parsePolygonNews(json, Date.now());
}
