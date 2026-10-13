/**
 * 기업 재무 지표 / ETF 운용 정보 수집·조회
 * - Yahoo quoteSummary: 밸류에이션 지표, 실적 일정, ETF 총보수·운용자산·편입 종목·과거 수익률
 * - SEC companyfacts: 분기·연간 재무제표 (공식 공시)
 * - Finnhub stock/metric: 기본 지표 (Yahoo 실패 시 보완)
 * - Alpha Vantage ETF_PROFILE: ETF 총보수·순자산·편입 종목 (Yahoo 실패 시 보완)
 */
import { get, run } from "../db";
import { env } from "../env";
import { getInstrument } from "../instruments";
import * as yahoo from "../providers/yahoo";
import * as sec from "../providers/sec";
import * as finnhub from "../providers/finnhub";
import * as av from "../providers/alphavantage";
import { extractFinancials, ttm, yoyGrowth, type Financials } from "../financials";
import { rawNum } from "../providers/yahoo";

export interface Snapshot<T> {
  data: T;
  source: string | null;
  fetchedAt: number;
}

export function readSnapshot<T>(kind: string, symbol: string): Snapshot<T> | null {
  const row = get<{ data: string; source: string | null; fetched_at: number }>(
    "SELECT data, source, fetched_at FROM snapshots WHERE kind=? AND symbol=?",
    kind,
    symbol,
  );
  if (!row) return null;
  try {
    return { data: JSON.parse(row.data) as T, source: row.source, fetchedAt: row.fetched_at };
  } catch {
    return null;
  }
}

export function writeSnapshot(kind: string, symbol: string, data: unknown, source: string) {
  run(
    "INSERT INTO snapshots(kind, symbol, data, source, fetched_at) VALUES(?,?,?,?,?) ON CONFLICT(kind, symbol) DO UPDATE SET data=excluded.data, source=excluded.source, fetched_at=excluded.fetched_at",
    kind,
    symbol,
    JSON.stringify(data),
    source,
    Date.now(),
  );
}

const STOCK_MODULES = ["price", "summaryDetail", "defaultKeyStatistics", "financialData", "calendarEvents", "assetProfile", "earnings"];
const ETF_MODULES = ["price", "summaryDetail", "defaultKeyStatistics", "fundProfile", "topHoldings", "fundPerformance", "assetProfile"];

export interface RefreshProfileResult {
  symbol: string;
  done: string[];
  errors: string[];
}

/** 프로필·재무 데이터 갱신. maxAgeMs 이내에 받은 데이터는 건너뛴다 */
export async function refreshProfile(symbol: string, opts: { maxAgeMs?: number; includeSec?: boolean } = {}): Promise<RefreshProfileResult> {
  const inst = getInstrument(symbol);
  const isEtf = inst?.kind === "etf";
  const maxAge = opts.maxAgeMs ?? 20 * 3600_000;
  const out: RefreshProfileResult = { symbol, done: [], errors: [] };
  const fresh = (kind: string, age = maxAge) => {
    const s = readSnapshot(kind, symbol);
    return s && Date.now() - s.fetchedAt < age;
  };

  if (env.yahooEnabled && !fresh("yahoo_summary")) {
    try {
      const r = await yahoo.fetchQuoteSummary(symbol, isEtf ? ETF_MODULES : STOCK_MODULES);
      writeSnapshot("yahoo_summary", symbol, r, "Yahoo Finance");
      out.done.push("yahoo_summary");
    } catch (e) {
      out.errors.push((e as Error).message);
    }
  }

  if (!isEtf && finnhub.finnhubEnabled() && !fresh("finnhub_metric")) {
    try {
      writeSnapshot("finnhub_metric", symbol, await finnhub.basicMetrics(symbol), "Finnhub");
      out.done.push("finnhub_metric");
    } catch (e) {
      out.errors.push((e as Error).message);
    }
  }

  if (!isEtf && inst?.cik && (opts.includeSec ?? true) && sec.secEnabled() && !fresh("sec_financials", 6 * 86400_000)) {
    try {
      const facts = await sec.fetchCompanyFacts(inst.cik);
      writeSnapshot("sec_financials", symbol, extractFinancials(facts), "SEC EDGAR");
      out.done.push("sec_financials");
    } catch (e) {
      out.errors.push((e as Error).message);
    }
  }

  if (!isEtf && inst?.cik && (opts.includeSec ?? true) && sec.secEnabled() && !fresh("sec_filings")) {
    try {
      writeSnapshot("sec_filings", symbol, await sec.fetchRecentFilings(inst.cik), "SEC EDGAR");
      out.done.push("sec_filings");
    } catch (e) {
      out.errors.push((e as Error).message);
    }
  }

  // Alpha Vantage 는 하루 호출 수가 적으므로 Yahoo ETF 정보가 없을 때 우선, 그 외에는 7일 주기로 갱신
  if (isEtf && av.alphaVantageEnabled()) {
    const ysum = readSnapshot<Record<string, unknown>>("yahoo_summary", symbol);
    const needs = !ysum || !(ysum.data.topHoldings as object | undefined) || !fresh("av_etf_profile", 7 * 86400_000);
    if (needs && !fresh("av_etf_profile", 3 * 86400_000)) {
      try {
        writeSnapshot("av_etf_profile", symbol, await av.fetchEtfProfile(symbol), "Alpha Vantage");
        out.done.push("av_etf_profile");
      } catch (e) {
        out.errors.push((e as Error).message);
      }
    }
  }
  return out;
}

// ───────────────────────────── 화면용 조립 ─────────────────────────────
export interface Field<T = number> {
  value: T | null;
  source: string | null;
  note?: string;
}

const f = <T>(value: T | null | undefined, source: string | null, note?: string): Field<T> => ({
  value: value === undefined || (typeof value === "number" && !Number.isFinite(value)) ? null : (value as T | null),
  source: value === null || value === undefined ? null : source,
  note,
});

function pick<T>(...cands: Field<T>[]): Field<T> {
  return cands.find((c) => c.value !== null) ?? { value: null, source: null };
}

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});

export interface StockFundamentalsView {
  marketCap: Field;
  fiftyTwoHigh: Field;
  fiftyTwoLow: Field;
  avgVolume3m: Field;
  avgVolume10d: Field;
  trailingPE: Field;
  forwardPE: Field;
  priceToBook: Field;
  roe: Field;
  epsTTM: Field;
  dividendRate: Field;
  dividendYield: Field;
  payoutRatio: Field;
  revenueTTM: Field;
  revenueGrowthYoY: Field;
  operatingIncomeTTM: Field;
  netIncomeTTM: Field;
  operatingCashFlowTTM: Field;
  freeCashFlowTTM: Field;
  operatingMargin: Field;
  sector: Field<string>;
  industry: Field<string>;
  summary: Field<string>;
  website: Field<string>;
  employees: Field;
  nextEarnings: Field<string>;
  exDividendDate: Field<string>;
  financials: Financials | null;
  financialsFetchedAt: number | null;
  earningsHistory: { quarter: string; actual: number | null; estimate: number | null }[];
  sources: { kind: string; source: string | null; fetchedAt: number }[];
}

function epochToDate(v: unknown): string | null {
  const n = rawNum(v);
  if (!n) return null;
  return new Date(n * 1000).toISOString().slice(0, 10);
}

export function stockFundamentals(symbol: string, price: number | null): StockFundamentalsView {
  const ys = readSnapshot<Obj>("yahoo_summary", symbol);
  const fm = readSnapshot<Obj>("finnhub_metric", symbol);
  const sf = readSnapshot<Financials>("sec_financials", symbol);
  const Y = "Yahoo Finance";
  const F = "Finnhub";
  const S = "SEC EDGAR (계산값)";
  const sd = o(ys?.data.summaryDetail);
  const ks = o(ys?.data.defaultKeyStatistics);
  const fd = o(ys?.data.financialData);
  const pr = o(ys?.data.price);
  const ap = o(ys?.data.assetProfile);
  const ce = o(ys?.data.calendarEvents);
  const fmD = o(fm?.data);
  const fin = sf?.data ?? null;

  const revTtm = ttm(fin?.revenue);
  const opTtm = ttm(fin?.operatingIncome);
  const niTtm = ttm(fin?.netIncome);
  const ocfTtm = ttm(fin?.operatingCashFlow);
  const capexTtm = ttm(fin?.capex);
  const fcf = ocfTtm && capexTtm ? ocfTtm.value - capexTtm.value : null;
  const epsSecTtm = (() => {
    const q = fin?.epsDiluted?.quarterly.slice(-4) ?? [];
    return q.length === 4 ? q.reduce((a, v) => a + v.value, 0) : null;
  })();
  // ROE = TTM 순이익 ÷ 평균 자기자본(최근·1년 전)
  const eq = fin?.equity?.quarterly ?? [];
  const eqLast = eq[eq.length - 1];
  const eqYearAgo = eqLast ? eq.find((e) => Math.abs(Date.parse(e.end) - (Date.parse(eqLast.end) - 365 * 86400000)) < 20 * 86400000) : undefined;
  const roeSec = niTtm && eqLast && eqYearAgo ? (niTtm.value / ((eqLast.value + eqYearAgo.value) / 2)) * 100 : null;

  const earningsDates = (o(ce.earnings).earningsDate as unknown[] | undefined) ?? [];
  const nextEarn = earningsDates.map(epochToDate).filter(Boolean).sort()[0] ?? null;

  const eqHist = (o(o(ys?.data.earnings).earningsChart).quarterly as Obj[] | undefined) ?? [];

  const fmNum = (k: string) => (typeof fmD[k] === "number" ? (fmD[k] as number) : null);

  return {
    marketCap: pick(f(rawNum(sd.marketCap) ?? rawNum(pr.marketCap), Y), f(fmNum("marketCapitalization") ? (fmNum("marketCapitalization") as number) * 1e6 : null, F)),
    fiftyTwoHigh: pick(f(rawNum(sd.fiftyTwoWeekHigh), Y), f(fmNum("52WeekHigh"), F)),
    fiftyTwoLow: pick(f(rawNum(sd.fiftyTwoWeekLow), Y), f(fmNum("52WeekLow"), F)),
    avgVolume3m: pick(f(rawNum(sd.averageVolume), Y), f(fmNum("3MonthAverageTradingVolume") ? (fmNum("3MonthAverageTradingVolume") as number) * 1e6 : null, F)),
    avgVolume10d: pick(f(rawNum(sd.averageVolume10days), Y), f(fmNum("10DayAverageTradingVolume") ? (fmNum("10DayAverageTradingVolume") as number) * 1e6 : null, F)),
    trailingPE: pick(
      f(rawNum(sd.trailingPE), Y),
      f(fmNum("peTTM"), F),
      f(price && epsSecTtm && epsSecTtm > 0 ? price / epsSecTtm : null, S, "현재가 ÷ 최근 4분기 희석 EPS 합"),
    ),
    forwardPE: pick(f(rawNum(sd.forwardPE) ?? rawNum(ks.forwardPE), Y, "애널리스트 추정 EPS 기준")),
    priceToBook: pick(f(rawNum(ks.priceToBook), Y), f(fmNum("pbQuarterly") ?? fmNum("pbAnnual"), F)),
    roe: pick(
      f(rawNum(fd.returnOnEquity) !== null ? (rawNum(fd.returnOnEquity) as number) * 100 : null, Y),
      f(fmNum("roeTTM"), F),
      f(roeSec, S, "최근 4분기 순이익 ÷ 평균 자기자본"),
    ),
    epsTTM: pick(f(rawNum(ks.trailingEps), Y), f(epsSecTtm, S, "최근 4분기 희석 EPS 합")),
    dividendRate: pick(f(rawNum(sd.dividendRate), Y, "제공처 기준 연간 배당금(예상)")),
    dividendYield: pick(f(rawNum(sd.dividendYield) !== null ? (rawNum(sd.dividendYield) as number) * 100 : null, Y, "제공처 계산값")),
    payoutRatio: pick(f(rawNum(sd.payoutRatio) !== null ? (rawNum(sd.payoutRatio) as number) * 100 : null, Y)),
    revenueTTM: pick(f(revTtm?.value ?? null, S, revTtm ? `최근 4분기 합 (${revTtm.end} 종료)` : undefined), f(rawNum(fd.totalRevenue), Y)),
    revenueGrowthYoY: pick(
      f(yoyGrowth(fin?.revenue), S, "최근 분기 매출 전년 동기 대비"),
      f(rawNum(fd.revenueGrowth) !== null ? (rawNum(fd.revenueGrowth) as number) * 100 : null, Y),
    ),
    operatingIncomeTTM: pick(f(opTtm?.value ?? null, S, "최근 4분기 합")),
    netIncomeTTM: pick(f(niTtm?.value ?? null, S, "최근 4분기 합"), f(rawNum(ks.netIncomeToCommon), Y)),
    operatingCashFlowTTM: pick(f(ocfTtm?.value ?? null, S, "최근 4분기 합"), f(rawNum(fd.operatingCashflow), Y)),
    freeCashFlowTTM: pick(
      f(fcf, S, "영업현금흐름 − 유형자산 취득(설비투자), 최근 4분기"),
      f(rawNum(fd.freeCashflow), Y, "Yahoo 산출 레버리지드 FCF (정의가 다를 수 있음)"),
    ),
    operatingMargin: pick(
      f(opTtm && revTtm && revTtm.value ? (opTtm.value / revTtm.value) * 100 : null, S, "최근 4분기 영업이익 ÷ 매출"),
      f(rawNum(fd.operatingMargins) !== null ? (rawNum(fd.operatingMargins) as number) * 100 : null, Y),
    ),
    sector: f(typeof ap.sector === "string" ? ap.sector : null, Y),
    industry: f(typeof ap.industry === "string" ? ap.industry : null, Y),
    summary: f(typeof ap.longBusinessSummary === "string" ? ap.longBusinessSummary : null, Y),
    website: f(typeof ap.website === "string" ? ap.website : null, Y),
    employees: f(rawNum(ap.fullTimeEmployees), Y),
    nextEarnings: f(nextEarn, Y, "실적 발표 예정일 (제공처 기준, 변경될 수 있음)"),
    exDividendDate: f(epochToDate(ce.exDividendDate), Y),
    financials: fin,
    financialsFetchedAt: sf?.fetchedAt ?? null,
    earningsHistory: eqHist.map((q) => ({
      quarter: String(q.date ?? ""),
      actual: rawNum(q.actual),
      estimate: rawNum(q.estimate),
    })),
    sources: [
      ys && { kind: "기업 지표·실적 일정", source: ys.source, fetchedAt: ys.fetchedAt },
      fm && { kind: "기본 재무 지표(보완)", source: fm.source, fetchedAt: fm.fetchedAt },
      sf && { kind: "재무제표 (10-K/10-Q)", source: sf.source, fetchedAt: sf.fetchedAt },
    ].filter(Boolean) as { kind: string; source: string | null; fetchedAt: number }[],
  };
}

export interface EtfProfileView {
  totalAssets: Field;
  expenseRatio: Field;
  nav: Field;
  family: Field<string>;
  category: Field<string>;
  inceptionDate: Field<string>;
  yieldProvider: Field;
  beta3y: Field;
  summary: Field<string>;
  holdings: { symbol: string | null; name: string; weight: number }[];
  holdingsSource: string | null;
  sectors: { sector: string; weight: number }[];
  top10Weight: number | null;
  trailingReturns: { label: string; value: number | null }[];
  annualReturns: { year: number; value: number | null }[];
  returnsSource: string | null;
  sources: { kind: string; source: string | null; fetchedAt: number }[];
}

const SECTOR_KO: Record<string, string> = {
  realestate: "부동산",
  consumer_cyclical: "경기소비재",
  basic_materials: "소재",
  consumer_defensive: "필수소비재",
  technology: "기술",
  communication_services: "커뮤니케이션",
  financial_services: "금융",
  utilities: "유틸리티",
  industrials: "산업재",
  energy: "에너지",
  healthcare: "헬스케어",
};

export function etfProfile(symbol: string): EtfProfileView {
  const ys = readSnapshot<Obj>("yahoo_summary", symbol);
  const avs = readSnapshot<av.AvEtfProfile>("av_etf_profile", symbol);
  const Y = "Yahoo Finance";
  const A = "Alpha Vantage";
  const sd = o(ys?.data.summaryDetail);
  const ks = o(ys?.data.defaultKeyStatistics);
  const fp = o(ys?.data.fundProfile);
  const th = o(ys?.data.topHoldings);
  const perf = o(ys?.data.fundPerformance);
  const ap = o(ys?.data.assetProfile);
  const fees = o(fp.feesExpensesInvestment);
  const AV = avs?.data;

  const yHoldings = ((th.holdings as Obj[] | undefined) ?? [])
    .map((h) => ({
      symbol: typeof h.symbol === "string" ? h.symbol : null,
      name: String(h.holdingName ?? h.symbol ?? ""),
      weight: (rawNum(h.holdingPercent) ?? NaN) * 100,
    }))
    .filter((h) => Number.isFinite(h.weight));
  const avHoldings = (AV?.holdings ?? []).map((h) => ({ ...h, weight: h.weight * 100 }));
  const holdings = yHoldings.length ? yHoldings : avHoldings;
  const holdingsSource = yHoldings.length ? Y : avHoldings.length ? A : null;

  const ySectors = ((th.sectorWeightings as Obj[] | undefined) ?? []).flatMap((obj) =>
    Object.entries(obj).map(([k, v]) => ({ sector: SECTOR_KO[k] ?? k, weight: (rawNum(v) ?? NaN) * 100 })),
  ).filter((s) => Number.isFinite(s.weight) && s.weight > 0);
  const sectors = ySectors.length ? ySectors : (AV?.sectors ?? []).map((s) => ({ sector: s.sector, weight: s.weight * 100 }));

  const tr = o(perf.trailingReturns);
  const trailingReturns = [
    { label: "연초 이후", value: rawNum(tr.ytd) },
    { label: "1년", value: rawNum(tr.oneYear) },
    { label: "3년(연환산)", value: rawNum(tr.threeYear) },
    { label: "5년(연환산)", value: rawNum(tr.fiveYear) },
    { label: "10년(연환산)", value: rawNum(tr.tenYear) },
  ].map((r) => ({ ...r, value: r.value !== null ? r.value * 100 : null }));
  const annual = ((o(perf.annualTotalReturns).returns as Obj[] | undefined) ?? [])
    .map((r) => ({ year: Number(r.year), value: rawNum(r.annualValue) !== null ? (rawNum(r.annualValue) as number) * 100 : null }))
    .filter((r) => Number.isFinite(r.year))
    .sort((a, b) => b.year - a.year)
    .slice(0, 10);
  const top10 = holdings.length ? holdings.slice(0, 10).reduce((a, h) => a + h.weight, 0) : null;
  const er = rawNum(fees.annualReportExpenseRatio) ?? rawNum(ks.annualReportExpenseRatio) ?? rawNum(sd.expenseRatio);

  return {
    totalAssets: pick(f(rawNum(sd.totalAssets) ?? rawNum(ks.totalAssets), Y), f(AV?.netAssets ?? null, A)),
    expenseRatio: pick(f(er !== null ? er * 100 : null, Y, "연간 보고서 기준 총보수"), f(AV?.netExpenseRatio != null ? AV.netExpenseRatio * 100 : null, A, "순 총보수")),
    nav: pick(f(rawNum(sd.navPrice), Y, "제공처가 보고한 최근 NAV")),
    family: pick(f(typeof fp.family === "string" ? fp.family : null, Y)),
    category: pick(f(typeof fp.categoryName === "string" ? fp.categoryName : null, Y)),
    inceptionDate: pick(f(epochToDate(ks.fundInceptionDate), Y), f(AV?.inceptionDate ?? null, A)),
    yieldProvider: pick(f(rawNum(sd.yield) !== null ? (rawNum(sd.yield) as number) * 100 : null, Y, "제공처 산출 수익률 (산식 비공개)")),
    beta3y: pick(f(rawNum(ks.beta3Year), Y)),
    summary: pick(f(typeof ap.longBusinessSummary === "string" ? ap.longBusinessSummary : null, Y)),
    holdings,
    holdingsSource,
    sectors,
    top10Weight: top10,
    trailingReturns,
    annualReturns: annual,
    returnsSource: trailingReturns.some((r) => r.value !== null) ? Y : null,
    sources: [
      ys && { kind: "ETF 프로필·편입 종목·과거 수익률", source: ys.source, fetchedAt: ys.fetchedAt },
      avs && { kind: "ETF 프로필(보완)", source: avs.source, fetchedAt: avs.fetchedAt },
    ].filter(Boolean) as { kind: string; source: string | null; fetchedAt: number }[],
  };
}

/** 상위 편입 종목 (브리핑·뉴스 연관성 판단용) */
export function topHoldings(symbol: string, minWeight = 3): { symbol: string; name: string; weight: number }[] {
  const v = etfProfile(symbol);
  return v.holdings.filter((h) => h.symbol && h.weight >= minWeight).map((h) => ({ symbol: (h.symbol as string).toUpperCase(), name: h.name, weight: h.weight }));
}

/** 저장된 최근 SEC 공시 목록 (개별 기업만) */
export function readFilings(symbol: string): { items: sec.SecFiling[]; fetchedAt: number } | null {
  const s = readSnapshot<sec.SecFiling[]>("sec_filings", symbol);
  return s ? { items: s.data, fetchedAt: s.fetchedAt } : null;
}
