import { describe, expect, it } from "vitest";
import { checkCoverage, compareWithBenchmark, runBacktest, runBacktestSuite, totalReturnPath, validateWeights, toKrw, type BacktestConfig, type BacktestResult } from "@/lib/sim/backtest";
import { drawdown, periodReturns, xirrPct } from "@/lib/sim/metrics";
import { monthlyHistory, runFuture, runMonteCarlo, scenarioHoldings, type FutureConfig } from "@/lib/sim/future";
import { dividendStress, episodeImpact, estimateBeta, findEpisodes, linearShock, pathShock } from "@/lib/sim/stress";
import { decodeSeries, encodeSeries, type PriceSeries, type SeriesDiv } from "@/lib/sim/series";
import { incomeInfo } from "@/lib/sim/income";
import { computeLedger, computeSimple, convertSimpleToLedger, ledgerTimeline } from "@/lib/portfolio/ledger";
import type { Txn } from "@/lib/portfolio/types";
import { addDays } from "@/lib/time";

/** 평일만 이어지는 거래일 */
function tradingDays(start: string, n: number): string[] {
  const out: string[] = [];
  let d = start;
  while (out.length < n) {
    const wd = new Date(d + "T00:00:00Z").getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

function mkSeries(symbol: string, dates: string[], close: number[] | ((i: number) => number), divs: SeriesDiv[] = [], kind: PriceSeries["kind"] = "etf"): PriceSeries {
  return { symbol, kind, dates, close: typeof close === "function" ? dates.map((_, i) => close(i)) : close, divs, source: "test", fetchedAt: 0 };
}

const baseCfg = (over: Partial<BacktestConfig> = {}): BacktestConfig => ({
  holdings: [{ symbol: "A", weight: 100 }],
  start: "2020-01-01",
  end: "2030-01-01",
  initial: 10_000,
  monthly: 0,
  timing: "month_start",
  reinvest: true,
  rebalance: "none",
  costPct: 0,
  taxPct: 0,
  riskFreePct: 0,
  ...over,
});

const ok = (r: ReturnType<typeof runBacktest>) => {
  if (!r.ok) throw new Error(r.problems.join(" / "));
  return r;
};

describe("백테스트: 분배금 이중 계산 방지", () => {
  const dates = tradingDays("2020-01-01", 300);
  // 가격은 그대로, 분기마다 주당 1달러 분배 (배당락일에 가격이 내려가지 않는 극단 예시)
  const divs: SeriesDiv[] = [60, 120, 180, 240].map((i) => ({ ex: dates[i], pay: dates[i + 5], amount: 1, kind: "regular" }));
  const flat = mkSeries("A", dates, () => 100, divs);

  it("재투자: 가격 불변이면 (1 + 1%)^4 만큼만 늘어난다", () => {
    const r = ok(runBacktest(baseCfg(), { A: flat }));
    expect(r.finalValue).toBeCloseTo(10_000 * 1.01 ** 4, 6);
    expect(r.income.gross).toBeCloseTo(100 + 101 + 102.01 + 103.0301, 6);
  });

  it("미재투자: 현금으로 정확히 4번만 더한다", () => {
    const r = ok(runBacktest(baseCfg({ reinvest: false }), { A: flat }));
    expect(r.finalValue).toBeCloseTo(10_000 + 4 * 100, 6);
    expect(r.income.cash).toBeCloseTo(400, 6);
  });

  it("가격만(분배금 제외) 계산은 분배금을 전혀 더하지 않는다", () => {
    const s = runBacktestSuite(baseCfg(), { A: flat });
    expect(s.priceOnly?.finalValue).toBeCloseTo(10_000, 6);
    expect(s.flipped?.finalValue).toBeCloseTo(10_400, 6);
  });

  it("재투자 백테스트 결과 = 총수익 지수 (배당락일에 가격이 내려가는 실제 형태)", () => {
    const close = dates.map((_, i) => 100 * Math.pow(1.0004, i) - (i >= 60 ? 1 : 0) - (i >= 120 ? 1 : 0));
    const x = mkSeries("A", dates, close, divs);
    const r = ok(runBacktest(baseCfg(), { A: x }));
    const tri = totalReturnPath(x, 0, dates.length - 1);
    expect(r.finalValue / 10_000).toBeCloseTo(tri[tri.length - 1], 9);
    expect(r.twr[r.twr.length - 1]).toBeCloseTo(tri[tri.length - 1], 9);
  });

  it("세금은 분배금에서 한 번만 뺀다", () => {
    const r = ok(runBacktest(baseCfg({ reinvest: false, taxPct: 15 }), { A: flat }));
    expect(r.income.tax).toBeCloseTo(60, 6);
    expect(r.finalValue).toBeCloseTo(10_000 + 340, 6);
  });
});

describe("백테스트: 기간·데이터 범위 검증", () => {
  const a = mkSeries("A", tradingDays("2015-01-01", 2000), (i) => 100 + i * 0.01);
  const b = mkSeries("B", tradingDays("2020-06-01", 600), (i) => 50 + i * 0.01);

  it("상장 전 시작일은 계산하지 않고 공통 시작일을 알려 준다", () => {
    const r = runBacktest(baseCfg({ holdings: [{ symbol: "A", weight: 50 }, { symbol: "B", weight: 50 }], start: "2018-01-02" }), { A: a, B: b });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problems.join(" ")).toContain("B: 데이터가 2020-06-01부터");
      expect(r.coverage?.commonStart).toBe("2020-06-01");
    }
  });

  it("사용자가 입력한 시작일·종료일을 그대로 쓴다 (빠른 기간 고정 아님)", () => {
    const r = ok(runBacktest(baseCfg({ start: "2016-03-15", end: "2017-08-20" }), { A: a }));
    expect(r.start).toBe("2016-03-15");
    expect(r.end <= "2017-08-20").toBe(true);
    expect(r.end >= "2017-08-17").toBe(true);
  });

  it("데이터 마지막 날 이후 종료일은 마지막 데이터 날까지 계산하고 알린다", () => {
    const cov = checkCoverage(["A"], { A: a }, "2016-01-04", "2099-01-01");
    expect(cov.effectiveEnd).toBe(a.dates[a.dates.length - 1]);
    expect(cov.notes[0]).toContain("마지막 데이터 날짜");
  });

  it("데이터가 없는 종목은 오류", () => {
    const r = runBacktest(baseCfg({ holdings: [{ symbol: "Z", weight: 100 }] }), {});
    expect(r.ok).toBe(false);
  });

  it("비중 합계 확인과 자동 정규화", () => {
    const v = validateWeights([{ symbol: "A", weight: 30 }, { symbol: "B", weight: 60 }], false);
    expect(v.ok).toBe(false);
    const n = validateWeights([{ symbol: "A", weight: 30 }, { symbol: "B", weight: 60 }], true);
    expect(n.ok && n.holdings.map((h) => Math.round(h.weight * 100) / 100)).toEqual([33.33, 66.67]);
  });
});

describe("백테스트: 납입·리밸런싱·비용", () => {
  const dates = tradingDays("2021-01-04", 520);
  const flat = mkSeries("A", dates, () => 10);

  it("가격이 그대로면 매월 납입금이 원금 그대로 쌓이고 수익률·IRR 은 0", () => {
    const r = ok(runBacktest(baseCfg({ monthly: 500, start: dates[0], end: dates[dates.length - 1] }), { A: flat }));
    expect(r.contributions).toBe(new Set(dates.map((d) => d.slice(0, 7))).size - 1);
    expect(r.finalValue).toBeCloseTo(10_000 + 500 * r.contributions, 6);
    expect(r.totalReturnPct).toBeCloseTo(0, 9);
    expect(r.twrReturnPct).toBeCloseTo(0, 9);
    expect(r.irrPct ?? 0).toBeCloseTo(0, 4);
  });

  it("월말 납입은 각 달 마지막 거래일에 한다", () => {
    const r = ok(runBacktest(baseCfg({ monthly: 100, timing: "month_end", start: "2021-01-04", end: "2021-03-31" }), { A: flat }));
    expect(r.contributions).toBe(3);
  });

  it("거래 비용은 산 금액에서 빠진다", () => {
    const r = ok(runBacktest(baseCfg({ costPct: 1, start: dates[0], end: dates[10] }), { A: flat }));
    expect(r.value[0]).toBeCloseTo(9_900, 6);
    expect(r.costs).toBeCloseTo(100, 6);
  });

  it("리밸런싱하면 목표 비중으로 돌아가고, 안 하면 비중이 흘러간다", () => {
    const up = mkSeries("U", dates, (i) => 10 * Math.pow(1.002, i));
    const cfg = baseCfg({ holdings: [{ symbol: "A", weight: 50 }, { symbol: "U", weight: 50 }], start: dates[0], end: "2022-12-30" });
    const none = ok(runBacktest(cfg, { A: flat, U: up }));
    const yearly = ok(runBacktest({ ...cfg, rebalance: "monthly" }, { A: flat, U: up }));
    expect(none.holdings[1].endWeight).toBeGreaterThan(65);
    expect(Math.abs(yearly.holdings[1].endWeight - 50)).toBeLessThan(3);
  });

  it("같은 조건의 벤치마크와 비교 (자기 자신이면 초과수익 0)", () => {
    const up = mkSeries("U", dates, (i) => 10 * Math.pow(1.001, i));
    const p = ok(runBacktest(baseCfg({ holdings: [{ symbol: "U", weight: 100 }], start: dates[0], end: dates[400] }), { U: up }));
    const c = compareWithBenchmark(p, p);
    expect(c.excessTotalPct).toBeCloseTo(0, 9);
    expect(c.relMddPct).toBeCloseTo(0, 9);
  });

  it("원화 환산: 각 날짜 환율로 평가금액과 납입금을 환산", () => {
    const fx = mkSeries("KRW=X", dates, (i) => 1000 + i, [], "market");
    const r = ok(runBacktest(baseCfg({ start: dates[0], end: dates[100] }), { A: flat }));
    const k = toKrw(r, fx);
    expect(k.ok).toBe(true);
    if (k.ok) {
      expect(k.contributedKrw).toBeCloseTo(10_000 * 1000, 3);
      expect(k.finalKrw).toBeCloseTo(10_000 * 1100, 3);
      expect(k.returnPct).toBeCloseTo(10, 6);
    }
    expect(toKrw(r, mkSeries("KRW=X", dates.slice(50), () => 1300, [], "market")).ok).toBe(false);
  });
});

describe("성과 지표", () => {
  it("XIRR: 1년 뒤 10% 회수", () => {
    expect(xirrPct([{ date: "2020-01-01", amount: -100 }, { date: "2020-12-31", amount: 110 }])).toBeCloseTo(10.03, 1);
  });
  it("최대 낙폭과 회복", () => {
    const d = drawdown([100, 120, 90, 100, 130]);
    expect(d.mddPct).toBeCloseTo(-25, 9);
    expect(d.recoveryIndex).toBe(4);
  });
  it("월별 수익률은 직전 달 말 대비", () => {
    const r = periodReturns(["2024-01-30", "2024-01-31", "2024-02-28", "2024-02-29"], [1, 1.1, 1.0, 1.21], (d) => d.slice(0, 7));
    expect(r[0].retPct).toBeCloseTo(10, 9);
    expect(r[1].retPct).toBeCloseTo(10, 9);
  });
});

describe("미래 시뮬레이터", () => {
  const cfg = (over: Partial<FutureConfig> = {}): FutureConfig => ({
    holdings: [{ symbol: "A", weight: 100, priceReturnPct: 0, yieldPct: 12 }],
    months: 12,
    startYm: "2026-11",
    initial: 10_000,
    monthly: 0,
    timing: "start",
    reinvest: false,
    rebalance: "none",
    costPct: 0,
    taxPct: 0,
    feePct: 0,
    ...over,
  });

  it("가격 0%·분배금 12%·미재투자: 매달 1%씩 현금, 평가금액 원금 유지", () => {
    const r = runFuture(cfg());
    expect(r.incomeGrossTotal).toBeCloseTo(1_200, 6);
    expect(r.finalValue).toBeCloseTo(11_200, 6);
    expect(r.priceGainTotal).toBeCloseTo(0, 9);
  });

  it("재투자하면 복리로 늘고, 가격 수익과 분배금이 따로 집계된다", () => {
    const r = runFuture(cfg({ reinvest: true, holdings: [{ symbol: "A", weight: 100, priceReturnPct: 6, yieldPct: 12 }] }));
    expect(r.finalValue).toBeGreaterThan(10_000 * 1.06 * 1.12);
    expect(r.priceGainTotal).toBeGreaterThan(600);
  });

  it("총수익률 고정 가정: 가격 수익률 = 총수익률 − 분배금 수익률 (분배금이 높아도 총수익이 같다)", () => {
    const h = scenarioHoldings([{ symbol: "HI", weight: 100, yieldPct: 10 }], "total", 5);
    expect(h[0].priceReturnPct).toBe(-5);
    const lo = runFuture(cfg({ reinvest: true, holdings: scenarioHoldings([{ symbol: "LO", weight: 100, yieldPct: 1 }], "total", 5) }));
    const hi = runFuture(cfg({ reinvest: true, holdings: h }));
    expect(Math.abs(lo.finalValue / hi.finalValue - 1)).toBeLessThan(0.005);
  });

  it("지급 월 비중대로 분배금을 나눈다 (분기 지급)", () => {
    const mw = Array(12).fill(0);
    [2, 5, 8, 11].forEach((m) => (mw[m] = 0.25));
    const r = runFuture(cfg({ startYm: "2026-01", holdings: [{ symbol: "A", weight: 100, priceReturnPct: 0, yieldPct: 4, monthWeights: mw }] }));
    expect(r.months.filter((m) => m.incomeGross > 0).map((m) => m.ym)).toEqual(["2026-03", "2026-06", "2026-09", "2026-12"]);
  });

  it("몬테카를로: 데이터가 36개월 미만이면 실행하지 않는다", () => {
    const d = tradingDays("2024-01-01", 400);
    const h = monthlyHistory([mkSeries("A", d, (i) => 100 + i)], null);
    expect("error" in h).toBe(false);
    if (!("error" in h)) {
      const r = runMonteCarlo({ ...cfg(), holdings: [{ symbol: "A", weight: 100 }], paths: 200, blockMonths: 3, seed: 1 }, h);
      expect("error" in r).toBe(true);
    }
  });

  it("몬테카를로: 매달 같은 수익률이면 모든 경로가 같다", () => {
    const d = tradingDays("2015-01-01", 1500);
    const x = mkSeries("A", d, (i) => 100 * Math.pow(1.01, Math.floor(i / 21)));
    // 월말 종가 기준 월 1% 내외로 일정하게 오르는 시계열
    const h = monthlyHistory([x], null);
    if ("error" in h) throw new Error(h.error);
    h.price[0] = h.price[0].map(() => 0.01);
    h.income[0] = h.income[0].map(() => 0);
    const r = runMonteCarlo({ ...cfg(), holdings: [{ symbol: "A", weight: 100 }], paths: 200, blockMonths: 3, seed: 1 }, h);
    if ("error" in r) throw new Error(r.error);
    expect(r.final.p5).toBeCloseTo(10_000 * 1.01 ** 12, 6);
    expect(r.final.p95).toBeCloseTo(r.final.p5, 6);
    expect(r.lossProbPct).toBe(0);
  });
});

describe("스트레스 테스트", () => {
  it("분배금 감소: 전체 동일 감소와 특정 종목 감소를 구분", () => {
    const pos = [
      { symbol: "A", shares: 100, ttmPerShare: 2, monthWeights: Array(12).fill(1 / 12) },
      { symbol: "B", shares: 10, ttmPerShare: 12, monthWeights: [] },
    ];
    const r = dividendStress(pos, [{ key: "u20", label: "20%", uniformCutPct: 20 }, { key: "b30", label: "B만 30%", targetedCuts: { B: 30 } }], 15);
    expect(r.baseAnnualGross).toBe(320);
    expect(r.rows[0].annualGross).toBeCloseTo(256, 9);
    expect(r.rows[0].kind).toBe("uniform");
    expect(r.rows[1].annualGross).toBeCloseTo(200 + 84, 9);
    expect(r.rows[1].perHolding[0].cutPct).toBe(0);
    expect(r.rows[1].annualNet).toBeCloseTo(284 * 0.85, 9);
    expect(r.rows[0].monthlyGross.reduce((a, b) => a + b, 0)).toBeCloseTo(256, 9);
  });

  it("레버리지(베타 3) 종목은 지수와 같은 손실률로 보지 않고, 일일 복리 경로가 단순 3배와 다르다", () => {
    const pos = [
      { symbol: "IDX", value: 1000, beta: 1 },
      { symbol: "L3", value: 1000, beta: 3 },
    ];
    const lin = linearShock(pos, 20);
    expect(lin.rows[0].retPct).toBeCloseTo(-20, 9);
    expect(lin.rows[1].retPct).toBeCloseTo(-60, 9);
    expect(linearShock([{ symbol: "L3", value: 1, beta: 3 }], 40).rows[0].retPct).toBe(-100);
    const p = pathShock(pos, 20, 20, 0.015, 500, 3);
    const idx = p.perHolding.find((x) => x.symbol === "IDX")!;
    expect(idx.p10).toBeCloseTo(-20, 6);
    expect(idx.p90).toBeCloseTo(-20, 6);
    const l3 = p.perHolding.find((x) => x.symbol === "L3")!;
    expect(l3.p50).not.toBeCloseTo(-60, 0);
    expect(l3.p90).toBeGreaterThan(l3.p10);
  });

  it("베타 추정: 지수의 2배로 움직이면 베타 ≈ 2", () => {
    const d = tradingDays("2020-01-01", 400);
    const r = d.map((_, i) => Math.sin(i * 1.7) * 0.01);
    const idx = [100];
    const x = [100];
    for (let i = 1; i < d.length; i++) {
      idx.push(idx[i - 1] * (1 + r[i]));
      x.push(x[i - 1] * (1 + 2 * r[i]));
    }
    const b = estimateBeta(mkSeries("X", d, x), mkSeries("IDX", d, idx, [], "market"));
    expect(b.beta).toBeCloseTo(2, 6);
  });

  it("과거 하락 구간: 실제 구간을 찾고, 상장 전 종목은 계산하지 않는다", () => {
    const d = tradingDays("2019-01-01", 400);
    const idx = mkSeries("IDX", d, (i) => (i < 100 ? 100 + i * 0.1 : i < 150 ? 110 - (i - 100) * 0.8 : 70 + (i - 150) * 0.5), [], "market");
    const eps = findEpisodes(idx, 15);
    expect(eps.length).toBe(1);
    expect(eps[0].peak).toBe(d[100]);
    expect(eps[0].trough).toBe(d[150]);
    expect(eps[0].recovery).not.toBeNull();
    const late = mkSeries("NEW", d.slice(120), () => 10);
    const imp = episodeImpact(eps[0], [{ symbol: "IDXETF", weight: 50 }, { symbol: "NEW", weight: 50 }], { IDXETF: idx, NEW: late }, d[d.length - 1]);
    expect(imp.missing).toEqual(["NEW"]);
    expect(imp.portfolioRetPct).toBeNull();
    const full = episodeImpact(eps[0], [{ symbol: "IDXETF", weight: 100 }], { IDXETF: idx }, d[d.length - 1]);
    expect(full.portfolioRetPct).toBeCloseTo((70 / 110 - 1) * 100, 6);
  });
});

describe("개인 자산 회계", () => {
  const t = (o: Partial<Txn> & Pick<Txn, "type" | "date">, i: number): Txn => ({ id: `t${i}`, createdAt: i, ...o });
  const txns: Txn[] = [
    t({ type: "deposit", date: "2025-01-02", amount: 10_000, fx: 1450 }, 1),
    t({ type: "buy", date: "2025-01-03", symbol: "SCHD", shares: 100, price: 27, fee: 2 }, 2),
    t({ type: "buy", date: "2025-02-03", symbol: "SCHD", shares: 100, price: 29, fee: 2 }, 3),
    t({ type: "dividend", date: "2025-03-28", symbol: "SCHD", amount: 50, tax: 7.5 }, 4),
    t({ type: "sell", date: "2025-04-01", symbol: "SCHD", shares: 50, price: 30, fee: 1 }, 5),
    t({ type: "reinvest", date: "2025-06-27", symbol: "SCHD", amount: 40, tax: 6, shares: 1.1, price: 30 }, 6),
    t({ type: "withdraw", date: "2025-07-01", amount: 500 }, 7),
    t({ type: "sell", date: "2025-07-02", symbol: "SCHD", shares: 999, price: 30 }, 8),
  ];

  it("이동평균 단가·실현 손익·분배금·입출금을 구분하고 항등식이 맞는다", () => {
    const s = computeLedger(txns, { SCHD: 31 });
    const p = s.positions.find((x) => x.symbol === "SCHD")!;
    expect(p.shares).toBeCloseTo(151.1, 9);
    // 평균 단가 (2700+2+2900+2)/200 = 28.02 → 50주 매도 실현 = 1500−1−1401 = 98
    expect(s.realized).toBeCloseTo(98, 9);
    expect(s.dividendsGross).toBe(90);
    expect(s.dividendsTax).toBe(13.5);
    expect(s.netContributions).toBe(9_500);
    expect(s.totalAssets - s.netContributions).toBeCloseTo(s.unrealized + s.realized + s.dividendsNet, 9);
    expect(s.issues.some((i) => i.level === "error" && i.txnId === "t8")).toBe(true);
  });

  it("간편 입력 → 거래 내역 전환 시 원가와 총자산이 중복되지 않는다", () => {
    const holdings = [
      { id: "h1", symbol: "QQQ", shares: 10, avgCost: 400, firstDate: "2024-05-01" },
      { id: "h2", symbol: "JEPI", shares: 50, avgCost: 55 },
    ];
    const simple = computeSimple(holdings, 1_000, { QQQ: 500, JEPI: 57 });
    let n = 0;
    const led = computeLedger(convertSimpleToLedger(holdings, 1_000, null, "2026-10-13", () => `c${n++}`), { QQQ: 500, JEPI: 57 });
    expect(led.totalAssets).toBeCloseTo(simple.totalAssets, 9);
    expect(led.totalCost).toBeCloseTo(simple.totalCost, 9);
    expect(led.unrealized).toBeCloseTo(simple.unrealized, 9);
    expect(led.netContributions).toBeCloseTo(simple.totalCost + 1_000, 9);
    expect(led.totalPnl).toBeCloseTo(simple.unrealized, 9);
  });

  it("시세가 없는 종목이 있으면 총수익률을 계산하지 않는다", () => {
    const s = computeLedger(txns.slice(0, 2), {});
    expect(s.pricesComplete).toBe(false);
    expect(s.totalReturnPct).toBeNull();
  });

  it("날짜별 평가금액 재구성", () => {
    const tl = ledgerTimeline(txns.slice(0, 3), ["2025-01-02", "2025-01-03", "2025-02-03"], () => 28);
    expect(tl.value).toEqual([10_000, 10_000 - 2702 + 2800, 10_000 - 2702 - 2902 + 5600]);
  });
});

describe("데이터 형식", () => {
  it("시계열 압축·복원", () => {
    const d = tradingDays("2024-12-30", 30);
    const s = mkSeries("A", d, (i) => 1 + i / 7, [{ ex: d[3], pay: null, amount: 0.123456789, kind: "regular" }]);
    const back = decodeSeries(JSON.parse(JSON.stringify(encodeSeries(s))));
    expect(back.dates).toEqual(d);
    expect(back.close[5]).toBeCloseTo(s.close[5], 6);
  });

  it("배당 요약: 최근 12개월 실제 합계와 '최근 지급액 연환산'을 따로 둔다", () => {
    const divs: SeriesDiv[] = Array.from({ length: 14 }, (_, i) => ({ ex: addDays("2025-09-01", i * 30), pay: addDays("2025-09-04", i * 30), amount: i === 13 ? 0.5 : 0.4, kind: "regular" }));
    const info = incomeInfo("JEPI", "etf", divs, 50, "2026-09-20");
    expect(info.word).toBe("분배금");
    expect(info.perYear).toBe(12);
    expect(info.ttmPerShare).toBeCloseTo(0.4 * 12, 9);
    expect(info.annualizedLatest).toBeCloseTo(0.4 * 12, 9);
    expect(info.upcoming.length).toBe(1);
    expect(info.monthWeights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });
});
