/**
 * 가격 봉(OHLCV) 데이터 수집·저장·조회
 * 일봉은 상장 이후 전체 기간을 저장해 두고(지표 계산·과거 이동용), 분봉은 제공처 허용 범위만 보관한다.
 */
import { all, get, run, tx } from "../db";
import { env } from "../env";
import { marketStatus } from "../market-calendar";
import * as yahoo from "../providers/yahoo";
import type { Bar, DataMeta, Interval } from "../types";
import { etDate, etToUtc } from "../time";
import { saveYahooDividendsAndSplits } from "./dividends";

export const INTERVALS: Interval[] = ["1m", "5m", "15m", "30m", "60m", "1d", "1wk", "1mo"];

export function isIntraday(i: Interval) {
  return i !== "1d" && i !== "1wk" && i !== "1mo";
}

/** 인터벌별 캐시 유효 시간 */
export function barTtlMs(interval: Interval): number {
  const st = marketStatus();
  const open = st.phase === "regular";
  switch (interval) {
    case "1m":
      return open ? 60_000 : 30 * 60_000;
    case "5m":
      return open ? 2 * 60_000 : 30 * 60_000;
    case "15m":
      return open ? 5 * 60_000 : 60 * 60_000;
    case "30m":
      return open ? 10 * 60_000 : 60 * 60_000;
    case "60m":
      return open ? 15 * 60_000 : 2 * 3600_000;
    case "1d":
      return open ? 10 * 60_000 : 3 * 3600_000;
    default:
      return open ? 60 * 60_000 : 6 * 3600_000;
  }
}

function saveBars(symbol: string, interval: Interval, bars: Bar[], source: string, meta: Record<string, unknown>) {
  tx(() => {
    if (isIntraday(interval)) {
      // 분봉은 제공처가 돌려준 범위로 교체 (부분 봉 갱신 포함)
      if (bars.length) run("DELETE FROM bars WHERE symbol=? AND interval=? AND ts>=?", symbol, interval, bars[0].t);
    }
    for (const b of bars) {
      if (interval === "1d") {
        // 같은 거래일(ET)의 봉은 하나만 남긴다 (제공처가 시각을 달리해 같은 날 봉을 다시 주는 경우)
        const dayStart = Math.floor(etToUtc(etDate(b.t * 1000)) / 1000);
        run("DELETE FROM bars WHERE symbol=? AND interval='1d' AND ts>=? AND ts<? AND ts<>?", symbol, dayStart, dayStart + 86400, b.t);
      }
      run(
        "INSERT INTO bars(symbol, interval, ts, open, high, low, close, volume, adjclose) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(symbol, interval, ts) DO UPDATE SET open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close, volume=excluded.volume, adjclose=excluded.adjclose",
        symbol,
        interval,
        b.t,
        b.o,
        b.h,
        b.l,
        b.c,
        b.v,
        b.ac ?? null,
      );
    }
    run(
      "INSERT INTO bar_meta(symbol, interval, fetched_at, source, first_ts, last_ts, meta) VALUES(?,?,?,?,?,?,?) ON CONFLICT(symbol, interval) DO UPDATE SET fetched_at=excluded.fetched_at, source=excluded.source, first_ts=excluded.first_ts, last_ts=excluded.last_ts, meta=excluded.meta",
      symbol,
      interval,
      Date.now(),
      source,
      bars[0]?.t ?? null,
      bars[bars.length - 1]?.t ?? null,
      JSON.stringify(pickMeta(meta)),
    );
  });
}

function pickMeta(m: Record<string, unknown>) {
  const keys = ["currency", "exchangeName", "fullExchangeName", "instrumentType", "firstTradeDate", "regularMarketTime", "timezone", "longName", "shortName"];
  return Object.fromEntries(keys.filter((k) => m[k] !== undefined).map((k) => [k, m[k]]));
}

export function readBars(symbol: string, interval: Interval, sinceTs?: number): Bar[] {
  const rows = all<{ ts: number; open: number; high: number; low: number; close: number; volume: number; adjclose: number | null }>(
    `SELECT ts, open, high, low, close, volume, adjclose FROM bars WHERE symbol=? AND interval=? ${sinceTs ? "AND ts>=?" : ""} ORDER BY ts`,
    ...(sinceTs ? [symbol, interval, sinceTs] : [symbol, interval]),
  );
  return rows.map((r) => ({ t: r.ts, o: r.open, h: r.high, l: r.low, c: r.close, v: r.volume, ac: r.adjclose }));
}

export function readBarMeta(symbol: string, interval: Interval) {
  return get<{ fetched_at: number; source: string | null; meta: string | null }>(
    "SELECT fetched_at, source, meta FROM bar_meta WHERE symbol=? AND interval=?",
    symbol,
    interval,
  );
}

/** 제공처에서 봉 데이터를 새로 받아 저장 */
export async function refreshBars(symbol: string, interval: Interval): Promise<number> {
  if (!env.yahooEnabled) throw new Error("가격 데이터 제공처(Yahoo)가 비활성화되어 있습니다");
  const existing = readBarMeta(symbol, interval);
  // 일봉: 최초 1회 전체 기간, 이후에는 최근 1년만 갱신 (배당·분할 이벤트 포함)
  let range = yahoo.MAX_RANGE[interval];
  if (interval === "1d" && existing) range = "1y";
  const res = await yahoo.fetchChart(symbol, interval, range, { events: interval === "1d" });
  if (!res.bars.length) throw new Error("가격 데이터가 비어 있습니다");
  // 분할이 새로 감지되면 과거 일봉 전체를 다시 받는다 (분할 조정 가격 일관성 유지)
  if (interval === "1d" && existing && res.splits.some((s) => s.date >= etDate(res.bars[0].t * 1000))) {
    const full = await yahoo.fetchChart(symbol, interval, "max", { events: true });
    run("DELETE FROM bars WHERE symbol=? AND interval='1d'", symbol);
    saveBars(symbol, interval, full.bars, "Yahoo Finance", full.meta);
    saveYahooDividendsAndSplits(symbol, full.dividends, full.splits);
    return full.bars.length;
  }
  saveBars(symbol, interval, res.bars, "Yahoo Finance", res.meta);
  if (interval === "1d") saveYahooDividendsAndSplits(symbol, res.dividends, res.splits);
  return res.bars.length;
}

const inflight = new Map<string, Promise<number>>();

export interface BarsResult {
  bars: Bar[];
  meta: DataMeta;
  instrumentMeta: Record<string, unknown>;
}

/** 저장된 봉을 읽고, 캐시가 만료되었으면 갱신 시도. 실패 시 저장된 과거 데이터를 stale 로 표시해 반환 */
export async function getBars(symbol: string, interval: Interval, opts: { allowFetch?: boolean } = {}): Promise<BarsResult> {
  const allowFetch = opts.allowFetch ?? env.onDemandFetch;
  let meta = readBarMeta(symbol, interval);
  let error: string | null = null;
  const expired = !meta || Date.now() - meta.fetched_at > barTtlMs(interval);
  if (expired && allowFetch) {
    const key = `${symbol}|${interval}`;
    let p = inflight.get(key);
    if (!p) {
      p = refreshBars(symbol, interval).finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    try {
      await p;
    } catch (e) {
      error = (e as Error).message;
    }
    meta = readBarMeta(symbol, interval);
  } else if (expired) {
    error = "캐시 만료 (자동 갱신 대기)";
  }
  const bars = readBars(symbol, interval);
  let instrumentMeta: Record<string, unknown> = {};
  try {
    instrumentMeta = meta?.meta ? JSON.parse(meta.meta) : {};
  } catch {
    instrumentMeta = {};
  }
  return {
    bars,
    meta: {
      source: meta?.source ?? null,
      fetchedAt: meta?.fetched_at ?? null,
      stale: Boolean(error) && bars.length > 0,
      error,
    },
    instrumentMeta,
  };
}

/** 일봉을 ET 날짜 기준 {date, close} 로 변환 */
export function dailyCloses(bars: Bar[]): { date: string; close: number; volume: number; high: number; low: number; open: number }[] {
  return bars.map((b) => ({ date: etDate(b.t * 1000), close: b.c, volume: b.v, high: b.h, low: b.l, open: b.o }));
}
