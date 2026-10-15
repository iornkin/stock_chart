/**
 * 포지션·심리 데이터 수집·저장·조회
 * 같은 자료를 여러 번 받아도 (종목, 날짜) 등 기본키로 덮어써 중복이 생기지 않는다.
 * 어떤 출처가 실패해도 다른 출처는 계속 수집하고, 실패한 부분은 결과에 따로 남긴다.
 */
import { CUSIPS, INSTITUTIONS, type InstitutionGroup } from "@/config/positioning";
import { all, get, run, tx } from "../db";
import { env } from "../env";
import { allInstruments, getInstrument } from "../instruments";
import { previousTradingDay, sessionTimes } from "../market-calendar";
import * as aaii from "../providers/aaii";
import * as cboe from "../providers/cboe";
import * as finra from "../providers/finra";
import * as nasdaq from "../providers/nasdaq";
import * as sec from "../providers/sec";
import { composePeriod, describeAmendments, impliedPriceCheck, thousandsCorrection, valueInDollars, type FilingRef, type HoldingRow, type OptionPoint, type SentimentRow, type ShortInterestPoint, type ShortVolumePoint } from "../positioning";
import { readSnapshot } from "./profile";

const DAY = 86400_000;
const addDaysIso = (iso: string, d: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * DAY).toISOString().slice(0, 10);

/** 직전 n 거래일 (기준일 포함, 최근 것부터) */
export function recentSessions(tradeDate: string, n: number): string[] {
  const out = [tradeDate];
  while (out.length < n) out.push(previousTradingDay(out[out.length - 1]));
  return out;
}

// ───────────────────────────── 저장 ─────────────────────────────

export function saveShortInterest(rows: finra.ShortInterestRow[], now = Date.now()): number {
  return tx(() => {
    for (const r of rows)
      run(
        `INSERT INTO short_interest(symbol, settlement_date, short_qty, prev_qty, avg_daily_volume, days_to_cover_reported, change_pct, revised, split, source, fetched_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(symbol, settlement_date) DO UPDATE SET short_qty=excluded.short_qty, prev_qty=excluded.prev_qty, avg_daily_volume=excluded.avg_daily_volume,
           days_to_cover_reported=excluded.days_to_cover_reported, change_pct=excluded.change_pct, revised=excluded.revised, split=excluded.split, source=excluded.source, fetched_at=excluded.fetched_at`,
        r.symbol, r.settlementDate, r.shortQty, r.prevQty, r.avgDailyVolume, r.daysToCoverReported, r.changePct, r.revised ? 1 : 0, r.split ? 1 : 0, "FINRA", now,
      );
    return rows.length;
  });
}

export function saveShortVolume(rows: finra.ShortVolumeRow[], now = Date.now()): number {
  return tx(() => {
    for (const r of rows)
      run(
        `INSERT INTO short_volume(symbol, trade_date, short_volume, short_exempt_volume, total_volume, markets, source, fetched_at) VALUES(?,?,?,?,?,?,?,?)
         ON CONFLICT(symbol, trade_date) DO UPDATE SET short_volume=excluded.short_volume, short_exempt_volume=excluded.short_exempt_volume, total_volume=excluded.total_volume, markets=excluded.markets, fetched_at=excluded.fetched_at`,
        r.symbol, r.date, r.shortVolume, r.shortExemptVolume, r.totalVolume, r.markets, "FINRA Reg SHO", now,
      );
    return rows.length;
  });
}

export function saveOptionStats(symbol: string, tradeDate: string, t: nasdaq.OptionChainTotals, now = Date.now()) {
  run(
    `INSERT INTO option_stats(symbol, trade_date, call_volume, put_volume, call_oi, put_oi, contracts, expiries, as_of, source, fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(symbol, trade_date) DO UPDATE SET call_volume=excluded.call_volume, put_volume=excluded.put_volume, call_oi=excluded.call_oi, put_oi=excluded.put_oi,
       contracts=excluded.contracts, expiries=excluded.expiries, as_of=excluded.as_of, fetched_at=excluded.fetched_at`,
    symbol, tradeDate, t.callVolume, t.putVolume, t.callOI, t.putOI, t.contracts, t.expiries, t.asOf, "Nasdaq (OPRA)", now,
  );
}

export function saveMarketOptions(date: string, rows: cboe.CboeProductStats[], now = Date.now()) {
  tx(() => {
    for (const r of rows)
      run(
        `INSERT INTO option_market(trade_date, product, call_volume, put_volume, call_oi, put_oi, published_ratio, source, fetched_at) VALUES(?,?,?,?,?,?,?,?,?)
         ON CONFLICT(trade_date, product) DO UPDATE SET call_volume=excluded.call_volume, put_volume=excluded.put_volume, call_oi=excluded.call_oi, put_oi=excluded.put_oi, published_ratio=excluded.published_ratio, fetched_at=excluded.fetched_at`,
        date, r.product, r.callVolume, r.putVolume, r.callOI, r.putOI, r.publishedRatio, "Cboe", now,
      );
  });
}

export function saveSentiment(source: string, weeks: aaii.SentimentWeek[], now = Date.now()): number {
  return tx(() => {
    for (const w of weeks)
      run(
        `INSERT INTO sentiment_survey(source, week_ending, bullish, neutral, bearish, fetched_at) VALUES(?,?,?,?,?,?)
         ON CONFLICT(source, week_ending) DO UPDATE SET bullish=excluded.bullish, neutral=excluded.neutral, bearish=excluded.bearish, fetched_at=excluded.fetched_at`,
        source, w.weekEnding, w.bullish, w.neutral, w.bearish, now,
      );
    return weeks.length;
  });
}

const SYMBOL_BY_CUSIP = new Map(Object.entries(CUSIPS).map(([s, c]) => [c, s]));
const TOP_N = 15;

/** 13F 한 제출 묶음 저장: 이 사이트 종목(옵션 포함) 전부 + 주식 보유 가치 상위 TOP_N */
export function save13fFiling(cik: number, filerName: string, f: sec.ThirteenFFiling, doc: { cover: sec.ThirteenFCover; rows: sec.ThirteenFRow[] }, now = Date.now()) {
  const agg = new Map<string, { cusip: string; putCall: string; issuer: string; title: string; shares: number; value: number }>();
  for (const r of doc.rows) {
    if (r.putCall === "" && r.shType && r.shType !== "SH") continue; // 채권 원금(PRN) 제외
    const k = `${r.cusip}|${r.putCall}`;
    const e = agg.get(k) ?? { cusip: r.cusip, putCall: r.putCall, issuer: r.issuer, title: r.title, shares: 0, value: 0 };
    e.shares += r.shares;
    e.value += valueInDollars(r.value, f.filed);
    agg.set(k, e);
  }
  // 천 달러 단위로 잘못 보고한 기관 보정 (주식 보유 행의 기말 가격 중앙값으로 판단)
  const unit = f.filed >= "2023-01-03" ? thousandsCorrection([...agg.values()].filter((x) => x.putCall === "")) : { factor: 1 as const, medianPrice: null };
  if (unit.factor !== 1) for (const x of agg.values()) x.value *= unit.factor;
  const valueNote = unit.factor !== 1 ? `가치가 천 달러 단위로 보고된 것으로 보여 1000을 곱함 (보정 전 기말 가격 중앙값 $${unit.medianPrice?.toFixed(3)})` : null;
  const stocks = [...agg.values()].filter((x) => x.putCall === "").sort((a, b) => b.value - a.value);
  const rank = new Map(stocks.slice(0, TOP_N).map((x, i) => [x.cusip, i + 1]));
  const keep = [...agg.values()].filter((x) => SYMBOL_BY_CUSIP.has(x.cusip) || (x.putCall === "" && rank.has(x.cusip)));
  tx(() => {
    run(
      `INSERT OR REPLACE INTO inst_filings(accession, cik, filer_name, form, period, filed, amendment_type, table_value_total, entry_total, rows_parsed, value_note, fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      f.accession, cik, filerName, f.form, f.period, f.filed, f.form === "13F-HR/A" ? (doc.cover.amendmentType ?? null) : null,
      doc.cover.tableValueTotal !== null ? valueInDollars(doc.cover.tableValueTotal, f.filed) * unit.factor : null, doc.cover.entryTotal, doc.rows.length, valueNote, now,
    );
    run("DELETE FROM inst_holdings WHERE accession=?", f.accession);
    for (const x of keep)
      run(
        "INSERT INTO inst_holdings(accession, cusip, put_call, symbol, issuer, title, shares, value, top_rank) VALUES(?,?,?,?,?,?,?,?,?)",
        f.accession, x.cusip, x.putCall, SYMBOL_BY_CUSIP.get(x.cusip) ?? null, x.issuer, x.title, x.shares, x.value, x.putCall === "" ? (rank.get(x.cusip) ?? null) : null,
      );
  });
  return keep.length;
}

// ───────────────────────────── 수집 ─────────────────────────────

export interface PartResult {
  ok: boolean;
  message: string;
}

export interface CollectOptions {
  tradeDate: string;
  now: number;
  log: (m: string) => void;
  symbols?: string[];
  /** 기관 13F 를 건너뛴다 (테스트·빠른 실행용) */
  skip13f?: boolean;
  /** 수동 강제 실행: 옵션 수집 시간 제한을 두지 않는다 (기준일 확인은 그대로 — Nasdaq 'AS OF' 날짜가 기준일과 같아야 저장) */
  ignoreOptionWindow?: boolean;
}

export async function collectPositioning(o: CollectOptions): Promise<Record<string, PartResult>> {
  const parts: Record<string, PartResult> = {};
  const symbols = o.symbols ?? allInstruments().map((i) => i.symbol);
  const want = new Set(symbols);
  const step = async (key: string, f: () => Promise<string>) => {
    try {
      const message = await f();
      parts[key] = { ok: true, message };
      o.log(`${key}: ${message}`);
    } catch (e) {
      parts[key] = { ok: false, message: (e as Error).message };
      o.log(`${key} 실패: ${(e as Error).message}`);
    }
  };

  // 1) 공매도 잔고 (FINRA, 최근 약 13개월)
  await step("short_interest", async () => {
    const rows = await finra.fetchShortInterest(symbols, addDaysIso(o.tradeDate, -400), o.tradeDate);
    const n = saveShortInterest(rows.filter((r) => want.has(r.symbol)), o.now);
    const latest = rows.map((r) => r.settlementDate).sort().at(-1);
    return `${n}건 (최근 결제일 ${latest ?? "없음"})`;
  });

  // 2) 일일 공매도 거래량 (FINRA Reg SHO) — 빠진 날만, 처음에는 40거래일
  await step("short_volume", async () => {
    const have = get<{ n: number }>("SELECT count(*) AS n FROM short_volume")?.n ?? 0;
    const dates = recentSessions(o.tradeDate, have ? 7 : 40);
    let files = 0, rows = 0;
    const missing: string[] = [];
    for (const d of dates) {
      if (get("SELECT 1 FROM short_volume WHERE trade_date=? LIMIT 1", d)) continue;
      const text = await finra.fetchShortVolumeFile(d);
      if (text === null) {
        missing.push(d);
        continue;
      }
      const p = finra.parseShortVolumeFile(text, want);
      rows += saveShortVolume(p.rows, o.now);
      files++;
    }
    return `파일 ${files}개·${rows}행${missing.length ? ` (아직 게시 전·휴장: ${missing.join(", ")})` : ""}`;
  });

  // 3) 종목별 옵션 합계 — 장 마감 후 ~ 다음 날 새벽 사이에만 (다음 거래일 값과 섞이지 않게)
  await step("options", async () => {
    const close = sessionTimes(o.tradeDate).close;
    if (!o.ignoreOptionWindow && (o.now < close || o.now > close + 10 * 3600_000)) return `건너뜀 — 수집 가능 시간(장 마감 후 10시간 이내)이 아님`;
    let ok = 0, none = 0;
    const failed: string[] = [];
    // 제공처 기준일이 수집 기준일과 다르면(다음 거래일 장 시작 후 등) 섞이지 않게 저장하지 않는다 — 제공처 오류가 아니라 건너뜀
    const mismatch: string[] = [];
    for (const s of symbols) {
      const inst = getInstrument(s);
      try {
        const t = await nasdaq.fetchOptionChainTotals(s, inst?.kind === "etf" ? "etf" : "stocks");
        if (!t) {
          none++;
          continue;
        }
        if (t.asOf && t.asOf !== o.tradeDate) {
          mismatch.push(`${s}(${t.asOf})`);
          continue;
        }
        saveOptionStats(s, o.tradeDate, t, o.now);
        ok++;
      } catch (e) {
        failed.push(`${s}(${(e as Error).message.slice(0, 60)})`);
      }
    }
    if (!ok && failed.length && failed.length >= mismatch.length) throw new Error(`옵션 체인 모두 실패: ${failed.slice(0, 5).join(", ")}`);
    if (!ok && mismatch.length) return `건너뜀 — 제공처 기준일이 수집 기준일(${o.tradeDate})과 달라 저장 안 함 (${mismatch.length}종목, 예: ${mismatch.slice(0, 3).join(", ")})`;
    return `${ok}종목 저장, 옵션 없음 ${none}${mismatch.length ? `, 기준일 불일치로 건너뜀 ${mismatch.length}` : ""}${failed.length ? `, 실패 ${failed.length}: ${failed.slice(0, 5).join(", ")}` : ""}`;
  });

  // 4) 시장 전체 옵션 통계 (Cboe) — 빠진 날만, 처음에는 약 1년
  await step("market_options", async () => {
    const have = get<{ n: number }>("SELECT count(*) AS n FROM option_market")?.n ?? 0;
    const dates = recentSessions(o.tradeDate, have ? 7 : 260);
    let saved = 0;
    const missing: string[] = [];
    for (const d of dates) {
      if (get("SELECT 1 FROM option_market WHERE trade_date=? LIMIT 1", d)) continue;
      const r = await cboe.fetchCboeDaily(d);
      if (!r) {
        missing.push(d);
        continue;
      }
      saveMarketOptions(d, r, o.now);
      saved++;
    }
    return `${saved}일 저장${missing.length ? ` (자료 없음 ${missing.length}일: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? " …" : ""})` : ""}`;
  });

  // 5) 투자심리 설문 (AAII)
  await step("sentiment", async () => {
    const p = await aaii.fetchAaii();
    const n = saveSentiment("AAII", p.weeks, o.now);
    run(
      "INSERT INTO snapshots(kind, symbol, data, source, fetched_at) VALUES('aaii_meta','MARKET',?,?,?) ON CONFLICT(kind, symbol) DO UPDATE SET data=excluded.data, source=excluded.source, fetched_at=excluded.fetched_at",
      JSON.stringify({ averages: p.averages }), "AAII", o.now,
    );
    return `${n}주 (최근 ${p.weeks[0]?.weekEnding ?? "-"})`;
  });

  // 6) 기관 13F — 최근 2개 보고 기간, 아직 받지 않은 제출만
  if (!o.skip13f) {
    await step("thirteen_f", async () => {
      if (!sec.secEnabled()) return "건너뜀 — SEC_USER_AGENT 미설정";
      let fetched = 0;
      const failed: string[] = [];
      for (const inst of INSTITUTIONS) {
        try {
          const { name, filings } = await sec.fetch13fFilings(inst.cik);
          const periods = [...new Set(filings.map((f) => f.period))].sort().reverse().slice(0, 2);
          for (const f of filings.filter((x) => periods.includes(x.period))) {
            if (get("SELECT 1 FROM inst_filings WHERE accession=?", f.accession)) continue;
            const doc = await sec.fetch13fDocuments(inst.cik, f.accession);
            save13fFiling(inst.cik, name, f, doc, o.now);
            fetched++;
          }
        } catch (e) {
          failed.push(`CIK ${inst.cik}: ${(e as Error).message.slice(0, 80)}`);
        }
      }
      if (failed.length === INSTITUTIONS.length) throw new Error(`모든 기관 실패 — ${failed[0]}`);
      return `새 제출 ${fetched}건${failed.length ? `, 실패 ${failed.length}곳 (${failed.slice(0, 3).join("; ")})` : ""}`;
    });
  }
  return parts;
}

export function positioningEnabled() {
  return env.positioningEnabled;
}

// ───────────────────────────── 조회 ─────────────────────────────

function closeOn(symbol: string, iso: string): number | null {
  const t = Date.parse(`${iso}T00:00:00Z`) / 1000;
  const r = get<{ close: number }>("SELECT close FROM bars WHERE symbol=? AND interval='1d' AND ts >= ? AND ts < ? ORDER BY ts DESC LIMIT 1", symbol, t, t + 86400);
  return r && Number.isFinite(r.close) ? r.close : null;
}

export interface SourceInfo {
  source: string;
  fetchedAt: number | null;
}

export interface InstitutionHolding {
  cik: number;
  filer: string;
  group: InstitutionGroup;
  period: string;
  filed: string;
  prevPeriod: string | null;
  /** 주식 보유 (옵션 행 제외) */
  shares: number | null;
  value: number | null;
  prevShares: number | null;
  prevKnown: boolean;
  /** 같은 공시의 옵션 행 (기초자산 수량 기준, 포지션 방향과 무관하게 보고) */
  putShares: number | null;
  callShares: number | null;
  priceCheck: { implied: number | null; close: number | null; ok: boolean | null };
  amendments: string[];
  /** 가치 단위 보정 안내 */
  valueNote: string | null;
}

export interface SymbolPositioning {
  symbol: string;
  kind: "stock" | "etf";
  shortInterest: { points: ShortInterestPoint[]; floatShares: number | null; floatSource: SourceInfo | null; info: SourceInfo } | null;
  shortVolume: { points: ShortVolumePoint[]; info: SourceInfo } | null;
  options: { points: OptionPoint[]; info: SourceInfo; lastAsOf: string | null } | null;
  institutions: { cusip: string | null; holdings: InstitutionHolding[]; trackedCount: number; info: SourceInfo } | null;
}

/** 기관별 최근 2개 보고 기간의 최종 보유 (정정 공시 반영) */
function institutionPeriods(cik: number) {
  const filings = all<{ accession: string; form: string; period: string; filed: string; amendment_type: string | null; filer_name: string; fetched_at: number }>(
    "SELECT accession, form, period, filed, amendment_type, filer_name, fetched_at FROM inst_filings WHERE cik=? ORDER BY period DESC, filed DESC",
    cik,
  );
  const periods = [...new Set(filings.map((f) => f.period))].slice(0, 2);
  return {
    name: filings[0]?.filer_name ?? null,
    fetchedAt: filings.length ? Math.max(...filings.map((f) => f.fetched_at)) : null,
    periods: periods.map((p) => {
      const fs: FilingRef[] = filings.filter((f) => f.period === p).map((f) => ({ accession: f.accession, form: f.form, period: f.period, filed: f.filed, amendmentType: f.amendment_type }));
      return { period: p, filings: fs };
    }),
  };
}

function holdingRows(accessions: string[], cusip?: string): (HoldingRow & { issuer: string | null; title: string | null; symbol: string | null; topRank: number | null })[] {
  if (!accessions.length) return [];
  const q = accessions.map(() => "?").join(",");
  return all<{ accession: string; cusip: string; put_call: string; shares: number; value: number; issuer: string | null; title: string | null; symbol: string | null; top_rank: number | null }>(
    `SELECT accession, cusip, put_call, shares, value, issuer, title, symbol, top_rank FROM inst_holdings WHERE accession IN (${q})${cusip ? " AND cusip=?" : ""}`,
    ...accessions,
    ...(cusip ? [cusip] : []),
  ).map((r) => ({ accession: r.accession, cusip: r.cusip, putCall: r.put_call, shares: r.shares, value: r.value, issuer: r.issuer, title: r.title, symbol: r.symbol, topRank: r.top_rank }));
}

export function readSymbolPositioning(symbol: string): SymbolPositioning {
  const inst = getInstrument(symbol);
  const kind = inst?.kind === "etf" ? "etf" : "stock";

  const si = all<{ settlement_date: string; short_qty: number; prev_qty: number | null; avg_daily_volume: number | null; revised: number; split: number; fetched_at: number }>(
    "SELECT settlement_date, short_qty, prev_qty, avg_daily_volume, revised, split, fetched_at FROM short_interest WHERE symbol=? ORDER BY settlement_date DESC LIMIT 26",
    symbol,
  );
  let floatShares: number | null = null;
  let floatSource: SourceInfo | null = null;
  if (kind === "stock") {
    const snap = readSnapshot<{ defaultKeyStatistics?: { floatShares?: unknown } }>("yahoo_summary", symbol);
    const raw = snap?.data?.defaultKeyStatistics?.floatShares;
    const v = typeof raw === "number" ? raw : raw && typeof raw === "object" && "raw" in raw ? (raw as { raw: unknown }).raw : null;
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      floatShares = v;
      floatSource = { source: "Yahoo Finance (유통주식 수)", fetchedAt: snap!.fetchedAt };
    }
  }
  const sv = all<{ trade_date: string; short_volume: number; total_volume: number; fetched_at: number }>(
    "SELECT trade_date, short_volume, total_volume, fetched_at FROM short_volume WHERE symbol=? ORDER BY trade_date DESC LIMIT 60",
    symbol,
  );
  const op = all<{ trade_date: string; call_volume: number | null; put_volume: number | null; call_oi: number | null; put_oi: number | null; as_of: string | null; fetched_at: number }>(
    "SELECT trade_date, call_volume, put_volume, call_oi, put_oi, as_of, fetched_at FROM option_stats WHERE symbol=? ORDER BY trade_date DESC LIMIT 120",
    symbol,
  );

  // 기관 13F
  const cusip = CUSIPS[symbol] ?? null;
  let institutions: SymbolPositioning["institutions"] = null;
  const trackedCount = get<{ n: number }>("SELECT count(DISTINCT cik) AS n FROM inst_filings")?.n ?? 0;
  if (trackedCount) {
    const holdings: InstitutionHolding[] = [];
    let fetchedAt: number | null = null;
    if (cusip) {
      for (const it of INSTITUTIONS) {
        const ip = institutionPeriods(it.cik);
        if (!ip.periods.length) continue;
        fetchedAt = Math.max(fetchedAt ?? 0, ip.fetchedAt ?? 0);
        const [cur, prev] = ip.periods;
        const cRows = holdingRows(cur.filings.map((f) => f.accession), cusip);
        const cComp = composePeriod(cur.filings, cRows);
        const pComp = prev ? composePeriod(prev.filings, holdingRows(prev.filings.map((f) => f.accession), cusip)) : null;
        const sh = cComp.holdings.get(`${cusip}|`) ?? null;
        const put = cComp.holdings.get(`${cusip}|PUT`) ?? null;
        const call = cComp.holdings.get(`${cusip}|CALL`) ?? null;
        const psh = pComp?.holdings.get(`${cusip}|`) ?? null;
        if (!sh && !psh && !put && !call) continue;
        const close = closeOn(symbol, cur.period);
        const chk = sh ? impliedPriceCheck(sh.value, sh.shares, close) : { implied: null, ok: null };
        holdings.push({
          cik: it.cik,
          filer: ip.name ?? `CIK ${it.cik}`,
          group: it.group,
          period: cur.period,
          filed: cComp.base?.filed ?? cur.filings[0]?.filed ?? "",
          prevPeriod: prev?.period ?? null,
          shares: sh?.shares ?? null,
          value: sh?.value ?? null,
          prevShares: psh?.shares ?? null,
          prevKnown: Boolean(pComp?.base),
          putShares: put?.shares ?? null,
          callShares: call?.shares ?? null,
          priceCheck: { implied: chk.implied, close, ok: chk.ok },
          amendments: describeAmendments(cComp),
          valueNote: cComp.base ? (get<{ value_note: string | null }>("SELECT value_note FROM inst_filings WHERE accession=?", cComp.base.accession)?.value_note ?? null) : null,
        });
      }
    }
    // 최근 보고 기간을 먼저 (지난 분기 공시만 있는 기관이 위로 올라오지 않게), 같은 기간 안에서는 보유 가치 순
    holdings.sort((a, b) => b.period.localeCompare(a.period) || (b.value ?? 0) - (a.value ?? 0));
    institutions = { cusip, holdings, trackedCount, info: { source: "SEC EDGAR 13F", fetchedAt } };
  }

  return {
    symbol,
    kind,
    shortInterest: si.length
      ? {
          points: si.map((r) => ({ date: r.settlement_date, shortQty: r.short_qty, prevQty: r.prev_qty, avgDailyVolume: r.avg_daily_volume, revised: Boolean(r.revised), split: Boolean(r.split) })),
          floatShares,
          floatSource,
          info: { source: "FINRA 공매도 잔고 (Consolidated Short Interest)", fetchedAt: Math.max(...si.map((r) => r.fetched_at)) },
        }
      : null,
    shortVolume: sv.length ? { points: sv.map((r) => ({ date: r.trade_date, shortVolume: r.short_volume, totalVolume: r.total_volume })), info: { source: "FINRA Reg SHO 일일 공매도 거래량 (장외 보고분)", fetchedAt: Math.max(...sv.map((r) => r.fetched_at)) } } : null,
    options: op.length
      ? {
          points: op.map((r) => ({ date: r.trade_date, callVolume: r.call_volume, putVolume: r.put_volume, callOI: r.call_oi, putOI: r.put_oi })),
          info: { source: "Nasdaq 옵션 체인 (OPRA 통합)", fetchedAt: Math.max(...op.map((r) => r.fetched_at)) },
          lastAsOf: op[0].as_of,
        }
      : null,
    institutions,
  };
}

export interface MarketSentimentData {
  sentiment: { rows: SentimentRow[]; averages: { bullish: number; neutral: number; bearish: number } | null; info: SourceInfo } | null;
  marketOptions: { rows: { date: string; product: cboe.CboeProduct; callVolume: number | null; putVolume: number | null; callOI: number | null; putOI: number | null; published: number | null }[]; info: SourceInfo } | null;
  institutions: {
    cik: number;
    filer: string;
    group: InstitutionGroup;
    period: string;
    filed: string;
    prevPeriod: string | null;
    totalValue: number | null;
    entries: number | null;
    amendments: number;
    amendmentNotes: string[];
    valueNote: string | null;
    top: { rank: number; issuer: string; title: string; cusip: string; symbol: string | null; shares: number; value: number; prevShares: number | null; prevKnown: boolean }[];
  }[];
  institutionsInfo: SourceInfo;
}

/** opts.institutions=false 면 기관 13F 요약을 건너뛴다 (종목 화면의 '시장 전체 참고'용) */
export function readMarketSentiment(opts: { institutions?: boolean } = {}): MarketSentimentData {
  const ss = all<{ week_ending: string; bullish: number; neutral: number; bearish: number; fetched_at: number }>("SELECT week_ending, bullish, neutral, bearish, fetched_at FROM sentiment_survey WHERE source='AAII' ORDER BY week_ending");
  const meta = readSnapshot<{ averages: { bullish: number; neutral: number; bearish: number } | null }>("aaii_meta", "MARKET");
  const mo = all<{ trade_date: string; product: string; call_volume: number | null; put_volume: number | null; call_oi: number | null; put_oi: number | null; published_ratio: number | null; fetched_at: number }>(
    "SELECT trade_date, product, call_volume, put_volume, call_oi, put_oi, published_ratio, fetched_at FROM option_market WHERE product IN ('total','equity','index','etp') ORDER BY trade_date",
  );
  const insts: MarketSentimentData["institutions"] = [];
  let instFetched: number | null = null;
  for (const it of opts.institutions === false ? [] : INSTITUTIONS) {
    const ip = institutionPeriods(it.cik);
    if (!ip.periods.length) continue;
    instFetched = Math.max(instFetched ?? 0, ip.fetchedAt ?? 0);
    const [cur, prev] = ip.periods;
    const cRows = holdingRows(cur.filings.map((f) => f.accession));
    const cComp = composePeriod(cur.filings, cRows);
    const pComp = prev ? composePeriod(prev.filings, holdingRows(prev.filings.map((f) => f.accession))) : null;
    const meta13 = cComp.base ? get<{ table_value_total: number | null; entry_total: number | null; value_note: string | null }>("SELECT table_value_total, entry_total, value_note FROM inst_filings WHERE accession=?", cComp.base.accession) : undefined;
    // 상위 보유: 기준 공시의 순위 (추가 보고 정정분은 순위가 없으므로 가치로 다시 정렬)
    const info = new Map(cRows.filter((r) => r.putCall === "").map((r) => [r.cusip, r]));
    const top = [...cComp.holdings.entries()]
      .filter(([k]) => k.endsWith("|"))
      .map(([k, v]) => ({ cusip: k.slice(0, -1), ...v }))
      .filter((x) => info.get(x.cusip)?.topRank != null)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
      .map((x, i) => {
        const r = info.get(x.cusip)!;
        const prevH = pComp?.holdings.get(`${x.cusip}|`) ?? null;
        // 직전 공시에서 이 종목을 저장해 두었을 때만(상위 보유였거나 이 사이트 종목) 비교한다
        const prevStored = Boolean(pComp?.base) && (prevH !== null || Boolean(SYMBOL_BY_CUSIP.get(x.cusip)));
        return { rank: i + 1, issuer: r.issuer ?? "", title: r.title ?? "", cusip: x.cusip, symbol: r.symbol, shares: x.shares, value: x.value, prevShares: prevH?.shares ?? null, prevKnown: prevStored };
      });
    insts.push({
      cik: it.cik,
      filer: ip.name ?? `CIK ${it.cik}`,
      group: it.group,
      period: cur.period,
      filed: cComp.base?.filed ?? "",
      prevPeriod: prev?.period ?? null,
      totalValue: meta13?.table_value_total ?? null,
      entries: meta13?.entry_total ?? null,
      amendments: Math.max(0, cComp.used.length - 1) + cComp.others.length,
      amendmentNotes: describeAmendments(cComp),
      valueNote: meta13?.value_note ?? null,
      top,
    });
  }
  insts.sort((a, b) => b.period.localeCompare(a.period) || (b.totalValue ?? 0) - (a.totalValue ?? 0));
  return {
    sentiment: ss.length ? { rows: ss.map((r) => ({ week: r.week_ending, bullish: r.bullish, neutral: r.neutral, bearish: r.bearish })), averages: meta?.data?.averages ?? null, info: { source: "AAII Sentiment Survey", fetchedAt: Math.max(...ss.map((r) => r.fetched_at)) } } : null,
    marketOptions: mo.length
      ? {
          rows: mo.map((r) => ({ date: r.trade_date, product: r.product as cboe.CboeProduct, callVolume: r.call_volume, putVolume: r.put_volume, callOI: r.call_oi, putOI: r.put_oi, published: r.published_ratio })),
          info: { source: "Cboe 일일 옵션 통계 (Cboe 거래소 기준)", fetchedAt: Math.max(...mo.map((r) => r.fetched_at)) },
        }
      : null,
    institutions: insts,
    institutionsInfo: { source: "SEC EDGAR 13F", fetchedAt: instFetched },
  };
}
