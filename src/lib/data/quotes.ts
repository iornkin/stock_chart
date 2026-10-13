/**
 * 시세 수집·저장·조회
 * 1순위: Yahoo v7 quote (다종목 일괄)
 * 2순위: Yahoo v8 chart 메타데이터 (종목별, crumb 불필요)
 * 3순위: Finnhub /quote (개별 주식, 거래량 미제공)
 */
import { all, run, tx } from "../db";
import { env } from "../env";
import { marketStatus } from "../market-calendar";
import * as yahoo from "../providers/yahoo";
import * as finnhub from "../providers/finnhub";
import { requestJson } from "../http";
import type { Quote } from "../types";

interface QuoteRow {
  symbol: string;
  name: string | null;
  price: number | null;
  change: number | null;
  change_pct: number | null;
  prev_close: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  avg_volume_3m: number | null;
  avg_volume_10d: number | null;
  market_cap: number | null;
  fifty_two_high: number | null;
  fifty_two_low: number | null;
  pre_price: number | null;
  pre_change_pct: number | null;
  post_price: number | null;
  post_change_pct: number | null;
  market_state: string | null;
  exchange: string | null;
  currency: string | null;
  quote_type: string | null;
  market_time: number | null;
  delay_minutes: number | null;
  source: string;
  source_detail: string | null;
  fetched_at: number;
  extra: string | null;
}

function fromRow(r: QuoteRow): Quote {
  let extra = {};
  try {
    extra = r.extra ? JSON.parse(r.extra) : {};
  } catch {
    extra = {};
  }
  return {
    symbol: r.symbol,
    name: r.name,
    price: r.price,
    change: r.change,
    changePct: r.change_pct,
    prevClose: r.prev_close,
    open: r.open,
    high: r.high,
    low: r.low,
    volume: r.volume,
    avgVolume3m: r.avg_volume_3m,
    avgVolume10d: r.avg_volume_10d,
    marketCap: r.market_cap,
    fiftyTwoHigh: r.fifty_two_high,
    fiftyTwoLow: r.fifty_two_low,
    prePrice: r.pre_price,
    preChangePct: r.pre_change_pct,
    postPrice: r.post_price,
    postChangePct: r.post_change_pct,
    marketState: r.market_state,
    exchange: r.exchange,
    currency: r.currency,
    quoteType: r.quote_type,
    marketTime: r.market_time,
    delayMinutes: r.delay_minutes,
    source: r.source,
    sourceDetail: r.source_detail,
    fetchedAt: r.fetched_at,
    extra,
  };
}

export function saveQuotes(quotes: Quote[]) {
  if (!quotes.length) return;
  tx(() => {
    for (const q of quotes) {
      // 새 시세에서 빠진 보조 항목(평균 거래량 등)은 기존 값을 유지한다
      run(
        `INSERT INTO quotes(symbol,name,price,change,change_pct,prev_close,open,high,low,volume,avg_volume_3m,avg_volume_10d,
          market_cap,fifty_two_high,fifty_two_low,pre_price,pre_change_pct,post_price,post_change_pct,market_state,exchange,currency,
          quote_type,market_time,delay_minutes,source,source_detail,fetched_at,extra)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(symbol) DO UPDATE SET
          name=COALESCE(excluded.name, quotes.name), price=excluded.price, change=excluded.change, change_pct=excluded.change_pct,
          prev_close=excluded.prev_close, open=excluded.open, high=excluded.high, low=excluded.low, volume=excluded.volume,
          avg_volume_3m=COALESCE(excluded.avg_volume_3m, quotes.avg_volume_3m), avg_volume_10d=COALESCE(excluded.avg_volume_10d, quotes.avg_volume_10d),
          market_cap=COALESCE(excluded.market_cap, quotes.market_cap), fifty_two_high=COALESCE(excluded.fifty_two_high, quotes.fifty_two_high),
          fifty_two_low=COALESCE(excluded.fifty_two_low, quotes.fifty_two_low), pre_price=excluded.pre_price, pre_change_pct=excluded.pre_change_pct,
          post_price=excluded.post_price, post_change_pct=excluded.post_change_pct, market_state=excluded.market_state,
          exchange=COALESCE(excluded.exchange, quotes.exchange), currency=COALESCE(excluded.currency, quotes.currency),
          quote_type=COALESCE(excluded.quote_type, quotes.quote_type), market_time=excluded.market_time, delay_minutes=excluded.delay_minutes,
          source=excluded.source, source_detail=excluded.source_detail, fetched_at=excluded.fetched_at,
          extra=CASE WHEN excluded.extra = '{}' THEN quotes.extra ELSE excluded.extra END`,
        q.symbol,
        q.name,
        q.price,
        q.change,
        q.changePct,
        q.prevClose,
        q.open,
        q.high,
        q.low,
        q.volume,
        q.avgVolume3m,
        q.avgVolume10d,
        q.marketCap,
        q.fiftyTwoHigh,
        q.fiftyTwoLow,
        q.prePrice,
        q.preChangePct,
        q.postPrice,
        q.postChangePct,
        q.marketState,
        q.exchange,
        q.currency,
        q.quoteType,
        q.marketTime,
        q.delayMinutes,
        q.source,
        q.sourceDetail,
        q.fetchedAt,
        JSON.stringify(Object.fromEntries(Object.entries(q.extra).filter(([, v]) => v !== null && v !== undefined))),
      );
    }
  });
}

export function readQuotes(symbols: string[]): Map<string, Quote> {
  const map = new Map<string, Quote>();
  if (!symbols.length) return map;
  const rows = all<QuoteRow>(`SELECT * FROM quotes WHERE symbol IN (${symbols.map(() => "?").join(",")})`, ...symbols);
  for (const r of rows) map.set(r.symbol, fromRow(r));
  return map;
}

export interface RefreshResult {
  ok: string[];
  failed: { symbol: string; error: string }[];
  sources: Record<string, string>;
}

async function finnhubQuote(symbol: string): Promise<Quote> {
  const j = await requestJson<{ c?: number; d?: number; dp?: number; h?: number; l?: number; o?: number; pc?: number; t?: number }>(
    "finnhub",
    `${env.finnhubBase}/quote?symbol=${encodeURIComponent(symbol)}&token=${env.finnhubKey}`,
  );
  if (!j.c) throw new Error("Finnhub 시세 없음");
  return {
    symbol,
    name: null,
    price: j.c,
    change: j.d ?? null,
    changePct: j.dp ?? null,
    prevClose: j.pc ?? null,
    open: j.o ?? null,
    high: j.h ?? null,
    low: j.l ?? null,
    volume: null,
    avgVolume3m: null,
    avgVolume10d: null,
    marketCap: null,
    fiftyTwoHigh: null,
    fiftyTwoLow: null,
    prePrice: null,
    preChangePct: null,
    postPrice: null,
    postChangePct: null,
    marketState: null,
    exchange: null,
    currency: "USD",
    quoteType: null,
    marketTime: j.t ? j.t * 1000 : null,
    delayMinutes: 0,
    source: "Finnhub",
    sourceDetail: "거래량 미제공",
    fetchedAt: Date.now(),
    extra: {},
  };
}

/** 제공처에서 시세를 새로 받아 저장 */
export async function refreshQuotes(symbols: string[], opts: { maxFallback?: number } = {}): Promise<RefreshResult> {
  const maxFallback = opts.maxFallback ?? Infinity;
  const result: RefreshResult = { ok: [], failed: [], sources: {} };
  const remaining = new Set(symbols);
  const got: Quote[] = [];
  const errors = new Map<string, string>();
  if (env.yahooEnabled) {
    try {
      const qs = await yahoo.fetchQuotes(symbols);
      for (const q of qs) {
        if (q.price === null) continue;
        got.push(q);
        remaining.delete(q.symbol);
      }
    } catch (e) {
      for (const s of remaining) errors.set(s, `Yahoo quote: ${(e as Error).message}`);
    }
    // 일괄 조회 실패분은 종목별 chart 로 보완 (화면 요청에서는 지연을 막기 위해 개수 제한)
    for (const s of [...remaining].slice(0, maxFallback)) {
      try {
        const q = await yahoo.fetchQuoteViaChart(s);
        if (q.price !== null) {
          got.push(q);
          remaining.delete(s);
        }
      } catch (e) {
        errors.set(s, `${errors.get(s) ?? ""} / Yahoo chart: ${(e as Error).message}`);
      }
    }
  }
  if (finnhub.finnhubEnabled()) {
    for (const s of [...remaining]) {
      if (s.startsWith("^") || s.includes("=") || s.includes(".")) continue;
      try {
        got.push(await finnhubQuote(s));
        remaining.delete(s);
      } catch (e) {
        errors.set(s, `${errors.get(s) ?? ""} / Finnhub: ${(e as Error).message}`);
      }
    }
  }
  saveQuotes(got);
  for (const q of got) {
    result.ok.push(q.symbol);
    result.sources[q.symbol] = q.source;
  }
  for (const s of remaining) result.failed.push({ symbol: s, error: errors.get(s) ?? "사용 가능한 데이터 제공처 없음" });
  return result;
}

const inflight = new Map<string, Promise<RefreshResult>>();

/** 화면 표시용 시세 최대 허용 경과 시간 */
export function quoteMaxAgeMs(purpose: "detail" | "list" = "list"): number {
  const st = marketStatus();
  if (st.phase === "regular") return purpose === "detail" ? 60_000 : 5 * 60_000;
  if (st.phase === "pre" || st.phase === "post") return 10 * 60_000;
  return 60 * 60_000;
}

export interface QuoteView extends Quote {
  /** 이 사이트 기준 최신성 */
  freshness: "fresh" | "stale";
  refreshError: string | null;
}

/** DB 시세를 읽고, 오래되었으면(ON_DEMAND_FETCH) 제공처에서 갱신 후 반환 */
export async function getQuotes(symbols: string[], purpose: "detail" | "list" = "list"): Promise<Map<string, QuoteView>> {
  const maxAge = quoteMaxAgeMs(purpose);
  let current = readQuotes(symbols);
  const stale = symbols.filter((s) => {
    const q = current.get(s);
    return !q || Date.now() - q.fetchedAt > maxAge;
  });
  let failures = new Map<string, string>();
  if (stale.length && env.onDemandFetch) {
    const key = stale.slice().sort().join(",");
    let p = inflight.get(key);
    if (!p) {
      p = refreshQuotes(stale, { maxFallback: 8 }).finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    try {
      // 화면 응답이 너무 늦어지지 않도록 최대 8초만 기다리고, 이후에는 저장된 데이터로 표시
      const r = await Promise.race([p, new Promise<null>((res) => setTimeout(() => res(null), 8000))]);
      if (r) failures = new Map(r.failed.map((f) => [f.symbol, f.error]));
    } catch (e) {
      failures = new Map(stale.map((s) => [s, (e as Error).message]));
    }
    current = readQuotes(symbols);
  }
  const out = new Map<string, QuoteView>();
  for (const s of symbols) {
    const q = current.get(s);
    if (!q) continue;
    const isStale = Date.now() - q.fetchedAt > maxAge * 3;
    out.set(s, { ...q, freshness: isStale ? "stale" : "fresh", refreshError: failures.get(s) ?? null });
  }
  return out;
}

/** 실시간/지연 여부 표시 문구 */
export function delayLabel(q: Pick<Quote, "delayMinutes" | "source" | "sourceDetail">): { realtime: boolean; text: string } {
  if (q.delayMinutes === 0) {
    return { realtime: true, text: `제공처 기준 실시간${q.sourceDetail ? ` (${q.sourceDetail})` : ""}` };
  }
  if (q.delayMinutes && q.delayMinutes > 0) return { realtime: false, text: `${q.delayMinutes}분 지연 데이터` };
  return { realtime: false, text: "지연 여부 미확인 (지연 데이터로 간주)" };
}
