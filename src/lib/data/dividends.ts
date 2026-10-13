/**
 * 배당·분배금 기록 수집·병합·조회
 *
 * 제공처별 특징
 * - Yahoo chart events: 배당락일·지급액(분할 조정)만 제공, 지급일 없음
 * - Nasdaq: 배당락일·선언일·기준일·지급일·지급액(선언 당시 금액)
 * - Polygon: 배당락일·지급일·기준일·선언일·지급 주기·유형(정기/특별/자본이득)
 *
 * 병합 규칙
 * - 같은 배당락일에 Polygon/Nasdaq 기록이 있으면 그것을 사용하고(지급일 포함), 없으면 Yahoo 기록을 사용
 * - Polygon/Nasdaq 의 선언 당시 금액은 이후 주식분할 비율로 나눠 현재 주식 수 기준으로 조정
 * - 제공처 기록이 서로 다르면 sources 에 모두 남긴다
 */
import { all, run, tx } from "../db";
import { env } from "../env";
import { getInstrument } from "../instruments";
import { splitAdjustFactor } from "../dividend-analytics";
import * as nasdaq from "../providers/nasdaq";
import * as polygon from "../providers/polygon";
import type { Dividend, DividendKind, Split } from "../types";

interface DivRow {
  symbol: string;
  ex_date: string;
  amount: number;
  amount_raw: number | null;
  split_adjusted: number;
  pay_date: string | null;
  record_date: string | null;
  declared_date: string | null;
  kind: string;
  frequency_reported: number | null;
  sources: string;
}

export function readDividends(symbol: string): Dividend[] {
  return all<DivRow>("SELECT * FROM dividends WHERE symbol=? ORDER BY ex_date", symbol).map((r) => ({
    symbol: r.symbol,
    exDate: r.ex_date,
    amount: r.amount,
    amountRaw: r.amount_raw,
    splitAdjusted: r.split_adjusted === 1,
    payDate: r.pay_date,
    recordDate: r.record_date,
    declaredDate: r.declared_date,
    kind: r.kind as DividendKind,
    frequencyReported: r.frequency_reported,
    sources: r.sources.split(",").filter(Boolean),
  }));
}

export function readAllDividends(fromDate: string, toDate: string): Dividend[] {
  return all<DivRow>(
    "SELECT * FROM dividends WHERE (ex_date BETWEEN ? AND ?) OR (pay_date BETWEEN ? AND ?) ORDER BY ex_date",
    fromDate,
    toDate,
    fromDate,
    toDate,
  ).map((r) => ({
    symbol: r.symbol,
    exDate: r.ex_date,
    amount: r.amount,
    amountRaw: r.amount_raw,
    splitAdjusted: r.split_adjusted === 1,
    payDate: r.pay_date,
    recordDate: r.record_date,
    declaredDate: r.declared_date,
    kind: r.kind as DividendKind,
    frequencyReported: r.frequency_reported,
    sources: r.sources.split(",").filter(Boolean),
  }));
}

export function readSplits(symbol: string): Split[] {
  return all<{ symbol: string; date: string; numerator: number; denominator: number }>(
    "SELECT symbol, date, numerator, denominator FROM splits WHERE symbol=? ORDER BY date",
    symbol,
  );
}

function upsert(d: Omit<Dividend, "symbol">, symbol: string) {
  run(
    `INSERT INTO dividends(symbol, ex_date, amount, amount_raw, split_adjusted, pay_date, record_date, declared_date, kind, frequency_reported, sources, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(symbol, ex_date, kind) DO UPDATE SET amount=excluded.amount, amount_raw=excluded.amount_raw, split_adjusted=excluded.split_adjusted,
       pay_date=COALESCE(excluded.pay_date, dividends.pay_date), record_date=COALESCE(excluded.record_date, dividends.record_date),
       declared_date=COALESCE(excluded.declared_date, dividends.declared_date), frequency_reported=COALESCE(excluded.frequency_reported, dividends.frequency_reported),
       sources=excluded.sources, updated_at=excluded.updated_at`,
    symbol,
    d.exDate,
    d.amount,
    d.amountRaw,
    d.splitAdjusted ? 1 : 0,
    d.payDate,
    d.recordDate,
    d.declaredDate,
    d.kind,
    d.frequencyReported,
    d.sources.join(","),
    Date.now(),
  );
}

/** Yahoo chart 이벤트로 받은 배당·분할 저장 (상세 제공처 기록이 없는 배당락일만) */
export function saveYahooDividendsAndSplits(symbol: string, divs: { date: string; amount: number }[], splits: Split[]) {
  tx(() => {
    for (const s of splits) {
      run(
        "INSERT INTO splits(symbol, date, numerator, denominator, source) VALUES(?,?,?,?,?) ON CONFLICT(symbol, date) DO UPDATE SET numerator=excluded.numerator, denominator=excluded.denominator",
        symbol,
        s.date,
        s.numerator,
        s.denominator,
        "Yahoo Finance",
      );
    }
    const existing = new Map(readDividends(symbol).map((d) => [d.exDate, d]));
    for (const d of divs) {
      const e = existing.get(d.date);
      if (e && e.sources.some((s) => s !== "Yahoo Finance")) {
        // 상세 제공처 기록이 이미 있으면 출처만 추가
        if (!e.sources.includes("Yahoo Finance") && Math.abs(e.amount - d.amount) / Math.max(e.amount, 1e-9) < 0.02) {
          run("UPDATE dividends SET sources=? WHERE symbol=? AND ex_date=? AND kind=?", [...e.sources, "Yahoo Finance"].join(","), symbol, e.exDate, e.kind);
        }
        continue;
      }
      upsert(
        {
          exDate: d.date,
          amount: d.amount,
          amountRaw: null,
          splitAdjusted: true,
          payDate: e?.payDate ?? null,
          recordDate: e?.recordDate ?? null,
          declaredDate: e?.declaredDate ?? null,
          kind: e?.kind ?? "unknown",
          frequencyReported: e?.frequencyReported ?? null,
          sources: ["Yahoo Finance"],
        },
        symbol,
      );
    }
  });
}

function polygonKind(t: string | null): DividendKind {
  if (!t) return "unknown";
  if (t === "CD") return "regular";
  if (t === "SC") return "special";
  if (t === "LT" || t === "ST") return "capital_gain";
  return "unknown";
}

function nasdaqKind(t: string | null): DividendKind {
  if (!t) return "unknown";
  const s = t.toLowerCase();
  if (s.includes("capital")) return "capital_gain";
  if (s.includes("special") || s.includes("extra")) return "special";
  if (s === "cash") return "regular";
  return "unknown";
}

export interface DividendRefreshResult {
  symbol: string;
  sources: string[];
  errors: string[];
  count: number;
}

/** 상세 제공처(Polygon, Nasdaq)에서 배당 기록을 받아 병합 */
export async function refreshDividendDetails(symbol: string): Promise<DividendRefreshResult> {
  const inst = getInstrument(symbol);
  const splits = readSplits(symbol);
  const errors: string[] = [];
  const sources: string[] = [];
  type Rec = Omit<Dividend, "symbol">;
  const detailed = new Map<string, Rec>();

  if (polygon.polygonEnabled()) {
    try {
      const rows = await polygon.fetchDividends(symbol);
      for (const r of rows) {
        const f = splitAdjustFactor(r.exDate, splits);
        const kind = polygonKind(r.type);
        detailed.set(`${r.exDate}|${kind}`, {
          exDate: r.exDate,
          amount: r.amount / f,
          amountRaw: r.amount,
          splitAdjusted: f !== 1,
          payDate: r.payDate,
          recordDate: r.recordDate,
          declaredDate: r.declaredDate,
          kind,
          frequencyReported: r.frequency,
          sources: ["Polygon.io"],
        });
      }
      sources.push("Polygon.io");
    } catch (e) {
      errors.push((e as Error).message);
    }
  }

  if (env.nasdaqEnabled) {
    try {
      const rows = await nasdaq.fetchDividends(symbol, inst?.kind === "etf" ? "etf" : "stocks");
      for (const r of rows) {
        const f = splitAdjustFactor(r.exDate, splits);
        const kind = nasdaqKind(r.type);
        const adj = r.amount / f;
        // 같은 배당락일·금액의 Polygon 기록이 있으면 누락 필드만 보완
        const match = [...detailed.values()].find((d) => d.exDate === r.exDate && Math.abs(d.amount - adj) / Math.max(adj, 1e-9) < 0.02);
        if (match) {
          match.payDate ??= r.payDate;
          match.recordDate ??= r.recordDate;
          match.declaredDate ??= r.declaredDate;
          if (match.kind === "unknown") match.kind = kind;
          if (!match.sources.includes("Nasdaq")) match.sources.push("Nasdaq");
          continue;
        }
        const key = `${r.exDate}|${kind}`;
        if (detailed.has(key)) continue;
        detailed.set(key, {
          exDate: r.exDate,
          amount: adj,
          amountRaw: r.amount,
          splitAdjusted: f !== 1,
          payDate: r.payDate,
          recordDate: r.recordDate,
          declaredDate: r.declaredDate,
          kind,
          frequencyReported: null,
          sources: ["Nasdaq"],
        });
      }
      sources.push("Nasdaq");
    } catch (e) {
      errors.push((e as Error).message);
    }
  }

  if (detailed.size) {
    tx(() => {
      const exDates = new Set([...detailed.values()].map((d) => d.exDate));
      const yahooRows = readDividends(symbol).filter((d) => d.sources.length === 1 && d.sources[0] === "Yahoo Finance");
      for (const y of yahooRows) {
        if (exDates.has(y.exDate)) {
          // Yahoo 기록을 상세 기록으로 대체 (중복 집계 방지)
          run("DELETE FROM dividends WHERE symbol=? AND ex_date=? AND kind=?", symbol, y.exDate, y.kind);
          const same = [...detailed.values()].find((d) => d.exDate === y.exDate && Math.abs(d.amount - y.amount) / Math.max(y.amount, 1e-9) < 0.02);
          if (same && !same.sources.includes("Yahoo Finance")) same.sources.push("Yahoo Finance");
        }
      }
      for (const d of detailed.values()) upsert(d, symbol);
    });
  }
  return { symbol, sources, errors, count: detailed.size };
}

export function dividendSources(divs: Dividend[]): string[] {
  return [...new Set(divs.flatMap((d) => d.sources))];
}
