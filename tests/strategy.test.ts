/** 지표 전략 백테스트: 체결 시점·비용·분배금·손절·통계·미래 정보 차단·워크포워드·국면 */
import { describe, expect, it } from "vitest";
import { evalCondition, neighborhood, paramGrid, regimes, runStrategy, walkForward, type ExecConfig, type StratBars, type StrategyResult, type StrategyRules } from "@/lib/sim/strategy";
import * as ta from "@/lib/ta";
import { mulberry32 } from "@/lib/sim/metrics";
import { addDays } from "@/lib/time";

function tradingDays(start: string, n: number): string[] {
  const out: string[] = [];
  let d = start;
  while (out.length < n) {
    const wd = new Date(d + "T00:00:00Z").getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d);
    d = addDays(d, 1);
  }
  return out;
}
const mk = (closes: number[], opens?: number[], start = "2020-01-02", divs: { ex: string; amount: number }[] = []): StratBars => {
  const dates = tradingDays(start, closes.length);
  const o = opens ?? closes;
  return { dates, o, h: closes.map((c, i) => Math.max(c, o[i]) * 1.001), l: closes.map((c, i) => Math.min(c, o[i]) * 0.999), c: closes, v: closes.map(() => 1000), divs };
};
const cfg = (over: Partial<ExecConfig> = {}): ExecConfig => ({ execution: "next_open", initial: 10_000, commissionPct: 0, slippageBps: 0, divTaxPct: 0, ...over });
const ok = (r: StrategyResult | { error: string }): StrategyResult => {
  if ("error" in r) throw new Error(r.error);
  return r;
};
// 가격이 떨어졌다가 오르는 V자 → 골든크로스 한 번
const V = [...Array.from({ length: 40 }, (_, i) => 100 - i), ...Array.from({ length: 60 }, (_, i) => 61 + i * 1.5)];
const maRules: StrategyRules = { entry: [{ kind: "ma_cross_up", params: { fast: 5, slow: 20, ema: 0 } }], exit: [{ kind: "ma_cross_down", params: { fast: 5, slow: 20, ema: 0 } }] };

describe("체결 시점 (미래 정보 없음)", () => {
  it("신호는 종가 확정 후 → 다음 날 시가에 체결 (같은 종가에 미리 사지 않음)", () => {
    const opens = V.map((c, i) => (i === 0 ? c : V[i - 1] + 0.3));
    const d = mk(V, opens);
    const r = ok(runStrategy(d, maRules, cfg()));
    const cross = evalCondition(maRules.entry[0], { h: d.h, l: d.l, c: d.c, v: d.v });
    const k = cross.indexOf(true);
    expect(k).toBeGreaterThan(20);
    expect(r.trades[0].signalDate).toBe(d.dates[k]);
    expect(r.trades[0].entryDate).toBe(d.dates[k + 1]);
    expect(r.trades[0].entryPrice).toBeCloseTo(opens[k + 1], 12);
    // 다음 날 종가 체결 방식
    const r2 = ok(runStrategy(d, maRules, cfg({ execution: "next_close" })));
    expect(r2.trades[0].entryPrice).toBeCloseTo(V[k + 1], 12);
  });
  it("뒤쪽 가격을 바꿔도 그 전의 거래·평가금액은 그대로 (20개 무작위 시계열)", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rnd = mulberry32(seed);
      let p = 100;
      const c = Array.from({ length: 400 }, () => (p *= 1 + (rnd() - 0.5) * 0.04));
      const d = mk(c);
      const cut = 200 + seed * 5;
      const c2 = c.map((x, i) => (i > cut ? x * (1 + Math.sin(i) * 0.3) : x));
      const d2 = { ...mk(c2), dates: d.dates };
      const rules: StrategyRules = { entry: [{ kind: "rsi_cross_up", params: { n: 14, level: 40 } }, { kind: "price_above_ma", params: { n: 50 } }], exit: [{ kind: "rsi_above", params: { n: 14, level: 65 } }], stopLossPct: 8 };
      const a = ok(runStrategy(d, rules, cfg({ commissionPct: 0.1, slippageBps: 5 })));
      const b = ok(runStrategy(d2, rules, cfg({ commissionPct: 0.1, slippageBps: 5 })));
      expect(b.equity.slice(0, cut + 1)).toEqual(a.equity.slice(0, cut + 1));
      const done = (r: StrategyResult) => r.trades.filter((t) => t.exitDate !== null && t.exitDate <= d.dates[cut]).map((t) => [t.entryDate, t.entryPrice, t.exitDate, t.exitPrice]);
      expect(done(b)).toEqual(done(a));
    }
  });
  it("마지막 봉의 신호는 체결되지 않음, 가격 없는 봉은 다음 봉으로 미룸", () => {
    const c = [...Array.from({ length: 30 }, () => 100), 101];
    const r = ok(runStrategy(mk(c), { entry: [{ kind: "price_above_ma", params: { n: 20 } }], exit: [] }, cfg()));
    expect(r.trades).toHaveLength(0);
    expect(r.signals.lastBarUnfilled).toBe(true);
    // 30번째 종가 101 에서 신호 → 31번째 시가가 없어(누락) 32번째 시가 103 에 체결
    const opens = [...Array.from({ length: 30 }, () => 100), 100, NaN, 103];
    const c2 = [...Array.from({ length: 30 }, () => 100), 101, 102, 103];
    const r2 = ok(runStrategy(mk(c2, opens), { entry: [{ kind: "price_above_ma", params: { n: 20 } }], exit: [] }, cfg()));
    expect(r2.signals.delayed).toBe(1);
    expect(r2.trades[0].entryPrice).toBe(103);
  });
});

describe("비용·분배금·손절", () => {
  it("수수료 1%·슬리피지 10bp 왕복: 가격이 그대로면 그만큼만 줄어든다", () => {
    // 21번째 봉 종가가 SMA20 위 → 다음 날 시가 100 에 매수, 청산 조건(종가 < SMA20)
    const c = [...Array.from({ length: 31 }, () => 100), 101, 100, 100, 99, 99, 99];
    const o = c.map(() => 100);
    const r = ok(runStrategy(mk(c, o), { entry: [{ kind: "price_above_ma", params: { n: 20 } }], exit: [{ kind: "price_below_ma", params: { n: 20 } }] }, cfg({ commissionPct: 1, slippageBps: 10 })));
    const t = r.trades[0];
    expect(t.entryPrice).toBeCloseTo(100.1, 12);
    const shares = 10_000 / 1.01 / 100.1;
    const net = shares * 99.9 * 0.99;
    expect(t.exitPrice).toBeCloseTo(99.9, 12);
    expect(t.pnl).toBeCloseTo(net - 10_000, 8);
    expect(r.equity[r.equity.length - 1]).toBeCloseTo(net, 8);
    expect(r.costs).toBeCloseTo(10_000 - net, 8);
  });
  it("배당락일: 전날 종가 기준 보유분만 받고, 보유 중이면 그날 종가로 재투자 (세금 15%)", () => {
    const c = Array.from({ length: 40 }, (_, i) => 100 + i * 0.5);
    const d = mk(c);
    d.divs = [{ ex: d.dates[30], amount: 2 }];
    const r = ok(runStrategy(d, { entry: [{ kind: "price_above_ma", params: { n: 20 } }], exit: [] }, cfg({ divTaxPct: 15 })));
    const t = r.trades[0];
    const before = 10_000 / t.entryPrice;
    expect(t.shares).toBeCloseTo(before + (before * 2 * 0.85) / c[30], 10);
    expect(r.dividends).toBeCloseTo(before * 2 * 0.85, 10);
    // 배당락일 시가에 산 경우는 받지 않음
    const d2 = mk(c);
    const k = 19; // SMA20 첫 값이 나오는 19번째 종가에서 첫 신호 → 20번째 시가 체결
    d2.divs = [{ ex: d2.dates[k + 1], amount: 2 }];
    const r2 = ok(runStrategy(d2, { entry: [{ kind: "price_above_ma", params: { n: 20 } }], exit: [] }, cfg()));
    expect(r2.trades[0].entryDate).toBe(d2.dates[k + 1]);
    expect(r2.dividends).toBe(0);
  });
  it("손절: 종가가 진입가 −5% 이하 → 다음 날 시가에 청산", () => {
    const c = [...Array.from({ length: 31 }, () => 100), 101, 100, 94, 93, 92];
    const r = ok(runStrategy(mk(c, c.map((x) => x)), { entry: [{ kind: "price_above_ma", params: { n: 20 } }], exit: [], stopLossPct: 5 }, cfg()));
    const t = r.trades[0];
    const k = c.indexOf(94);
    expect(t.exitReason).toContain("손절");
    expect(t.exitDate).toBe(mk(c).dates[k + 1]);
    expect(t.exitPrice).toBe(93);
  });
});

describe("거래 통계", () => {
  it("승률·손익비·기대값·노출, 손실이 없으면 손익비는 계산하지 않음", () => {
    const d = mk(V);
    const r = ok(runStrategy(d, maRules, cfg()));
    expect(r.stats.trades).toBe(r.trades.length);
    expect(r.stats.exposurePct).toBeGreaterThan(0);
    expect(r.stats.exposurePct).toBeLessThanOrEqual(100);
    if (r.stats.closed && r.trades.filter((t) => !t.open).every((t) => t.pnl > 0)) expect(r.stats.profitFactor).toBeNull();
    // 거래가 없으면 0 이 아니라 null + 이유
    const flat = ok(runStrategy(mk(Array.from({ length: 50 }, () => 100)), { entry: [{ kind: "rsi_below", params: { n: 14, level: 30 } }], exit: [] }, cfg()));
    expect(flat.stats.winRatePct).toBeNull();
    expect(flat.stats.notes[0]).toContain("청산된 거래가 없어");
    expect(flat.totalReturnPct).toBe(0);
  });
  it("신호 수와 실제 거래 수를 구분 (보유 중 신호는 무시로 집계)", () => {
    const rnd = mulberry32(5);
    let p = 100;
    const c = Array.from({ length: 300 }, () => (p *= 1 + (rnd() - 0.5) * 0.05));
    const r = ok(runStrategy(mk(c), { entry: [{ kind: "rsi_cross_up", params: { n: 14, level: 45 } }], exit: [], maxHoldBars: 30 }, cfg()));
    expect(r.signals.entry).toBeGreaterThanOrEqual(r.trades.length);
    expect(r.signals.ignoredEntry).toBeGreaterThan(0);
  });
  it("차트와 같은 지표 값 사용 (조건 계산 = ta.ts)", () => {
    const d = mk(V);
    const s5 = ta.sma(d.c, 5);
    const s20 = ta.sma(d.c, 20);
    const cross = evalCondition(maRules.entry[0], { h: d.h, l: d.l, c: d.c, v: d.v });
    const i = cross.indexOf(true);
    expect((s5[i - 1] as number) <= (s20[i - 1] as number) && (s5[i] as number) > (s20[i] as number)).toBe(true);
  });
});

describe("과최적화 점검", () => {
  const rnd = mulberry32(11);
  let p = 100;
  const c = Array.from({ length: 1600 }, (_, i) => (p *= 1 + (rnd() - 0.48) * 0.03 + Math.sin(i / 60) * 0.004));
  const d = mk(c, undefined, "2015-01-02");
  const ax = { key: "fast", label: "단기", values: [5, 10, 20] };
  const ay = { key: "slow", label: "장기", values: [30, 60, 100] };
  it("격자: 학습 구간·평가 구간 성과, 최고 칸 주변 비교", () => {
    const cells = paramGrid(d, maRules, cfg(), ax, ay, 1000);
    expect(cells).toHaveLength(9);
    const nb = neighborhood(cells, ax, ay, (x) => x.isSharpe);
    expect(nb?.neighbors).toBeGreaterThan(0);
  });
  it("워크포워드: 학습 3년 → 평가 1년씩, 평가 구간만 이어 붙임", () => {
    const wf = walkForward(d, maRules, cfg(), ax, ay, 3, 1);
    expect(wf).not.toBeNull();
    const w = wf!;
    expect(w.windows.length).toBeGreaterThanOrEqual(2);
    for (const x of w.windows) expect(x.testFrom >= x.trainTo).toBe(true);
    expect(w.curve[0]).toBe(1);
  });
  it("시장 국면: 1년 전체가 있는 연도만 상승·횡보·하락으로", () => {
    const r = ok(runStrategy(d, maRules, cfg()));
    const g = regimes(r.dates, r.equity, r.buyHold);
    expect(g.rows.every((x) => ["상승", "횡보", "하락"].includes(x.regime))).toBe(true);
    expect(g.rows.length).toBeGreaterThanOrEqual(4);
    expect(g.groups.reduce((a, x) => a + x.years, 0)).toBe(g.rows.length);
  });
});
