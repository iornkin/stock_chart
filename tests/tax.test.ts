import { describe, expect, it } from "vitest";
import { CostBook, capitalGainsTax, taxReport } from "@/lib/portfolio/tax";
import { runBacktest } from "@/lib/sim/backtest";
import type { Txn } from "@/lib/portfolio/types";
import type { PriceSeries } from "@/lib/sim/series";
import { addDays } from "@/lib/time";

const t = (o: Partial<Txn> & Pick<Txn, "type" | "date">, i: number): Txn => ({ id: `t${i}`, createdAt: i, ...o });

describe("해외주식 양도소득세", () => {
  it("기본공제 250만 원 후 22%", () => {
    expect(capitalGainsTax(5_000_000)).toEqual({ taxableKrw: 2_500_000, taxKrw: 550_000 });
    expect(capitalGainsTax(2_000_000).taxKrw).toBe(0);
    expect(capitalGainsTax(-1_000_000).taxKrw).toBe(0);
  });

  it("선입선출법과 이동평균법의 취득가액 차이", () => {
    const fifo = new CostBook("fifo");
    const avg = new CostBook("average");
    for (const b of [fifo, avg]) {
      b.buy(10, 1000, 1_000_000);
      b.buy(10, 2000, 2_600_000);
    }
    expect(fifo.sell(10).krw).toBe(1_000_000);
    expect(avg.sell(10).krw).toBe(1_800_000);
    expect(fifo.position.krw).toBe(2_600_000);
  });

  it("연간 손익통산·다음 해로 손실 이월 안 함·수수료 필요경비", () => {
    const txns: Txn[] = [
      t({ type: "deposit", date: "2025-01-02", amount: 100_000, fx: 1300 }, 1),
      t({ type: "buy", date: "2025-01-03", symbol: "QQQ", shares: 100, price: 400, fx: 1300 }, 2),
      t({ type: "buy", date: "2025-01-03", symbol: "JEPI", shares: 100, price: 60, fx: 1300 }, 3),
      // QQQ 50주: (500 − 400) × 50 × 1,300 = 6,500,000 − 수수료 10 × 1,300
      t({ type: "sell", date: "2025-06-02", symbol: "QQQ", shares: 50, price: 500, fee: 10, fx: 1300 }, 4),
      // JEPI 손실: (50 − 60) × 100 × 1,300 = −1,300,000
      t({ type: "sell", date: "2025-07-01", symbol: "JEPI", shares: 100, price: 50, fx: 1300 }, 5),
      // 2026 년 손실은 2025 년과 상계하지 않음
      t({ type: "sell", date: "2026-02-02", symbol: "QQQ", shares: 50, price: 380, fx: 1300 }, 6),
      t({ type: "dividend", date: "2025-03-28", symbol: "QQQ", amount: 100, tax: 15, fx: 1400 }, 7),
    ];
    const r = taxReport(txns, "fifo", () => null);
    const y25 = r.years.find((y) => y.year === 2025)!;
    expect(y25.netKrw).toBeCloseTo(6_500_000 - 13_000 - 1_300_000, 6);
    expect(y25.taxKrw).toBe(Math.round((6_500_000 - 13_000 - 1_300_000 - 2_500_000) * 0.22));
    expect(y25.dividendsKrw).toBe(140_000);
    const y26 = r.years.find((y) => y.year === 2026)!;
    expect(y26.netKrw).toBeLessThan(0);
    expect(y26.taxKrw).toBe(0);
  });

  it("거래 환율이 없으면 원/달러 기록으로 근사하고 표시", () => {
    const txns: Txn[] = [t({ type: "buy", date: "2025-01-03", symbol: "SCHD", shares: 10, price: 25 }, 1), t({ type: "sell", date: "2025-05-01", symbol: "SCHD", shares: 10, price: 30 }, 2)];
    const r = taxReport(txns, "average", (d) => (d < "2025-03-01" ? 1450 : 1380));
    expect(r.estimatedFx).toBe(2);
    expect(r.years[0].netKrw).toBeCloseTo(300 * 1380 - 250 * 1450, 6);
    expect(taxReport(txns, "average", () => null).missingFx.length).toBe(2);
  });

  it("지금 전부 판다면: 올해 실현분과 합산해 추가 세금 계산", () => {
    const txns: Txn[] = [t({ type: "buy", date: "2025-01-03", symbol: "QQQ", shares: 100, price: 400, fx: 1300 }, 1)];
    const r = taxReport(txns, "fifo", () => null, { prices: { QQQ: 500 }, fx: 1300, year: 2026 });
    expect(r.liquidation?.gainKrw).toBeCloseTo(13_000_000, 6);
    expect(r.liquidation?.taxKrw).toBe(Math.round((13_000_000 - 2_500_000) * 0.22));
  });
});

describe("백테스트 양도소득세", () => {
  const dates: string[] = [];
  for (let d = "2021-01-04"; d <= "2023-12-29"; d = addDays(d, 1)) {
    const wd = new Date(d + "T00:00:00Z").getUTCDay();
    if (wd !== 0 && wd !== 6) dates.push(d);
  }
  const y1end = dates.filter((d) => d < "2022-01-01").length - 1;
  const mk = (symbol: string, f: (i: number) => number): PriceSeries => ({ symbol, kind: "etf", dates, close: dates.map((_, i) => f(i)), divs: [], source: "t", fetchedAt: 0 });
  const A = mk("A", () => 100);
  const B = mk("B", (i) => (i <= y1end ? 100 + (100 * i) / y1end : 200));
  const base = { holdings: [{ symbol: "A", weight: 50 }, { symbol: "B", weight: 50 }], start: dates[0], end: dates[dates.length - 1], initial: 100_000, monthly: 0, timing: "month_start" as const, reinvest: true, costPct: 0, taxPct: 0, riskFreePct: 0 };

  it("리밸런싱 매도 차익에 세금 → 다음 해 5월 납부", () => {
    const r = runBacktest({ ...base, rebalance: "annual", capitalGains: { method: "fifo", fx: null, fixedFx: 1000 } }, { A, B });
    if (!r.ok) throw new Error(r.problems.join());
    const y = r.capitalGains!.years.find((x) => x.year === "2022")!;
    // 2022-01 첫 거래일: B 50,000 → 100,000, 목표 75,000 → 12,500달러어치(125주) 매도, 차익 12,500달러 = 1,250만 원
    expect(y.netGainKrw).toBeCloseTo(12_500_000, 0);
    expect(y.taxKrw).toBe(Math.round((12_500_000 - 2_500_000) * 0.22));
    expect(y.paidOn?.slice(0, 7)).toBe("2023-05");
    expect(r.capitalGains!.paidUsd).toBeCloseTo(2_200, 6);
    const noTax = runBacktest({ ...base, rebalance: "annual" }, { A, B });
    if (!noTax.ok) throw new Error();
    expect(noTax.finalValue - r.finalValue).toBeGreaterThan(2_000);
  });

  it("매도가 없으면 납부 세금 0, 대신 전부 판다고 가정한 세금을 따로 계산", () => {
    const r = runBacktest({ ...base, rebalance: "none", capitalGains: { method: "average", fx: null, fixedFx: 1000 } }, { A, B });
    if (!r.ok) throw new Error();
    expect(r.capitalGains!.paidUsd).toBe(0);
    expect(r.capitalGains!.liquidationExtraKrw).toBe(Math.round((50_000_000 - 2_500_000) * 0.22));
    expect(r.capitalGains!.afterTaxLiquidationUsd).toBeCloseTo(r.finalValue - 10_450, 6);
  });

  it("환율 기록이 기간을 덮지 않으면 계산하지 않음", () => {
    const fx = mk("KRW=X", () => 1300);
    fx.dates = dates.slice(10);
    fx.close = fx.close.slice(10);
    const r = runBacktest({ ...base, rebalance: "annual", capitalGains: { method: "fifo", fx, fixedFx: null } }, { A, B });
    expect(r.ok).toBe(false);
  });
});

import { solveTarget } from "@/lib/sim/target";

describe("목표 배당 역산", () => {
  const monthly = Array(12).fill(1 / 12);
  const quarterly = Array(12).fill(0);
  [2, 5, 8, 11].forEach((m) => (quarterly[m] = 0.25));

  it("평균 기준: 연간 목표 ÷ (수익률 × 세후 비율)", () => {
    const r = solveTarget([{ symbol: "M", weight: 100, yieldPct: 8, annualizedYieldPct: 7.2, monthWeights: monthly, price: 50 }], 1000, 15, true);
    if ("error" in r) throw new Error(r.error);
    expect(r.requiredAvg).toBeCloseTo(12_000 / (0.08 * 0.85), 6);
    expect(r.requiredEveryMonth).toBeCloseTo(r.requiredAvg, 6);
    expect(r.requiredAnnualized).toBeCloseTo(12_000 / (0.072 * 0.85), 6);
  });

  it("분기 지급만 있으면 지급 없는 달이 생기고, 섞으면 가장 적은 달 기준이 더 크다", () => {
    const q = solveTarget([{ symbol: "Q", weight: 100, yieldPct: 4, annualizedYieldPct: null, monthWeights: quarterly, price: 30 }], 500, 0, false);
    if ("error" in q) throw new Error(q.error);
    expect(q.zeroMonths).toEqual([1, 2, 4, 5, 7, 8, 10, 11]);
    expect(q.requiredEveryMonth).toBeNull();
    const mix = solveTarget(
      [
        { symbol: "Q", weight: 50, yieldPct: 4, annualizedYieldPct: null, monthWeights: quarterly, price: 30 },
        { symbol: "M", weight: 50, yieldPct: 8, annualizedYieldPct: null, monthWeights: monthly, price: 50 },
      ],
      500,
      0,
      false,
    );
    if ("error" in mix) throw new Error(mix.error);
    expect(mix.yieldPct).toBeCloseTo(6, 9);
    expect(mix.requiredEveryMonth!).toBeGreaterThan(mix.requiredAvg);
    expect(mix.monthly.reduce((a, b) => a + b, 0)).toBeCloseTo(6000, 6);
  });
});
