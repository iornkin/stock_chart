import { describe, expect, it } from "vitest";
import { futureSensitivity, type FutureConfig } from "@/lib/sim/future";

const cfg: FutureConfig = {
  holdings: [
    { symbol: "A", weight: 60, priceReturnPct: 5, yieldPct: 3 },
    { symbol: "B", weight: 40, priceReturnPct: 2, yieldPct: 6 },
  ],
  months: 120,
  startYm: "2026-11",
  initial: 10_000,
  monthly: 500,
  timing: "start",
  reinvest: true,
  rebalance: "annual",
  costPct: 0.1,
  taxPct: 15,
  feePct: 0,
};

describe("가정 민감도 (한 번에 하나씩)", () => {
  const { base, rows } = futureSensitivity(cfg, { fx: 1400 });
  const r = (k: string) => rows.find((x) => x.key === k)!;
  it("방향이 맞다: 수익률↑ → 자산↑, 분배금↓·세금↑ → 월 분배금↓, 비용↑·급락 → 자산↓", () => {
    expect(r("ret+").diffValue).toBeGreaterThan(0);
    expect(r("ret-").diffValue).toBeLessThan(0);
    expect(r("div-").diffIncome).toBeLessThan(0);
    expect(r("tax30").diffIncome).toBeLessThan(0);
    expect(r("fee+").diffValue).toBeLessThan(0);
    expect(r("cost+").diffValue).toBeLessThan(0);
    expect(r("crash").diffValue).toBeLessThan(0);
  });
  it("세율만 바꾸면 세후 분배금은 (1−0.30)/(1−0.15) 배 (재투자 효과로 자산도 조금 줄어듦)", () => {
    expect(r("tax30").monthlyIncomeNet).toBeLessThan(base.avgMonthlyIncomeNet * (0.7 / 0.85) * 1.001);
  });
  it("환율은 달러 결과를 바꾸지 않고 원화 환산만 ±10%", () => {
    expect(r("fx10").diffValue).toBe(0);
    expect(r("fx10").diffValuePct).toBe(10);
    expect(r("fx-10").diffValuePct).toBe(-10);
  });
  it("같은 입력 → 같은 결과", () => {
    expect(futureSensitivity(cfg, { fx: 1400 })).toEqual({ base, rows });
  });
});
