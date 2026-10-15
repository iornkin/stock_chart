/**
 * 투자 위험 예산 (순수 함수) — 가정에 따른 계산이며 실제 손실 예측이 아니다
 *
 * - 종목별 위험 요인: 실제 과거 일간 총수익률(분배금 포함)로 변동성·베타·최대 낙폭·위험 기여도를 계산한다.
 * - 섹터 충격: 제공처 섹터 비중으로 계산한다. 섹터 정보가 없는 부분은 추정하지 않고
 *   '그 섹터에 전혀 없다고 볼 때 ~ 전부 그 섹터라고 볼 때'의 범위로 보여 준다.
 *   레버리지 ETF 는 편입 종목 대신 기초 ETF(예: TQQQ → QQQ)의 섹터 비중 × 배수로 본다 (하루 만에 일어난다고 가정).
 * - 장기 금리: 월간 총수익률을 10년물 금리 월간 변화(%p)에 회귀한 과거 관계로 추정한다. 상관이 약하면 그렇다고 표시한다.
 */
import { monthEndTotalReturn } from "./future";
import { drawdown, stdev } from "./metrics";
import type { PriceSeries } from "./series";

// ─────────────────────────────── 일간 총수익률 ───────────────────────────────

/** 최근 lookbackDays 거래일의 일간 총수익률 (배당락일 분배금 보정) */
export function dailyTotalReturns(x: PriceSeries, lookbackDays = 756): { dates: string[]; r: number[] } {
  const divBy = new Map<string, number>();
  for (const d of x.divs) divBy.set(d.ex, (divBy.get(d.ex) ?? 0) + d.amount);
  const from = Math.max(1, x.dates.length - lookbackDays);
  const dates: string[] = [];
  const r: number[] = [];
  for (let i = from; i < x.dates.length; i++) {
    if (!(x.close[i - 1] > 0)) continue;
    dates.push(x.dates[i]);
    r.push((x.close[i] + (divBy.get(x.dates[i]) ?? 0)) / x.close[i - 1] - 1);
  }
  return { dates, r };
}

/** 연환산 변동성 (%) — 거래일 120일 미만이면 null */
export function annualVol(x: PriceSeries, lookbackDays = 756): { pct: number; days: number } | null {
  const { r } = dailyTotalReturns(x, lookbackDays);
  return r.length >= 120 ? { pct: stdev(r) * Math.sqrt(252) * 100, days: r.length } : null;
}

/** 최근 lookbackDays 거래일 총수익 지수의 최대 낙폭 (%) */
export function recentMdd(x: PriceSeries, lookbackDays = 2520): { pct: number; from: string; to: string } | null {
  const { dates, r } = dailyTotalReturns(x, lookbackDays);
  if (r.length < 120) return null;
  const v = [1];
  for (const k of r) v.push(v[v.length - 1] * (1 + k));
  return { pct: drawdown(v).mddPct, from: dates[0], to: dates[dates.length - 1] };
}

export interface RiskContribution {
  /** 포트폴리오 연환산 변동성 (%) */
  portfolioVolPct: number;
  /** 종목 → 전체 변동성 중 몫 (%, 합 100) */
  share: Record<string, number>;
  days: number;
  from: string;
  to: string;
}

/**
 * 위험 기여도: 모든 종목에 가격이 있는 날만 맞춰 공분산을 계산하고
 * 기여도_i = w_i × (Σw)_i / (wᵀΣw)  (합계 100%)
 */
export function riskContributions(positions: { symbol: string; value: number }[], series: Record<string, PriceSeries | undefined>, lookbackDays = 756): RiskContribution | { error: string } {
  const pos = positions.filter((p) => p.value > 0);
  if (!pos.length) return { error: "보유 종목이 없습니다." };
  const total = pos.reduce((a, p) => a + p.value, 0);
  const rets = pos.map((p) => {
    const x = series[p.symbol];
    if (!x) return null;
    const d = dailyTotalReturns(x, lookbackDays);
    return new Map(d.dates.map((k, i) => [k, d.r[i]]));
  });
  const missing = pos.filter((_, i) => !rets[i]).map((p) => p.symbol);
  if (missing.length) return { error: `${missing.join(", ")} 가격 기록이 없습니다.` };
  const maps = rets as Map<string, number>[];
  const common = [...maps[0].keys()].filter((d) => maps.every((m) => m.has(d))).sort();
  if (common.length < 120) return { error: `모든 종목에 가격이 있는 날이 ${common.length}일뿐이라 계산하지 않습니다 (120일 이상 필요).` };
  const R = maps.map((m) => common.map((d) => m.get(d) as number));
  const means = R.map((r) => r.reduce((a, b) => a + b, 0) / r.length);
  const n = pos.length;
  const cov = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => {
    let s = 0;
    for (let t = 0; t < common.length; t++) s += (R[i][t] - means[i]) * (R[j][t] - means[j]);
    return s / (common.length - 1);
  }));
  const w = pos.map((p) => p.value / total);
  const sw = cov.map((row) => row.reduce((a, c, j) => a + c * w[j], 0));
  const varP = w.reduce((a, wi, i) => a + wi * sw[i], 0);
  if (!(varP > 0)) return { error: "변동성이 0이라 기여도를 계산할 수 없습니다." };
  const share: Record<string, number> = {};
  pos.forEach((p, i) => (share[p.symbol] = ((w[i] * sw[i]) / varP) * 100));
  return { portfolioVolPct: Math.sqrt(varP * 252) * 100, share, days: common.length, from: common[0], to: common[common.length - 1] };
}

// ─────────────────────────────── 섹터 노출 ───────────────────────────────

export interface SectorInfo {
  kind: "stock" | "etf";
  category: string;
  leverage: number | null;
  sectors: { sector: string; weight: number }[];
  stockSector: string | null;
}

export interface HoldingSectors {
  /** 섹터 → 비중 (%) */
  weights: Record<string, number>;
  /** 섹터를 아는 비율 (%) */
  knownPct: number;
  /** 레버리지 ETF 의 섹터를 대신 가져온 기초 ETF */
  via: string | null;
  leverage: number;
  note: string | null;
}

/** 종목 하나의 섹터 비중. proxies: 레버리지 ETF 가 따라가는 지수의 일반 ETF 후보 (앞에서부터) */
export function holdingSectors(symbol: string, info: Record<string, SectorInfo | undefined>, proxies: string[] = []): HoldingSectors {
  const i = info[symbol];
  if (!i) return { weights: {}, knownPct: 0, via: null, leverage: 1, note: "섹터 정보 없음" };
  if (i.category === "gold") return { weights: {}, knownPct: 100, via: null, leverage: 1, note: "금 — 주식 섹터 없음" };
  if (i.kind === "stock") return i.stockSector ? { weights: { [i.stockSector]: 100 }, knownPct: 100, via: null, leverage: 1, note: null } : { weights: {}, knownPct: 0, via: null, leverage: 1, note: "섹터 정보 없음" };
  const fromList = (list: { sector: string; weight: number }[]) => {
    const weights: Record<string, number> = {};
    for (const s of list) if (s.weight > 0) weights[s.sector] = (weights[s.sector] ?? 0) + s.weight;
    return { weights, knownPct: Math.min(100, Object.values(weights).reduce((a, b) => a + b, 0)) };
  };
  if (i.leverage) {
    for (const p of proxies) {
      const pi = info[p];
      if (pi && !pi.leverage && pi.sectors.length) return { ...fromList(pi.sectors), via: p, leverage: i.leverage, note: `${p} 섹터 비중 × ${i.leverage}배로 계산` };
    }
    return { weights: {}, knownPct: 0, via: null, leverage: i.leverage, note: "기초 지수의 섹터 정보 없음" };
  }
  if (!i.sectors.length) return { weights: {}, knownPct: 0, via: null, leverage: 1, note: "제공처 섹터 비중 미제공" };
  return { ...fromList(i.sectors), via: null, leverage: 1, note: null };
}

// ─────────────────────────────── 시나리오 ───────────────────────────────

export interface ScenarioHolding {
  symbol: string;
  /** 손실액 (양수 = 손실). 범위가 있으면 low ~ high */
  low: number;
  high: number;
}

export interface ScenarioResult {
  /** 예상 손실 (양수 = 손실) — 범위 하단·상단 */
  low: number;
  high: number;
  perHolding: ScenarioHolding[];
  /** 데이터가 없어 계산에서 뺀 종목 */
  excluded: string[];
}

const cap = (value: number, loss: number) => Math.max(-value, Math.min(value, loss));

/** 선택한 섹터들이 shockPct% 내릴 때 (다른 섹터는 그대로, 하루 만에 일어난다고 가정) */
export function sectorShock(rows: { symbol: string; value: number; sectors: HoldingSectors }[], sectors: string[], shockPct: number): ScenarioResult {
  const sel = new Set(sectors);
  const per = rows.map((r) => {
    const exp = Object.entries(r.sectors.weights).reduce((a, [s, w]) => a + (sel.has(s) ? w : 0), 0);
    const unknown = Math.max(0, 100 - r.sectors.knownPct);
    const f = (pct: number) => cap(r.value, (r.value * (pct / 100) * (shockPct / 100) * r.sectors.leverage));
    return { symbol: r.symbol, low: f(exp), high: f(exp + unknown) };
  });
  return { low: per.reduce((a, p) => a + p.low, 0), high: per.reduce((a, p) => a + p.high, 0), perHolding: per, excluded: [] };
}

/** 시장 지수가 shockPct% 내릴 때 — 베타 단순 적용 (최대 −100%) */
export function marketShock(rows: { symbol: string; value: number; beta: number | null }[], shockPct: number): ScenarioResult {
  const per: ScenarioHolding[] = [];
  const excluded: string[] = [];
  for (const r of rows) {
    if (r.beta === null) {
      excluded.push(r.symbol);
      continue;
    }
    const l = cap(r.value, (r.value * r.beta * shockPct) / 100);
    per.push({ symbol: r.symbol, low: l, high: l });
  }
  const s = per.reduce((a, p) => a + p.low, 0);
  return { low: s, high: s, perHolding: per, excluded };
}

/** 레버리지 ETF 의 기초 지수가 하루에 dropPct% 내릴 때 (레버리지 ETF 만, 다른 종목은 그대로) */
export function leveragedCrash(rows: { symbol: string; value: number; leverage: number | null }[], dropPct: number): ScenarioResult {
  const per = rows.filter((r) => r.leverage).map((r) => {
    const l = cap(r.value, (r.value * (r.leverage as number) * dropPct) / 100);
    return { symbol: r.symbol, low: l, high: l };
  });
  const s = per.reduce((a, p) => a + p.low, 0);
  return { low: s, high: s, perHolding: per, excluded: [] };
}

/** 분배금 감소 + 가격 하락이 동시에: 자산 손실(베타 적용)과 연간 분배금 감소(세전·세후) */
export function dividendAndPrice(rows: { symbol: string; value: number; beta: number | null; annualIncome: number }[], cutPct: number, marketDropPct: number, taxPct: number) {
  const price = marketShock(rows, marketDropPct);
  const incomeBefore = rows.reduce((a, r) => a + r.annualIncome, 0);
  const incomeDrop = incomeBefore * (cutPct / 100);
  return { price, incomeBefore, incomeAfter: incomeBefore - incomeDrop, incomeDrop, incomeDropNet: incomeDrop * (1 - taxPct / 100) };
}

// ─────────────────────────────── 장기 금리 ───────────────────────────────

export interface RateSensitivity {
  symbol: string;
  /** 10년물 금리 +1%p 일 때 그달 총수익률 변화 (%) — 과거 회귀 기울기 */
  pctPerPoint: number;
  /** 기울기 표준오차 */
  se: number;
  corr: number;
  months: number;
  from: string;
  to: string;
}

/** 월간 총수익률을 10년물 금리 월간 변화(%p)에 회귀 (최근 years 년, 36개월 이상 필요) */
export function rateSensitivity(x: PriceSeries, rate: PriceSeries, years = 10): RateSensitivity | { error: string } {
  const me = monthEndTotalReturn(x);
  const lv = new Map<string, number>();
  for (let i = 0; i < rate.dates.length; i++) if (rate.close[i] > 0) lv.set(rate.dates[i].slice(0, 7), rate.close[i]);
  // 마지막 달은 아직 끝나지 않았을 수 있으므로 쓰지 않는다
  const months = me.slice(0, -1).filter((m) => lv.has(m.ym));
  const tail = months.slice(-(years * 12 + 1));
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 1; i < tail.length; i++) {
    const prevYm = tail[i - 1].ym;
    // 연속된 달만 (중간이 빠지면 건너뜀)
    const [y0, m0] = prevYm.split("-").map(Number);
    const next = m0 === 12 ? `${y0 + 1}-01` : `${y0}-${String(m0 + 1).padStart(2, "0")}`;
    if (tail[i].ym !== next) continue;
    xs.push((lv.get(tail[i].ym) as number) - (lv.get(prevYm) as number));
    ys.push((tail[i].value / tail[i - 1].value - 1) * 100);
  }
  if (xs.length < 36) return { error: `금리와 겹치는 달이 ${xs.length}개월뿐입니다 (36개월 이상 필요).` };
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (!(sxx > 0) || !(syy > 0)) return { error: "변화가 없어 계산할 수 없습니다." };
  const b = sxy / sxx;
  const a = my - b * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (ys[i] - a - b * xs[i]) ** 2;
  const se = Math.sqrt(sse / (n - 2) / sxx);
  return { symbol: x.symbol, pctPerPoint: b, se, corr: sxy / Math.sqrt(sxx * syy), months: n, from: tail[0].ym, to: tail[tail.length - 1].ym };
}

/** 금리 risePoints %p 상승: 손실 = −가치 × 기울기 × 상승폭. 범위 = 기울기 ± 표준오차 */
export function rateShock(rows: { symbol: string; value: number; sens: RateSensitivity | null }[], risePoints: number): ScenarioResult {
  const per: ScenarioHolding[] = [];
  const excluded: string[] = [];
  for (const r of rows) {
    if (!r.sens) {
      excluded.push(r.symbol);
      continue;
    }
    const a = cap(r.value, (-r.value * (r.sens.pctPerPoint - r.sens.se) * risePoints) / 100);
    const b = cap(r.value, (-r.value * (r.sens.pctPerPoint + r.sens.se) * risePoints) / 100);
    per.push({ symbol: r.symbol, low: Math.min(a, b), high: Math.max(a, b) });
  }
  return { low: per.reduce((a, p) => a + p.low, 0), high: per.reduce((a, p) => a + p.high, 0), perHolding: per, excluded };
}

// ─────────────────────────────── 기준과 비교 ───────────────────────────────

export interface LossLimit {
  kind: "pct" | "usd";
  value: number;
}

export function limitUsd(limit: LossLimit, total: number): number {
  return limit.kind === "pct" ? (total * limit.value) / 100 : limit.value;
}

/** 손실(양수)이 기준을 넘는지: over = 상단도 넘음, partly = 범위 안에 기준이 있음 */
export function compareToLimit(low: number, high: number, limit: number): "within" | "partly" | "over" {
  if (low > limit) return "over";
  if (high > limit) return "partly";
  return "within";
}
