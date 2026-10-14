import { describe, expect, it } from "vitest";
import { afterTax, compareTaxScenarios, reinvestScenario } from "@/lib/dividend-tax";

describe("분배금 세후 계산", () => {
  it("세전 = 세금 + 세후, 세율은 0~100% 로 제한", () => {
    expect(afterTax(1000, 15)).toEqual({ gross: 1000, tax: 150, net: 850 });
    expect(afterTax(1000, 0).net).toBe(1000);
    expect(afterTax(1000, -5).tax).toBe(0);
    expect(afterTax(1000, 150).net).toBe(0);
  });

  it("여러 세율 가정을 같은 세전 금액으로 비교, 월은 연 ÷ 12", () => {
    const rows = compareTaxScenarios(1200, [
      { label: "세전", rate: 0 },
      { label: "15%", rate: 15 },
      { label: "직접 22%", rate: 22 },
    ]);
    expect(rows.map((r) => r.annual.net)).toEqual([1200, 1020, 936]);
    expect(rows[1].monthly.net).toBeCloseTo(85, 9);
    expect(rows[2].monthly.tax).toBeCloseTo(22, 9);
  });

  it("재투자: 가격 변화 0, 월 1% 분배, 세금 0 이면 1년 뒤 (1.01)^12 배", () => {
    const r = reinvestScenario({ startValue: 10_000, yieldPct: 12, taxPct: 0, priceChangePct: 0, years: 2, perYear: 12 });
    expect(r[0].valueNetReinvest).toBeCloseTo(10_000 * 1.01 ** 12, 6);
    expect(r[0].valueGrossReinvest).toBeCloseTo(r[0].valueNetReinvest, 9);
    expect(r[1].year).toBe(2);
  });

  it("세금은 재투자 효과를 줄이고, 재투자하지 않으면 원금 + 세후 현금", () => {
    const r = reinvestScenario({ startValue: 10_000, yieldPct: 4, taxPct: 15, priceChangePct: 0, years: 3, perYear: 4 });
    expect(r[2].valueNetReinvest).toBeLessThan(r[2].valueGrossReinvest);
    expect(r[2].valueNoReinvest).toBe(10_000);
    expect(r[2].cashNoReinvest).toBeCloseTo(3 * 10_000 * 0.04 * 0.85, 9);
    // 첫해 세후 분배금: 분기 1%·세후 0.85% 를 매번 재투자
    expect(r[0].incomeNet).toBeCloseTo(10_000 * (1.0085 ** 4 - 1), 6);
  });

  it("가격 변화율 가정이 반영됨 (분배 없음)", () => {
    const r = reinvestScenario({ startValue: 100, yieldPct: 0, taxPct: 15, priceChangePct: 10, years: 2, perYear: 4 });
    expect(r[1].valueNetReinvest).toBeCloseTo(121, 9);
    expect(r[1].valueNoReinvest).toBeCloseTo(121, 9);
  });
});
