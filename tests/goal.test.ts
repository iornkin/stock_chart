import { describe, expect, it } from "vitest";
import { goalPlan, type GoalInput } from "@/lib/sim/goal";

const base: GoalInput = { currentUsd: 0, monthlyUsd: 1000, years: 10, targetMonthlyUsd: 500, afterTax: true, yieldPct: 4, totalReturnPct: 4, taxPct: 15, reinvest: true };

describe("목표 달성 계획", () => {
  it("필요 자산 = 연 목표 ÷ (분배금 수익률 × 세후 비율)", () => {
    const r = goalPlan(base);
    if ("error" in r) throw new Error(r.error);
    expect(r.requiredAssets).toBeCloseTo((500 * 12) / (0.04 * 0.85), 6);
  });

  it("가격 변화 0, 재투자 없으면 평가액 = 납입 합계", () => {
    const r = goalPlan({ ...base, reinvest: false });
    if ("error" in r) throw new Error(r.error);
    expect(r.projectedAssets - r.cash).toBeCloseTo(120_000, 6);
    expect(r.projectedMonthlyIncome).toBeCloseTo((120_000 * 0.04 * 0.85) / 12, 6);
    expect(r.cash).toBeGreaterThan(0);
  });

  it("필요 월 투자금으로 계산하면 기간 끝에 목표에 닿음, 더 적으면 못 닿음", () => {
    const r = goalPlan(base);
    if ("error" in r) throw new Error(r.error);
    expect(r.requiredMonthly).not.toBeNull();
    const at = goalPlan({ ...base, monthlyUsd: r.requiredMonthly! + 0.01 });
    const below = goalPlan({ ...base, monthlyUsd: r.requiredMonthly! * 0.98 });
    if ("error" in at || "error" in below) throw new Error("x");
    expect(at.monthsToGoal).not.toBeNull();
    expect(at.monthsToGoal!).toBeLessThanOrEqual(120);
    expect(below.monthsToGoal === null || below.monthsToGoal > 120).toBe(true);
  });

  it("분배금 감소·시작 직후 하락 가정은 결과를 나쁘게, 이미 목표 이상이면 0개월", () => {
    const r = goalPlan(base);
    const cut = goalPlan({ ...base, yieldPct: 3.2 });
    const shock = goalPlan({ ...base, currentUsd: 50_000, shockPct: 30 });
    const noShock = goalPlan({ ...base, currentUsd: 50_000 });
    if ("error" in r || "error" in cut || "error" in shock || "error" in noShock) throw new Error("x");
    expect(cut.requiredAssets).toBeGreaterThan(r.requiredAssets);
    expect(shock.projectedAssets).toBeLessThan(noShock.projectedAssets);
    const done = goalPlan({ ...base, currentUsd: 1_000_000 });
    if ("error" in done) throw new Error("x");
    expect(done.monthsToGoal).toBe(0);
    expect(done.requiredMonthly).toBe(0);
  });

  it("잘못된 입력은 계산하지 않음", () => {
    expect("error" in goalPlan({ ...base, yieldPct: 0 })).toBe(true);
    expect("error" in goalPlan({ ...base, years: 0 })).toBe(true);
  });
});
