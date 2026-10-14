/**
 * 과거 백테스트 엔진 (순수 함수, 브라우저에서 실행)
 *
 * 계산 규칙
 * 1. 가격: 분할만 반영한 실제 종가. 분배금은 배당락일에 '보유 주식 수 × 주당 지급액'으로 한 번만 더한다.
 *    (수정주가를 쓰지 않으므로 분배금이 가격과 현금에 이중으로 들어가지 않는다)
 * 2. 분배금 재투자: 배당락일 종가로 같은 종목을 산다 (총수익 지수의 일반적인 계산 방식). 세금은 재투자 전에 뺀다.
 *    재투자하지 않으면 세후 분배금은 현금(이자 없음)으로 쌓인다.
 * 3. 초기 투자금은 시작일 종가로 목표 비중대로 산다. 매월 추가 납입금은 월초(첫 거래일) 또는 월말(마지막 거래일) 종가로 목표 비중대로 산다.
 * 4. 리밸런싱: 새 기간(월·분기·반기·연)의 첫 거래일 종가로 목표 비중에 맞춘다. 거래 비용은 사고판 금액에 부과한다.
 * 5. 계산 달력: 선택한 모든 종목에 실제 종가가 있는 날만 쓴다. 없는 가격을 만들어 채우지 않는다.
 * 6. 시작일이 어떤 종목의 첫 데이터(상장일·수집 시작일) 이전이면 계산하지 않고 이유를 돌려준다.
 */
import { daysBetween } from "@/lib/time";
import { annualVolPct, cagrPct, dailyReturns, drawdown, periodReturns, sharpe, xirrPct, yearsBetween } from "./metrics";
import { closeOn, indexOnOrAfter, indexOnOrBefore, type PriceSeries } from "./series";
import { capitalGainsTax, CostBook, type CostMethod } from "@/lib/portfolio/tax";

export type Rebalance = "none" | "monthly" | "quarterly" | "semiannual" | "annual";
export type ContributionTiming = "month_start" | "month_end";

export const REBALANCE_KO: Record<Rebalance, string> = {
  none: "리밸런싱 안 함",
  monthly: "매월",
  quarterly: "분기마다",
  semiannual: "반기마다",
  annual: "매년",
};

export interface WeightItem {
  symbol: string;
  /** 비중(%) */
  weight: number;
}

export interface BacktestConfig {
  holdings: WeightItem[];
  start: string;
  end: string;
  initial: number;
  monthly: number;
  timing: ContributionTiming;
  reinvest: boolean;
  rebalance: Rebalance;
  /** 거래 비용(%) — 사고판 금액 기준 */
  costPct: number;
  /** 분배금 세금(%) — 원천징수 가정 */
  taxPct: number;
  /** 샤프 비율용 무위험 수익률(연 %) */
  riskFreePct: number;
  /** true 면 분배금을 아예 반영하지 않는다 (가격 수익률 비교용) */
  ignoreDividends?: boolean;
  /**
   * 해외주식 양도소득세 (한국 거주자 가정): 연간 손익통산 → 250만 원 공제 → 22%, 다음 해 5월 첫 거래일에 납부.
   * 환율은 날짜별 원/달러 종가(fx) 또는 직접 입력한 고정 환율(fixedFx)
   */
  capitalGains?: { method: CostMethod; fx: PriceSeries | null; fixedFx: number | null } | null;
}

export interface CapitalGainsResult {
  method: CostMethod;
  fxBasis: "historical" | "fixed";
  years: { year: string; netGainKrw: number; taxKrw: number; paidOn: string | null; paidUsd: number }[];
  /** 기간 중 납부한 세금 (납부일 환율로 달러 환산) */
  paidUsd: number;
  /** 기간 말 아직 납부 전인 세금 (원화) */
  unpaidKrw: number;
  /** 기간 마지막 날 전부 판다면 추가로 생기는 세금 (원화) */
  liquidationExtraKrw: number;
  /** 미납 세금과 전부 매도 시 세금을 뺀 가치 */
  afterTaxLiquidationUsd: number;
  fxEnd: number;
}

export interface CoverageItem {
  symbol: string;
  first: string | null;
  last: string | null;
}

export interface CoverageReport {
  items: CoverageItem[];
  /** 모든 종목에 데이터가 있는 첫날 (공통 시작일) */
  commonStart: string | null;
  commonEnd: string | null;
  problems: string[];
  /** 실제 계산 종료일 (요청 종료일과 데이터 마지막 날 중 이른 날) */
  effectiveEnd: string | null;
  notes: string[];
}

export function checkCoverage(symbols: string[], series: Record<string, PriceSeries | undefined>, start: string, end: string): CoverageReport {
  const items: CoverageItem[] = symbols.map((s) => {
    const x = series[s];
    return { symbol: s, first: x?.dates[0] ?? null, last: x?.dates[x.dates.length - 1] ?? null };
  });
  const problems: string[] = [];
  const notes: string[] = [];
  for (const it of items) {
    if (!it.first || !it.last) problems.push(`${it.symbol}: 수집된 일봉 데이터가 없어 계산할 수 없습니다.`);
  }
  const firsts = items.map((i) => i.first).filter((x): x is string => !!x);
  const lasts = items.map((i) => i.last).filter((x): x is string => !!x);
  const commonStart = firsts.length === items.length && firsts.length ? firsts.sort().slice(-1)[0] : null;
  const commonEnd = lasts.length === items.length && lasts.length ? lasts.sort()[0] : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) problems.push("시작일과 종료일을 YYYY-MM-DD 형식으로 입력하세요.");
  else if (end <= start) problems.push("종료일은 시작일보다 뒤여야 합니다.");
  for (const it of items) {
    if (it.first && start < it.first) problems.push(`${it.symbol}: 데이터가 ${it.first}부터 있습니다(상장일 또는 제공처 기록 시작일). 시작일 ${start}은 그 이전이라 계산하지 않습니다.`);
    if (it.last && start > it.last) problems.push(`${it.symbol}: 마지막 데이터가 ${it.last}입니다. 시작일이 그 이후입니다.`);
  }
  let effectiveEnd: string | null = null;
  if (commonEnd) {
    effectiveEnd = end > commonEnd ? commonEnd : end;
    if (end > commonEnd) notes.push(`종료일 ${end}까지의 데이터가 아직 없어 마지막 데이터 날짜 ${commonEnd}까지 계산했습니다.`);
  }
  return { items, commonStart, commonEnd, problems, effectiveEnd, notes };
}

export function validateWeights(holdings: WeightItem[], normalize: boolean): { ok: true; holdings: WeightItem[]; sum: number; normalized: boolean } | { ok: false; error: string; sum: number } {
  const clean = holdings.filter((h) => h.symbol);
  const sum = clean.reduce((a, h) => a + (Number.isFinite(h.weight) ? h.weight : 0), 0);
  if (!clean.length) return { ok: false, error: "종목을 하나 이상 추가하세요.", sum };
  const seen = new Set<string>();
  for (const h of clean) {
    if (seen.has(h.symbol)) return { ok: false, error: `${h.symbol}이(가) 두 번 들어 있습니다.`, sum };
    seen.add(h.symbol);
    if (!Number.isFinite(h.weight) || h.weight <= 0) return { ok: false, error: `${h.symbol}의 비중을 0보다 크게 입력하세요.`, sum };
  }
  if (Math.abs(sum - 100) < 0.01) return { ok: true, holdings: clean, sum, normalized: false };
  if (!normalize) return { ok: false, error: `비중 합계가 ${round2(sum)}%입니다. 100%로 맞추거나 '자동 정규화'를 켜세요.`, sum };
  return { ok: true, holdings: clean.map((h) => ({ ...h, weight: (h.weight / sum) * 100 })), sum, normalized: true };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function periodKey(d: string, f: Rebalance): string {
  const y = d.slice(0, 4);
  const m = Number(d.slice(5, 7));
  if (f === "monthly") return d.slice(0, 7);
  if (f === "quarterly") return `${y}Q${Math.ceil(m / 3)}`;
  if (f === "semiannual") return `${y}H${m <= 6 ? 1 : 2}`;
  return y;
}

export interface HoldingResult {
  symbol: string;
  targetWeight: number;
  shares: number;
  value: number;
  endWeight: number;
  dividendsGross: number;
}

export interface BacktestResult {
  ok: true;
  config: BacktestConfig;
  start: string;
  end: string;
  tradingDays: number;
  years: number;
  dates: string[];
  value: number[];
  contributed: number[];
  /** 시간가중 수익 지수 (시작 1) */
  twr: number[];
  drawdown: number[];
  finalValue: number;
  totalContributed: number;
  profit: number;
  /** (최종 평가금액 ÷ 총 납입 원금 − 1) */
  totalReturnPct: number;
  /** 시간가중 누적 수익률 — 납입 시점과 무관한 전략 자체의 수익률 */
  twrReturnPct: number;
  cagrPct: number | null;
  irrPct: number | null;
  volPct: number | null;
  sharpe: number | null;
  riskFreePct: number;
  mddPct: number;
  mddPeak: string | null;
  mddTrough: string | null;
  mddRecovery: string | null;
  annual: { year: string; retPct: number; partial: boolean }[];
  monthly: { ym: string; retPct: number }[];
  income: { gross: number; tax: number; net: number; reinvested: number; cash: number };
  monthlyIncome: { ym: string; gross: number; net: number }[];
  holdings: HoldingResult[];
  costs: number;
  contributions: number;
  capitalGains: CapitalGainsResult | null;
  notes: string[];
  verification: BacktestVerification;
}

/** 결과를 검증·재현하기 위한 기록 (요청 기간과 실제 계산 기간, 종목별 데이터 범위, 뺀 날) */
export interface BacktestVerification {
  requested: { start: string; end: string };
  used: { start: string; end: string };
  /** 기간 안에서 일부 종목 가격이 없어 계산에서 뺀 거래일 */
  skippedDays: number;
  skippedSample: string[];
  coverage: (CoverageItem & { source: string | null; fetchedAt: number | null; divEvents: number })[];
  commonStart: string | null;
  commonEnd: string | null;
  /** 실제로 반영한 분배금 지급 건수 (보유 수량이 있을 때만) */
  divEvents: number;
  rebalances: number;
}

export interface BacktestFailure {
  ok: false;
  problems: string[];
  coverage: CoverageReport | null;
}

export type BacktestOutcome = BacktestResult | BacktestFailure;

export function runBacktest(cfg: BacktestConfig, series: Record<string, PriceSeries | undefined>): BacktestOutcome {
  const symbols = cfg.holdings.map((h) => h.symbol);
  const wv = validateWeights(cfg.holdings, false);
  if (!wv.ok) return { ok: false, problems: [wv.error], coverage: null };
  if (!(cfg.initial >= 0) || !(cfg.monthly >= 0) || cfg.initial + cfg.monthly <= 0) return { ok: false, problems: ["초기 투자금이나 매월 추가 투자금 중 하나는 0보다 커야 합니다."], coverage: null };
  if (cfg.costPct < 0 || cfg.costPct >= 100 || cfg.taxPct < 0 || cfg.taxPct > 100) return { ok: false, problems: ["거래 비용과 세율은 0~100% 사이로 입력하세요."], coverage: null };
  const cov = checkCoverage(symbols, series, cfg.start, cfg.end);
  if (cov.problems.length) return { ok: false, problems: cov.problems, coverage: cov };
  const end = cov.effectiveEnd as string;
  const ss = symbols.map((s) => series[s] as PriceSeries);

  // 계산 달력: 모든 종목에 종가가 있는 날
  const base = ss[0];
  const sets = ss.slice(1).map((x) => new Set(x.dates));
  const i0 = indexOnOrAfter(base.dates, cfg.start);
  const i1 = indexOnOrBefore(base.dates, end);
  const cal: string[] = [];
  for (let i = Math.max(0, i0); i0 >= 0 && i <= i1; i++) if (sets.every((st) => st.has(base.dates[i]))) cal.push(base.dates[i]);
  if (cal.length < 2) return { ok: false, problems: ["선택한 기간에 모든 종목의 종가가 함께 있는 거래일이 2일 미만입니다."], coverage: cov };
  const notes = [...cov.notes];
  if (cal[0] !== cfg.start) notes.push(`시작일 ${cfg.start}은 거래일이 아니거나 일부 종목 가격이 없어 ${cal[0]} 종가부터 계산했습니다.`);
  const skipped = i1 - Math.max(0, i0) + 1 - cal.length;
  const calSet = new Set(cal);
  const skippedSample: string[] = [];
  for (let i = Math.max(0, i0); i0 >= 0 && i <= i1 && skippedSample.length < 5; i++) if (!calSet.has(base.dates[i])) skippedSample.push(base.dates[i]);
  if (skipped > 0) notes.push(`일부 종목의 가격이 없는 ${skipped}개 거래일은 계산에서 뺐습니다 (가격을 임의로 채우지 않음).`);
  // 월말 납입 판정을 위해 기간 다음 거래일을 확인
  const afterEnd = base.dates[indexOnOrBefore(base.dates, cal[cal.length - 1]) + 1] ?? null;

  const n = cal.length;
  const k = ss.length;
  const w = cfg.holdings.map((h) => h.weight / 100);
  const cost = cfg.costPct / 100;
  const tax = cfg.taxPct / 100;
  // 가격 정렬
  const px: Float64Array[] = ss.map((x) => {
    const arr = new Float64Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      while (x.dates[j] < cal[i]) j++;
      arr[i] = x.close[j];
    }
    return arr;
  });
  const divs = ss.map((x) => (cfg.ignoreDividends ? [] : [...x.divs].sort((a, b) => a.ex.localeCompare(b.ex))));
  const dptr = divs.map((d) => {
    let p = 0;
    while (p < d.length && d[p].ex <= cal[0]) p++;
    return p;
  });

  // 양도소득세 준비 (환율이 기간 전체에 있어야 함)
  const cg = cfg.capitalGains ?? null;
  let fxArr: Float64Array | null = null;
  if (cg) {
    fxArr = new Float64Array(n);
    if (cg.fixedFx && cg.fixedFx > 0) fxArr.fill(cg.fixedFx);
    else {
      const fx = cg.fx;
      if (!fx || !fx.dates.length) return { ok: false, problems: ["양도소득세 계산에 필요한 원/달러 환율 기록이 아직 없습니다. 고정 환율을 직접 입력하세요."], coverage: cov };
      if (fx.dates[0] > cal[0]) return { ok: false, problems: [`양도소득세 계산에 필요한 원/달러 환율 기록이 ${fx.dates[0]}부터 있습니다. 시작일을 늦추거나 고정 환율을 입력하세요.`], coverage: cov };
      for (let i = 0; i < n; i++) fxArr[i] = (closeOn(fx, cal[i]) as { close: number }).close;
    }
  }
  const books = cg ? symbols.map(() => new CostBook(cg.method)) : null;
  const yearGain = new Map<string, number>();
  const taxYears: CapitalGainsResult["years"] = [];
  const settled = new Set<string>();
  let taxPaidUsd = 0;

  const shares = new Array<number>(k).fill(0);
  const divGross = new Array<number>(k).fill(0);
  const addShares = (s: number, q: number, i: number) => {
    shares[s] += q;
    if (books && fxArr) books[s].buy(q, q * px[s][i], q * px[s][i] * fxArr[i]);
  };
  const removeShares = (s: number, q: number, i: number) => {
    if (!(q > 0)) return;
    shares[s] -= q;
    if (books && fxArr) {
      const c = books[s].sell(q);
      const y = cal[i].slice(0, 4);
      yearGain.set(y, (yearGain.get(y) ?? 0) + q * px[s][i] * fxArr[i] - c.krw);
    }
  };
  let cash = 0;
  let costs = 0;
  let divEvents = 0;
  let rebalances = 0;
  const divCount = new Array<number>(k).fill(0);
  let contributedTotal = cfg.initial;
  let contributions = 0;
  let incGross = 0;
  let incTax = 0;
  let reinvested = 0;
  const monthInc = new Map<string, { gross: number; net: number }>();
  const value: number[] = [];
  const contributed: number[] = [];
  const twr: number[] = [];
  const flows: { date: string; amount: number }[] = [];

  const buyByWeight = (amount: number, i: number) => {
    for (let s = 0; s < k; s++) {
      const a = amount * w[s];
      addShares(s, (a * (1 - cost)) / px[s][i], i);
      costs += a * cost;
    }
  };

  // 시작일
  if (cfg.initial > 0) {
    buyByWeight(cfg.initial, 0);
    flows.push({ date: cal[0], amount: -cfg.initial });
  }
  const v0 = shares.reduce((a, sh, s) => a + sh * px[s][0], 0);
  value.push(v0);
  contributed.push(contributedTotal);
  twr.push(cfg.initial > 0 ? v0 / cfg.initial : 1);

  for (let i = 1; i < n; i++) {
    // 1) 분배금 (전 거래일 다음날 ~ 오늘 사이에 배당락)
    for (let s = 0; s < k; s++) {
      const d = divs[s];
      while (dptr[s] < d.length && d[dptr[s]].ex <= cal[i]) {
        const ev = d[dptr[s]++];
        if (ev.ex <= cal[i - 1]) continue;
        const gross = shares[s] * ev.amount;
        if (gross <= 0) continue;
        const net = gross * (1 - tax);
        divEvents++;
        divCount[s]++;
        incGross += gross;
        incTax += gross - net;
        divGross[s] += gross;
        const ym = (ev.pay ?? ev.ex).slice(0, 7);
        const m = monthInc.get(ym) ?? { gross: 0, net: 0 };
        m.gross += gross;
        m.net += net;
        monthInc.set(ym, m);
        if (cfg.reinvest) {
          addShares(s, (net * (1 - cost)) / px[s][i], i);
          costs += net * cost;
          reinvested += net;
        } else cash += net;
      }
    }
    // 1-1) 양도소득세 납부: 5월 첫 거래일에 지난해까지의 세금 (현금 → 부족하면 보유 비율대로 매도)
    if (cg && fxArr && cal[i].slice(5, 7) === "05" && cal[i - 1].slice(5, 7) !== "05") {
      const thisYear = cal[i].slice(0, 4);
      for (const y of [...yearGain.keys()].sort()) {
        if (y >= thisYear || settled.has(y)) continue;
        settled.add(y);
        const net = yearGain.get(y) ?? 0;
        const taxKrw = capitalGainsTax(net).taxKrw;
        const usd = taxKrw / fxArr[i];
        if (usd > 0) {
          let left = usd;
          const fromCash = Math.min(cash, left);
          cash -= fromCash;
          left -= fromCash;
          const inv = shares.reduce((a, sh, s) => a + sh * px[s][i], 0);
          if (left > 0 && inv > 0) {
            const f = Math.min(1, left / (inv * (1 - cost)));
            for (let s = 0; s < k; s++) {
              const q = shares[s] * f;
              costs += q * px[s][i] * cost;
              removeShares(s, q, i);
            }
          }
          taxPaidUsd += usd;
        }
        taxYears.push({ year: y, netGainKrw: net, taxKrw, paidOn: cal[i], paidUsd: usd });
      }
    }
    // 2) 추가 납입
    const mNow = cal[i].slice(0, 7);
    let flow = 0;
    if (cfg.monthly > 0) {
      const isContribution =
        cfg.timing === "month_start"
          ? mNow !== cal[i - 1].slice(0, 7)
          : i < n - 1
            ? cal[i + 1].slice(0, 7) !== mNow
            : afterEnd !== null && afterEnd.slice(0, 7) !== mNow;
      if (isContribution) flow = cfg.monthly;
    }
    // 3) 리밸런싱 (새 기간 첫 거래일) — 같은 날 납입금도 함께 맞춘다
    const rebalanceToday = cfg.rebalance !== "none" && periodKey(cal[i], cfg.rebalance) !== periodKey(cal[i - 1], cfg.rebalance);
    if (rebalanceToday) {
      rebalances++;
      const cur = shares.map((sh, s) => sh * px[s][i]);
      const total = cur.reduce((a, b) => a + b, 0) + flow;
      let traded = 0;
      for (let s = 0; s < k; s++) traded += Math.abs(total * w[s] - cur[s]);
      const fee = traded * cost;
      costs += fee;
      for (let s = 0; s < k; s++) {
        const target = ((total - fee) * w[s]) / px[s][i];
        if (target > shares[s]) addShares(s, target - shares[s], i);
        else removeShares(s, shares[s] - target, i);
      }
    } else if (flow > 0) buyByWeight(flow, i);
    if (flow > 0) {
      contributedTotal += flow;
      contributions++;
      flows.push({ date: cal[i], amount: -flow });
    }
    const v = shares.reduce((a, sh, s) => a + sh * px[s][i], 0) + cash;
    const prev = value[i - 1];
    twr.push(prev > 0 ? twr[i - 1] * ((v - flow) / prev) : twr[i - 1]);
    value.push(v);
    contributed.push(contributedTotal);
  }

  const finalValue = value[n - 1];
  flows.push({ date: cal[n - 1], amount: finalValue });
  const years = yearsBetween(cal[0], cal[n - 1]);
  const rets = dailyReturns(twr);
  const dd = drawdown(twr);
  const annual = periodReturns(cal, twr, (d) => d.slice(0, 4)).map((p, idx, arr) => ({
    year: p.key,
    retPct: p.retPct,
    partial: (idx === 0 && p.first.slice(5) > "01-07") || (idx === arr.length - 1 && p.last.slice(5) < "12-24"),
  }));
  const monthly = periodReturns(cal, twr, (d) => d.slice(0, 7)).map((p) => ({ ym: p.key, retPct: p.retPct }));
  const endValues = shares.map((sh, s) => sh * px[s][n - 1]);
  const invested = endValues.reduce((a, b) => a + b, 0);
  if (!cfg.reinvest && cash > 0) notes.push("재투자하지 않은 세후 분배금은 이자 없는 현금으로 평가금액에 포함했습니다.");
  if (years < 1) notes.push("기간이 1년 미만이라 연환산 수익률(CAGR)은 표시하지 않습니다.");
  let capitalGains: CapitalGainsResult | null = null;
  if (cg && fxArr && books) {
    const fxEnd = fxArr[n - 1];
    const lastYear = cal[n - 1].slice(0, 4);
    let unpaidKrw = 0;
    for (const y of [...yearGain.keys()].sort()) {
      if (settled.has(y)) continue;
      const net = yearGain.get(y) ?? 0;
      const t = capitalGainsTax(net).taxKrw;
      if (y !== lastYear) unpaidKrw += t;
      taxYears.push({ year: y, netGainKrw: net, taxKrw: t, paidOn: null, paidUsd: 0 });
    }
    const realizedLast = yearGain.get(lastYear) ?? 0;
    const lastTax = capitalGainsTax(realizedLast).taxKrw;
    unpaidKrw += lastTax;
    const unrealized = books.reduce((a, b, s) => a + shares[s] * px[s][n - 1] * fxEnd - b.position.krw, 0);
    const liquidationExtraKrw = capitalGainsTax(realizedLast + unrealized).taxKrw - lastTax;
    capitalGains = {
      method: cg.method,
      fxBasis: cg.fixedFx && cg.fixedFx > 0 ? "fixed" : "historical",
      years: taxYears.sort((a, b) => a.year.localeCompare(b.year)),
      paidUsd: taxPaidUsd,
      unpaidKrw,
      liquidationExtraKrw,
      afterTaxLiquidationUsd: finalValue - (unpaidKrw + liquidationExtraKrw) / fxEnd,
      fxEnd,
    };
    notes.push(`양도소득세: 연간 손익통산 후 250만 원 공제·22%, 다음 해 5월 첫 거래일에 납부(현금 → 부족하면 보유 비율대로 매도)한다고 가정했습니다. 이 포트폴리오 외 다른 해외주식 매매는 없다고 보며, 원화 환산은 ${capitalGains.fxBasis === "fixed" ? `고정 환율 ${cg.fixedFx}원` : "거래일 원/달러 종가(실제 신고는 결제일 기준환율)"}입니다.`);
  }
  return {
    ok: true,
    config: cfg,
    start: cal[0],
    end: cal[n - 1],
    tradingDays: n,
    years,
    dates: cal,
    value,
    contributed,
    twr,
    drawdown: dd.series,
    finalValue,
    totalContributed: contributedTotal,
    profit: finalValue - contributedTotal,
    totalReturnPct: contributedTotal > 0 ? (finalValue / contributedTotal - 1) * 100 : 0,
    twrReturnPct: (twr[n - 1] - 1) * 100,
    cagrPct: cagrPct(twr[n - 1], years),
    irrPct: years >= 1 ? xirrPct(flows) : null,
    volPct: annualVolPct(rets),
    sharpe: sharpe(rets, cfg.riskFreePct),
    riskFreePct: cfg.riskFreePct,
    mddPct: dd.mddPct,
    mddPeak: dd.mddPct < 0 ? cal[dd.peakIndex] : null,
    mddTrough: dd.mddPct < 0 ? cal[dd.troughIndex] : null,
    mddRecovery: dd.recoveryIndex !== null ? cal[dd.recoveryIndex] : null,
    annual,
    monthly,
    income: { gross: incGross, tax: incTax, net: incGross - incTax, reinvested, cash },
    monthlyIncome: [...monthInc.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([ym, m]) => ({ ym, ...m })),
    holdings: ss.map((x, s) => ({
      symbol: x.symbol,
      targetWeight: cfg.holdings[s].weight,
      shares: shares[s],
      value: endValues[s],
      endWeight: invested > 0 ? (endValues[s] / invested) * 100 : 0,
      dividendsGross: divGross[s],
    })),
    costs,
    contributions,
    capitalGains,
    notes,
    verification: {
      requested: { start: cfg.start, end: cfg.end },
      used: { start: cal[0], end: cal[n - 1] },
      skippedDays: Math.max(0, skipped),
      skippedSample,
      coverage: cov.items.map((it, s) => ({ ...it, source: ss[s].source, fetchedAt: ss[s].fetchedAt, divEvents: divCount[s] })),
      commonStart: cov.commonStart,
      commonEnd: cov.commonEnd,
      divEvents,
      rebalances,
    },
  };
}

/** 같은 조건으로 '분배금 재투자 여부'와 '가격만(분배금 제외)'을 함께 계산 */
export function runBacktestSuite(cfg: BacktestConfig, series: Record<string, PriceSeries | undefined>) {
  const main = runBacktest(cfg, series);
  if (!main.ok) return { main, flipped: null, priceOnly: null };
  const flipped = runBacktest({ ...cfg, reinvest: !cfg.reinvest }, series) as BacktestResult;
  const priceOnly = runBacktest({ ...cfg, ignoreDividends: true, reinvest: false }, series) as BacktestResult;
  return { main, flipped, priceOnly };
}

export interface BenchmarkComparison {
  benchmark: string;
  excessTotalPct: number;
  excessCagrPct: number | null;
  finalDiff: number;
  /** 포트폴리오 TWR ÷ 벤치마크 TWR (시작 100) */
  relDates: string[];
  relative: number[];
  /** 벤치마크 대비 상대 성과의 최대 낙폭(%) */
  relMddPct: number;
}

export function compareWithBenchmark(p: BacktestResult, b: BacktestResult): BenchmarkComparison {
  const bm = new Map(b.dates.map((d, i) => [d, b.twr[i]]));
  const relDates: string[] = [];
  const relative: number[] = [];
  for (let i = 0; i < p.dates.length; i++) {
    const bv = bm.get(p.dates[i]);
    if (bv === undefined) continue;
    relDates.push(p.dates[i]);
    relative.push((p.twr[i] / bv) * 100);
  }
  const base = relative[0] ?? 100;
  const rel = relative.map((v) => (v / base) * 100);
  return {
    benchmark: b.holdings.map((h) => h.symbol).join("+"),
    excessTotalPct: p.totalReturnPct - b.totalReturnPct,
    excessCagrPct: p.cagrPct !== null && b.cagrPct !== null ? p.cagrPct - b.cagrPct : null,
    finalDiff: p.finalValue - b.finalValue,
    relDates,
    relative: rel,
    relMddPct: drawdown(rel).mddPct,
  };
}

export interface FullPeriodStat {
  symbol: string;
  first: string;
  last: string;
  years: number;
  priceCagrPct: number | null;
  totalCagrPct: number | null;
  totalReturnPct: number;
  mddPct: number;
}

/** 종목 하나의 전체 이용 가능 기간 성과 (종목마다 기간이 달라 서로 직접 비교할 수 없다) */
export function fullPeriodStat(x: PriceSeries): FullPeriodStat | null {
  if (x.dates.length < 2) return null;
  const tri = totalReturnPath(x, 0, x.dates.length - 1);
  const years = yearsBetween(x.dates[0], x.dates[x.dates.length - 1]);
  const t = tri[tri.length - 1];
  return {
    symbol: x.symbol,
    first: x.dates[0],
    last: x.dates[x.dates.length - 1],
    years,
    priceCagrPct: cagrPct(x.close[x.close.length - 1] / x.close[0], years),
    totalCagrPct: cagrPct(t, years),
    totalReturnPct: (t - 1) * 100,
    mddPct: drawdown(tri).mddPct,
  };
}

/** 분배금을 배당락일 종가로 재투자한 총수익 지수 (from 위치 = 1) */
export function totalReturnPath(x: PriceSeries, from: number, to: number): number[] {
  const out = [1];
  const divs = [...x.divs].sort((a, b) => a.ex.localeCompare(b.ex));
  let p = 0;
  while (p < divs.length && divs[p].ex <= x.dates[from]) p++;
  let idx = 1;
  for (let i = from + 1; i <= to; i++) {
    let d = 0;
    while (p < divs.length && divs[p].ex <= x.dates[i]) d += divs[p++].amount;
    idx *= (x.close[i] + d) / x.close[i - 1];
    out.push(idx);
  }
  return out;
}

export interface KrwView {
  ok: true;
  values: number[];
  contributedKrw: number;
  finalKrw: number;
  returnPct: number;
  fxStart: { date: string; rate: number };
  fxEnd: { date: string; rate: number };
}

/**
 * 원화 환산 — 각 날짜의 환율(해당일 또는 직전 거래일 종가)로 평가금액과 납입금을 환산한다.
 * 원화 기준 수익률에는 환율 변동 효과가 포함된다. 환율 기록이 없는 기간은 계산하지 않는다.
 */
export function toKrw(r: BacktestResult, fx: PriceSeries | undefined): KrwView | { ok: false; reason: string } {
  if (!fx || !fx.dates.length) return { ok: false, reason: "원/달러 환율 기록이 아직 수집되지 않았습니다." };
  if (fx.dates[0] > r.dates[0]) return { ok: false, reason: `환율 기록이 ${fx.dates[0]}부터 있어 ${r.dates[0]}부터의 원화 환산은 계산하지 않습니다.` };
  const values: number[] = [];
  let contributedKrw = 0;
  let prevContrib = 0;
  for (let i = 0; i < r.dates.length; i++) {
    const rate = closeOn(fx, r.dates[i]) as { date: string; close: number };
    values.push(r.value[i] * rate.close);
    const flow = r.contributed[i] - prevContrib;
    if (flow > 0) contributedKrw += flow * rate.close;
    prevContrib = r.contributed[i];
  }
  const s = closeOn(fx, r.dates[0]) as { date: string; close: number };
  const e = closeOn(fx, r.dates[r.dates.length - 1]) as { date: string; close: number };
  const finalKrw = values[values.length - 1];
  if (daysBetween(e.date, r.dates[r.dates.length - 1]) > 7) return { ok: false, reason: `최근 환율 기록(${e.date})이 오래되어 원화 환산을 하지 않습니다.` };
  return {
    ok: true,
    values,
    contributedKrw,
    finalKrw,
    returnPct: contributedKrw > 0 ? (finalKrw / contributedKrw - 1) * 100 : 0,
    fxStart: { date: s.date, rate: s.close },
    fxEnd: { date: e.date, rate: e.close },
  };
}
