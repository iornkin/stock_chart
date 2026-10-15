import { describe, expect, it } from "vitest";
import { centerHistory, historicalReturnStats, monthlyHistory, probAtLeast, runFuture, runMonteCarlo, type FutureConfig, type MonthlyHistory } from "@/lib/sim/future";
import type { PriceSeries } from "@/lib/sim/series";
import { addDays } from "@/lib/time";

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
const mk = (symbol: string, dates: string[], f: (i: number, d: string) => number, divs: PriceSeries["divs"] = []): PriceSeries => ({ symbol, kind: "etf", dates, close: dates.map((d, i) => f(i, d)), divs, source: "t", fetchedAt: 0 });
const yearsSince = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / (365.25 * 86400000);

const cfg = (over: Partial<FutureConfig> = {}): FutureConfig => ({
  holdings: [
    { symbol: "A", weight: 60, priceReturnPct: 5, yieldPct: 2 },
    { symbol: "B", weight: 40, priceReturnPct: -1, yieldPct: 8, monthWeights: [0, 0, 1 / 4, 0, 0, 1 / 4, 0, 0, 1 / 4, 0, 0, 1 / 4] },
  ],
  months: 30,
  startYm: "2026-11",
  initial: 10_000,
  monthly: 300,
  timing: "start",
  reinvest: true,
  rebalance: "annual",
  costPct: 0.1,
  taxPct: 15,
  feePct: 0,
  ...over,
});

describe("미래 시나리오: 연도별 상세와 종목별 분배금", () => {
  it("연도별로 시작 + 납입 + 가격 변화 + 세후 분배금 − 비용 = 연말 평가금액", () => {
    for (const reinvest of [true, false]) {
      const r = runFuture(cfg({ reinvest }));
      expect(r.yearly.map((y) => y.year)).toEqual([2026, 2027, 2028, 2029]);
      expect(r.yearly.reduce((a, y) => a + y.months, 0)).toBe(30);
      for (const y of r.yearly) expect(y.startValue + y.contributions + y.priceGain + y.incomeNet - y.costs).toBeCloseTo(y.endValue, 6);
      expect(r.yearly[r.yearly.length - 1].endValue).toBeCloseTo(r.finalValue, 6);
      expect(r.yearly.reduce((a, y) => a + y.contributions, 0)).toBeCloseTo(r.totalContributed, 6);
      expect(r.yearly.reduce((a, y) => a + y.reinvested, 0)).toBeCloseTo(reinvest ? r.incomeNetTotal : 0, 6);
    }
  });

  it("종목별 분배금 합 = 전체 분배금, 세후 = 세전 × (1 − 세율), 연도별 합도 일치", () => {
    const r = runFuture(cfg());
    const g = r.perHolding.reduce((a, h) => a + h.incomeGross, 0);
    const n = r.perHolding.reduce((a, h) => a + h.incomeNet, 0);
    expect(g).toBeCloseTo(r.incomeGrossTotal, 6);
    expect(n).toBeCloseTo(r.incomeNetTotal, 6);
    for (const h of r.perHolding) {
      expect(h.incomeNet).toBeCloseTo(h.incomeGross * 0.85, 6);
      expect(h.years.reduce((a, y) => a + y.gross, 0)).toBeCloseTo(h.incomeGross, 6);
    }
    // B 는 3·6·9·12월에만 지급 → 2026년(11·12월)은 12월 1회분, 2027년은 4회분
    const b = r.perHolding.find((h) => h.symbol === "B")!;
    const y26 = b.years.find((y) => y.year === 2026)!;
    const y27 = b.years.find((y) => y.year === 2027)!;
    expect(y27.gross / y26.gross).toBeGreaterThan(3.5);
    expect(y27.gross / y26.gross).toBeLessThan(6); // 납입으로 평가금액이 커져 4배보다 큼
  });
});

describe("종목별 과거 실적 (이동 구간 총수익률)", () => {
  it("매년 10%씩 꾸준히 오르면 5년 이동 구간 연환산이 모두 약 10%", () => {
    const d = tradingDays("2010-01-01", 252 * 12);
    const s = mk("A", d, (_, day) => 100 * Math.pow(1.1, yearsSince("2010-01-01", day)));
    const h = historicalReturnStats(s, 5);
    if ("error" in h) throw new Error(h.error);
    expect(h.p25).toBeCloseTo(10, 0);
    expect(h.p75).toBeCloseTo(10, 0);
    expect(h.windows).toBeGreaterThan(60);
  });

  it("분배금은 재투자해 총수익에 포함", () => {
    const d = tradingDays("2010-01-01", 252 * 8);
    const divs = d.filter((_, i) => i % 63 === 30).map((ex) => ({ ex, pay: null, amount: 1, kind: "regular" }));
    const flat = historicalReturnStats(mk("F", d, () => 100), 5);
    const paid = historicalReturnStats(mk("P", d, () => 100, divs), 5);
    if ("error" in flat || "error" in paid) throw new Error("data");
    expect(flat.p50).toBeCloseTo(0, 6);
    expect(paid.p50).toBeGreaterThan(3.9); // 분기 1% → 연 약 4%
  });

  it("데이터가 짧으면 계산하지 않고 이유를 알림", () => {
    const s = mk("S", tradingDays("2022-01-01", 252 * 4), (i) => 100 + i);
    expect("error" in historicalReturnStats(s, 5)).toBe(true);
  });
});

describe("몬테카를로 보완", () => {
  const hist = (rets: number[], income: number[] = rets.map(() => 0)): MonthlyHistory => ({ months: rets.map((_, i) => `2015-${String((i % 12) + 1).padStart(2, "0")}`), price: [rets], income: [income], first: "2015-01", last: "2019-12" });

  it("평균 조정: 변동성은 남기고 기하 평균을 목표에 맞춤", () => {
    const rets = Array.from({ length: 60 }, (_, i) => (i % 2 ? 0.04 : -0.02));
    const c = centerHistory(hist(rets), 7);
    const g = Math.pow(c.price[0].reduce((a, x) => a * (1 + x), 1), 12 / 60) - 1;
    expect(g * 100).toBeCloseTo(7, 0);
    // 변동성(차이)은 그대로
    expect(c.price[0][1] - c.price[0][0]).toBeCloseTo(0.06, 12);
  });

  it("수익률이 매달 같으면 평균 조정 결과가 정확히 목표 수익률", () => {
    const h = hist(Array(60).fill(0.02));
    const base = { ...cfg(), holdings: [{ symbol: "A", weight: 100 }], months: 12, monthly: 0, costPct: 0, taxPct: 0, rebalance: "none" as const, paths: 100, blockMonths: 3, seed: 7 };
    const r = runMonteCarlo({ ...base, centerAnnualPct: 7 }, h);
    if ("error" in r) throw new Error(r.error);
    expect(r.final.p50).toBeCloseTo(10_000 * 1.07, 4);
    expect(r.cagr.p50).toBeCloseTo(7, 6);
    expect(r.centeredAt).toBe(7);
    // 표본 자체 성과는 원래 과거 값 (월 2%)
    expect(r.sample.annualPct).toBeCloseTo((Math.pow(1.02, 12) - 1) * 100, 6);
    expect(r.yearEnd).toHaveLength(1);
    expect(probAtLeast(r.finalsSorted, 10_000 * 1.07 - 1)).toBe(100);
    expect(probAtLeast(r.finalsSorted, 10_000 * 1.07 + 1)).toBe(0);
  });

  it("연말 분위수·종목별 분배금·마지막 12개월 월평균 분배금", () => {
    const d = tradingDays("2012-01-01", 252 * 8);
    const divs = d.filter((_, i) => i % 21 === 10).map((ex) => ({ ex, pay: null, amount: 0.5, kind: "regular" }));
    const h = monthlyHistory([mk("A", d, (i) => 100 + i * 0.02, divs)], null);
    if ("error" in h) throw new Error(h.error);
    const r = runMonteCarlo({ ...cfg(), holdings: [{ symbol: "A", weight: 100 }], months: 30, paths: 200, blockMonths: 3, seed: 3 }, h);
    if ("error" in r) throw new Error(r.error);
    expect(r.yearEnd.map((y) => y.month)).toEqual([12, 24, 30]);
    expect(r.incomeBySymbol[0].symbol).toBe("A");
    expect(r.incomeBySymbol[0].p50).toBeGreaterThan(0);
    expect(r.lastYearMonthlyIncome.p50).toBeGreaterThan(0);
    for (const y of r.yearEnd) expect(y.p5).toBeLessThanOrEqual(y.p95);
  });
});

describe("몬테카를로 확률", () => {
  it("목표 이상 경로 비율", () => {
    expect(probAtLeast([1, 2, 3, 4], 3)).toBe(50);
    expect(probAtLeast([1, 2, 3, 4], 0)).toBe(100);
    expect(probAtLeast([1, 2, 3, 4], 5)).toBe(0);
  });
});
