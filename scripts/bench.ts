/**
 * 계산 성능 측정 (합성 데이터, 외부 호출 없음) — npm run bench
 * 큰 거래 내역·긴 백테스트·지표 전체·전략 격자·몬테카를로·위험 지표가 각각 얼마나 걸리는지 잰다.
 * 결과는 이 컴퓨터 기준이며, 브라우저(특히 휴대폰)에서는 더 느릴 수 있다.
 */
import { computeLedger } from "@/lib/portfolio/ledger";
import type { Txn } from "@/lib/portfolio/types";
import { runBacktest } from "@/lib/sim/backtest";
import { mulberry32 } from "@/lib/sim/metrics";
import { runMonteCarlo, monthlyHistory } from "@/lib/sim/future";
import { riskReport } from "@/lib/sim/risk-metrics";
import { paramGrid, runStrategy, walkForward, type StratBars } from "@/lib/sim/strategy";
import type { PriceSeries } from "@/lib/sim/series";
import { INDICATORS, defaultParams } from "@/lib/ta-registry";
import { addDays } from "@/lib/time";

function days(start: string, n: number): string[] {
  const out: string[] = [];
  let d = start;
  while (out.length < n) {
    const wd = new Date(d + "T00:00:00Z").getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d);
    d = addDays(d, 1);
  }
  return out;
}
function series(symbol: string, n: number, seed: number): PriceSeries {
  const rnd = mulberry32(seed);
  const dates = days("1996-01-02", n);
  let p = 50;
  const close = dates.map(() => (p *= 1 + (rnd() - 0.49) * 0.03));
  const divs = dates.filter((_, i) => i % 63 === 30).map((ex) => ({ ex, pay: null, amount: 0.3, kind: "regular" }));
  return { symbol, kind: "etf", dates, close, divs, source: "bench", fetchedAt: 0 };
}
function bench(name: string, f: () => unknown, reps = 3) {
  f();
  const ts: number[] = [];
  for (let i = 0; i < reps; i++) {
    const t = performance.now();
    f();
    ts.push(performance.now() - t);
  }
  ts.sort((a, b) => a - b);
  console.log(`${name.padEnd(52)} 중앙값 ${ts[Math.floor(ts.length / 2)].toFixed(1).padStart(8)} ms  (최소 ${ts[0].toFixed(1)})`);
}

const N = 7500; // 약 30년 거래일
const S = Object.fromEntries(["A", "B", "C", "D"].map((s, i) => [s, series(s, N, i + 1)]));
const rnd = mulberry32(9);
const ledger: Txn[] = [{ id: "d0", type: "deposit", date: "2000-01-03", amount: 1e9, createdAt: 0 }];
for (let i = 1; i < 10_000; i++) ledger.push({ id: `t${i}`, type: rnd() < 0.7 ? "buy" : "dividend", date: S.A.dates[Math.floor((i / 10_000) * (N - 1))], symbol: ["A", "B", "C", "D"][i % 4], shares: 1 + Math.floor(rnd() * 10), price: 50 + rnd() * 50, amount: 5, tax: 0.75, createdAt: i });
const prices = { A: 100, B: 100, C: 100, D: 100 };
const bars: StratBars = { dates: S.A.dates, o: S.A.close.map((c) => c * 0.999), h: S.A.close.map((c) => c * 1.01), l: S.A.close.map((c) => c * 0.99), c: S.A.close, v: S.A.close.map(() => 1e6), divs: S.A.divs.map((d) => ({ ex: d.ex, amount: d.amount })) };
const rules = { entry: [{ kind: "ma_cross_up" as const, params: { fast: 50, slow: 200, ema: 0 } }], exit: [{ kind: "ma_cross_down" as const, params: { fast: 50, slow: 200, ema: 0 } }] };
const cfg = { execution: "next_open" as const, initial: 10_000, commissionPct: 0.1, slippageBps: 5, divTaxPct: 15 };

console.log(`합성 데이터: 일봉 ${N}개(약 30년) × 4종목, 거래 내역 ${ledger.length.toLocaleString()}건\n`);
bench("내 자산 회계 (거래 10,000건)", () => computeLedger(ledger, prices));
bench("포트폴리오 백테스트 (4종목·30년·월 납입·월 리밸런싱)", () =>
  runBacktest({ holdings: ["A", "B", "C", "D"].map((s) => ({ symbol: s, weight: 25 })), start: S.A.dates[0], end: S.A.dates[N - 1], initial: 10_000, monthly: 500, timing: "month_start", reinvest: true, rebalance: "monthly", costPct: 0.1, taxPct: 15, riskFreePct: 2 }, S),
);
bench(`기술적 지표 ${INDICATORS.length}종 전체 (일봉 ${N}개)`, () => {
  const b = { h: bars.h, l: bars.l, c: bars.c, v: bars.v };
  for (const d of INDICATORS) d.compute(b, defaultParams(d));
});
bench("지표 전략 1회 (MA 50/200, 30년)", () => runStrategy(bars, rules, cfg));
const ax = { key: "fast", label: "fast", values: [10, 20, 30, 50, 70, 100] };
const ay = { key: "slow", label: "slow", values: [100, 150, 200, 250, 300] };
bench("파라미터 격자 30칸 (학습·평가)", () => paramGrid(bars, rules, cfg, ax, ay, Math.floor(N * 0.7)), 2);
bench("워크포워드 (30칸 × 학습 3년·평가 1년)", () => walkForward(bars, rules, cfg, ax, ay, 3, 1), 2);
const idx = S.A.close.map((c, i) => c * (1 + i * 1e-5));
bench("위험 지표 보고서 (30년 일간, 벤치마크 포함)", () => riskReport(S.A.dates, idx, { rfPct: 2, cagrPct: 8, mddPct: -30, bench: S.B.close }));
const h = monthlyHistory([S.A, S.B], null);
if (!("error" in h))
  bench("몬테카를로 2,000경로 × 20년", () =>
    runMonteCarlo({ holdings: [{ symbol: "A", weight: 50 }, { symbol: "B", weight: 50 }], months: 240, startYm: "2026-11", initial: 10_000, monthly: 500, timing: "start", reinvest: true, rebalance: "annual", costPct: 0.1, taxPct: 15, feePct: 0, paths: 2000, blockMonths: 6, seed: 42 }, h),
  2);
