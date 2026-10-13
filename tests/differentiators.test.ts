import { describe, expect, it } from "vitest";
import { priceSignalChanges, signalStateAt, compareRows } from "@/lib/briefing/signals";
import { buildJudgment } from "@/lib/briefing/judgment";
import { analyzeAligned, leverageGroups } from "@/lib/leverage";
import { annualTotals, changeTrend, incomeGrowthSeries, paymentStatus, yieldDecomposition } from "@/lib/dividend-analytics";
import type { Bar, Dividend } from "@/lib/types";

/** 날짜와 종가 배열로 일봉 시계열 만들기 */
function series(closes: number[], vols?: number[]) {
  const start = Date.UTC(2024, 0, 2);
  return closes.map((c, i) => {
    const d = new Date(start + i * 86400000).toISOString().slice(0, 10);
    const bar: Bar = { t: (start + i * 86400000) / 1000, o: c, h: c * 1.01, l: c * 0.99, c, v: vols?.[i] ?? 1_000_000 };
    return { date: d, bar };
  });
}

const div = (exDate: string, amount: number, payDate: string | null = null): Dividend => ({
  symbol: "T",
  exDate,
  amount,
  amountRaw: null,
  splitAdjusted: false,
  payDate,
  recordDate: null,
  declaredDate: null,
  kind: "regular",
  frequencyReported: null,
  sources: ["test"],
});

describe("일일 변화 분석 (전일 대비 새 변화만)", () => {
  it("50일선을 아래에서 위로 넘은 날에만 '회복'으로 잡는다", () => {
    const closes = [...Array(60).fill(100), ...Array(10).fill(95), 101];
    const d = series(closes);
    const cur = signalStateAt(d, d.length - 1)!;
    const prev = signalStateAt(d, d.length - 2)!;
    const changes = priceSignalChanges(prev, cur, { price: ["P1"], volume: [], tech: ["T1"] });
    expect(changes.some((c) => c.short === "50일선 회복")).toBe(true);
    // 다음 날도 위에 머물면 같은 변화를 다시 내지 않는다
    const d2 = series([...closes, 101.5]);
    const again = priceSignalChanges(signalStateAt(d2, d2.length - 2), signalStateAt(d2, d2.length - 1)!, { price: [], volume: [], tech: [] });
    expect(again.some((c) => c.short === "50일선 회복")).toBe(false);
  });

  it("평소 변동폭보다 큰 움직임과 거래량 급증을 찾는다", () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + (i % 2 ? 0.3 : -0.3));
    closes.push(closes[closes.length - 1] * 0.95);
    const vols = closes.map((_, i) => (i === closes.length - 1 ? 3_500_000 : 1_000_000));
    const d = series(closes, vols);
    const changes = priceSignalChanges(signalStateAt(d, d.length - 2), signalStateAt(d, d.length - 1)!, { price: ["P1"], volume: ["V1"], tech: [] });
    const big = changes.find((c) => c.tag === "price" && c.direction === "down");
    expect(big?.importance).toBe(3);
    expect(changes.some((c) => c.tag === "volume" && c.short.startsWith("거래량 3.5배"))).toBe(true);
  });

  it("비교표는 전일과 오늘 값을 함께 준다", () => {
    const d = series(Array.from({ length: 80 }, (_, i) => 100 + i * 0.1));
    const rows = compareRows(signalStateAt(d, d.length - 2)!, signalStateAt(d, d.length - 1)!);
    expect(rows[0]).toMatchObject({ label: "종가", direction: "up" });
  });
});

describe("종합 판단 (규칙 기반)", () => {
  it("꾸준한 상승 추세는 상승 우위, 데이터가 부족하면 판단 보류", () => {
    const d = series(Array.from({ length: 260 }, (_, i) => 100 * Math.pow(1.002, i) * (1 + (i % 3 === 0 ? 0.004 : -0.001))));
    const j = buildJudgment({
      symbol: "T",
      cur: signalStateAt(d, d.length - 1),
      bench20: { symbol: "B", ret: 0.5 },
      coveredCall: false,
      levels: [],
      nextEarnings: null,
      nextExDate: null,
      income: null,
      evidence: { price: [], tech: [], bench: [], volume: [] },
    });
    expect(j.score).toBeGreaterThanOrEqual(2);
    expect(j.label).toBe("상승 우위");
    const short = series(Array(20).fill(100));
    expect(buildJudgment({ symbol: "T", cur: signalStateAt(short, 19), bench20: null, coveredCall: false, levels: [], nextEarnings: null, nextExDate: null, income: null, evidence: { price: [], tech: [], bench: [], volume: [] } }).stance).toBe("unavailable");
  });

  it("레버리지 ETF 는 상대강도를 점수에 넣지 않고 주의 사항을 붙인다", () => {
    const d = series(Array.from({ length: 260 }, (_, i) => 100 + i * 0.2));
    const j = buildJudgment({ symbol: "L", cur: signalStateAt(d, d.length - 1), bench20: { symbol: "B", ret: 1 }, leverage: 3, coveredCall: false, levels: [], nextEarnings: null, nextExDate: null, income: null, evidence: { price: [], tech: [], bench: [], volume: [] } });
    expect(j.factors.find((f) => f.key === "relative")?.score).toBeNull();
    expect(j.cautions.some((c) => c.includes("3배 레버리지"))).toBe(true);
  });
});

describe("레버리지 ETF 분석", () => {
  it("설정 파일에서 같은 기초지수 묶음을 만든다", () => {
    const g = leverageGroups();
    const ndx = g.find((x) => x.members.some((m) => m.symbol === "TQQQ"))!;
    expect(ndx.members.map((m) => m.symbol)).toEqual(expect.arrayContaining(["QQQ", "QLD", "TQQQ"]));
    const semi = g.find((x) => x.members.some((m) => m.symbol === "SOXL"))!;
    expect(semi.members.map((m) => m.symbol)).toContain("SOXX");
  });

  it("오르내림 반복 구간에서는 3배 ETF 가 단순 3배보다 낮고, 급락·회복 구간을 찾는다", () => {
    const days = 400;
    const base = [100];
    for (let i = 1; i < days; i++) base.push(base[i - 1] * (i % 2 ? 1.03 : 1 / 1.03) * (i > 100 && i < 140 ? 0.99 : 1) * (i >= 140 && i < 200 ? 1.008 : 1));
    const lev = [100];
    for (let i = 1; i < days; i++) lev.push(lev[i - 1] * (1 + 3 * (base[i] / base[i - 1] - 1)));
    const dates = series(base).map((x) => x.date);
    const group = { key: "t", title: "테스트", underlying: "Test", members: [{ symbol: "B", leverage: 1 }, { symbol: "L3", leverage: 3 }] };
    const a = analyzeAligned(group, "B", dates, [{ symbol: "B", leverage: 1, tr: base }, { symbol: "L3", leverage: 3, tr: lev }], { B: dates[0], L3: dates[0] });
    const all = a.periods.find((p) => p.key === "all")!;
    expect(all.vsMultiple.L3).not.toBeNull();
    expect(a.episodes.length).toBeGreaterThan(0);
    expect(a.episodes[0].members.L3.loss).toBeLessThan(a.episodes[0].members.B.loss);
    expect(a.rolling.find((r) => r.symbol === "L3")?.windows).toBeGreaterThan(100);
  });
});

describe("배당·분배금 분석", () => {
  it("지급 완료·지급 예정·발표됨을 구분한다", () => {
    expect(paymentStatus(div("2026-09-01", 1, "2026-09-05"), "2026-10-01")).toBe("paid");
    expect(paymentStatus(div("2026-09-28", 1, "2026-10-05"), "2026-10-01")).toBe("scheduled");
    expect(paymentStatus(div("2026-10-20", 1, "2026-10-25"), "2026-10-01")).toBe("announced");
    expect(paymentStatus(div("2026-09-01", 1, null), "2026-10-01")).toBe("ex_passed");
  });

  it("연도별 합계의 전년 대비는 완전한 연도끼리만 계산하고, 증감 횟수를 센다", () => {
    const divs = [2023, 2024, 2025].flatMap((y, k) => [3, 6, 9, 12].map((m) => div(`${y}-${String(m).padStart(2, "0")}-10`, 1 + k * 0.1)));
    const t = annualTotals(divs, "2026-02-01");
    expect(t.find((x) => x.year === 2023)?.yoy).toBeNull();
    expect(t.find((x) => x.year === 2025)?.yoy).toBeCloseTo(((4 * 1.2) / (4 * 1.1) - 1) * 100, 5);
    const tr = changeTrend(divs, "2026-02-01", 12);
    expect(tr.up).toBe(2);
    expect(tr.same).toBe(9);
  });

  it("수익률 변화를 가격 효과와 분배금 효과로 나눈다 (분배금이 같고 가격이 내려간 경우)", () => {
    const pts = Array.from({ length: 800 }, (_, i) => ({ date: new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(0, 10), close: i < 600 ? 50 : 40 }));
    const divs = Array.from({ length: 27 }, (_, i) => div(new Date(Date.UTC(2024, 0, 15) + i * 30 * 86400000).toISOString().slice(0, 10), 0.5));
    const d = yieldDecomposition(divs, pts, pts[pts.length - 1].date)!;
    expect(d.yieldNow).toBeGreaterThan(d.yieldThen);
    expect(Math.abs(d.distributionEffect)).toBeLessThan(Math.abs(d.priceEffect));
  });

  it("재투자 지수는 현금 수령 지수와 가격 지수 이상으로 쌓인다 (가격 불변 시)", () => {
    const pts = Array.from({ length: 30 }, (_, i) => ({ date: new Date(Date.UTC(2025, 0, 6) + i * 86400000).toISOString().slice(0, 10), close: 10 }));
    const g = incomeGrowthSeries(pts, [div(pts[10].date, 0.5), div(pts[20].date, 0.5)]);
    expect(g.price[g.price.length - 1]).toBe(100);
    expect(g.cash[g.cash.length - 1]).toBeCloseTo(110, 5);
    expect(g.reinvest[g.reinvest.length - 1]).toBeGreaterThan(110);
  });
});
