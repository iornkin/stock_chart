/**
 * Yahoo Finance (비공식 공개 엔드포인트)
 * - v8 chart: OHLCV(분봉~월봉), 배당·분할 이벤트 — 인증 불필요
 * - v7 quote: 다종목 시세 일괄 조회 — 쿠키+crumb 필요
 * - v10 quoteSummary: 기업 지표·ETF 프로필·편입 종목·실적 일정 — 쿠키+crumb 필요
 * - v1 search: 종목 관련 뉴스 헤드라인
 *
 * 주의: Yahoo 는 공식 API 를 제공하지 않으며 이용약관상 개인적·비상업적 용도로만 사용해야 한다.
 * 엔드포인트 구조가 예고 없이 바뀔 수 있으므로 모든 호출은 실패를 전제로 처리한다.
 */
import { env } from "../env";
import { BROWSER_UA, ProviderError, request, requestJson } from "../http";
import type { Bar, Interval, NewsItem, Quote, Split } from "../types";
import { etDate } from "../time";
import { newsId, safeImageUrl } from "../news-utils";

const P = "yahoo";

let session: { cookie: string; crumb: string; at: number } | null = null;

function parseSetCookie(res: Response): string {
  const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return list
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

/** 쿠키 + crumb 확보 (1시간 캐시) */
export async function getSession(force = false): Promise<{ cookie: string; crumb: string }> {
  if (!force && session && Date.now() - session.at < 3600_000) return session;
  const res = await request(P, env.yahooCookieUrl, {
    headers: { "User-Agent": BROWSER_UA },
    redirect: "manual",
    retries: 1,
    // fc.yahoo.com 은 404 와 함께 쿠키를 내려준다
    acceptStatus: [301, 302, 303, 307, 308, 404],
  });
  const cookie = parseSetCookie(res);
  await res.text().catch(() => "");
  if (!cookie) throw new ProviderError(P, "세션 쿠키를 받지 못했습니다");
  const crumbRes = await request(P, `${env.yahooQuery2}/v1/test/getcrumb`, {
    headers: { "User-Agent": BROWSER_UA, Cookie: cookie },
    retries: 1,
  });
  const crumb = (await crumbRes.text()).trim();
  if (!crumbRes.ok || !crumb || crumb.includes("<") || crumb.length > 64) {
    throw new ProviderError(P, `crumb 발급 실패 (HTTP ${crumbRes.status})`, crumbRes.status);
  }
  session = { cookie, crumb, at: Date.now() };
  return session;
}

async function authedJson<T>(url: string): Promise<T> {
  for (let i = 0; i < 2; i++) {
    const s = await getSession(i > 0);
    const sep = url.includes("?") ? "&" : "?";
    try {
      return await requestJson<T>(P, `${url}${sep}crumb=${encodeURIComponent(s.crumb)}`, {
        headers: { "User-Agent": BROWSER_UA, Cookie: s.cookie },
      });
    } catch (e) {
      if (e instanceof ProviderError && (e.status === 401 || e.status === 403) && i === 0) continue;
      throw e;
    }
  }
  throw new ProviderError(P, "인증 실패");
}

/** {raw, fmt} 형태와 숫자 모두 처리 */
export function rawNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "object" && v !== null && "raw" in v) {
    const r = (v as { raw: unknown }).raw;
    return typeof r === "number" && Number.isFinite(r) ? r : null;
  }
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function rawStr(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "fmt" in v) return String((v as { fmt: unknown }).fmt ?? "") || null;
  return null;
}

// ─────────────────────────────── quote (v7) ───────────────────────────────
interface V7Quote {
  [k: string]: unknown;
  symbol: string;
}

export function normalizeV7Quote(q: V7Quote, fetchedAt: number): Quote {
  const n = (k: string) => rawNum(q[k]);
  const s = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : null);
  const mt = n("regularMarketTime");
  return {
    symbol: q.symbol,
    name: s("longName") ?? s("shortName"),
    price: n("regularMarketPrice"),
    change: n("regularMarketChange"),
    changePct: n("regularMarketChangePercent"),
    prevClose: n("regularMarketPreviousClose"),
    open: n("regularMarketOpen"),
    high: n("regularMarketDayHigh"),
    low: n("regularMarketDayLow"),
    volume: n("regularMarketVolume"),
    avgVolume3m: n("averageDailyVolume3Month"),
    avgVolume10d: n("averageDailyVolume10Day"),
    marketCap: n("marketCap"),
    fiftyTwoHigh: n("fiftyTwoWeekHigh"),
    fiftyTwoLow: n("fiftyTwoWeekLow"),
    prePrice: n("preMarketPrice"),
    preChangePct: n("preMarketChangePercent"),
    postPrice: n("postMarketPrice"),
    postChangePct: n("postMarketChangePercent"),
    marketState: s("marketState"),
    exchange: s("fullExchangeName") ?? s("exchange"),
    currency: s("currency"),
    quoteType: s("quoteType"),
    marketTime: mt ? mt * 1000 : null,
    delayMinutes: n("exchangeDataDelayedBy"),
    source: "Yahoo Finance",
    sourceDetail: s("quoteSourceName"),
    fetchedAt,
    extra: {
      trailingPE: n("trailingPE"),
      forwardPE: n("forwardPE"),
      priceToBook: n("priceToBook"),
      epsTTM: n("epsTrailingTwelveMonths"),
      epsForward: n("epsForward"),
      dividendYield: n("dividendYield"),
      trailingAnnualDividendRate: n("trailingAnnualDividendRate"),
      trailingAnnualDividendYield: n("trailingAnnualDividendYield"),
      sharesOutstanding: n("sharesOutstanding"),
      bookValue: n("bookValue"),
      earningsTimestamp: n("earningsTimestamp"),
      firstTradeDate: n("firstTradeDateMilliseconds"),
    },
  };
}

export async function fetchQuotes(symbols: string[]): Promise<Quote[]> {
  const out: Quote[] = [];
  for (let i = 0; i < symbols.length; i += 40) {
    const chunk = symbols.slice(i, i + 40);
    const url = `${env.yahooQuery1}/v7/finance/quote?symbols=${chunk.map(encodeURIComponent).join(",")}`;
    const json = await authedJson<{ quoteResponse?: { result?: V7Quote[]; error?: unknown } }>(url);
    const now = Date.now();
    for (const q of json.quoteResponse?.result ?? []) {
      if (q && typeof q.symbol === "string") out.push(normalizeV7Quote(q, now));
    }
  }
  return out;
}

// ─────────────────────────────── chart (v8) ───────────────────────────────
export interface ChartResult {
  symbol: string;
  bars: Bar[];
  dividends: { date: string; amount: number }[];
  splits: Split[];
  meta: Record<string, unknown>;
}

interface V8Chart {
  chart?: {
    result?: Array<{
      meta?: Record<string, unknown>;
      timestamp?: number[];
      events?: {
        dividends?: Record<string, { amount?: number; date?: number }>;
        splits?: Record<string, { date?: number; numerator?: number; denominator?: number }>;
      };
      indicators?: {
        quote?: Array<{ open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }>;
        adjclose?: Array<{ adjclose?: (number | null)[] }>;
      };
    }> | null;
    error?: { code?: string; description?: string } | null;
  };
}

export function parseChart(symbol: string, json: V8Chart): ChartResult {
  if (json.chart?.error) {
    throw new ProviderError(P, `chart 오류: ${json.chart.error.description ?? json.chart.error.code}`);
  }
  const r = json.chart?.result?.[0];
  if (!r) throw new ProviderError(P, "chart 결과 없음");
  const ts = r.timestamp ?? [];
  const q = r.indicators?.quote?.[0] ?? {};
  const adj = r.indicators?.adjclose?.[0]?.adjclose;
  const bars: Bar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    const v = q.volume?.[i];
    if (o == null || h == null || l == null || c == null) continue; // 거래 없는 봉은 제외
    bars.push({ t: ts[i], o, h, l, c, v: v ?? 0, ac: adj?.[i] ?? null });
  }
  const dividends = Object.values(r.events?.dividends ?? {})
    .filter((d) => typeof d.amount === "number" && typeof d.date === "number")
    .map((d) => ({ date: etDate((d.date as number) * 1000), amount: d.amount as number }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const splits = Object.values(r.events?.splits ?? {})
    .filter((s) => typeof s.date === "number" && s.numerator && s.denominator)
    .map((s) => ({ symbol, date: etDate((s.date as number) * 1000), numerator: s.numerator as number, denominator: s.denominator as number }));
  return { symbol, bars, dividends, splits, meta: r.meta ?? {} };
}

export async function fetchChart(
  symbol: string,
  interval: Interval,
  range: string,
  opts: { events?: boolean } = {},
): Promise<ChartResult> {
  const params = new URLSearchParams({ interval, includePrePost: "false" });
  const days = /^(\d+)d$/.exec(range);
  if (interval === "60m" && days) {
    // 1시간봉은 'range=730d' 가 상장 2~3년 된 종목에서 422 오류를 내므로 기간을 직접 지정 (최근 729일)
    const now = Math.floor(Date.now() / 1000);
    params.set("period1", String(now - (Number(days[1]) - 1) * 86400));
    params.set("period2", String(now));
  } else if (range === "max") {
    // range=max 는 Yahoo 가 긴 기록을 월봉 등으로 줄여 돌려주므로 시작·끝 시각을 직접 지정한다 (1900-01-01 ~ 현재)
    params.set("period1", "-2208994789");
    params.set("period2", String(Math.floor(Date.now() / 1000)));
  } else params.set("range", range);
  if (opts.events) params.set("events", "div|split");
  const url = `${env.yahooQuery1}/v8/finance/chart/${encodeURIComponent(symbol)}?${params}`;
  const json = await requestJson<V8Chart>(P, url, { headers: { "User-Agent": BROWSER_UA } });
  const res = parseChart(symbol, json);
  // 요청한 간격과 다른 간격의 봉을 저장하지 않는다 (예: 일봉 요청에 월봉 응답)
  const g = typeof res.meta.dataGranularity === "string" ? res.meta.dataGranularity : null;
  const same = (a: string, b: string) => a === b || (a === "60m" && b === "1h") || (a === "1h" && b === "60m");
  if (g && !same(g, interval)) throw new ProviderError(P, `요청한 ${interval} 대신 ${g} 간격 데이터가 반환되어 저장하지 않았습니다`);
  return res;
}

/** v7 quote 실패 시 대체: chart 메타데이터로 시세 구성 (crumb 불필요) */
export async function fetchQuoteViaChart(symbol: string): Promise<Quote> {
  const res = await fetchChart(symbol, "1d", "5d");
  const m = res.meta;
  const now = Date.now();
  const price = rawNum(m.regularMarketPrice);
  const mt = rawNum(m.regularMarketTime);
  const marketDate = mt ? etDate(mt * 1000) : null;
  // 이전 거래일 종가: 마지막 거래 시각의 날짜보다 앞선 마지막 일봉 종가
  let prevClose: number | null = null;
  for (let i = res.bars.length - 1; i >= 0; i--) {
    if (marketDate && etDate(res.bars[i].t * 1000) < marketDate) {
      prevClose = res.bars[i].c;
      break;
    }
  }
  if (prevClose === null) prevClose = rawNum(m.chartPreviousClose);
  const last = res.bars[res.bars.length - 1];
  const sameDay = last && marketDate && etDate(last.t * 1000) === marketDate;
  const change = price !== null && prevClose !== null ? price - prevClose : null;
  return {
    symbol,
    name: (m.longName as string) ?? (m.shortName as string) ?? null,
    price,
    change,
    changePct: change !== null && prevClose ? (change / prevClose) * 100 : null,
    prevClose,
    open: sameDay ? last.o : null,
    high: rawNum(m.regularMarketDayHigh) ?? (sameDay ? last.h : null),
    low: rawNum(m.regularMarketDayLow) ?? (sameDay ? last.l : null),
    volume: rawNum(m.regularMarketVolume) ?? (sameDay ? last.v : null),
    avgVolume3m: null,
    avgVolume10d: null,
    marketCap: null,
    fiftyTwoHigh: rawNum(m.fiftyTwoWeekHigh),
    fiftyTwoLow: rawNum(m.fiftyTwoWeekLow),
    prePrice: null,
    preChangePct: null,
    postPrice: null,
    postChangePct: null,
    marketState: null,
    exchange: (m.fullExchangeName as string) ?? (m.exchangeName as string) ?? null,
    currency: (m.currency as string) ?? null,
    quoteType: (m.instrumentType as string) ?? null,
    marketTime: mt ? mt * 1000 : null,
    delayMinutes: null,
    source: "Yahoo Finance (chart)",
    sourceDetail: null,
    fetchedAt: now,
    extra: { firstTradeDate: rawNum(m.firstTradeDate) },
  };
}

// ─────────────────────────────── quoteSummary (v10) ───────────────────────────────
export async function fetchQuoteSummary(symbol: string, modules: string[]): Promise<Record<string, unknown>> {
  const url = `${env.yahooQuery2}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules.join(",")}&formatted=false&lang=en-US&region=US`;
  const json = await authedJson<{ quoteSummary?: { result?: Record<string, unknown>[]; error?: { description?: string } | null } }>(url);
  if (json.quoteSummary?.error) throw new ProviderError(P, `quoteSummary 오류: ${json.quoteSummary.error.description}`);
  const r = json.quoteSummary?.result?.[0];
  if (!r) throw new ProviderError(P, "quoteSummary 결과 없음");
  return r;
}

export { rawStr };

// ─────────────────────────────── search news (v1) ───────────────────────────────
interface V1Search {
  news?: Array<{
    uuid?: string;
    title?: string;
    publisher?: string;
    link?: string;
    providerPublishTime?: number;
    type?: string;
    relatedTickers?: string[];
    thumbnail?: { resolutions?: { url?: string; width?: number; height?: number; tag?: string }[] };
  }>;
}

/** 목록용으로 알맞은 크기(가로 140~480px)의 썸네일을 고른다 */
function pickThumb(t: { resolutions?: { url?: string; width?: number }[] } | undefined): string | null {
  const rs = (t?.resolutions ?? []).filter((r) => r.url);
  const fit = rs.filter((r) => (r.width ?? 0) >= 140 && (r.width ?? 0) <= 480).sort((a, b) => (a.width ?? 0) - (b.width ?? 0))[0];
  return safeImageUrl((fit ?? rs.sort((a, b) => (a.width ?? 0) - (b.width ?? 0))[0])?.url);
}

export function parseSearchNews(json: V1Search, fetchedAt: number): NewsItem[] {
  const out: NewsItem[] = [];
  for (const n of json.news ?? []) {
    if (!n.title || !n.link || !n.providerPublishTime) continue;
    out.push({
      id: newsId(n.link),
      title: n.title,
      summary: null,
      url: n.link,
      publisher: n.publisher ?? null,
      publishedAt: n.providerPublishTime * 1000,
      provider: "Yahoo Finance",
      fetchedAt,
      related: (n.relatedTickers ?? []).map((t) => t.toUpperCase()),
      image: pickThumb(n.thumbnail),
    });
  }
  return out;
}

export async function searchNews(query: string, count = 12): Promise<NewsItem[]> {
  const params = new URLSearchParams({
    q: query,
    quotesCount: "0",
    newsCount: String(count),
    enableFuzzyQuery: "false",
    lang: "en-US",
    region: "US",
  });
  const json = await requestJson<V1Search>(P, `${env.yahooQuery2}/v1/finance/search?${params}`, {
    headers: { "User-Agent": BROWSER_UA },
    cacheKey: `ysearch:${query}:${count}`,
    cacheTtlMs: 10 * 60_000,
  });
  return parseSearchNews(json, Date.now());
}

/** 인터벌별 Yahoo 허용 조회 범위 */
export const MAX_RANGE: Record<Interval, string> = {
  "1m": "7d",
  "5m": "60d",
  "15m": "60d",
  "30m": "60d",
  "60m": "730d",
  "1d": "max",
  "1wk": "max",
  "1mo": "max",
};
