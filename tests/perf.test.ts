/**
 * 성능 회귀 감시 — 측정값(npm run bench)의 수십 배 여유를 둔 상한이라 느린 CI 에서도 흔들리지 않고,
 * 실수로 계산량이 크게 늘어난 경우(예: 이중 반복문)만 잡는다.
 */
import { describe, expect, it } from "vitest";
import { computeLedger } from "@/lib/portfolio/ledger";
import type { Txn } from "@/lib/portfolio/types";
import { mulberry32 } from "@/lib/sim/metrics";
import { paramGrid, type StratBars } from "@/lib/sim/strategy";
import { riskReport } from "@/lib/sim/risk-metrics";
import { INDICATORS, defaultParams } from "@/lib/ta-registry";
import { addDays } from "@/lib/time";

const time = (f: () => unknown) => {
  const t = performance.now();
  f();
  return performance.now() - t;
};
const N = 7500;
const rnd = mulberry32(3);
const dates: string[] = [];
for (let d = "1996-01-02"; dates.length < N; d = addDays(d, 1)) if (![0, 6].includes(new Date(d + "T00:00:00Z").getUTCDay())) dates.push(d);
let p = 50;
const c = dates.map(() => (p *= 1 + (rnd() - 0.49) * 0.03));
const bars: StratBars = { dates, o: c.map((x) => x * 0.999), h: c.map((x) => x * 1.01), l: c.map((x) => x * 0.99), c, v: c.map(() => 1e6), divs: [] };

describe("성능 상한 (회귀 감시)", () => {
  it("거래 10,000건 회계 < 1.5초 (측정 ~17ms)", () => {
    const L: Txn[] = [{ id: "d", type: "deposit", date: "2000-01-03", amount: 1e9, createdAt: 0 }];
    for (let i = 1; i < 10_000; i++) L.push({ id: `t${i}`, type: "buy", date: dates[Math.floor((i / 10_000) * (N - 1))], symbol: ["A", "B", "C"][i % 3], shares: 1, price: 50, createdAt: i });
    expect(time(() => computeLedger(L, { A: 1, B: 1, C: 1 }))).toBeLessThan(1500);
  });
  it("지표 전체 × 일봉 7,500개 < 3초 (측정 ~54ms)", () => {
    expect(time(() => INDICATORS.forEach((d) => d.compute({ h: bars.h, l: bars.l, c: bars.c, v: bars.v }, defaultParams(d))))).toBeLessThan(3000);
  });
  it("전략 격자 30칸 × 30년 < 6초 (측정 ~100ms)", () => {
    const rules = { entry: [{ kind: "ma_cross_up" as const, params: { fast: 50, slow: 200, ema: 0 } }], exit: [{ kind: "ma_cross_down" as const, params: { fast: 50, slow: 200, ema: 0 } }] };
    const ms = time(() => paramGrid(bars, rules, { execution: "next_open", initial: 1e4, commissionPct: 0.1, slippageBps: 5, divTaxPct: 0 }, { key: "fast", label: "", values: [10, 20, 30, 50, 70, 100] }, { key: "slow", label: "", values: [100, 150, 200, 250, 300] }, 5000));
    expect(ms).toBeLessThan(6000);
  });
  it("위험 지표 보고서 30년 < 2초 (측정 ~25ms)", () => {
    expect(time(() => riskReport(dates, c, { rfPct: 2, cagrPct: 5, mddPct: -30, bench: c.map((x) => x * 1.1) }))).toBeLessThan(2000);
  });
});
