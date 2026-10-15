/** 성과·위험 지표 기준값 (손계산) + 경계값 */
import { describe, expect, it } from "vitest";
import { cagrPct, drawdown, periodReturns, sharpe, xirrPct } from "@/lib/sim/metrics";
import { calendarReturns, calmar, cvar, downsideDev, drawdownStats, historicalVaR, relativeMetrics, returnsOf, riskReport, rolling, sortino } from "@/lib/sim/risk-metrics";
import { trIndex } from "@/lib/sim/series";
import { addDays } from "@/lib/time";

const days = (start: string, n: number) => Array.from({ length: n }, (_, i) => addDays(start, i));

describe("기존 지표 기준값", () => {
  it("CAGR: 2년에 2배 → 41.42%, 1년 미만·0 이하는 계산 안 함", () => {
    expect(cagrPct(2, 2) as number).toBeCloseTo((Math.SQRT2 - 1) * 100, 10);
    expect(cagrPct(1.5, 0.9)).toBeNull();
    expect(cagrPct(0, 3)).toBeNull();
  });
  it("XIRR: 365일 뒤 1,000 → 1,100 = 10%, 부호가 한쪽뿐이면 null", () => {
    expect(xirrPct([{ date: "2023-01-01", amount: -1000 }, { date: "2024-01-01", amount: 1100 }]) as number).toBeCloseTo(10, 6);
    expect(xirrPct([{ date: "2023-01-01", amount: 1000 }, { date: "2024-01-01", amount: 1100 }])).toBeNull();
  });
  it("최대 낙폭: 고점 120 → 저점 90 = −25%, 130 에서 회복", () => {
    const d = drawdown([100, 120, 90, 130]);
    expect(d.mddPct).toBeCloseTo(-25, 10);
    expect([d.peakIndex, d.troughIndex, d.recoveryIndex]).toEqual([1, 2, 3]);
    expect(drawdown([100, 100, 100]).mddPct).toBe(0);
  });
  it("샤프: 변동이 없으면 계산 안 함(0 이 아니라 null)", () => {
    expect(sharpe(new Array(100).fill(0.001), 0)).toBeNull();
  });
  it("기간 수익률: 각 기간 = 끝 ÷ 직전 기간 끝", () => {
    const r = periodReturns(["2024-01-30", "2024-01-31", "2024-02-01", "2024-02-29"], [100, 110, 99, 121], (d) => d.slice(0, 7));
    expect(r.map((x) => Math.round(x.retPct * 100) / 100)).toEqual([10, 10]);
  });
  it("총수익 지수: 배당락일에 가격이 없어도(휴장·누락) 다음 거래일에 반영", () => {
    const tri = trIndex({ dates: ["2024-01-05", "2024-01-08", "2024-01-09"], close: [100, 99, 101], divs: [{ ex: "2024-01-06", amount: 1 }] });
    expect(tri[1]).toBeCloseTo(1, 12);
    expect(tri[2]).toBeCloseTo(101 / 99, 12);
    // 시작일 이전 배당락은 넣지 않음, 같은 날 두 번 지급은 합산
    expect(trIndex({ dates: ["2024-01-05", "2024-01-08"], close: [100, 100], divs: [{ ex: "2024-01-05", amount: 5 }, { ex: "2024-01-08", amount: 1 }, { ex: "2024-01-08", amount: 1 }] })[1]).toBeCloseTo(1.02, 12);
    // 가격 0·NaN 은 수익률을 만들지 않음
    expect(trIndex({ dates: ["a", "b", "c"], close: [100, NaN, 110], divs: [] })).toEqual([1, 1, 1]);
  });
});

describe("위험 지표 기준값", () => {
  const pat = [0.01, -0.02, 0.03, -0.01];
  it("하방 변동성: √((0.0004 + 0.0001) / 4) × √252 × 100", () => {
    const r = Array.from({ length: 20 }, (_, i) => pat[i % 4]);
    expect(downsideDev(r).value as number).toBeCloseTo(Math.sqrt(0.000125) * Math.sqrt(252) * 100, 10);
    expect(downsideDev([0.01]).value).toBeNull();
  });
  it("소르티노: 연 평균 0.63 ÷ 하방 변동성", () => {
    const r = Array.from({ length: 60 }, (_, i) => pat[i % 4]);
    expect(sortino(r, 0).value as number).toBeCloseTo(0.0025 * 252 / (Math.sqrt(0.000125) * Math.sqrt(252)), 10);
    const up = sortino(new Array(80).fill(0.001), 0);
    expect(up.value).toBeNull();
    expect(up.note).toContain("분모가 0");
  });
  it("칼마: CAGR ÷ |MDD|", () => {
    expect(calmar(20, -10).value).toBe(2);
    expect(calmar(20, 0).value).toBeNull();
    expect(calmar(null, -10).value).toBeNull();
  });
  it("VaR·CVaR(95%): 100개 중 5번째로 나쁜 날 1%, 하위 5개 평균 3%", () => {
    const r = [-0.05, -0.04, -0.03, -0.02, -0.01, ...new Array(95).fill(0.01)];
    expect(historicalVaR(r).value as number).toBeCloseTo(1, 10);
    expect(cvar(r).value as number).toBeCloseTo(3, 10);
    expect(historicalVaR(r.slice(0, 10)).value).toBeNull();
  });
  it("베타·알파·추적 오차·정보 비율·상관: 포트폴리오 = 벤치마크 × 2", () => {
    const b = Array.from({ length: 120 }, (_, i) => Math.sin(i) * 0.01 + 0.0005);
    const r = b.map((x) => 2 * x);
    const m = relativeMetrics(r, b, 0);
    expect(m.beta.value as number).toBeCloseTo(2, 10);
    expect(m.correlation.value as number).toBeCloseTo(1, 10);
    expect(m.alpha.value as number).toBeCloseTo(0, 8);
    const sd = Math.sqrt(b.reduce((a, x) => a + (x - b.reduce((p, q) => p + q, 0) / b.length) ** 2, 0) / (b.length - 1));
    expect(m.trackingError.value as number).toBeCloseTo(sd * Math.sqrt(252) * 100, 8);
    expect(relativeMetrics(b, b, 0).trackingError.value).toBeNull();
    expect(relativeMetrics(r.slice(0, 10), b.slice(0, 10), 0).beta.value).toBeNull();
  });
  it("낙폭 기간: 가장 긴 수면 아래 3일(회복), 최대 낙폭 회복 2일, 지금 −9.9%", () => {
    const d = drawdownStats(days("2024-01-01", 7), [100, 110, 90, 95, 111, 105, 100]) as NonNullable<ReturnType<typeof drawdownStats>>;
    expect(d.longestDays).toBe(3);
    expect(d.longestRecovered).toBe(true);
    expect(d.longestFrom).toBe("2024-01-02");
    expect(d.recoveryDays).toBe(2);
    expect(d.currentDrawdownPct).toBeCloseTo((100 / 111 - 1) * 100, 10);
    const never = drawdownStats(days("2024-01-01", 4), [100, 90, 80, 85]) as NonNullable<ReturnType<typeof drawdownStats>>;
    expect(never.longestRecovered).toBe(false);
    expect(never.recoveryDays).toBeNull();
  });
  it("달력 수익률: 처음·끝 부분 기간 표시", () => {
    const r = calendarReturns(["2024-01-15", "2024-01-31", "2024-02-01", "2024-02-29", "2024-03-01", "2024-03-12"], [100, 110, 100, 121, 120, 132], "month");
    expect(r.map((x) => [x.key, Math.round(x.retPct * 100) / 100, x.partial])).toEqual([
      ["2024-01", 10, true],
      ["2024-02", 10, false],
      ["2024-03", 9.09, true],
    ]);
  });
  it("이동 창 지표: 꾸준히 오르면 낙폭 0, 수익률 = 창 수익률", () => {
    const n = 300;
    const idx = Array.from({ length: n }, (_, i) => 100 * 1.001 ** i);
    const r = rolling(days("2023-01-01", n), idx, 0, 252, 10);
    expect(r[0].mddPct).toBe(0);
    expect(r[0].retPct).toBeCloseTo((1.001 ** 252 - 1) * 100, 8);
    expect(r[0].sharpe).toBeNull(); // 변동 0
  });
  it("보고서 한 번에: 지수 배율과 무관, 같은 입력 같은 결과", () => {
    const n = 600;
    const d = days("2022-01-01", n);
    const idx = Array.from({ length: n }, (_, i) => 100 * (1 + 0.0004 * i + 0.03 * Math.sin(i / 9)));
    const bench = Array.from({ length: n }, (_, i) => 100 * (1 + 0.0003 * i + 0.02 * Math.sin(i / 9)));
    const a = riskReport(d, idx, { rfPct: 2, cagrPct: 10, mddPct: -12, bench });
    const b = riskReport(d, idx.map((x) => x * 37), { rfPct: 2, cagrPct: 10, mddPct: -12, bench: bench.map((x) => x * 3) });
    expect(b.sortino.value as number).toBeCloseTo(a.sortino.value as number, 9);
    expect(b.var95.value as number).toBeCloseTo(a.var95.value as number, 9);
    expect(b.relative?.beta.value as number).toBeCloseTo(a.relative?.beta.value as number, 9);
    expect(riskReport(d, idx, { rfPct: 2, cagrPct: 10, mddPct: -12, bench })).toEqual(a);
    expect(returnsOf([100, 0, 50]).every(Number.isFinite)).toBe(true);
  });
});
