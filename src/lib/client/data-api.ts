/**
 * 화면(브라우저)에서 쓰는 데이터 조회.
 * 서버 모드는 /api/* 를, 정적 모드(GitHub Pages)는 빌드 때 저장한 out/data/*.json 을 읽는다.
 */
import { IS_STATIC, staticDataUrl } from "@/lib/static-mode";
import { compareFromInputs, type CompareInput, type CompareResult } from "@/lib/compare-core";
import { digestOf, type BriefingDigest } from "@/lib/briefing/digest";
import type { SymbolBriefing } from "@/lib/briefing/types";
import { decodeSeries, seriesFileKey, type PriceSeries, type SeriesWire } from "@/lib/sim/series";
import type { IncomeInfo } from "@/lib/sim/income";

export async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, IS_STATIC ? { cache: "no-cache" } : undefined);
  let j: unknown = null;
  try {
    j = await r.json();
  } catch {
    /* 404 HTML 등 JSON 이 아닌 응답 */
  }
  if (!r.ok) throw new Error((j as { error?: string } | null)?.error ?? (r.status === 404 ? "데이터 파일이 없습니다 (아직 수집되지 않음)" : `HTTP ${r.status}`));
  if (j === null) throw new Error("응답을 해석하지 못했습니다");
  return j as T;
}

export function chartUrl(symbol: string, interval: string): string {
  return IS_STATIC ? staticDataUrl(`chart/${encodeURIComponent(symbol)}/${interval}.json`) : `/api/chart/${encodeURIComponent(symbol)}?interval=${interval}`;
}

export interface QuotesResponse<Q> {
  quotes: Q[];
  missing: string[];
  serverTime: number;
}

export async function fetchQuotes<Q extends { symbol: string }>(symbols: string[]): Promise<QuotesResponse<Q>> {
  if (!IS_STATIC) return getJson(`/api/quotes?symbols=${encodeURIComponent(symbols.join(","))}`);
  const all = await getJson<QuotesResponse<Q>>(staticDataUrl("quotes.json"));
  const want = new Set(symbols);
  const quotes = all.quotes.filter((q) => want.has(q.symbol));
  const have = new Set(quotes.map((q) => q.symbol));
  return { quotes, missing: symbols.filter((s) => !have.has(s)), serverTime: all.serverTime };
}

/** 종목별 최신 브리핑 요약 (제목·종합 판단·주요 변화) */
export async function fetchDigests(symbols: string[]): Promise<Record<string, BriefingDigest>> {
  if (IS_STATIC) {
    const all = await getJson<Record<string, BriefingDigest>>(staticDataUrl("briefing/latest.json"));
    return Object.fromEntries(symbols.filter((s) => all[s]).map((s) => [s, all[s]]));
  }
  const rs = await Promise.all(symbols.map((s) => getJson<{ scope: string; content: SymbolBriefing }>(`/api/briefing/${s}`).catch(() => null)));
  const out: Record<string, BriefingDigest> = {};
  for (const r of rs) if (r && r.content) out[r.scope] = digestOf(r.content);
  return out;
}

export async function fetchCompare(symbols: string[], period: string): Promise<CompareResult> {
  if (!IS_STATIC) return getJson(`/api/compare?symbols=${symbols.join(",")}&period=${period}`);
  const inputs = await Promise.all(
    symbols.map((s) =>
      getJson<CompareInput>(staticDataUrl(`compare/${encodeURIComponent(s)}.json`)).catch(
        (e): CompareInput => ({ symbol: s, points: [], error: String((e as Error).message ?? e), fetchedAt: null, dividends: [], price: null, expenseRatio: null, expenseSource: null, totalAssets: null }),
      ),
    ),
  );
  return compareFromInputs(inputs, period);
}

export function statusUrl(): string {
  return IS_STATIC ? staticDataUrl("status.json") : "/api/status";
}

const seriesCache = new Map<string, Promise<PriceSeries>>();

/** 백테스트·시뮬레이션용 일봉 종가 + 분배금 (한 번 받은 종목은 페이지에 머무는 동안 재사용) */
export function fetchSeries(symbol: string): Promise<PriceSeries> {
  let p = seriesCache.get(symbol);
  if (!p) {
    const url = IS_STATIC ? staticDataUrl(`series/${seriesFileKey(symbol)}.json`) : `/api/series/${encodeURIComponent(symbol)}`;
    p = getJson<SeriesWire>(url).then(decodeSeries);
    p.catch(() => seriesCache.delete(symbol));
    seriesCache.set(symbol, p);
  }
  return p;
}

export interface IncomeResponse {
  asOf: number;
  items: Record<string, IncomeInfo>;
}

let incomeCache: Promise<IncomeResponse> | null = null;

/** 지원 종목별 배당·분배금 요약 */
export function fetchIncome(): Promise<IncomeResponse> {
  if (!incomeCache) {
    incomeCache = getJson<IncomeResponse>(IS_STATIC ? staticDataUrl("income.json") : "/api/income");
    incomeCache.catch(() => (incomeCache = null));
  }
  return incomeCache;
}
