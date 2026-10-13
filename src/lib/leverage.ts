/**
 * 레버리지 ETF 분석
 * 같은 기초지수를 따르는 1배 ETF 와 레버리지 ETF 를 '공통 거래일'로 맞춰 같은 기간 실제 성과를 비교한다.
 * - 성과는 분배금 재투자 가정 총수익 지수(배당락일 종가 재투자, 세금·수수료 미반영) 기준
 * - 과거 데이터 분석이며 미래 성과를 예측하거나 보장하지 않는다
 */
import { INSTRUMENTS, type InstrumentConfig } from "@/config/instruments";
import { readBars } from "./data/bars";
import { readDividends } from "./data/dividends";
import { totalReturnIndex } from "./performance";
import { etDate } from "./time";

export interface LeverageMember {
  symbol: string;
  leverage: number;
}

export interface LeverageGroup {
  key: string;
  title: string;
  underlying: string;
  members: LeverageMember[];
}

const underlyingKey = (u?: string) => (u ?? "").replace(/\s*\(.*\)\s*/g, "").trim().toLowerCase();

const GROUP_TITLE: Record<string, string> = {
  "nasdaq-100 index": "나스닥100",
  "s&p 500 index": "S&P 500",
  "nyse semiconductor index": "반도체 (NYSE 반도체 지수)",
};

/** 설정 파일의 기초지수·레버리지 정보로 묶음을 만든다 (레버리지 ETF 가 있는 기초지수만) */
export function leverageGroups(instruments: InstrumentConfig[] = INSTRUMENTS): LeverageGroup[] {
  const groups = new Map<string, LeverageGroup>();
  for (const i of instruments) {
    if (!i.leverage) continue;
    const k = underlyingKey(i.underlying);
    if (!k) continue;
    const g = groups.get(k) ?? { key: k.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), title: GROUP_TITLE[k] ?? (i.underlying ?? k), underlying: (i.underlying ?? "").replace(/\s*\(.*\)\s*/g, ""), members: [] };
    g.members.push({ symbol: i.symbol, leverage: i.leverage });
    groups.set(k, g);
  }
  for (const [k, g] of groups) {
    const base = instruments.filter((i) => !i.leverage && i.kind === "etf" && (i.strategy === "index" || i.strategy === "sector") && underlyingKey(i.underlying) === k);
    for (const b of base) g.members.push({ symbol: b.symbol, leverage: 1 });
  }
  return [...groups.values()].map((g) => ({ ...g, members: g.members.sort((a, b) => a.leverage - b.leverage || a.symbol.localeCompare(b.symbol)) }));
}

// ─────────────────────────────── 순수 계산 ───────────────────────────────

export interface AlignedSeries {
  symbol: string;
  leverage: number;
  /** 공통 거래일 기준 총수익 지수 */
  tr: number[];
}

export interface PeriodRow {
  key: string;
  label: string;
  start: string;
  values: Record<string, number | null>;
  /** 레버리지 ETF: 실제 − (기준 ETF 수익률 × 배수) */
  vsMultiple: Record<string, number | null>;
}

export interface Episode {
  peak: string;
  trough: string;
  recovered: string | null;
  baseLoss: number;
  members: Record<string, { loss: number; recovery: string | null; recoveryDays: number | null; nowFromPeak: number }>;
}

export interface YearRow {
  year: number;
  partial: boolean;
  values: Record<string, number>;
}

export interface RollingStat {
  symbol: string;
  windows: number;
  worst: number;
  median: number;
  best: number;
  lossShare: number;
  /** 기준 ETF 보다 낮았던 비율 */
  underBaseShare: number | null;
  /** 기준 ETF 수익률 × 배수보다 낮았던 비율 */
  underMultipleShare: number | null;
}

export interface MemberStats {
  symbol: string;
  leverage: number;
  firstDate: string;
  vol1y: number | null;
  volAll: number | null;
  mdd: number;
  mddPeak: string;
  mddTrough: string;
  fromAth: number;
  athDate: string;
}

export interface LeverageAnalysis {
  group: LeverageGroup;
  base: string;
  start: string;
  end: string;
  days: number;
  members: MemberStats[];
  periods: PeriodRow[];
  years: YearRow[];
  episodes: Episode[];
  rolling: RollingStat[];
  /** 차트용 (주 단위로 줄인 총수익 지수, 시작 100) */
  chart: { dates: string[]; series: Record<string, number[]> };
  excluded: { symbol: string; reason: string }[];
  dataAsOf: string;
}

const ret = (a: number, b: number) => (b / a - 1) * 100;

function annVol(tr: number[], from = 0): number | null {
  const r: number[] = [];
  for (let i = Math.max(1, from + 1); i < tr.length; i++) r.push(Math.log(tr[i] / tr[i - 1]));
  if (r.length < 20) return null;
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1)) * Math.sqrt(252) * 100;
}

function mddOf(tr: number[], dates: string[]) {
  let peak = 0;
  let best = { mdd: 0, peak: 0, trough: 0 };
  for (let i = 1; i < tr.length; i++) {
    if (tr[i] > tr[peak]) peak = i;
    const d = tr[i] / tr[peak] - 1;
    if (d < best.mdd) best = { mdd: d, peak, trough: i };
  }
  return { mdd: best.mdd * 100, peak: dates[best.peak], trough: dates[best.trough] };
}

/** 시작일 직전(포함) 마지막 공통 거래일 인덱스 */
function indexOnOrBefore(dates: string[], d: string): number {
  let lo = 0;
  let hi = dates.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] <= d) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

const PERIODS: { key: string; label: string; days?: number; ytd?: boolean; all?: boolean }[] = [
  { key: "1m", label: "1개월", days: 31 },
  { key: "3m", label: "3개월", days: 92 },
  { key: "6m", label: "6개월", days: 183 },
  { key: "ytd", label: "연초 이후", ytd: true },
  { key: "1y", label: "1년", days: 365 },
  { key: "3y", label: "3년", days: 365 * 3 },
  { key: "5y", label: "5년", days: 365 * 5 },
  { key: "10y", label: "10년", days: 3652 },
  { key: "all", label: "공통 기간 전체", all: true },
];

export function analyzeAligned(group: LeverageGroup, baseSymbol: string, dates: string[], series: AlignedSeries[], firstDates: Record<string, string>): Omit<LeverageAnalysis, "excluded" | "dataAsOf"> {
  const end = dates[dates.length - 1];
  const base = series.find((s) => s.symbol === baseSymbol) as AlignedSeries;

  // 기간별 수익률
  const periods: PeriodRow[] = [];
  for (const p of PERIODS) {
    let startIdx: number;
    if (p.all) startIdx = 0;
    else if (p.ytd) startIdx = indexOnOrBefore(dates, `${Number(end.slice(0, 4)) - 1}-12-31`);
    else startIdx = indexOnOrBefore(dates, new Date(Date.parse(`${end}T00:00:00Z`) - (p.days as number) * 86400000).toISOString().slice(0, 10));
    if (startIdx < 0 || (p.days && Date.parse(dates[0]) > Date.parse(end) - (p.days as number) * 86400000 + 5 * 86400000)) continue;
    const values: Record<string, number | null> = {};
    const vsMultiple: Record<string, number | null> = {};
    const baseR = ret(base.tr[startIdx], base.tr[base.tr.length - 1]);
    for (const s of series) {
      values[s.symbol] = ret(s.tr[startIdx], s.tr[s.tr.length - 1]);
      vsMultiple[s.symbol] = s.symbol === baseSymbol ? null : (values[s.symbol] as number) - baseR * s.leverage;
    }
    periods.push({ key: p.key, label: p.label, start: dates[startIdx], values, vsMultiple });
  }

  // 연도별
  const years: YearRow[] = [];
  const y0 = Number(dates[0].slice(0, 4));
  const y1 = Number(end.slice(0, 4));
  for (let y = y0; y <= y1; y++) {
    const s = y === y0 ? 0 : indexOnOrBefore(dates, `${y - 1}-12-31`);
    const e = indexOnOrBefore(dates, `${y}-12-31`);
    if (s < 0 || e <= s) continue;
    const values: Record<string, number> = {};
    for (const x of series) values[x.symbol] = ret(x.tr[s], x.tr[e]);
    years.push({ year: y, partial: y === y0 ? dates[0] > `${y}-01-05` : y === y1, values });
  }

  // 급락 구간 (기준 ETF 고점 대비 −15% 이상)
  const episodes: Episode[] = [];
  const TH = -0.15;
  let peak = 0;
  let trough = 0;
  let minDd = 0;
  const record = (pk: number, tg: number, rec: number | null) => {
    const members: Episode["members"] = {};
    for (const s of series) {
      const atPeak = s.tr[pk];
      let r: number | null = null;
      for (let i = pk + 1; i < s.tr.length; i++) {
        if (s.tr[i] >= atPeak) {
          r = i;
          break;
        }
      }
      members[s.symbol] = {
        loss: ret(atPeak, s.tr[tg]),
        recovery: r !== null ? dates[r] : null,
        recoveryDays: r !== null ? Math.round((Date.parse(dates[r]) - Date.parse(dates[pk])) / 86400000) : null,
        nowFromPeak: ret(atPeak, s.tr[s.tr.length - 1]),
      };
    }
    episodes.push({ peak: dates[pk], trough: dates[tg], recovered: rec !== null ? dates[rec] : null, baseLoss: ret(base.tr[pk], base.tr[tg]), members });
  };
  for (let i = 1; i < base.tr.length; i++) {
    if (base.tr[i] >= base.tr[peak]) {
      if (minDd <= TH) record(peak, trough, i);
      peak = i;
      trough = i;
      minDd = 0;
    } else {
      const d = base.tr[i] / base.tr[peak] - 1;
      if (d < minDd) {
        minDd = d;
        trough = i;
      }
    }
  }
  if (minDd <= TH) record(peak, trough, null);

  // 1년(252거래일) 보유 구간 분포
  const W = 252;
  const rolling: RollingStat[] = [];
  if (dates.length > W + 20) {
    for (const s of series) {
      const rs: number[] = [];
      let under = 0;
      let underMul = 0;
      for (let i = W; i < s.tr.length; i++) {
        const r = ret(s.tr[i - W], s.tr[i]);
        rs.push(r);
        const br = ret(base.tr[i - W], base.tr[i]);
        if (r < br) under++;
        if (r < br * s.leverage) underMul++;
      }
      const sorted = [...rs].sort((a, b) => a - b);
      rolling.push({
        symbol: s.symbol,
        windows: rs.length,
        worst: sorted[0],
        median: sorted[Math.floor(sorted.length / 2)],
        best: sorted[sorted.length - 1],
        lossShare: (rs.filter((r) => r < 0).length / rs.length) * 100,
        underBaseShare: s.symbol === baseSymbol ? null : (under / rs.length) * 100,
        underMultipleShare: s.symbol === baseSymbol ? null : (underMul / rs.length) * 100,
      });
    }
  }

  // 종목별 위험 지표
  const oneYearIdx = Math.max(0, indexOnOrBefore(dates, new Date(Date.parse(`${end}T00:00:00Z`) - 365 * 86400000).toISOString().slice(0, 10)));
  const members: MemberStats[] = series.map((s) => {
    const m = mddOf(s.tr, dates);
    let ath = 0;
    for (let i = 1; i < s.tr.length; i++) if (s.tr[i] >= s.tr[ath]) ath = i;
    return {
      symbol: s.symbol,
      leverage: s.leverage,
      firstDate: firstDates[s.symbol],
      vol1y: annVol(s.tr, oneYearIdx),
      volAll: annVol(s.tr),
      mdd: m.mdd,
      mddPeak: m.peak,
      mddTrough: m.trough,
      fromAth: ret(s.tr[ath], s.tr[s.tr.length - 1]),
      athDate: dates[ath],
    };
  });

  // 차트: 주 단위(금요일 또는 마지막 거래일)로 줄이고 시작 100
  const pick: number[] = [];
  for (let i = 0; i < dates.length; i++) {
    const last = i === dates.length - 1;
    const nextWeek = !last && new Date(`${dates[i + 1]}T00:00:00Z`).getUTCDay() < new Date(`${dates[i]}T00:00:00Z`).getUTCDay();
    if (i === 0 || last || nextWeek) pick.push(i);
  }
  const chart = {
    dates: pick.map((i) => dates[i]),
    series: Object.fromEntries(series.map((s) => [s.symbol, pick.map((i) => Math.round((s.tr[i] / s.tr[0]) * 10000) / 100)])),
  };

  return { group, base: baseSymbol, start: dates[0], end, days: dates.length, members, periods, years, episodes: episodes.reverse(), rolling, chart };
}

// ─────────────────────────────── DB 에서 불러오기 ───────────────────────────────

function loadTr(symbol: string): { dates: string[]; tr: number[] } | null {
  const bars = readBars(symbol, "1d");
  if (bars.length < 30) return null;
  const pts = bars.map((b) => ({ date: etDate(b.t * 1000), close: b.c }));
  const tri = totalReturnIndex(
    pts,
    readDividends(symbol).map((d) => ({ exDate: d.exDate, amount: d.amount })),
  );
  return { dates: tri.map((p) => p.date), tr: tri.map((p) => p.value) };
}

export function analyzeLeverageGroup(group: LeverageGroup): LeverageAnalysis | null {
  const loaded = new Map<string, { dates: string[]; tr: number[] }>();
  const excluded: { symbol: string; reason: string }[] = [];
  for (const m of group.members) {
    const d = loadTr(m.symbol);
    if (d) loaded.set(m.symbol, d);
    else excluded.push({ symbol: m.symbol, reason: "일봉 데이터가 없거나 부족합니다" });
  }
  const baseCandidates = group.members.filter((m) => m.leverage === 1 && loaded.has(m.symbol));
  if (!baseCandidates.length) return null;
  // 기준 ETF: 기록이 가장 긴 1배 ETF 하나만 사용 (같은 지수를 따르는 다른 1배 ETF 는 표에서 제외해 비교를 단순하게)
  const base = baseCandidates.sort((a, b) => (loaded.get(a.symbol) as { dates: string[] }).dates[0].localeCompare((loaded.get(b.symbol) as { dates: string[] }).dates[0]))[0].symbol;
  const used = group.members.filter((m) => loaded.has(m.symbol) && (m.leverage > 1 || m.symbol === base));
  if (used.length < 2) return null;
  // 공통 거래일
  let common: string[] = (loaded.get(used[0].symbol) as { dates: string[] }).dates;
  for (const m of used.slice(1)) {
    const s = new Set((loaded.get(m.symbol) as { dates: string[] }).dates);
    common = common.filter((d) => s.has(d));
  }
  const dates = [...common].sort();
  if (dates.length < 60) return null;
  const firstDates: Record<string, string> = {};
  const series: AlignedSeries[] = used.map((m) => {
    const d = loaded.get(m.symbol) as { dates: string[]; tr: number[] };
    firstDates[m.symbol] = d.dates[0];
    const map = new Map(d.dates.map((x, i) => [x, d.tr[i]]));
    return { symbol: m.symbol, leverage: m.leverage, tr: dates.map((x) => map.get(x) as number) };
  });
  const a = analyzeAligned(group, base, dates, series, firstDates);
  return { ...a, excluded, dataAsOf: a.end };
}

// ─────────────────────────────── 대시보드용 위험 지표 ───────────────────────────────

export interface LeverageRisk {
  symbol: string;
  leverage: number;
  base: string;
  /** 상장 이후 최고 종가 대비 (가격 기준) */
  fromAth: number;
  athDate: string;
  ret20: number | null;
  base20: number | null;
  /** 20거래일 실제 수익률 − 기준 ETF 수익률 × 배수 */
  gap20: number | null;
  /** 기준 ETF 20일 실현 변동성 (연환산 %) */
  baseVol20: number | null;
  asOf: string;
}

export function leverageRiskSnapshot(): LeverageRisk[] {
  const out: LeverageRisk[] = [];
  const closesOf = (s: string) => readBars(s, "1d").map((b) => ({ date: etDate(b.t * 1000), c: b.c }));
  for (const g of leverageGroups()) {
    const bases = g.members.filter((m) => m.leverage === 1).map((m) => ({ s: m.symbol, d: closesOf(m.symbol) })).filter((x) => x.d.length > 30);
    if (!bases.length) continue;
    const base = bases.sort((a, b) => a.d[0].date.localeCompare(b.d[0].date))[0];
    const bMap = new Map(base.d.map((x) => [x.date, x.c]));
    for (const m of g.members.filter((x) => x.leverage > 1)) {
      const d = closesOf(m.symbol);
      if (d.length < 30) continue;
      let ath = 0;
      for (let i = 1; i < d.length; i++) if (d[i].c >= d[ath].c) ath = i;
      const last = d[d.length - 1];
      const p20 = d[d.length - 21];
      const ret20 = p20 ? (last.c / p20.c - 1) * 100 : null;
      const b1 = bMap.get(last.date);
      const b0 = p20 ? bMap.get(p20.date) : undefined;
      const base20 = b1 && b0 ? (b1 / b0 - 1) * 100 : null;
      const bc = base.d.filter((x) => x.date <= last.date).slice(-21).map((x) => x.c);
      let vol: number | null = null;
      if (bc.length >= 21) {
        const r = bc.slice(1).map((c, i) => Math.log(c / bc[i]));
        const mean = r.reduce((a, b) => a + b, 0) / r.length;
        vol = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1)) * Math.sqrt(252) * 100;
      }
      out.push({
        symbol: m.symbol,
        leverage: m.leverage,
        base: base.s,
        fromAth: (last.c / d[ath].c - 1) * 100,
        athDate: d[ath].date,
        ret20,
        base20,
        gap20: ret20 !== null && base20 !== null ? ret20 - base20 * m.leverage : null,
        baseVol20: vol,
        asOf: last.date,
      });
    }
  }
  return out;
}
