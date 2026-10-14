import { describe, expect, it } from "vitest";
import { portfolioExposure } from "@/lib/portfolio/exposure";
import type { ExposureInfo } from "@/lib/exposure-types";

const NOW = Date.UTC(2026, 9, 14);
const etf = (symbol: string, holdings: [string | null, number, boolean?][], extra: Partial<ExposureInfo> = {}): ExposureInfo => ({
  symbol,
  kind: "etf",
  category: "index",
  leverage: null,
  strategy: "index",
  holdings: holdings.map(([s, w, fund]) => ({ symbol: s, name: s ?? "기타", weight: w, fund: !!fund })),
  holdingsSource: "test",
  sectors: [
    { sector: "기술", weight: 60 },
    { sector: "헬스케어", weight: 30 },
  ],
  sectorsSource: "test",
  stockSector: null,
  expenseRatio: 0.2,
  fetchedAt: NOW - 86400_000,
  ...extra,
});
const stock = (symbol: string, sector: string | null): ExposureInfo => ({
  symbol,
  kind: "stock",
  category: "m7",
  leverage: null,
  strategy: null,
  holdings: [],
  holdingsSource: null,
  sectors: [],
  sectorsSource: null,
  stockSector: sector,
  expenseRatio: null,
  fetchedAt: NOW,
});

const info: Record<string, ExposureInfo> = {
  QQQ: etf("QQQ", [
    ["NVDA", 9],
    ["AAPL", 8],
    ["MSFT", 7],
  ]),
  SPY: etf("SPY", [
    ["NVDA", 7],
    ["AAPL", 6],
    ["JPM", 2],
  ]),
  NVDA: stock("NVDA", "기술"),
  TQQQ: etf("TQQQ", [["NVDA", 3]], { leverage: 3, category: "leveraged", strategy: "leveraged" }),
  RYLD: etf("RYLD", [["RSSL", 100, true]], { category: "income" }),
  GLD: etf("GLD", [], { category: "gold", sectors: [] }),
};

describe("내 자산 노출 분석", () => {
  it("직접 보유 + ETF 상위 편입 종목으로 같은 종목의 간접 노출을 합산", () => {
    const r = portfolioExposure({
      positions: [
        { symbol: "QQQ", value: 10_000 },
        { symbol: "SPY", value: 10_000 },
        { symbol: "NVDA", value: 5_000 },
      ],
      cash: 1_000,
      info,
      now: NOW,
      m7Symbols: ["NVDA", "AAPL", "MSFT"],
    });
    const nvda = r.lookthrough.find((x) => x.symbol === "NVDA")!;
    expect(nvda.direct).toBe(5_000);
    expect(nvda.total).toBeCloseTo(5_000 + 900 + 700, 9);
    expect(nvda.pct).toBeCloseTo((6_600 / 25_000) * 100, 9);
    expect(r.lookthrough[0].symbol).toBe("NVDA");
    // 확인한 비율: 직접 5,000 + QQQ 24% + SPY 15% = 8,900 / 25,000
    expect(r.knownPct).toBeCloseTo((8_900 / 25_000) * 100, 9);
    // M7: NVDA 6,600 + AAPL 1,400 + MSFT 700
    expect(r.m7.value).toBeCloseTo(8_700, 9);
    expect(r.m7.direct).toBe(5_000);
    expect(r.cash).toBe(1_000);
  });

  it("두 ETF 의 중복도 = 같은 종목 비중 중 작은 쪽의 합", () => {
    const r = portfolioExposure({ positions: [{ symbol: "QQQ", value: 1 }, { symbol: "SPY", value: 1 }], cash: 0, info, now: NOW, m7Symbols: [] });
    expect(r.overlaps).toHaveLength(1);
    expect(r.overlaps[0].overlapPct).toBeCloseTo(7 + 6, 9);
    expect(r.overlaps[0].common.sort()).toEqual(["AAPL", "NVDA"]);
  });

  it("레버리지·펀드 편입·금은 편입 종목으로 펼치지 않고 이유를 남김, 레버리지 실질 노출은 배수만큼", () => {
    const r = portfolioExposure({
      positions: [
        { symbol: "TQQQ", value: 1_000 },
        { symbol: "RYLD", value: 1_000 },
        { symbol: "GLD", value: 1_000 },
      ],
      cash: 0,
      info,
      now: NOW,
      m7Symbols: ["NVDA"],
    });
    expect(r.lookthrough).toHaveLength(0);
    expect(r.etfs.every((e) => !e.used && e.reason)).toBe(true);
    expect(r.knownPct).toBe(0);
    expect(r.leveraged.pct).toBeCloseTo(100 / 3, 9);
    expect(r.leveraged.effective).toBe(3_000);
    expect(r.styles.map((s) => s.key).sort()).toEqual(["gold", "income", "leveraged"]);
  });

  it("섹터: ETF 섹터 비중 + 주식 섹터, 모르는 부분은 미분류로 남김", () => {
    const r = portfolioExposure({ positions: [{ symbol: "QQQ", value: 1_000 }, { symbol: "NVDA", value: 1_000 }, { symbol: "GLD", value: 1_000 }], cash: 0, info, now: NOW, m7Symbols: [] });
    const tech = r.sectors.find((s) => s.sector === "기술")!;
    expect(tech.value).toBeCloseTo(1_600, 9);
    // QQQ 섹터 90% 확인 + NVDA 100% → 1,900 / 3,000 확인
    expect(r.sectorUnknownPct).toBeCloseTo(100 - (1_900 / 3_000) * 100, 9);
  });

  it("정보가 없거나 오래된 종목을 따로 알림 (최신 자료처럼 쓰지 않음)", () => {
    const old = { ...info, SPY: { ...info.SPY, fetchedAt: NOW - 30 * 86400_000 } };
    const r = portfolioExposure({ positions: [{ symbol: "SPY", value: 1 }, { symbol: "ZZZ", value: 1 }], cash: 0, info: old, now: NOW, m7Symbols: [] });
    expect(r.staleInfo).toEqual(["SPY"]);
    expect(r.missingInfo).toEqual(["ZZZ"]);
    expect(r.etfs[0].stale).toBe(true);
  });
});
