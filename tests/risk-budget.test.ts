import { describe, expect, it } from "vitest";
import { compareToLimit, dividendAndPrice, holdingSectors, leveragedCrash, limitUsd, marketShock, rateSensitivity, rateShock, riskContributions, sectorShock, type SectorInfo } from "@/lib/sim/risk-budget";
import type { PriceSeries } from "@/lib/sim/series";
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
const mk = (symbol: string, dates: string[], close: number[]): PriceSeries => ({ symbol, kind: "etf", dates, close, divs: [], source: "test", fetchedAt: 0 });

const info: Record<string, SectorInfo> = {
  QQQ: { kind: "etf", category: "index", leverage: null, sectors: [{ sector: "기술", weight: 50 }, { sector: "커뮤니케이션", weight: 15 }, { sector: "경기소비재", weight: 15 }], stockSector: null },
  TQQQ: { kind: "etf", category: "leveraged", leverage: 3, sectors: [], stockSector: null },
  NVDA: { kind: "stock", category: "m7", leverage: null, sectors: [], stockSector: "기술" },
  GLD: { kind: "etf", category: "gold", leverage: null, sectors: [], stockSector: null },
  JEPI: { kind: "etf", category: "income", leverage: null, sectors: [], stockSector: null },
};

describe("섹터 노출", () => {
  it("ETF 는 제공처 비중, 주식은 100%, 금은 섹터 없음, 레버리지는 기초 ETF × 배수", () => {
    expect(holdingSectors("QQQ", info).knownPct).toBe(80);
    expect(holdingSectors("NVDA", info).weights).toEqual({ 기술: 100 });
    expect(holdingSectors("GLD", info)).toMatchObject({ knownPct: 100, weights: {} });
    expect(holdingSectors("JEPI", info)).toMatchObject({ knownPct: 0, note: "제공처 섹터 비중 미제공" });
    const t = holdingSectors("TQQQ", info, ["^NDX", "QQQ"]);
    expect(t).toMatchObject({ via: "QQQ", leverage: 3, knownPct: 80 });
    expect(holdingSectors("TQQQ", info, []).knownPct).toBe(0);
    expect(holdingSectors("XYZ", info).note).toBe("섹터 정보 없음");
  });

  it("섹터 충격: 모르는 부분은 0 ~ 전부로 범위, 레버리지는 배수, 손실은 평가금액을 넘지 않음", () => {
    const rows = [
      { symbol: "QQQ", value: 10_000, sectors: holdingSectors("QQQ", info) },
      { symbol: "TQQQ", value: 1_000, sectors: holdingSectors("TQQQ", info, ["QQQ"]) },
      { symbol: "GLD", value: 5_000, sectors: holdingSectors("GLD", info) },
      { symbol: "JEPI", value: 4_000, sectors: holdingSectors("JEPI", info) },
    ];
    const r = sectorShock(rows, ["기술"], 30);
    const q = r.perHolding.find((p) => p.symbol === "QQQ")!;
    expect(q.low).toBeCloseTo(10_000 * 0.5 * 0.3); // 1500
    expect(q.high).toBeCloseTo(10_000 * 0.7 * 0.3); // + 모르는 20%
    expect(r.perHolding.find((p) => p.symbol === "TQQQ")!.low).toBeCloseTo(1_000 * 0.5 * 0.3 * 3);
    expect(r.perHolding.find((p) => p.symbol === "GLD")).toMatchObject({ low: 0, high: 0 });
    expect(r.perHolding.find((p) => p.symbol === "JEPI")).toMatchObject({ low: 0, high: 4_000 * 0.3 });
    expect(r.low).toBeCloseTo(1500 + 450);
    const big = sectorShock([{ symbol: "TQQQ", value: 1_000, sectors: { weights: { 기술: 100 }, knownPct: 100, via: "X", leverage: 3, note: null } }], ["기술"], 50);
    expect(big.high).toBe(1_000);
  });
});

describe("시장·레버리지·분배금 시나리오", () => {
  it("베타 단순 적용, 베타 없는 종목은 제외로 표시", () => {
    const r = marketShock([{ symbol: "A", value: 1000, beta: 1.2 }, { symbol: "B", value: 1000, beta: null }, { symbol: "C", value: 1000, beta: 3 }], 40);
    expect(r.perHolding.find((p) => p.symbol === "A")!.low).toBeCloseTo(480);
    expect(r.perHolding.find((p) => p.symbol === "C")!.low).toBe(1000);
    expect(r.excluded).toEqual(["B"]);
  });
  it("레버리지 급락은 레버리지 종목만", () => {
    const r = leveragedCrash([{ symbol: "TQQQ", value: 2000, leverage: 3 }, { symbol: "QQQ", value: 8000, leverage: null }], 15);
    expect(r.perHolding).toHaveLength(1);
    expect(r.low).toBeCloseTo(900);
  });
  it("분배금 감소 + 가격 하락", () => {
    const r = dividendAndPrice([{ symbol: "A", value: 10_000, beta: 0.8, annualIncome: 400 }], 30, 20, 15);
    expect(r.price.low).toBeCloseTo(1600);
    expect(r.incomeDrop).toBeCloseTo(120);
    expect(r.incomeDropNet).toBeCloseTo(102);
    expect(r.incomeAfter).toBeCloseTo(280);
  });
  it("기준 비교", () => {
    expect(limitUsd({ kind: "pct", value: 20 }, 50_000)).toBe(10_000);
    expect(limitUsd({ kind: "usd", value: 7_000 }, 50_000)).toBe(7_000);
    expect(compareToLimit(100, 200, 300)).toBe("within");
    expect(compareToLimit(100, 400, 300)).toBe("partly");
    expect(compareToLimit(350, 400, 300)).toBe("over");
  });
});

describe("위험 기여도", () => {
  it("같은 움직임이면 비중대로, 변동 없는 현금성 종목은 0", () => {
    const dates = tradingDays("2023-01-02", 300);
    let a = 100;
    const ca = dates.map((_, i) => (a *= 1 + (i % 2 ? 0.01 : -0.009)));
    const flat = dates.map(() => 50);
    const r = riskContributions([{ symbol: "A", value: 6000 }, { symbol: "B", value: 4000 }, { symbol: "C", value: 5000 }], { A: mk("A", dates, ca), B: mk("B", dates, ca.map((x) => x * 2)), C: mk("C", dates, flat) });
    if ("error" in r) throw new Error(r.error);
    expect(r.share.A).toBeCloseTo(60, 5);
    expect(r.share.B).toBeCloseTo(40, 5);
    expect(r.share.C).toBeCloseTo(0, 5);
    expect(r.portfolioVolPct).toBeGreaterThan(0);
  });
  it("겹치는 날이 부족하면 계산하지 않음", () => {
    const d1 = tradingDays("2023-01-02", 100);
    const r = riskContributions([{ symbol: "A", value: 1 }], { A: mk("A", d1, d1.map((_, i) => 100 + i)) });
    expect("error" in r).toBe(true);
    expect("error" in riskContributions([{ symbol: "Z", value: 1 }], {})).toBe(true);
  });
});

describe("금리 민감도", () => {
  // 매달 말 금리 변화 Δ 에 대해 그달 수익률 = 1% − 5 × Δ (%) 인 가상 자산
  const months = 60;
  const dates: string[] = [];
  const rate: number[] = [];
  const px: number[] = [];
  let r = 4;
  let p = 100;
  for (let m = 0; m < months; m++) {
    const y = 2020 + Math.floor(m / 12);
    const mm = String((m % 12) + 1).padStart(2, "0");
    const dr = ((m * 7) % 5) / 10 - 0.2; // −0.2 ~ +0.2 %p
    if (m > 0) {
      r += dr;
      p *= 1 + (1 - 5 * dr) / 100;
    }
    dates.push(`${y}-${mm}-28`);
    rate.push(r);
    px.push(p);
  }
  it("기울기·상관 복원, 마지막 달 제외", () => {
    const s = rateSensitivity(mk("A", dates, px), mk("^TNX", dates, rate), 10);
    if ("error" in s) throw new Error(s.error);
    expect(s.pctPerPoint).toBeCloseTo(-5, 6);
    expect(s.corr).toBeCloseTo(-1, 6);
    expect(s.months).toBe(months - 2);
    const shock = rateShock([{ symbol: "A", value: 10_000, sens: s }, { symbol: "B", value: 5_000, sens: null }], 1);
    expect(shock.low).toBeCloseTo(500, 3);
    expect(shock.excluded).toEqual(["B"]);
  });
  it("36개월 미만이면 계산하지 않음", () => {
    const s = rateSensitivity(mk("A", dates.slice(0, 20), px.slice(0, 20)), mk("^TNX", dates, rate));
    expect("error" in s).toBe(true);
  });
});
