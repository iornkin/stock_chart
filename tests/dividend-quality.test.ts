import { describe, expect, it } from "vitest";
import { dividendQuality, paymentVolatility } from "@/lib/dividend-quality";
import type { Dividend } from "@/lib/types";

const d = (exDate: string, amount: number, kind: Dividend["kind"] = "regular"): Dividend => ({
  symbol: "X",
  exDate,
  amount,
  amountRaw: null,
  splitAdjusted: false,
  payDate: null,
  recordDate: null,
  declaredDate: null,
  kind,
  frequencyReported: null,
  sources: ["test"],
});

describe("분배금 지급 변동성", () => {
  it("같은 금액이면 변동 계수 0, '작음'", () => {
    const v = paymentVolatility(["2025-03-01", "2025-06-01", "2025-09-01", "2025-12-01"].map((x) => d(x, 0.5)), "2026-01-01")!;
    expect(v.cvPct).toBe(0);
    expect(v.level).toBe("작음");
    expect(v.decreases).toBe(0);
  });

  it("변동 계수 = 표준편차 ÷ 평균, 감소 횟수", () => {
    // 1, 0.5, 1, 0.5 → 평균 0.75, 표준편차 0.25 → 33.3%
    const v = paymentVolatility([d("2025-01-01", 1), d("2025-02-01", 0.5), d("2025-03-01", 1), d("2025-04-01", 0.5)], "2025-05-01")!;
    expect(v.cvPct).toBeCloseTo(33.333, 2);
    expect(v.level).toBe("큼");
    expect(v.decreases).toBe(2);
  });

  it("특별 분배·자본이득은 빼고, 기록이 4회 미만이면 계산하지 않음", () => {
    const v = paymentVolatility([d("2025-01-01", 1), d("2025-02-01", 1), d("2025-03-01", 1), d("2025-03-15", 9, "special"), d("2025-04-01", 1)], "2025-05-01")!;
    expect(v.n).toBe(4);
    expect(v.cvPct).toBe(0);
    expect(paymentVolatility([d("2025-01-01", 1), d("2025-02-01", 1), d("2025-03-01", 1)], "2025-05-01")).toBeNull();
  });

  it("기준일 이후(발표만 된) 지급과 3년보다 오래된 기록은 쓰지 않음", () => {
    const divs = [d("2020-01-01", 100), ...["2025-01-01", "2025-02-01", "2025-03-01", "2025-04-01"].map((x) => d(x, 1)), d("2025-06-01", 50)];
    expect(paymentVolatility(divs, "2025-05-01")!.cvPct).toBe(0);
  });
});

describe("배당 품질 요약", () => {
  // 2022~2024 분기 지급 → 2024 연간 합계가 2023 대비 증가 (자료 첫해 2022 는 부분 연도로 보고 비교에서 뺌)
  const divs = [
    ...["2022-03-01", "2022-06-01", "2022-09-01", "2022-12-01"].map((x) => d(x, 0.5)),
    ...["2023-03-01", "2023-06-01", "2023-09-01", "2023-12-01"].map((x) => d(x, 0.5)),
    ...["2024-03-01", "2024-06-01", "2024-09-01", "2024-12-01"].map((x) => d(x, 0.6)),
    d("2025-03-01", 0.6),
    d("2024-12-20", 0.3, "capital_gain"),
  ];
  // 2024-03-01 100 → 2025-03-01 90 (가격 −10%), 2025-03-01 배당락 0.6
  const pts = [
    { date: "2024-02-29", close: 100 },
    { date: "2024-03-01", close: 100 },
    { date: "2024-09-03", close: 95 },
    { date: "2025-03-03", close: 90 },
  ];

  it("TTM·연간 변화·가격 수익률과 총수익률을 따로 계산, 구성은 추정하지 않음", () => {
    const q = dividendQuality("X", divs, pts, "2025-03-05", 90);
    expect(q.ttmSum).toBeCloseTo(0.6 * 4, 9);
    expect(q.ttmYield).toBeCloseTo((2.4 / 90) * 100, 9);
    expect(q.annual).toMatchObject({ year: 2024 });
    // 2024 합계에는 제공처가 자본이득으로 표시한 0.3 도 들어감 (연도별 합계 기준과 같음)
    expect(q.annual!.sum).toBeCloseTo(2.7, 9);
    expect(q.annual!.changePct).toBeCloseTo((2.7 / 2 - 1) * 100, 9);
    expect(q.priceReturn1y).toBeCloseTo(-10, 9);
    expect(q.totalReturn1y!).toBeGreaterThan(q.priceReturn1y!);
    expect(q.flaggedTtm).toBe(1);
    expect(q.composition).toBeNull();
  });

  it("가격 기록이 1년을 덮지 않으면 수익률을 비워 둠", () => {
    const q = dividendQuality("X", divs, pts.slice(2), "2025-03-05", 90);
    expect(q.priceReturn1y).toBeNull();
    expect(q.totalReturn1y).toBeNull();
  });
});
