import { describe, expect, it } from "vitest";
import { inferFrequency, splitAdjustFactor, summarizeDividends } from "@/lib/dividend-analytics";
import { normalizedPrice, periodStats, sliceFrom, totalReturnIndex } from "@/lib/performance";
import type { Dividend } from "@/lib/types";

function d(exDate: string, amount: number, kind: Dividend["kind"] = "regular"): Dividend {
  return { symbol: "X", exDate, amount, amountRaw: null, splitAdjusted: false, payDate: null, recordDate: null, declaredDate: null, kind, frequencyReported: null, sources: ["test"] };
}

function monthly(n: number, start = [2024, 1]): Dividend[] {
  const out: Dividend[] = [];
  let [y, m] = start;
  for (let i = 0; i < n; i++) {
    out.push(d(`${y}-${String(m).padStart(2, "0")}-01`, 0.3 + (i % 3) * 0.01));
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

describe("지급 주기 판정 (실제 기록 기반)", () => {
  it("월별", () => {
    expect(inferFrequency(monthly(20), "2025-09-15").label).toBe("monthly");
  });
  it("분기별", () => {
    const q = ["2024-03-20", "2024-06-20", "2024-09-19", "2024-12-19", "2025-03-20", "2025-06-18"].map((x) => d(x, 0.5));
    expect(inferFrequency(q, "2025-07-01").label).toBe("quarterly");
  });
  it("불규칙", () => {
    const q = ["2024-01-10", "2024-02-05", "2024-07-20", "2024-08-01", "2025-03-20"].map((x) => d(x, 0.5));
    expect(inferFrequency(q, "2025-07-01").label).toBe("irregular");
  });
  it("기록 없음", () => {
    expect(inferFrequency([], "2025-07-01").label).toBe("none");
  });
});

describe("배당 요약 계산", () => {
  const divs = [...monthly(14, [2024, 9]), d("2025-10-20", 0.5, "special")];
  const s = summarizeDividends(divs, "2025-10-25", 50);
  it("TTM 은 365일 이내 정기 지급만 합산, 특별 분배는 분리", () => {
    const expected = divs.filter((x) => x.kind === "regular" && x.exDate > "2024-10-25" && x.exDate <= "2025-10-25").reduce((a, x) => a + x.amount, 0);
    expect(s.ttmSum).toBeCloseTo(expected);
    expect(s.ttmSpecialSum).toBeCloseTo(0.5);
    expect(s.ttmYield).toBeCloseTo((expected / 50) * 100);
  });
  it("연환산은 주기 판정이 규칙적일 때만, 확정값이 아님", () => {
    expect(s.frequency.perYear).toBe(12);
    expect(s.annualizedLatest).toBeCloseTo((s.latest?.amount ?? 0) * 12);
    const irregular = summarizeDividends([d("2024-01-10", 1), d("2025-03-01", 2)], "2025-04-01", 10);
    expect(irregular.annualizedLatest).toBeNull();
  });
  it("미래 배당락일은 예정으로 분리", () => {
    const s2 = summarizeDividends([...monthly(6, [2025, 5]), d("2025-11-03", 0.4)], "2025-10-25", 50);
    expect(s2.upcoming.map((x) => x.exDate)).toEqual(["2025-11-03"]);
  });
  it("분할 조정 계수", () => {
    expect(splitAdjustFactor("2024-09-01", [{ date: "2024-10-11", numerator: 3, denominator: 1 }])).toBe(3);
    expect(splitAdjustFactor("2024-12-01", [{ date: "2024-10-11", numerator: 3, denominator: 1 }])).toBe(1);
  });
});

describe("총수익률", () => {
  const pts = [
    { date: "2025-01-02", close: 100 },
    { date: "2025-01-03", close: 99 },
    { date: "2025-01-06", close: 99 },
  ];
  it("배당락일 재투자", () => {
    const tr = totalReturnIndex(pts, [{ exDate: "2025-01-03", amount: 1 }]);
    expect(tr[1].value).toBeCloseTo(100);
    expect(normalizedPrice(pts)[2].value).toBeCloseTo(99);
  });
  it("휴장일 배당락은 다음 거래일 반영", () => {
    const tr = totalReturnIndex(pts, [{ exDate: "2025-01-04", amount: 1 }]);
    expect(tr[2].value).toBeCloseTo(100);
  });
  it("기간 통계와 데이터 부족 처리", () => {
    const st = periodStats(pts, [{ exDate: "2025-01-03", amount: 1 }]);
    expect(st?.priceReturn).toBeCloseTo(-1);
    expect(st?.totalReturnCash).toBeCloseTo(0);
    expect(sliceFrom(pts, "2024-12-01")).toBeNull();
    expect(sliceFrom(pts, "2025-01-03")?.[0].date).toBe("2025-01-03");
    // 시작일이 휴장일이면 직전 거래일 종가를 기준점으로 사용
    expect(sliceFrom(pts, "2025-01-04")?.[0].date).toBe("2025-01-03");
  });
});
