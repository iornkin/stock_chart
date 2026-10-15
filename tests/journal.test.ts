import { describe, expect, it } from "vitest";
import { journalOutcome } from "@/lib/journal/outcome";
import type { JournalEntry } from "@/lib/journal/types";
import type { PriceSeries } from "@/lib/sim/series";

const s: PriceSeries = {
  symbol: "SCHD",
  kind: "etf",
  dates: ["2026-01-02", "2026-02-02", "2026-03-02", "2026-04-01", "2026-05-01"],
  close: [100, 90, 80, 95, 110],
  divs: [{ ex: "2026-03-02", pay: null, amount: 2, kind: "regular" }, { ex: "2025-12-01", pay: null, amount: 9, kind: "regular" }],
  source: "t",
  fetchedAt: 0,
};
const e = (o: Partial<JournalEntry> = {}): JournalEntry => ({ id: "j", symbol: "SCHD", action: "buy", date: "2026-01-02", price: null, priceSource: "close", reason: "r", horizon: "1년", expectation: "", maxLossPct: 15, invalidation: "", reviewDate: "2026-04-01", refs: "", memo: "", createdAt: 0, reviews: [], ...o });

describe("투자 판단 사후 결과", () => {
  it("가격·분배금 포함 수익률, 최대 하락과 감수 손실 비교, 재검토일", () => {
    const o = journalOutcome(e(), s, "2026-05-02");
    expect(o.basePrice).toBe(100);
    expect(o.priceReturnPct).toBeCloseTo(10, 9);
    expect(o.dividendsPerShare).toBe(2); // 기록일 이전 분배금은 제외
    expect(o.totalReturnPct).toBeCloseTo(12, 9);
    expect(o.maxDrawdownPct).toBeCloseTo(-20, 9);
    expect(o.breachedMaxLoss).toBe(true);
    expect(o.reviewDue).toBe(true);
  });
  it("직접 넣은 가격을 우선, 감수 손실을 안 넣으면 비교하지 않음", () => {
    const o = journalOutcome(e({ price: 88, maxLossPct: null, reviewDate: "2027-01-01" }), s, "2026-05-02");
    expect(o.basePrice).toBe(88);
    expect(o.breachedMaxLoss).toBeNull();
    expect(o.reviewDue).toBe(false);
  });
  it("가격 기록이 없거나 상장 전이면 계산하지 않음", () => {
    expect(journalOutcome(e(), undefined, "2026-05-02").error).toBeTruthy();
    expect(journalOutcome(e({ date: "2020-01-01" }), s, "2026-05-02").error).toBeTruthy();
  });
});
