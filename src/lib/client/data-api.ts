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
import type { ExposureResponse } from "@/lib/exposure-types";
import type { EtfHistoryResponse } from "@/lib/etf-history";

const FETCH_TIMEOUT_MS = 45_000;

export async function getJson<T>(url: string): Promise<T> {
  let r: Response;
  try {
    // 응답이 오래 없으면 끊고 오류로 보여 준다 (무한 로딩 방지)
    r = await fetch(url, { ...(IS_STATIC ? { cache: "no-cache" as const } : {}), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (e) {
    const name = (e as Error)?.name;
    throw new Error(name === "TimeoutError" || name === "AbortError" ? `응답이 ${FETCH_TIMEOUT_MS / 1000}초 넘게 없어 중단했습니다. 네트워크를 확인하고 다시 시도하세요.` : "네트워크 오류로 데이터를 받지 못했습니다.");
  }
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

/** 페이지를 오래 열어 둔 경우 새로 수집된 자료를 다시 받도록 캐시 유효 시간을 둔다 */
const SUMMARY_TTL_MS = 10 * 60_000;
let incomeCache: { at: number; p: Promise<IncomeResponse> } | null = null;

/** 지원 종목별 배당·분배금 요약 */
export function fetchIncome(): Promise<IncomeResponse> {
  if (!incomeCache || Date.now() - incomeCache.at > SUMMARY_TTL_MS) {
    const p = getJson<IncomeResponse>(IS_STATIC ? staticDataUrl("income.json") : "/api/income");
    incomeCache = { at: Date.now(), p };
    p.catch(() => (incomeCache = null));
  }
  return incomeCache.p;
}

let historyCache: { at: number; p: Promise<EtfHistoryResponse> } | null = null;

/** ETF 구성 기록 (이 사이트가 갱신할 때마다 쌓은 기록) */
export function fetchEtfHistory(): Promise<EtfHistoryResponse> {
  if (!historyCache || Date.now() - historyCache.at > SUMMARY_TTL_MS) {
    const p = getJson<EtfHistoryResponse>(IS_STATIC ? staticDataUrl("exposure-history.json") : "/api/exposure/history");
    historyCache = { at: Date.now(), p };
    p.catch(() => (historyCache = null));
  }
  return historyCache.p;
}

let exposureCache: { at: number; p: Promise<ExposureResponse> } | null = null;

/** 지원 종목별 상위 편입 종목·섹터 (내 자산 노출 분석·알림) */
export function fetchExposure(): Promise<ExposureResponse> {
  if (!exposureCache || Date.now() - exposureCache.at > SUMMARY_TTL_MS) {
    const p = getJson<ExposureResponse>(IS_STATIC ? staticDataUrl("exposure.json") : "/api/exposure");
    exposureCache = { at: Date.now(), p };
    p.catch(() => (exposureCache = null));
  }
  return exposureCache.p;
}
