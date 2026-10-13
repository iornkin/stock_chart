/** SEC companyfacts → 분기 값 계산 테스트 (테스트용 고정 데이터) */
import { describe, expect, it } from "vitest";
import { extractFinancials, ttm, yoyGrowth } from "@/lib/financials";
import type { CompanyFacts } from "@/lib/providers/sec";

const f = (start: string | undefined, end: string, val: number, form: string, fy: number, fp: string, filed = "2025-01-01") => ({ start, end, val, form, fy, fp, filed });

const facts: CompanyFacts = {
  cik: 1,
  entityName: "Test Corp",
  facts: {
    "us-gaap": {
      Revenues: {
        units: {
          USD: [
            f("2023-10-01", "2023-12-31", 90, "10-Q", 2024, "Q1"),
            f("2024-01-01", "2024-03-31", 100, "10-Q", 2024, "Q2"),
            f("2024-04-01", "2024-06-30", 110, "10-Q", 2024, "Q3"),
            f("2023-10-01", "2024-09-30", 420, "10-K", 2024, "FY"),
            f("2024-10-01", "2024-12-31", 120, "10-Q", 2025, "Q1"),
          ],
        },
      },
      NetCashProvidedByUsedInOperatingActivities: {
        units: {
          USD: [
            f("2023-10-01", "2023-12-31", 30, "10-Q", 2024, "Q1"),
            f("2023-10-01", "2024-03-31", 70, "10-Q", 2024, "Q2"),
            f("2023-10-01", "2024-06-30", 100, "10-Q", 2024, "Q3"),
            f("2023-10-01", "2024-09-30", 140, "10-K", 2024, "FY"),
          ],
        },
      },
      StockholdersEquity: { units: { USD: [f(undefined, "2024-09-30", 500, "10-K", 2024, "FY")] } },
    },
  },
};

describe("재무제표 분기 값 계산", () => {
  const fin = extractFinancials(facts);
  it("4분기 = 연간 − 3분기 누적 (계산값 표시)", () => {
    const q4 = fin.revenue?.quarterly.find((q) => q.end === "2024-09-30");
    expect(q4?.value).toBe(120);
    expect(q4?.derived).toBe(true);
  });
  it("YTD 누적 현금흐름 → 분기 값", () => {
    expect(fin.operatingCashFlow?.quarterly.map((q) => q.value)).toEqual([30, 40, 30, 40]);
  });
  it("TTM 과 전년 동기 대비", () => {
    expect(ttm(fin.revenue)?.value).toBe(100 + 110 + 120 + 120);
    expect(yoyGrowth(fin.revenue)).toBeCloseTo((120 / 90 - 1) * 100);
  });
  it("시점 항목(자기자본)", () => {
    expect(fin.equity?.quarterly[0].value).toBe(500);
  });
});
