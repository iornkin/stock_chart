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
import { addDays, indexOnOrAfter, trIndex, type PriceSeries } from "./series";
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
  /** 그 달 추가 납입금 */
  contribution: number;
  /** 그 달 가격 변화 손익 */
  priceGainMonth: number;
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
  perHolding: FutureHoldingResult[];
  /** 연도별 상세 (기간 첫해·마지막 해는 일부 개월일 수 있음) */
  yearly: FutureYear[];
  /** 거래 비용 합계 */
  costs: number;
}

export interface FutureHoldingResult {
  symbol: string;
  /** 기간 말 평가금액 */
  value: number;
  incomeGross: number;
  incomeNet: number;
  /** 연도별 분배금 (세전·세후) */
  years: { year: number; gross: number; net: number }[];
}

export interface FutureYear {
  year: number;
  months: number;
  startValue: number;
  contributions: number;
  priceGain: number;
  incomeGross: number;
  incomeTax: number;
  incomeNet: number;
  /** 재투자한 세후 분배금 (현금 수령이면 0) */
  reinvested: number;
  costs: number;
  endValue: number;
  /** 연말 누적 납입 원금 */
  contributed: number;
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
  st: { cash: number; costs: number; priceGain: number; incGross: number[]; incNetBy: number[]; incNet: number },
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
      st.incNetBy[s] += n;
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
  const st = { cash: 0, costs: 0, priceGain: 0, incGross: new Array<number>(k).fill(0), incNetBy: new Array<number>(k).fill(0), incNet: 0 };
  contribute(v, w, cfg.initial, cfg, st);
  let contributed = cfg.initial;
  const monthsOut: FutureMonth[] = [];
  const mPrice = cfg.holdings.map((h) => Math.pow(1 + h.priceReturnPct / 100, 1 / 12) - 1);
  const yearly = new Map<number, FutureYear>();
  const symYear = cfg.holdings.map(() => new Map<number, { gross: number; net: number }>());
  let prevValue = v.reduce((a, b) => a + b, 0);
  for (let m = 0; m < cfg.months; m++) {
    const ym = nextYm(cfg.startYm, m);
    const year = Number(ym.slice(0, 4));
    const cal = Number(ym.slice(5, 7)) - 1;
    const y =
      yearly.get(year) ??
      (yearly
        // 첫해는 초기 투자금을 납입으로 보고 시작 평가금액 0 에서 출발 (평가금액 변화 = 납입 + 가격 변화 + 세후 분배금 − 비용)
        .set(year, { year, months: 0, startValue: m === 0 ? 0 : prevValue, contributions: m === 0 ? cfg.initial : 0, priceGain: 0, incomeGross: 0, incomeTax: 0, incomeNet: 0, reinvested: 0, costs: m === 0 ? st.costs : 0, endValue: 0, contributed: 0 })
        .get(year) as FutureYear);
    const costs0 = st.costs;
    const price0 = st.priceGain;
    const gross0 = [...st.incGross];
    const net0 = [...st.incNetBy];
    let contribution = 0;
    if (cfg.monthly > 0 && cfg.timing === "start" && m > 0) {
      contribute(v, w, cfg.monthly, cfg, st);
      contributed += cfg.monthly;
      contribution += cfg.monthly;
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
      contribution += cfg.monthly;
    }
    const value = v.reduce((a, b) => a + b, 0) + st.cash;
    monthsOut.push({ ym, value, contributed, contribution, priceGainMonth: st.priceGain - price0, priceGain: st.priceGain, incomeGross: r.gross, incomeNet: r.net, cash: st.cash });
    y.months += 1;
    y.contributions += contribution;
    y.priceGain += st.priceGain - price0;
    y.incomeGross += r.gross;
    y.incomeNet += r.net;
    y.incomeTax += r.gross - r.net;
    if (cfg.reinvest) y.reinvested += r.net;
    y.costs += st.costs - costs0;
    y.endValue = value;
    y.contributed = contributed;
    for (let i = 0; i < k; i++) {
      const g = st.incGross[i] - gross0[i];
      if (g <= 0) continue;
      const e = symYear[i].get(year) ?? { gross: 0, net: 0 };
      e.gross += g;
      e.net += st.incNetBy[i] - net0[i];
      symYear[i].set(year, e);
    }
    prevValue = value;
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
    perHolding: cfg.holdings.map((h, i) => ({
      symbol: h.symbol,
      value: v[i],
      incomeGross: st.incGross[i],
      incomeNet: st.incNetBy[i],
      years: [...symYear[i].entries()].sort((a, b) => a[0] - b[0]).map(([year, e]) => ({ year, ...e })),
    })),
    yearly: [...yearly.values()],
    costs: st.costs,
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
export const DEFAULT_TOTAL_RETURN: Record<ScenarioKey, number> = { conservative: 4, neutral: 7, optimistic: 10 };

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

/** 종목별 과거 실적: 일정 기간(기본 5년) 이동 구간 총수익률(분배금 재투자)의 연환산 분포 */
export interface HistoricalReturn {
  symbol: string;
  from: string;
  to: string;
  years: number;
  /** 전체 기간 총수익률 연환산 (%) */
  totalCagr: number;
  windowYears: number;
  /** 이동 구간 개수 (월 단위로 한 칸씩 이동) */
  windows: number;
  p25: number;
  p50: number;
  p75: number;
  worst: number;
  best: number;
}

/** 월말 총수익 지수 (배당락일 종가로 분배금 재투자, 공통 정의 trIndex) */
export function monthEndTotalReturn(s: PriceSeries): { ym: string; date: string; value: number }[] {
  const tri = s.dates.length ? trIndex(s) : [];
  const out: { ym: string; date: string; value: number }[] = [];
  for (let i = 0; i < s.dates.length; i++) {
    const ym = s.dates[i].slice(0, 7);
    if (out.length && out[out.length - 1].ym === ym) out[out.length - 1] = { ym, date: s.dates[i], value: tri[i] };
    else out.push({ ym, date: s.dates[i], value: tri[i] });
  }
  return out;
}

/** 최근 N년(null 이면 전체) 총수익률(분배금 재투자) 연환산 — 참고값 표시용 */
export function totalReturnCagr(s: PriceSeries, years: number | null): { pct: number; from: string; to: string } | null {
  const me = monthEndTotalReturn(s);
  if (me.length < 13) return null;
  const last = me[me.length - 1];
  const i = years ? Math.max(0, me.length - 1 - Math.round(years * 12)) : 0;
  const y = (Date.parse(last.date) - Date.parse(me[i].date)) / (365.25 * 86400000);
  if (y < 1 || (years && y < years - 0.2)) return null;
  return { pct: (Math.pow(last.value / me[i].value, 1 / y) - 1) * 100, from: me[i].date, to: last.date };
}

export function historicalReturnStats(s: PriceSeries, windowYears = 5): HistoricalReturn | { error: string } {
  if (s.dates.length < 40) return { error: "일봉 데이터가 부족합니다." };
  const me = monthEndTotalReturn(s);
  const W = Math.round(windowYears * 12);
  const cagrs: number[] = [];
  for (let i = 0; i + W < me.length; i++) cagrs.push((Math.pow(me[i + W].value / me[i].value, 1 / windowYears) - 1) * 100);
  const years = (Date.parse(s.dates[s.dates.length - 1]) - Date.parse(s.dates[0])) / (365.25 * 86400000);
  if (cagrs.length < 12) return { error: `데이터가 ${years.toFixed(1)}년치라 ${windowYears}년 이동 구간을 12개 이상 만들 수 없습니다.` };
  const sorted = [...cagrs].sort((a, b) => a - b);
  const first = me[0];
  const last = me[me.length - 1];
  return {
    symbol: s.symbol,
    from: s.dates[0],
    to: s.dates[s.dates.length - 1],
    years,
    totalCagr: (Math.pow(last.value / first.value, 1 / Math.max(years, 1e-9)) - 1) * 100,
    windowYears,
    windows: cagrs.length,
    p25: quantile(sorted, 0.25),
    p50: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    worst: sorted[0],
    best: sorted[sorted.length - 1],
  };
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
  /**
   * 평균 조정: null 이면 과거 월별 수익률을 그대로 쓴다.
   * 숫자(연 %)를 주면 종목마다 월별 총수익률의 평균만 그 값(기하 평균 기준)에 맞추고, 변동성·분포 모양·종목 간 움직임은 과거 그대로 둔다.
   */
  centerAnnualPct?: number | null;
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
  /** 경로별 연환산 수익률(시간가중, 납입 영향 제외) 분위수(%) — 12개월 미만이면 누적 수익률 */
  cagr: { p5: number; p25: number; p50: number; p75: number; p95: number; annualized: boolean };
  /** 매년 말(마지막 달 포함) 평가금액 분위수 */
  yearEnd: { month: number; ym: string; contributed: number; p5: number; p25: number; p50: number; p75: number; p95: number }[];
  /** 오름차순 최종 평가금액 (목표 달성 확률 계산용) */
  finalsSorted: number[];
  /** 마지막 12개월(기간이 짧으면 전체) 세후 분배금의 월평균 분위수 */
  lastYearMonthlyIncome: { p5: number; p50: number; p95: number };
  /** 종목별 세후 분배금 합계 중앙값 */
  incomeBySymbol: { symbol: string; p50: number }[];
  /** 뽑는 데 쓴 과거 표본 자체의 성과 (월별 리밸런싱 근사) */
  sample: { annualPct: number; volPct: number; mddPct: number; worst12mPct: number | null; months: number };
  /** 평균 조정을 했다면 목표 연 수익률(%) */
  centeredAt: number | null;
}

/** 과거 표본 포트폴리오(매달 목표 비중으로 맞춘다고 근사)의 연 수익률·변동성·낙폭 */
function sampleStats(hist: MonthlyHistory, w: number[]) {
  const n = hist.months.length;
  const r: number[] = [];
  for (let i = 0; i < n; i++) r.push(w.reduce((a, wk, k) => a + wk * (hist.price[k][i] + hist.income[k][i]), 0));
  let g = 1;
  let peak = 1;
  let mdd = 0;
  const cum = [1];
  for (const x of r) {
    g *= 1 + x;
    cum.push(g);
    peak = Math.max(peak, g);
    mdd = Math.min(mdd, g / peak - 1);
  }
  const mean = r.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
  let worst: number | null = null;
  for (let i = 0; i + 12 < cum.length; i++) {
    const x = (cum[i + 12] / cum[i] - 1) * 100;
    worst = worst === null ? x : Math.min(worst, x);
  }
  return { annualPct: (Math.pow(g, 12 / n) - 1) * 100, volPct: sd * Math.sqrt(12) * 100, mddPct: mdd * 100, worst12mPct: worst, months: n };
}

/** 종목별 월 총수익률 평균을 목표 연 수익률(기하 평균 기준)에 맞춘 가격 수익률 (분배금 수익률은 그대로) */
export function centerHistory(hist: MonthlyHistory, annualPct: number): MonthlyHistory {
  const target = Math.pow(1 + annualPct / 100, 1 / 12) - 1;
  const price = hist.price.map((pr, k) => {
    const tot = pr.map((x, i) => x + hist.income[k][i]);
    const mean = tot.reduce((a, b) => a + b, 0) / tot.length;
    const varc = tot.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, tot.length - 1);
    // 산술 평균 ≈ 기하 평균 + 분산/2 → 기하 기준으로 목표에 맞춘다
    const shift = target + varc / 2 - mean;
    return pr.map((x) => Math.max(-0.99, x + shift));
  });
  return { ...hist, price };
}

export function runMonteCarlo(cfg: MonteCarloConfig, rawHist: MonthlyHistory): MonteCarloResult | { error: string } {
  const centered = cfg.centerAnnualPct !== undefined && cfg.centerAnnualPct !== null && Number.isFinite(cfg.centerAnnualPct) ? cfg.centerAnnualPct : null;
  if (centered !== null && !(centered > -50 && centered < 50)) return { error: "평균 조정 수익률은 −50%~50% 사이로 정하세요." };
  const hist = centered !== null ? centerHistory(rawHist, centered) : rawHist;
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
  const cagrs: number[] = [];
  const lastYearInc: number[] = [];
  const symInc: number[][] = cfg.holdings.map(() => []);
  const contributed: number[] = [];
  const tailFrom = Math.max(0, H - 12);
  const fcfg: FutureConfig = { ...cfg, holdings: cfg.holdings.map((h) => ({ ...h, priceReturnPct: 0, yieldPct: 0 })) };
  for (let p = 0; p < cfg.paths; p++) {
    const v = new Array<number>(k).fill(0);
    const st = { cash: 0, costs: 0, priceGain: 0, incGross: new Array<number>(k).fill(0), incNetBy: new Array<number>(k).fill(0), incNet: 0 };
    contribute(v, w, cfg.initial, fcfg, st);
    let contrib = cfg.initial;
    let pos = 0;
    let left = 0;
    let prevTotal = v.reduce((a, b) => a + b, 0);
    let twr = 1;
    let peak = 1;
    let mdd = 0;
    let tailInc = 0;
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
      const step = stepMonth(
        v,
        hist.price.map((r) => r[idx]),
        hist.income.map((r) => r[idx]),
        st,
        fcfg,
      );
      if (m >= tailFrom) tailInc += step.net;
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
    cagrs.push(H >= 12 ? (Math.pow(twr, 12 / H) - 1) * 100 : (twr - 1) * 100);
    lastYearInc.push(tailInc / Math.min(12, H));
    st.incNetBy.forEach((x, k) => symInc[k].push(x));
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
  const cs = [...cagrs].sort((a, b) => a - b);
  const ls = [...lastYearInc].sort((a, b) => a - b);
  const yearEnd: MonteCarloResult["yearEnd"] = [];
  for (let m = 11; m < H; m += 12) yearEnd.push({ month: m + 1, ym: nextYm(cfg.startYm, m), contributed: contributed[m], p5: bands.p5[m], p25: bands.p25[m], p50: bands.p50[m], p75: bands.p75[m], p95: bands.p95[m] });
  if (!yearEnd.length || yearEnd[yearEnd.length - 1].month !== H) yearEnd.push({ month: H, ym: nextYm(cfg.startYm, H - 1), contributed: contributed[H - 1], p5: bands.p5[H - 1], p25: bands.p25[H - 1], p50: bands.p50[H - 1], p75: bands.p75[H - 1], p95: bands.p95[H - 1] });
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
    cagr: { p5: quantile(cs, 0.05), p25: quantile(cs, 0.25), p50: quantile(cs, 0.5), p75: quantile(cs, 0.75), p95: quantile(cs, 0.95), annualized: H >= 12 },
    yearEnd,
    finalsSorted: fs,
    lastYearMonthlyIncome: { p5: quantile(ls, 0.05), p50: quantile(ls, 0.5), p95: quantile(ls, 0.95) },
    incomeBySymbol: cfg.holdings.map((h, k) => ({ symbol: h.symbol, p50: quantile([...symInc[k]].sort((a, b) => a - b), 0.5) })),
    sample: sampleStats(rawHist, w),
    centeredAt: centered,
  };
}

/** 최종 평가금액이 목표 이상인 경로 비율(%) */
export function probAtLeast(finalsSorted: number[], target: number): number {
  if (!finalsSorted.length) return NaN;
  let lo = 0;
  let hi = finalsSorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (finalsSorted[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return ((finalsSorted.length - lo) / finalsSorted.length) * 100;
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

// ───────────────────────────── 가정 민감도 ─────────────────────────────

export interface SensitivityRow {
  key: string;
  label: string;
  /** 무엇을 바꿨는지 */
  change: string;
  finalValue: number;
  /** 마지막 12개월 월평균 세후 분배금 */
  monthlyIncomeNet: number;
  diffValue: number;
  diffValuePct: number;
  diffIncome: number;
}

/**
 * 한 번에 가정 하나만 바꿔 다시 계산 (나머지는 그대로) — 결과가 어떤 가정에 크게 흔들리는지 보기 위한 것.
 * 분배금 감소는 가격 수익률을 그대로 두므로 총수익률도 그만큼 줄어든다. 급락은 '투자 시작 직후 한 번' 초기 금액에만 적용.
 * fx 를 주면 원화 환산 결과(환율 ±10%)도 함께 보여 준다 (달러 금액은 그대로, 원화 금액만 바뀜).
 */
export function futureSensitivity(cfg: FutureConfig, opts: { fx?: number | null } = {}): { base: FutureResult; rows: SensitivityRow[] } {
  const base = runFuture(cfg);
  const variants: { key: string; label: string; change: string; cfg: FutureConfig; scale?: number }[] = [
    { key: "ret-", label: "가격 수익률 −2%p", change: "모든 종목 연 가격 수익률 −2%p", cfg: { ...cfg, holdings: cfg.holdings.map((h) => ({ ...h, priceReturnPct: h.priceReturnPct - 2 })) } },
    { key: "ret+", label: "가격 수익률 +2%p", change: "모든 종목 연 가격 수익률 +2%p", cfg: { ...cfg, holdings: cfg.holdings.map((h) => ({ ...h, priceReturnPct: h.priceReturnPct + 2 })) } },
    { key: "div-", label: "분배금 −30%", change: "분배금 수익률 × 0.7 (가격 수익률은 그대로)", cfg: { ...cfg, holdings: cfg.holdings.map((h) => ({ ...h, yieldPct: h.yieldPct * 0.7 })) } },
    { key: "tax30", label: "분배금 세율 30%", change: `세율 ${cfg.taxPct}% → 30%`, cfg: { ...cfg, taxPct: 30 } },
    { key: "fee+", label: "연 비용 +0.5%p", change: `추가 연간 비용 ${cfg.feePct}% → ${cfg.feePct + 0.5}%`, cfg: { ...cfg, feePct: cfg.feePct + 0.5 } },
    { key: "cost+", label: "거래 비용 +0.5%p", change: `매수·재투자·리밸런싱 비용 ${cfg.costPct}% → ${cfg.costPct + 0.5}%`, cfg: { ...cfg, costPct: cfg.costPct + 0.5 } },
    { key: "crash", label: "시작 직후 −30% 급락", change: "초기 투자금이 시작하자마자 30% 줄었다고 가정 (이후 같은 가정)", cfg: { ...cfg, initial: cfg.initial * 0.7 } },
  ];
  const rows: SensitivityRow[] = variants.map((v) => {
    const r = runFuture(v.cfg);
    return {
      key: v.key,
      label: v.label,
      change: v.change,
      finalValue: r.finalValue,
      monthlyIncomeNet: r.avgMonthlyIncomeNet,
      diffValue: r.finalValue - base.finalValue,
      diffValuePct: base.finalValue > 0 ? (r.finalValue / base.finalValue - 1) * 100 : 0,
      diffIncome: r.avgMonthlyIncomeNet - base.avgMonthlyIncomeNet,
    };
  });
  if (opts.fx && opts.fx > 0)
    for (const k of [-10, 10])
      rows.push({
        key: `fx${k}`,
        label: `원/달러 ${k > 0 ? "+" : ""}${k}% (원화 환산)`,
        change: `달러 금액은 그대로, 원화 환산만 현재 환율 ${Math.round(opts.fx)}원 → ${Math.round(opts.fx * (1 + k / 100))}원`,
        finalValue: base.finalValue,
        monthlyIncomeNet: base.avgMonthlyIncomeNet,
        diffValue: 0,
        diffValuePct: k,
        diffIncome: 0,
      });
  return { base, rows };
}
