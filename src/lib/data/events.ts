/**
 * 일정 데이터: 실적 발표, 경제지표 발표, (배당 일정은 dividends 테이블에서 직접 조회)
 */
import { all, run, tx } from "../db";
import { allInstruments, allSymbols } from "../instruments";
import * as finnhub from "../providers/finnhub";
import * as fred from "../providers/fred";
import { addDays, etDate } from "../time";
import type { MarketEvent } from "../types";
import { readSnapshot, stockFundamentals, topHoldings } from "./profile";

function saveEvents(events: MarketEvent[], replaceKinds: { kind: string; from: string; to: string; source: string }[]) {
  tx(() => {
    for (const r of replaceKinds) {
      run("DELETE FROM events WHERE kind=? AND source=? AND date BETWEEN ? AND ?", r.kind, r.source, r.from, r.to);
    }
    for (const e of events) {
      run(
        "INSERT INTO events(id, symbol, kind, date, time_hint, title, data, source, fetched_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET date=excluded.date, time_hint=excluded.time_hint, title=excluded.title, data=excluded.data, source=excluded.source, fetched_at=excluded.fetched_at",
        e.id,
        e.symbol,
        e.kind,
        e.date,
        e.timeHint,
        e.title,
        e.data ? JSON.stringify(e.data) : null,
        e.source,
        e.fetchedAt,
      );
    }
  });
}

/** 실적 발표 대상: 지원 종목 + ETF 상위 편입 종목(비중 3% 이상) */
export function earningsWatchSymbols(): Map<string, string[]> {
  const map = new Map<string, string[]>(); // symbol -> 관련 ETF 목록
  for (const s of allSymbols()) map.set(s, []);
  for (const i of allInstruments()) {
    if (i.kind !== "etf") continue;
    for (const h of topHoldings(i.symbol, 3)) {
      const list = map.get(h.symbol) ?? [];
      list.push(`${i.symbol}(${h.weight.toFixed(1)}%)`);
      map.set(h.symbol, list);
    }
  }
  return map;
}

const HOUR_KO: Record<string, string> = { bmo: "장 시작 전", amc: "장 마감 후", dmh: "장중" };

export async function refreshEarnings(): Promise<{ count: number; source: string; errors: string[] }> {
  const from = addDays(etDate(), -7);
  const to = addDays(etDate(), 45);
  const watch = earningsWatchSymbols();
  const events: MarketEvent[] = [];
  const errors: string[] = [];
  let source = "";
  if (finnhub.finnhubEnabled()) {
    try {
      const rows = await finnhub.earningsCalendar(from, to);
      source = "Finnhub";
      for (const r of rows) {
        if (!watch.has(r.symbol)) continue;
        events.push({
          id: `earn:${r.symbol}:${r.date}`,
          symbol: r.symbol,
          kind: "earnings",
          date: r.date,
          timeHint: r.hour ? (HOUR_KO[r.hour] ?? r.hour) : null,
          title: `${r.symbol} 실적 발표${r.quarter && r.year ? ` (${r.year} Q${r.quarter})` : ""}`,
          data: { ...r, relatedEtfs: watch.get(r.symbol) ?? [] },
          source: "Finnhub",
          fetchedAt: Date.now(),
        });
      }
      saveEvents(events, [{ kind: "earnings", from, to, source: "Finnhub" }]);
      return { count: events.length, source, errors };
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  // 대체: Yahoo calendarEvents (개별 주식만)
  source = "Yahoo Finance";
  for (const i of allInstruments()) {
    if (i.kind !== "stock") continue;
    if (!readSnapshot("yahoo_summary", i.symbol)) continue;
    const d = stockFundamentals(i.symbol, null).nextEarnings.value;
    if (!d) continue;
    events.push({
      id: `earn:${i.symbol}:${d}`,
      symbol: i.symbol,
      kind: "earnings",
      date: d,
      timeHint: null,
      title: `${i.symbol} 실적 발표 예정`,
      data: { relatedEtfs: watch.get(i.symbol) ?? [] },
      source: "Yahoo Finance",
      fetchedAt: Date.now(),
    });
  }
  saveEvents(events, [{ kind: "earnings", from, to, source: "Yahoo Finance" }]);
  return { count: events.length, source, errors };
}

export async function refreshEconomicCalendar(): Promise<{ count: number; errors: string[] }> {
  if (!fred.fredEnabled()) return { count: 0, errors: ["FRED_API_KEY 미설정 — 경제지표 일정 미수집"] };
  const from = addDays(etDate(), -7);
  const to = addDays(etDate(), 35);
  const rows = await fred.fetchReleaseDates(from, to);
  const events: MarketEvent[] = [];
  for (const r of rows) {
    const k = fred.KEY_RELEASES.find((x) => x.match.test(r.releaseName));
    if (!k) continue;
    events.push({
      id: `econ:${r.releaseId}:${r.date}`,
      symbol: null,
      kind: "economic",
      date: r.date,
      timeHint: null,
      title: k.ko,
      data: { releaseName: r.releaseName, releaseId: r.releaseId, importance: k.importance },
      source: "FRED",
      fetchedAt: Date.now(),
    });
  }
  saveEvents(events, [{ kind: "economic", from, to, source: "FRED" }]);
  return { count: events.length, errors: [] };
}

export function readEvents(from: string, to: string, opts: { kinds?: string[]; symbols?: string[] } = {}): MarketEvent[] {
  const conds = ["date BETWEEN ? AND ?"];
  const params: string[] = [from, to];
  if (opts.kinds?.length) {
    conds.push(`kind IN (${opts.kinds.map(() => "?").join(",")})`);
    params.push(...opts.kinds);
  }
  if (opts.symbols?.length) {
    conds.push(`symbol IN (${opts.symbols.map(() => "?").join(",")})`);
    params.push(...opts.symbols);
  }
  return all<{ id: string; symbol: string | null; kind: string; date: string; time_hint: string | null; title: string; data: string | null; source: string; fetched_at: number }>(
    `SELECT * FROM events WHERE ${conds.join(" AND ")} ORDER BY date, symbol`,
    ...params,
  ).map((r) => ({
    id: r.id,
    symbol: r.symbol,
    kind: r.kind as MarketEvent["kind"],
    date: r.date,
    timeHint: r.time_hint,
    title: r.title,
    data: r.data ? JSON.parse(r.data) : null,
    source: r.source,
    fetchedAt: r.fetched_at,
  }));
}

// ─────────────── 거시 지표 (FRED) ───────────────
export async function refreshMacro(): Promise<{ count: number; errors: string[] }> {
  if (!fred.fredEnabled()) return { count: 0, errors: ["FRED_API_KEY 미설정 — 거시 지표 미수집"] };
  let count = 0;
  const errors: string[] = [];
  for (const s of fred.MACRO_SERIES) {
    try {
      const obs = await fred.fetchObservations(s.id, 40);
      tx(() => {
        for (const o of obs) {
          run("INSERT INTO macro(series, date, value, source) VALUES(?,?,?,?) ON CONFLICT(series, date) DO UPDATE SET value=excluded.value", s.id, o.date, o.value, "FRED");
        }
      });
      count += obs.length;
    } catch (e) {
      errors.push(`${s.id}: ${(e as Error).message}`);
    }
  }
  return { count, errors };
}

export function readMacro(series: string, limit = 10): { date: string; value: number }[] {
  return all<{ date: string; value: number }>("SELECT date, value FROM macro WHERE series=? ORDER BY date DESC LIMIT ?", series, limit).reverse();
}
