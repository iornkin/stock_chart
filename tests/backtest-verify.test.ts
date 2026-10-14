import { describe, expect, it } from "vitest";
import { runBacktest, type BacktestConfig } from "@/lib/sim/backtest";
import { configFingerprint, dataFingerprint } from "@/lib/sim/repro";
import { parseSettings, SETTINGS_FORMAT } from "@/lib/sim/backtest-settings";
import type { PriceSeries, SeriesDiv } from "@/lib/sim/series";
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
const mk = (symbol: string, dates: string[], f: (i: number) => number, divs: SeriesDiv[] = []): PriceSeries => ({ symbol, kind: "etf", dates, close: dates.map((_, i) => f(i)), divs, source: "test", fetchedAt: 0 });
const cfg = (over: Partial<BacktestConfig> = {}): BacktestConfig => ({
  holdings: [{ symbol: "A", weight: 100 }],
  start: "2020-01-01",
  end: "2030-01-01",
  initial: 10_000,
  monthly: 0,
  timing: "month_start",
  reinvest: true,
  rebalance: "none",
  costPct: 0,
  taxPct: 0,
  riskFreePct: 0,
  ...over,
});
const ok = (r: ReturnType<typeof runBacktest>) => {
  if (!r.ok) throw new Error(r.problems.join(" / "));
  return r;
};

const D = tradingDays("2020-01-01", 400);
const divs: SeriesDiv[] = [50, 150, 250, 350].map((i) => ({ ex: D[i], pay: null, amount: 0.5, kind: "regular" }));
const A = mk("A", D, (i) => 100 * 1.0004 ** i, divs);
const B = mk("B", D, (i) => 50 + Math.sin(i / 10) * 3);

describe("백테스트 재현성", () => {
  it("같은 설정·같은 데이터면 결과와 재현 코드가 항상 같다", () => {
    const c = cfg({ holdings: [{ symbol: "A", weight: 60 }, { symbol: "B", weight: 40 }], monthly: 300, rebalance: "quarterly", costPct: 0.1, taxPct: 15 });
    const r1 = ok(runBacktest(c, { A, B }));
    const r2 = ok(runBacktest(structuredClone(c), { A: structuredClone(A), B: structuredClone(B) }));
    expect(r2).toEqual(r1);
    expect(configFingerprint(c)).toBe(configFingerprint(structuredClone(c)));
    expect(dataFingerprint(["A", "B"], { A, B }, r1.start, r1.end)).toBe(dataFingerprint(["B", "A"], { A: structuredClone(A), B }, r1.start, r1.end));
  });

  it("설정이나 기간 안의 가격이 하나라도 바뀌면 코드가 달라진다", () => {
    const c = cfg();
    expect(configFingerprint({ ...c, costPct: 0.2 })).not.toBe(configFingerprint(c));
    const A2 = { ...A, close: A.close.map((v, i) => (i === 100 ? v + 0.01 : v)) };
    expect(dataFingerprint(["A"], { A: A2 }, D[0], D[399])).not.toBe(dataFingerprint(["A"], { A }, D[0], D[399]));
    // 기간 밖의 변화는 영향 없음
    expect(dataFingerprint(["A"], { A: A2 }, D[200], D[399])).toBe(dataFingerprint(["A"], { A }, D[200], D[399]));
  });
});

describe("백테스트 검증 기록", () => {
  it("요청 기간과 실제 계산 기간을 따로 기록 (주말 시작일 → 다음 거래일)", () => {
    const r = ok(runBacktest(cfg({ start: "2020-02-01", end: "2020-06-30" }), { A }));
    expect(r.verification.requested).toEqual({ start: "2020-02-01", end: "2020-06-30" });
    expect(r.verification.used.start).toBe("2020-02-03");
    expect(r.verification.used.end).toBe("2020-06-30");
    expect(r.verification.coverage[0]).toMatchObject({ symbol: "A", first: D[0], last: D[399], source: "test" });
  });

  it("한 종목 가격이 빠진 날은 채우지 않고 빼며, 그날과 개수를 기록", () => {
    const missing = [D[30], D[31], D[77]];
    const Bgap = { ...B, dates: B.dates.filter((d) => !missing.includes(d)), close: B.close.filter((_, i) => !missing.includes(D[i])) };
    const r = ok(runBacktest(cfg({ holdings: [{ symbol: "A", weight: 50 }, { symbol: "B", weight: 50 }] }), { A, B: Bgap }));
    expect(r.verification.skippedDays).toBe(3);
    expect(r.verification.skippedSample).toEqual(missing);
    for (const d of missing) expect(r.dates).not.toContain(d);
  });

  it("빠진 날에 배당락이 있어도 다음 계산일에 한 번만 반영 (누락·이중 계산 없음)", () => {
    const Agap = { ...A, dates: A.dates.filter((d) => d !== D[50]), close: A.close.filter((_, i) => i !== 50) };
    const r = ok(runBacktest(cfg({ end: D[399] }), { A: Agap }));
    expect(r.verification.divEvents).toBe(4);
    expect(r.verification.coverage[0].divEvents).toBe(4);
  });

  it("상장 시점이 다른 종목: 공통 시작일 이전 기간은 계산하지 않음", () => {
    const late = mk("L", D.slice(200), (i) => 20 + i * 0.01);
    const r = runBacktest(cfg({ holdings: [{ symbol: "A", weight: 50 }, { symbol: "L", weight: 50 }], start: D[10] }), { A, L: late });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.coverage?.commonStart).toBe(D[200]);
    const r2 = ok(runBacktest(cfg({ holdings: [{ symbol: "A", weight: 50 }, { symbol: "L", weight: 50 }], start: D[200] }), { A, L: late }));
    expect(r2.verification.used.start).toBe(D[200]);
  });

  it("추가 납입은 수익률(TWR)에 들어가지 않는다: 납입 여부와 관계없이 TWR 동일", () => {
    const g = mk("G", D, (i) => 100 * 1.001 ** i);
    const noFlow = ok(runBacktest(cfg({ holdings: [{ symbol: "G", weight: 100 }] }), { G: g }));
    const withFlow = ok(runBacktest(cfg({ holdings: [{ symbol: "G", weight: 100 }], monthly: 5_000 }), { G: g }));
    expect(withFlow.twrReturnPct).toBeCloseTo(noFlow.twrReturnPct, 9);
    expect(withFlow.totalContributed).toBe(10_000 + 5_000 * withFlow.contributions);
    // 손익 = 평가금액 − 납입 원금 (납입금 자체는 손익이 아님)
    expect(withFlow.profit).toBeCloseTo(withFlow.finalValue - withFlow.totalContributed, 9);
  });

  it("리밸런싱 횟수 기록", () => {
    const r = ok(runBacktest(cfg({ holdings: [{ symbol: "A", weight: 50 }, { symbol: "B", weight: 50 }], start: "2020-01-02", end: "2020-12-31", rebalance: "quarterly" }), { A, B }));
    expect(r.verification.rebalances).toBe(3);
  });
});

describe("백테스트 설정 파일", () => {
  const good = {
    format: SETTINGS_FORMAT,
    version: 1,
    portfolios: [{ name: "QQQ 100", items: [{ symbol: "qqq", weight: 100 }] }],
    start: "2020-01-02",
    end: "2024-12-31",
    initial: 10000,
    monthly: 500,
    timing: "month_start",
    reinvest: true,
    rebalance: "annual",
    costPct: 0.1,
    taxPct: 15,
    rfMode: "auto",
    riskFreePct: 0,
    benchmark: "spy",
    normalize: false,
    capitalGains: null,
  };
  it("올바른 파일은 그대로 복원 (티커 대문자 정리)", () => {
    const r = parseSettings(JSON.parse(JSON.stringify(good)));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.settings.portfolios[0].items[0].symbol).toBe("QQQ");
      expect(r.settings.benchmark).toBe("SPY");
      expect(r.settings.rebalance).toBe("annual");
    }
  });
  it("다른 형식·잘못된 값은 적용하지 않음", () => {
    expect(parseSettings({ ...good, format: "x" }).ok).toBe(false);
    expect(parseSettings({ ...good, start: "2020/01/02" }).ok).toBe(false);
    expect(parseSettings({ ...good, rebalance: "weekly" }).ok).toBe(false);
    expect(parseSettings({ ...good, portfolios: [] }).ok).toBe(false);
    expect(parseSettings({ ...good, initial: "1000" }).ok).toBe(false);
  });
});
