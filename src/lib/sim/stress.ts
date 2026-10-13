/**
 * 스트레스 테스트 (순수 함수) — 가정에 따른 계산이며 실제 미래 예측이 아니다
 *
 * 1) 분배금 감소: 기준 = 보유 수량 × 최근 12개월 실제 주당 정기 지급액. 감소율을 전체 또는 특정 종목에만 적용한다.
 * 2) 하락장 단순 충격: 선택한 시장 지수가 X% 내린다고 가정하고, 각 종목의 과거 일간 베타로 영향을 추정한다.
 *    - 베타 단순 적용: 종목 손실률 = 베타 × X (최대 −100%)
 *    - 일일 복리 경로: 지수가 D거래일 동안 과거 변동성으로 오르내리며 X% 내리는 경로를 여러 번 만들고,
 *      종목은 매일 '베타 × 지수 일간 수익률'로 움직인다고 계산한다. 레버리지 ETF 처럼 매일 배수를 다시 맞추는
 *      상품은 같은 하락률이라도 경로에 따라 손실이 달라진다는 점을 반영한다.
 * 3) 과거 실제 하락 구간: 지수가 고점 대비 일정 비율 이상 하락한 실제 구간에서 각 종목의 실제 총수익률(분배금 포함)을 쓴다.
 *    그 구간에 데이터가 없는 종목(상장 전)은 계산하지 않는다.
 */
import { mulberry32, normal, quantile, stdev } from "./metrics";
import { indexOnOrBefore, isRegularDiv, type PriceSeries } from "./series";

// ─────────────────────────────── 분배금 감소 ───────────────────────────────

export interface IncomePosition {
  symbol: string;
  shares: number;
  /** 최근 12개월 실제 주당 정기 지급액 */
  ttmPerShare: number;
  /** 1~12월 비중 (합계 1) */
  monthWeights: number[];
}

export interface DividendScenario {
  key: string;
  label: string;
  /** 전체 종목 동일 감소율(%) */
  uniformCutPct?: number;
  /** 특정 종목만 감소 (종목 → 감소율 %) */
  targetedCuts?: Record<string, number>;
}

export interface DividendStressRow {
  key: string;
  label: string;
  kind: "uniform" | "targeted";
  annualGross: number;
  annualNet: number;
  monthlyGross: number[];
  perHolding: { symbol: string; before: number; after: number; cutPct: number }[];
  diffAnnualGross: number;
  diffPct: number;
}

export function dividendStress(positions: IncomePosition[], scenarios: DividendScenario[], taxPct: number) {
  const tax = taxPct / 100;
  const before = positions.map((p) => ({ symbol: p.symbol, annual: p.shares * p.ttmPerShare, mw: p.monthWeights.some((x) => x > 0) ? p.monthWeights : Array(12).fill(1 / 12) }));
  const baseAnnual = before.reduce((a, b) => a + b.annual, 0);
  const monthly = (cuts: number[]) => Array.from({ length: 12 }, (_, m) => before.reduce((a, b, i) => a + b.annual * (1 - cuts[i] / 100) * b.mw[m], 0));
  const rows: DividendStressRow[] = scenarios.map((sc) => {
    const cuts = positions.map((p) => (sc.targetedCuts ? (sc.targetedCuts[p.symbol] ?? 0) : (sc.uniformCutPct ?? 0)));
    const per = before.map((b, i) => ({ symbol: b.symbol, before: b.annual, after: b.annual * (1 - cuts[i] / 100), cutPct: cuts[i] }));
    const annualGross = per.reduce((a, p) => a + p.after, 0);
    return {
      key: sc.key,
      label: sc.label,
      kind: sc.targetedCuts ? "targeted" : "uniform",
      annualGross,
      annualNet: annualGross * (1 - tax),
      monthlyGross: monthly(cuts),
      perHolding: per,
      diffAnnualGross: annualGross - baseAnnual,
      diffPct: baseAnnual > 0 ? (annualGross / baseAnnual - 1) * 100 : 0,
    };
  });
  return { baseAnnualGross: baseAnnual, baseAnnualNet: baseAnnual * (1 - tax), baseMonthly: monthly(positions.map(() => 0)), rows };
}

// ─────────────────────────────── 하락장: 베타 ───────────────────────────────

export interface BetaEstimate {
  symbol: string;
  beta: number | null;
  corr: number | null;
  days: number;
  from: string | null;
  to: string | null;
}

/** 공통 거래일의 일간 수익률로 시장 지수 대비 베타 추정 (최근 lookbackDays 거래일) */
export function estimateBeta(x: PriceSeries, idx: PriceSeries, lookbackDays = 756): BetaEstimate {
  const im = new Map(idx.dates.map((d, i) => [d, idx.close[i]]));
  const pairs: { d: string; a: number; b: number }[] = [];
  for (let i = 0; i < x.dates.length; i++) {
    const c = im.get(x.dates[i]);
    if (c !== undefined) pairs.push({ d: x.dates[i], a: x.close[i], b: c });
  }
  const tail = pairs.slice(-(lookbackDays + 1));
  // 분배금 배당락일의 가격 하락은 수익률에서 보정 (총수익 기준)
  const divByDate = new Map<string, number>();
  for (const d of x.divs) divByDate.set(d.ex, (divByDate.get(d.ex) ?? 0) + d.amount);
  const ra: number[] = [];
  const rb: number[] = [];
  for (let i = 1; i < tail.length; i++) {
    ra.push((tail[i].a + (divByDate.get(tail[i].d) ?? 0)) / tail[i - 1].a - 1);
    rb.push(tail[i].b / tail[i - 1].b - 1);
  }
  if (ra.length < 120) return { symbol: x.symbol, beta: null, corr: null, days: ra.length, from: tail[0]?.d ?? null, to: tail[tail.length - 1]?.d ?? null };
  const ma = ra.reduce((s, v) => s + v, 0) / ra.length;
  const mb = rb.reduce((s, v) => s + v, 0) / rb.length;
  let cov = 0;
  let vb = 0;
  let va = 0;
  for (let i = 0; i < ra.length; i++) {
    cov += (ra[i] - ma) * (rb[i] - mb);
    vb += (rb[i] - mb) ** 2;
    va += (ra[i] - ma) ** 2;
  }
  return { symbol: x.symbol, beta: vb ? cov / vb : null, corr: va && vb ? cov / Math.sqrt(va * vb) : null, days: ra.length, from: tail[0].d, to: tail[tail.length - 1].d };
}

/** 지수의 일간 로그수익률 표준편차 (최근 lookbackDays) */
export function dailyVol(idx: PriceSeries, lookbackDays = 756): number {
  const c = idx.close.slice(-(lookbackDays + 1));
  const r: number[] = [];
  for (let i = 1; i < c.length; i++) r.push(Math.log(c[i] / c[i - 1]));
  return stdev(r);
}

export interface ShockPosition {
  symbol: string;
  value: number;
  beta: number | null;
}

export interface LinearShockRow {
  symbol: string;
  value: number;
  beta: number | null;
  retPct: number | null;
  loss: number | null;
  after: number | null;
}

/** 베타 단순 적용 */
export function linearShock(positions: ShockPosition[], shockPct: number) {
  const rows: LinearShockRow[] = positions.map((p) => {
    if (p.beta === null) return { symbol: p.symbol, value: p.value, beta: null, retPct: null, loss: null, after: null };
    const r = Math.max(-100, -p.beta * shockPct);
    return { symbol: p.symbol, value: p.value, beta: p.beta, retPct: r, loss: (p.value * r) / 100, after: p.value * (1 + r / 100) };
  });
  const complete = rows.every((r) => r.retPct !== null);
  const total = positions.reduce((a, p) => a + p.value, 0);
  const loss = complete ? rows.reduce((a, r) => a + (r.loss as number), 0) : null;
  return { rows, total, loss, after: loss !== null ? total + loss : null, retPct: loss !== null && total > 0 ? (loss / total) * 100 : null };
}

export interface PathShockResult {
  shockPct: number;
  days: number;
  paths: number;
  sigmaDaily: number;
  perHolding: { symbol: string; p10: number; p50: number; p90: number }[];
  portfolio: { p10: number; p50: number; p90: number } | null;
}

/** 일일 복리 경로 시뮬레이션 (지수가 days 거래일 동안 정확히 shockPct% 하락하는 경로들) */
export function pathShock(positions: ShockPosition[], shockPct: number, days: number, sigmaDaily: number, paths = 1000, seed = 7): PathShockResult {
  const rand = mulberry32(seed);
  const target = Math.log(1 - shockPct / 100);
  const per: number[][] = positions.map(() => []);
  const port: number[] = [];
  const total = positions.reduce((a, p) => a + p.value, 0);
  const complete = positions.every((p) => p.beta !== null);
  for (let k = 0; k < paths; k++) {
    const z = Array.from({ length: days }, () => normal(rand) * sigmaDaily);
    const m = z.reduce((a, b) => a + b, 0) / days;
    const r = z.map((v) => Math.exp(v - m + target / days) - 1);
    let pv = 0;
    positions.forEach((p, s) => {
      if (p.beta === null) return;
      let g = 1;
      for (const x of r) g *= Math.max(0, 1 + (p.beta as number) * x);
      per[s].push((g - 1) * 100);
      pv += p.value * g;
    });
    if (complete && total > 0) port.push((pv / total - 1) * 100);
  }
  const q = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return { p10: quantile(s, 0.1), p50: quantile(s, 0.5), p90: quantile(s, 0.9) };
  };
  return {
    shockPct,
    days,
    paths,
    sigmaDaily,
    perHolding: positions.filter((p) => p.beta !== null).map((p) => ({ symbol: p.symbol, ...q(per[positions.indexOf(p)]) })),
    portfolio: complete && port.length ? q(port) : null,
  };
}

// ─────────────────────────────── 과거 실제 하락 구간 ───────────────────────────────

export interface Episode {
  name: string | null;
  peak: string;
  trough: string;
  recovery: string | null;
  indexDrawdownPct: number;
}

const NAMED: { from: string; to: string; name: string }[] = [
  { from: "1987-10-01", to: "1987-12-31", name: "1987 블랙 먼데이" },
  { from: "1990-08-01", to: "1990-12-31", name: "1990 걸프전·경기침체" },
  { from: "1998-08-01", to: "1998-10-31", name: "1998 러시아·LTCM 위기" },
  { from: "2001-01-01", to: "2003-03-31", name: "닷컴 버블 붕괴 (2000~2002)" },
  { from: "2008-01-01", to: "2009-06-30", name: "글로벌 금융위기 (2007~2009)" },
  { from: "2010-06-01", to: "2010-07-31", name: "2010 유럽 재정위기" },
  { from: "2011-08-01", to: "2011-11-30", name: "2011 미국 신용등급 강등" },
  { from: "2015-08-01", to: "2016-02-29", name: "2015~2016 중국 쇼크·유가 급락" },
  { from: "2018-10-01", to: "2018-12-31", name: "2018 4분기 하락" },
  { from: "2020-02-15", to: "2020-04-30", name: "2020 코로나19 급락" },
  { from: "2022-01-01", to: "2022-12-31", name: "2022 금리 인상기 하락" },
  { from: "2025-03-01", to: "2025-05-31", name: "2025 관세 충격" },
];

/** 지수가 고점 대비 thresholdPct% 이상 내린 구간 (고점 → 저점 → 고점 회복) */
export function findEpisodes(idx: PriceSeries, thresholdPct = 15): Episode[] {
  const out: Episode[] = [];
  const c = idx.close;
  let peakI = 0;
  let troughI = 0;
  let inDd = false;
  for (let i = 1; i < c.length; i++) {
    if (!inDd) {
      if (c[i] >= c[peakI]) {
        peakI = i;
        continue;
      }
      if (c[i] / c[peakI] - 1 <= -thresholdPct / 100) {
        inDd = true;
        troughI = i;
      }
    } else {
      if (c[i] < c[troughI]) troughI = i;
      if (c[i] >= c[peakI]) {
        out.push(mk(idx, peakI, troughI, i));
        inDd = false;
        peakI = i;
      }
    }
  }
  if (inDd) out.push(mk(idx, peakI, troughI, null));
  return out.reverse();
}

function mk(idx: PriceSeries, p: number, t: number, r: number | null): Episode {
  const trough = idx.dates[t];
  return {
    name: NAMED.find((n) => trough >= n.from && trough <= n.to)?.name ?? null,
    peak: idx.dates[p],
    trough,
    recovery: r === null ? null : idx.dates[r],
    indexDrawdownPct: (idx.close[t] / idx.close[p] - 1) * 100,
  };
}

export interface EpisodeImpact {
  episode: Episode;
  perHolding: { symbol: string; weight: number; retPct: number | null; contributionPct: number | null; reason: string | null }[];
  /** 고점에 산 뒤 지수 저점일까지 포트폴리오 총수익률 (모든 종목에 데이터가 있을 때만) */
  portfolioRetPct: number | null;
  /** 같은 구간 포트폴리오의 최대 낙폭 (고점 → 지수 회복일 또는 데이터 끝) */
  portfolioMddPct: number | null;
  /** 포트폴리오가 고점 가치를 회복한 날 */
  portfolioRecovery: string | null;
  missing: string[];
}

/** 분배금 재투자 총수익 지수를 date 기준 1로 만든 경로 (from~to) */
function trPath(x: PriceSeries, from: string, to: string): { dates: string[]; v: number[] } | null {
  const i0 = indexOnOrBefore(x.dates, from);
  if (i0 < 0 || x.dates[0] > from) return null;
  const i1 = indexOnOrBefore(x.dates, to);
  if (i1 <= i0) return null;
  const divs = x.divs.filter((d) => d.ex > x.dates[i0] && d.ex <= x.dates[i1]);
  const dates = [x.dates[i0]];
  const v = [1];
  let p = 0;
  for (let i = i0 + 1; i <= i1; i++) {
    let d = 0;
    while (p < divs.length && divs[p].ex <= x.dates[i]) d += divs[p++].amount;
    v.push(v[v.length - 1] * ((x.close[i] + d) / x.close[i - 1]));
    dates.push(x.dates[i]);
  }
  return { dates, v };
}

export function episodeImpact(ep: Episode, holdings: { symbol: string; weight: number }[], series: Record<string, PriceSeries | undefined>, dataEnd: string): EpisodeImpact {
  const windowEnd = ep.recovery ?? dataEnd;
  const paths = holdings.map((h) => {
    const x = series[h.symbol];
    if (!x || !x.dates.length) return { h, path: null, reason: "데이터 없음" };
    if (x.dates[0] > ep.peak) return { h, path: null, reason: `${x.dates[0]} 이후 데이터만 있음 (상장 전 구간)` };
    return { h, path: trPath(x, ep.peak, windowEnd), reason: null };
  });
  const per = paths.map(({ h, path, reason }) => {
    if (!path) return { symbol: h.symbol, weight: h.weight, retPct: null, contributionPct: null, reason };
    const i = indexOnOrBefore(path.dates, ep.trough);
    const r = (path.v[Math.max(0, i)] - 1) * 100;
    return { symbol: h.symbol, weight: h.weight, retPct: r, contributionPct: (r * h.weight) / 100, reason: null };
  });
  const missing = per.filter((p) => p.retPct === null).map((p) => p.symbol);
  let portfolioRetPct: number | null = null;
  let portfolioMddPct: number | null = null;
  let portfolioRecovery: string | null = null;
  if (!missing.length && holdings.length) {
    portfolioRetPct = per.reduce((a, p) => a + (p.contributionPct as number), 0);
    // 매수 후 보유(리밸런싱 없음): 날짜별 가치 = Σ 비중 × 총수익 지수
    const ref = paths[0].path as { dates: string[]; v: number[] };
    const maps = paths.map((p) => new Map((p.path as { dates: string[]; v: number[] }).dates.map((d, i) => [d, (p.path as { v: number[] }).v[i]])));
    let peak = 1;
    let mdd = 0;
    let troughSeen = false;
    for (const d of ref.dates) {
      const vals = maps.map((m) => m.get(d));
      if (vals.some((v) => v === undefined)) continue;
      const pv = vals.reduce((a: number, v, s) => a + (v as number) * (holdings[s].weight / 100), 0);
      if (pv > peak) peak = pv;
      mdd = Math.min(mdd, (pv / peak - 1) * 100);
      if (d >= ep.trough) troughSeen = true;
      if (troughSeen && pv >= 1 && !portfolioRecovery && d > ep.trough) portfolioRecovery = d;
    }
    portfolioMddPct = mdd;
  }
  return { episode: ep, perHolding: per, portfolioRetPct, portfolioMddPct, portfolioRecovery, missing };
}

/** 최근 12개월 실제 주당 정기 지급액 (기준일까지) */
export function ttmPerShare(x: PriceSeries, asOf: string): number {
  const from = new Date(Date.parse(asOf) - 365 * 86400000).toISOString().slice(0, 10);
  return x.divs.filter((d) => isRegularDiv(d) && d.ex > from && d.ex <= asOf).reduce((a, d) => a + d.amount, 0);
}


/** 과거 실제 급락 구간(고점 → 저점)의 지수 일간 로그수익률 표준편차 — 하락장 경로 시뮬레이션의 '위기 변동성' */
export function crashVol(idx: PriceSeries, episodes: Episode[]): { sigma: number; days: number } | null {
  const r: number[] = [];
  for (const e of episodes) {
    const a = indexOnOrBefore(idx.dates, e.peak);
    const b = indexOnOrBefore(idx.dates, e.trough);
    for (let i = Math.max(1, a + 1); i <= b; i++) r.push(Math.log(idx.close[i] / idx.close[i - 1]));
  }
  return r.length >= 60 ? { sigma: stdev(r), days: r.length } : null;
}
