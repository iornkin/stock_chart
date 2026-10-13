/**
 * 미래 포트폴리오 시나리오 계산 (순수 함수) — 예측이 아니라 사용자가 정한 가정의 계산 결과
 *
 * 계산 기준 (이중 계산 방지)
 * - 가격 수익률: 분배금을 뺀 가격 변화율(연 %). 매달 (1+가격 수익률)^(1/12) 만큼 평가금액이 변한다.
 * - 분배금 수익률: 그 달 평가금액 기준 연 %. 한 해 분배금을 과거 실제 지급 월의 비중대로 나눠 지급한다.
 *   지급된 분배금은 평가금액에서 따로 빼지 않는다 — 가격 수익률이 이미 '분배금을 지급한 뒤의 가격'이기 때문.
 * - 총수익률 ≈ 가격 수익률 + 분배금 수익률. '총수익률 고정' 가정에서는 가격 수익률 = 총수익률 − 분배금 수익률로 정한다.
 * - 추가 납입은 매달 초(또는 말)에 목표 비중대로 산다. 세금은 분배금에서 원천징수, 거래 비용은 매수·리밸런싱 금액에 부과.
 */
import { mulberry32, quantile } from "./metrics";
import { addDays, indexOnOrAfter, type PriceSeries } from "./series";
import type { Rebalance } from "./backtest";

export interface FutureHolding {
  symbol: string;
  weight: number;
  /** 연 가격 수익률(%) — 분배금 제외 */
  priceReturnPct: number;
  /** 연 분배금 수익률(%) */
  yieldPct: number;
  /** 1~12월 분배금 비중 (합계 1). 비어 있으면 12개월 균등 */
  monthWeights?: number[];
}

export interface FutureConfig {
  holdings: FutureHolding[];
  months: number;
  /** 시작 연월 (YYYY-MM) — 분배금 지급 월 배치용 */
  startYm: string;
  initial: number;
  monthly: number;
  timing: "start" | "end";
  reinvest: boolean;
  rebalance: Rebalance;
  costPct: number;
  taxPct: number;
  /** 추가 연간 비용(%) — 가정 수익률에 이미 보수가 반영됐다면 0 */
  feePct: number;
}

export interface FutureMonth {
  ym: string;
  value: number;
  contributed: number;
  /** 누적 가격 변화 손익 */
  priceGain: number;
  /** 그 달 분배금 (세전·세후) */
  incomeGross: number;
  incomeNet: number;
  /** 재투자하지 않고 쌓인 세후 분배금 누적 */
  cash: number;
}

export interface FutureResult {
  months: FutureMonth[];
  finalValue: number;
  totalContributed: number;
  profit: number;
  returnPct: number;
  priceGainTotal: number;
  incomeGrossTotal: number;
  incomeNetTotal: number;
  annualIncome: { year: number; gross: number; net: number; months: number }[];
  /** 마지막 12개월(또는 전체) 월평균 세후 분배금 */
  avgMonthlyIncomeNet: number;
  perHolding: { symbol: string; value: number; incomeGross: number }[];
}

function nextYm(ym: string, add: number): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 + add;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, "0")}`;
}

function rebalanceDue(f: Rebalance, monthIndex: number): boolean {
  if (f === "none" || monthIndex === 0) return false;
  const step = f === "monthly" ? 1 : f === "quarterly" ? 3 : f === "semiannual" ? 6 : 12;
  return monthIndex % step === 0;
}

export function validateFuture(cfg: FutureConfig): string | null {
  if (!cfg.holdings.length) return "종목을 하나 이상 추가하세요.";
  const sum = cfg.holdings.reduce((a, h) => a + h.weight, 0);
  if (Math.abs(sum - 100) > 0.01) return `비중 합계가 ${Math.round(sum * 100) / 100}%입니다. 100%로 맞추세요.`;
  if (!Number.isInteger(cfg.months) || cfg.months < 1 || cfg.months > 600) return "기간은 1~600개월(50년) 사이로 입력하세요.";
  if (!(cfg.initial >= 0) || !(cfg.monthly >= 0) || cfg.initial + cfg.monthly <= 0) return "초기 투자금이나 매월 추가 투자금 중 하나는 0보다 커야 합니다.";
  for (const h of cfg.holdings) {
    if (!Number.isFinite(h.priceReturnPct) || h.priceReturnPct <= -100) return `${h.symbol}의 가격 수익률 가정이 올바르지 않습니다.`;
    if (!Number.isFinite(h.yieldPct) || h.yieldPct < 0 || h.yieldPct > 100) return `${h.symbol}의 분배금 수익률은 0~100% 사이로 입력하세요.`;
  }
  return null;
}

/** 월별 시뮬레이션의 한 달 (결정적·확률적 계산 공용) */
function stepMonth(
  v: number[],
  priceRet: number[],
  divYield: number[],
  st: { cash: number; costs: number; priceGain: number; incGross: number[]; incNet: number },
  cfg: FutureConfig,
) {
  const cost = cfg.costPct / 100;
  const tax = cfg.taxPct / 100;
  const feeM = Math.pow(1 - cfg.feePct / 100, 1 / 12);
  let gross = 0;
  let net = 0;
  for (let s = 0; s < v.length; s++) {
    const start = v[s];
    const dist = start * divYield[s];
    const after = start * (1 + priceRet[s]) * feeM;
    st.priceGain += after - start;
    v[s] = after;
    if (dist > 0) {
      const n = dist * (1 - tax);
      gross += dist;
      net += n;
      st.incGross[s] += dist;
      if (cfg.reinvest) {
        v[s] += n * (1 - cost);
        st.costs += n * cost;
      } else st.cash += n;
    }
  }
  st.incNet += net;
  return { gross, net };
}

function contribute(v: number[], w: number[], amount: number, cfg: FutureConfig, st: { costs: number }) {
  const cost = cfg.costPct / 100;
  for (let s = 0; s < v.length; s++) {
    v[s] += amount * w[s] * (1 - cost);
    st.costs += amount * w[s] * cost;
  }
}

function rebalance(v: number[], w: number[], cfg: FutureConfig, st: { costs: number }) {
  const total = v.reduce((a, b) => a + b, 0);
  let traded = 0;
  for (let s = 0; s < v.length; s++) traded += Math.abs(total * w[s] - v[s]);
  const fee = (traded * cfg.costPct) / 100;
  st.costs += fee;
  for (let s = 0; s < v.length; s++) v[s] = (total - fee) * w[s];
}

export function runFuture(cfg: FutureConfig): FutureResult {
  const k = cfg.holdings.length;
  const w = cfg.holdings.map((h) => h.weight / 100);
  const v = new Array<number>(k).fill(0);
  const st = { cash: 0, costs: 0, priceGain: 0, incGross: new Array<number>(k).fill(0), incNet: 0 };
  contribute(v, w, cfg.initial, cfg, st);
  let contributed = cfg.initial;
  const monthsOut: FutureMonth[] = [];
  const mPrice = cfg.holdings.map((h) => Math.pow(1 + h.priceReturnPct / 100, 1 / 12) - 1);
  for (let m = 0; m < cfg.months; m++) {
    const ym = nextYm(cfg.startYm, m);
    const cal = Number(ym.slice(5, 7)) - 1;
    if (cfg.monthly > 0 && cfg.timing === "start" && m > 0) {
      contribute(v, w, cfg.monthly, cfg, st);
      contributed += cfg.monthly;
    }
    if (rebalanceDue(cfg.rebalance, m)) rebalance(v, w, cfg, st);
    const dy = cfg.holdings.map((h) => {
      const mw = h.monthWeights && h.monthWeights.some((x) => x > 0) ? h.monthWeights[cal] : 1 / 12;
      return (h.yieldPct / 100) * mw;
    });
    const r = stepMonth(v, mPrice, dy, st, cfg);
    if (cfg.monthly > 0 && cfg.timing === "end") {
      contribute(v, w, cfg.monthly, cfg, st);
      contributed += cfg.monthly;
    }
    monthsOut.push({ ym, value: v.reduce((a, b) => a + b, 0) + st.cash, contributed, priceGain: st.priceGain, incomeGross: r.gross, incomeNet: r.net, cash: st.cash });
  }
  const finalValue = monthsOut[monthsOut.length - 1]?.value ?? cfg.initial;
  const byYear = new Map<number, { gross: number; net: number; months: number }>();
  for (const m of monthsOut) {
    const y = Number(m.ym.slice(0, 4));
    const e = byYear.get(y) ?? { gross: 0, net: 0, months: 0 };
    e.gross += m.incomeGross;
    e.net += m.incomeNet;
    e.months += 1;
    byYear.set(y, e);
  }
  const tail = monthsOut.slice(-12);
  return {
    months: monthsOut,
    finalValue,
    totalContributed: contributed,
    profit: finalValue - contributed,
    returnPct: contributed > 0 ? (finalValue / contributed - 1) * 100 : 0,
    priceGainTotal: st.priceGain,
    incomeGrossTotal: st.incGross.reduce((a, b) => a + b, 0),
    incomeNetTotal: st.incNet,
    annualIncome: [...byYear.entries()].map(([year, e]) => ({ year, ...e })),
    avgMonthlyIncomeNet: tail.length ? tail.reduce((a, m) => a + m.incomeNet, 0) / tail.length : 0,
    perHolding: cfg.holdings.map((h, s) => ({ symbol: h.symbol, value: v[s], incomeGross: st.incGross[s] })),
  };
}

// ─────────────────────────────── 시나리오 가정 ───────────────────────────────

export type ScenarioKey = "conservative" | "neutral" | "optimistic";

export const SCENARIO_KO: Record<ScenarioKey, string> = {
  conservative: "보수적",
  neutral: "중립적",
  optimistic: "낙관적",
};

/** 계산용 기본 가정 (예측값이 아님) — 화면에서 바꿀 수 있다 */
export const DEFAULT_TOTAL_RETURN: Record<ScenarioKey, number> = { conservative: 2, neutral: 5, optimistic: 8 };

export type AssumptionMode = "total" | "price";

/**
 * 시나리오 가정 → 종목별 가격·분배금 수익률
 * - total: 모든 종목의 총수익률을 같게 두고, 가격 수익률 = 총수익률 − 분배금 수익률 (분배금이 높다고 총수익이 높아지지 않음)
 * - price: 모든 종목의 가격 수익률을 같게 두고 분배금 수익률을 더함 (분배금이 높은 종목이 유리해지는 가정임에 주의)
 */
export function scenarioHoldings(base: { symbol: string; weight: number; yieldPct: number; monthWeights?: number[] }[], mode: AssumptionMode, rate: number): FutureHolding[] {
  return base.map((b) => ({
    symbol: b.symbol,
    weight: b.weight,
    yieldPct: b.yieldPct,
    priceReturnPct: mode === "total" ? rate - b.yieldPct : rate,
    monthWeights: b.monthWeights,
  }));
}

// ─────────────────────────────── 몬테카를로 ───────────────────────────────

export interface MonthlyHistory {
  /** 공통 기간의 월 (YYYY-MM) */
  months: string[];
  /** [종목][월] 가격 수익률 (분배금 제외) */
  price: number[][];
  /** [종목][월] 분배금 수익률 (그 달 배당락 분배금 ÷ 전월 말 종가) */
  income: number[][];
  first: string;
  last: string;
}

/** 일봉 → 월말 종가 기준 월별 수익률. 모든 종목에 완전한 월이 있는 공통 기간만 쓴다 */
export function monthlyHistory(series: PriceSeries[], lookbackYears: number | null, asOf?: string): MonthlyHistory | { error: string } {
  if (!series.length) return { error: "종목이 없습니다." };
  for (const s of series) if (s.dates.length < 40) return { error: `${s.symbol}: 일봉 데이터가 부족합니다.` };
  const monthEnds = series.map((s) => {
    const m = new Map<string, { date: string; close: number }>();
    for (let i = 0; i < s.dates.length; i++) m.set(s.dates[i].slice(0, 7), { date: s.dates[i], close: s.close[i] });
    return m;
  });
  // 공통 기간: 모든 종목의 첫 '완전한' 달 이후 ~ 마지막 완료된 달
  const firstFull = series.map((s) => nextYm(s.dates[0].slice(0, 7), 1));
  let startYm = firstFull.sort().slice(-1)[0];
  const lastDate = asOf ?? series.map((s) => s.dates[s.dates.length - 1]).sort()[0];
  const lastFull = nextYm(lastDate.slice(0, 7), -1);
  if (lookbackYears) {
    const lb = nextYm(lastFull, -(lookbackYears * 12) + 1);
    if (lb > startYm) startYm = lb;
  }
  const months: string[] = [];
  for (let ym = startYm; ym <= lastFull; ym = nextYm(ym, 1)) months.push(ym);
  const price: number[][] = series.map(() => []);
  const income: number[][] = series.map(() => []);
  const used: string[] = [];
  for (const ym of months) {
    const prevYm = nextYm(ym, -1);
    const ok = monthEnds.every((m) => m.has(ym) && m.has(prevYm));
    if (!ok) continue;
    used.push(ym);
    series.forEach((s, k) => {
      const p0 = monthEnds[k].get(prevYm) as { date: string; close: number };
      const p1 = monthEnds[k].get(ym) as { date: string; close: number };
      price[k].push(p1.close / p0.close - 1);
      const d = s.divs.filter((x) => x.ex > p0.date && x.ex <= p1.date).reduce((a, x) => a + x.amount, 0);
      income[k].push(d / p0.close);
    });
  }
  if (!used.length) return { error: "모든 종목에 공통으로 있는 완전한 월 데이터가 없습니다." };
  return { months: used, price, income, first: used[0], last: used[used.length - 1] };
}

export const MC_MIN_MONTHS = 36;

export interface MonteCarloConfig extends Omit<FutureConfig, "holdings"> {
  holdings: { symbol: string; weight: number }[];
  paths: number;
  /** 연속된 몇 개월을 한 묶음으로 뽑을지 (추세·변동성 군집을 일부 보존) */
  blockMonths: number;
  seed: number;
}

export interface MonteCarloResult {
  paths: number;
  months: string[];
  /** 월별 평가금액 분위수 */
  bands: { p5: number[]; p25: number[]; p50: number[]; p75: number[]; p95: number[] };
  contributed: number[];
  final: { p5: number; p25: number; p50: number; p75: number; p95: number; mean: number };
  /** 최종 평가금액이 총 납입 원금보다 작은 경로 비율(%) */
  lossProbPct: number;
  totalContributed: number;
  /** 세후 분배금 합계 분위수 */
  income: { p5: number; p50: number; p95: number };
  /** 경로별 최대 낙폭(시간가중, 월말 기준)의 중앙값(%) */
  medianMddPct: number;
  history: { first: string; last: string; count: number };
}

export function runMonteCarlo(cfg: MonteCarloConfig, hist: MonthlyHistory): MonteCarloResult | { error: string } {
  const n = hist.months.length;
  if (n < MC_MIN_MONTHS) return { error: `모든 종목에 공통으로 있는 월 데이터가 ${n}개월뿐입니다. 최소 ${MC_MIN_MONTHS}개월이 필요해 몬테카를로 시뮬레이션을 실행하지 않습니다.` };
  if (cfg.paths < 100 || cfg.paths > 5000) return { error: "경로 수는 100~5000 사이로 정하세요." };
  const k = cfg.holdings.length;
  const w = cfg.holdings.map((h) => h.weight / 100);
  const rand = mulberry32(cfg.seed);
  const block = Math.max(1, Math.min(cfg.blockMonths, 12, n));
  const H = cfg.months;
  const vals: Float64Array[] = Array.from({ length: H }, () => new Float64Array(cfg.paths));
  const finals: number[] = [];
  const incomes: number[] = [];
  const mdds: number[] = [];
  const contributed: number[] = [];
  const fcfg: FutureConfig = { ...cfg, holdings: cfg.holdings.map((h) => ({ ...h, priceReturnPct: 0, yieldPct: 0 })) };
  for (let p = 0; p < cfg.paths; p++) {
    const v = new Array<number>(k).fill(0);
    const st = { cash: 0, costs: 0, priceGain: 0, incGross: new Array<number>(k).fill(0), incNet: 0 };
    contribute(v, w, cfg.initial, fcfg, st);
    let contrib = cfg.initial;
    let pos = 0;
    let left = 0;
    let prevTotal = v.reduce((a, b) => a + b, 0);
    let twr = 1;
    let peak = 1;
    let mdd = 0;
    for (let m = 0; m < H; m++) {
      if (left === 0) {
        pos = Math.floor(rand() * (n - block + 1));
        left = block;
      }
      const idx = pos + (block - left);
      left--;
      let flowStart = 0;
      let flowEnd = 0;
      if (cfg.monthly > 0 && cfg.timing === "start" && m > 0) {
        contribute(v, w, cfg.monthly, fcfg, st);
        contrib += cfg.monthly;
        flowStart = cfg.monthly;
      }
      if (rebalanceDue(cfg.rebalance, m)) rebalance(v, w, fcfg, st);
      stepMonth(
        v,
        hist.price.map((r) => r[idx]),
        hist.income.map((r) => r[idx]),
        st,
        fcfg,
      );
      if (cfg.monthly > 0 && cfg.timing === "end") {
        contribute(v, w, cfg.monthly, fcfg, st);
        contrib += cfg.monthly;
        flowEnd = cfg.monthly;
      }
      const total = v.reduce((a, b) => a + b, 0) + st.cash;
      vals[m][p] = total;
      if (p === 0) contributed.push(contrib);
      // 낙폭은 납입금 효과를 뺀 시간가중 수익 지수로 계산
      const base = prevTotal + flowStart;
      if (base > 0) twr *= (total - flowEnd) / base;
      prevTotal = total;
      if (twr > peak) peak = twr;
      mdd = Math.min(mdd, twr / peak - 1);
    }
    finals.push(vals[H - 1][p]);
    incomes.push(st.incNet);
    mdds.push(mdd * 100);
  }
  const totalContributed = contributed[contributed.length - 1] ?? cfg.initial;
  const bands = { p5: [] as number[], p25: [] as number[], p50: [] as number[], p75: [] as number[], p95: [] as number[] };
  for (let m = 0; m < H; m++) {
    const s = Array.from(vals[m]).sort((a, b) => a - b);
    bands.p5.push(quantile(s, 0.05));
    bands.p25.push(quantile(s, 0.25));
    bands.p50.push(quantile(s, 0.5));
    bands.p75.push(quantile(s, 0.75));
    bands.p95.push(quantile(s, 0.95));
  }
  const fs = [...finals].sort((a, b) => a - b);
  const is = [...incomes].sort((a, b) => a - b);
  const ms = [...mdds].sort((a, b) => a - b);
  return {
    paths: cfg.paths,
    months: Array.from({ length: H }, (_, m) => nextYm(cfg.startYm, m)),
    bands,
    contributed,
    final: { p5: quantile(fs, 0.05), p25: quantile(fs, 0.25), p50: quantile(fs, 0.5), p75: quantile(fs, 0.75), p95: quantile(fs, 0.95), mean: fs.reduce((a, b) => a + b, 0) / fs.length },
    lossProbPct: (finals.filter((f) => f < totalContributed).length / finals.length) * 100,
    totalContributed,
    income: { p5: quantile(is, 0.05), p50: quantile(is, 0.5), p95: quantile(is, 0.95) },
    medianMddPct: quantile(ms, 0.5),
    history: { first: hist.first, last: hist.last, count: n },
  };
}

/** 과거 실적으로 '가격 수익률' 가정을 채울 때 쓰는 값: 최근 N년(없으면 전체) 연환산 가격 수익률(%) */
export function historicalPriceCagr(s: PriceSeries, years: number): { pct: number; from: string; to: string } | null {
  if (s.dates.length < 2) return null;
  const to = s.dates[s.dates.length - 1];
  const fromTarget = addDays(to, -Math.round(years * 365.25));
  const i = Math.max(0, indexOnOrAfter(s.dates, fromTarget));
  const y = (Date.parse(to) - Date.parse(s.dates[i])) / (365.25 * 86400000);
  if (y < 1) return null;
  return { pct: (Math.pow(s.close[s.close.length - 1] / s.close[i], 1 / y) - 1) * 100, from: s.dates[i], to };
}
