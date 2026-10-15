import { beforeAll, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { baselineRecord, compareCompositions, isMaterialChange, shouldRecord, type CompositionData, type CompositionRecord } from "@/lib/etf-history";

beforeAll(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usi-etfh-"));
  process.env.DATABASE_PATH = path.join(dir, "t.db");
});

const comp = (over: Partial<CompositionData> = {}): CompositionData => ({
  holdings: [
    { symbol: "NVDA", name: "NVIDIA", weight: 9 },
    { symbol: "MSFT", name: "Microsoft", weight: 8 },
    { symbol: null, name: "Cash", weight: 1 },
  ],
  sectors: [
    { sector: "기술", weight: 50 },
    { sector: "커뮤니케이션", weight: 15 },
  ],
  expenseRatio: 0.2,
  category: "Large Growth",
  ...over,
});
const rec = (date: string, over: Partial<CompositionData> = {}): CompositionRecord => ({ ...comp(over), date, checkedAt: 0, source: "test" });

describe("구성 기록 규칙", () => {
  it("작은 비중 흔들림은 의미 있는 변화가 아님, 편입·편출·총보수·분류·섹터 1%p 는 변화", () => {
    expect(isMaterialChange(comp(), comp({ holdings: [{ symbol: "NVDA", name: "NVIDIA", weight: 9.3 }, { symbol: "MSFT", name: "Microsoft", weight: 8 }, { symbol: null, name: "cash", weight: 1 }] }))).toBe(false);
    expect(isMaterialChange(comp(), comp({ holdings: [{ symbol: "NVDA", name: "NVIDIA", weight: 9.6 }, { symbol: "MSFT", name: "Microsoft", weight: 8 }, { symbol: null, name: "Cash", weight: 1 }] }))).toBe(true);
    expect(isMaterialChange(comp(), comp({ holdings: [{ symbol: "NVDA", name: "NVIDIA", weight: 9 }, { symbol: "AAPL", name: "Apple", weight: 8 }, { symbol: null, name: "Cash", weight: 1 }] }))).toBe(true);
    expect(isMaterialChange(comp(), comp({ expenseRatio: 0.18 }))).toBe(true);
    expect(isMaterialChange(comp(), comp({ category: "Technology" }))).toBe(true);
    expect(isMaterialChange(comp(), comp({ sectors: [{ sector: "기술", weight: 51.2 }, { sector: "커뮤니케이션", weight: 15 }] }))).toBe(true);
  });
  it("처음 / 변화 / 28일 경과 때만 새 기록, 자료가 비면 기록하지 않음", () => {
    expect(shouldRecord(null, comp(), "2026-10-15")).toBe(true);
    expect(shouldRecord(rec("2026-10-01"), comp(), "2026-10-15")).toBe(false);
    expect(shouldRecord(rec("2026-09-10"), comp(), "2026-10-15")).toBe(true);
    expect(shouldRecord(rec("2026-10-14"), comp({ expenseRatio: 0.15 }), "2026-10-15")).toBe(true);
    expect(shouldRecord(null, { holdings: [], sectors: [], expenseRatio: null, category: null }, "2026-10-15")).toBe(false);
  });
});

describe("구성 비교", () => {
  it("새로 편입·빠짐·비중 변화·섹터·총보수", () => {
    const a = rec("2026-07-01");
    const b = rec("2026-10-01", {
      holdings: [
        { symbol: "NVDA", name: "NVIDIA", weight: 10.5 },
        { symbol: "AAPL", name: "Apple", weight: 7 },
        { symbol: null, name: "CASH", weight: 1 },
      ],
      sectors: [{ sector: "기술", weight: 53 }, { sector: "커뮤니케이션", weight: 14 }],
      expenseRatio: 0.15,
    });
    const d = compareCompositions(a, b);
    expect(d.holdings[0]).toMatchObject({ symbol: "AAPL", status: "new", after: 7 });
    expect(d.holdings[1]).toMatchObject({ symbol: "MSFT", status: "gone", before: 8 });
    expect(d.holdings.find((h) => h.symbol === "NVDA")).toMatchObject({ status: "changed", diff: 1.5 });
    // 심볼 없는 편입은 이름(대소문자 무시)으로 맞춤
    expect(d.holdings.find((h) => h.symbol === null)?.status).toBe("same");
    expect(d.sectors[0]).toMatchObject({ sector: "기술", diff: 3 });
    expect(d.expense).toEqual({ before: 0.2, after: 0.15 });
    expect(d.category).toBeNull();
    expect(d.topSumBefore).toBe(18);
    expect(d.topSumAfter).toBe(18.5);
  });
  it("비교 기준: 기준일 이전 마지막 기록, 없으면 가장 오래된 기록, 1건뿐이면 없음", () => {
    const rs = [rec("2026-01-05"), rec("2026-06-01"), rec("2026-09-20"), rec("2026-10-10")];
    expect(baselineRecord(rs, "2026-07-15")?.date).toBe("2026-06-01");
    expect(baselineRecord(rs, "2025-01-01")?.date).toBe("2026-01-05");
    expect(baselineRecord(rs, "2026-12-31")?.date).toBe("2026-09-20");
    expect(baselineRecord([rec("2026-10-10")], "2026-01-01")).toBeNull();
  });
});

describe("구성 기록 저장 (DB)", () => {
  it("제공처 자료가 없으면 기록하지 않고, 있으면 기록 → 같은 날 다시 확인하면 새 기록 없이 확인 시각만", async () => {
    const { writeSnapshot } = await import("@/lib/data/profile");
    const { recordEtfComposition, readEtfHistory, buildEtfHistoryMap } = await import("@/lib/data/etf-history");
    expect(recordEtfComposition("QQQ")).toBe(false);
    writeSnapshot(
      "yahoo_summary",
      "QQQ",
      {
        topHoldings: { holdings: [{ symbol: "NVDA", holdingName: "NVIDIA Corp", holdingPercent: { raw: 0.09 } }, { symbol: "MSFT", holdingName: "Microsoft Corp", holdingPercent: { raw: 0.08 } }], sectorWeightings: [{ technology: { raw: 0.6 } }] },
        fundProfile: { categoryName: "Large Growth", feesExpensesInvestment: { annualReportExpenseRatio: { raw: 0.002 } } },
      },
      "Yahoo Finance",
    );
    const t0 = Date.parse("2026-10-14T15:00:00Z");
    expect(recordEtfComposition("QQQ", t0)).toBe(true);
    expect(recordEtfComposition("QQQ", t0 + 3600_000)).toBe(false);
    const h = readEtfHistory("QQQ", 100_000);
    expect(h).toHaveLength(1);
    expect(h[0].holdings.map((x) => x.symbol)).toEqual(["NVDA", "MSFT"]);
    expect(h[0].holdings[0].weight).toBeCloseTo(9);
    expect(h[0].sectors[0]).toMatchObject({ sector: "기술", weight: 60 });
    expect(h[0].expenseRatio).toBeCloseTo(0.2);
    expect(h[0].category).toBe("Large Growth");
    expect(h[0].checkedAt).toBe(t0 + 3600_000);
    expect(buildEtfHistoryMap().QQQ.records).toHaveLength(1);
  });
});
