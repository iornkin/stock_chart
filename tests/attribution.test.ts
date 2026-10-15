import { describe, expect, it } from "vitest";
import { attributeLedger, attributeSimple, snapshotAt } from "@/lib/portfolio/attribution";
import type { Txn } from "@/lib/portfolio/types";

const D = ["2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"];
const px: Record<string, number[]> = { A: [100, 110, 105, 120, 130], B: [50, 50, 45, 45, 40] };
const closeOf = (s: string, d: string) => {
  const i = D.filter((x) => x <= d).length - 1;
  return i >= 0 && px[s] ? px[s][i] : null;
};
const t = (o: Partial<Txn> & Pick<Txn, "type" | "date">, i: number): Txn => ({ id: `t${i}`, createdAt: i, ...o });
const txns: Txn[] = [
  t({ type: "deposit", date: "2026-01-02", amount: 10_000 }, 1),
  t({ type: "buy", date: "2026-01-02", symbol: "A", shares: 50, price: 100, fee: 1 }, 2),
  t({ type: "buy", date: "2026-01-02", symbol: "B", shares: 40, price: 50 }, 3),
  t({ type: "deposit", date: "2026-01-06", amount: 2_000 }, 4),
  t({ type: "buy", date: "2026-01-06", symbol: "A", shares: 10, price: 104 }, 5),
  t({ type: "dividend", date: "2026-01-07", symbol: "B", amount: 20, tax: 3 }, 6),
  t({ type: "sell", date: "2026-01-08", symbol: "B", shares: 20, price: 41, fee: 1 }, 7),
];

describe("기간 변화 분석", () => {
  it("변화 = 입출금 + 세후 분배금 − 수수료 + 가격 효과 + 매매 시점 효과 (빠진 항목 없음)", () => {
    const a = attributeLedger(txns, D, closeOf, "2026-01-02", "2026-01-08");
    if ("error" in a) throw new Error(a.error);
    expect(Math.abs(a.residual)).toBeLessThan(1e-9);
    expect(a.deposits).toBe(2_000); // 시작일 입금은 시작 상태에 포함
    const A = a.bySymbol.find((x) => x.symbol === "A")!;
    // A: 50주 × (110−100) + 50 × (105−110) + 60 × (120−105) + 60 × (130−120) = 500 − 250 + 900 + 600
    expect(A.priceEffect).toBeCloseTo(1_750, 9);
    // 1/6 매수 104, 그날 종가 105 → +10
    expect(A.tradeEffect).toBeCloseTo(10, 9);
    const B = a.bySymbol.find((x) => x.symbol === "B")!;
    expect(B.dividendsNet).toBe(17);
    // 매도 41, 그날 종가 40 → +20
    expect(B.tradeEffect).toBeCloseTo(20, 9);
    expect(a.fees).toBe(1);
    expect(a.bySymbol[0].symbol).toBe("A"); // 기여 큰 순
  });

  it("입금은 수익이 아님: 입금만 있으면 TWR 0, 가격 효과 0", () => {
    const a = attributeLedger([t({ type: "deposit", date: "2026-01-02", amount: 100 }, 1), t({ type: "deposit", date: "2026-01-06", amount: 50 }, 2)], D, closeOf, "2026-01-02", "2026-01-08");
    if ("error" in a) throw new Error(a.error);
    expect(a.change).toBe(50);
    expect(a.priceEffect).toBe(0);
    expect(a.twrPct).toBeCloseTo(0, 12);
  });

  it("간편 입력은 지금 수량으로 가정", () => {
    const a = attributeSimple([{ id: "h", symbol: "A", shares: 10, avgCost: 90 }], 100, D, closeOf, () => 1.5, "2026-01-05", "2026-01-08");
    if ("error" in a) throw new Error(a.error);
    expect(a.assumedConstant).toBe(true);
    expect(a.priceEffect).toBeCloseTo(10 * (130 - 110), 9);
    expect(a.dividendsNet).toBeCloseTo(15, 9);
  });

  it("타임머신: 그날까지의 거래와 그날 종가로 보유 상태 재구성", () => {
    const s = snapshotAt(txns, "2026-01-05", closeOf);
    expect(s.positions.find((x) => x.symbol === "A")?.shares).toBe(50);
    expect(s.cash).toBeCloseTo(10_000 - 5_001 - 2_000, 9);
    expect(s.marketValue).toBeCloseTo(50 * 110 + 40 * 50, 9);
    expect(s.netContributions).toBe(10_000);
    const later = snapshotAt(txns, "2026-01-08", closeOf);
    expect(later.positions.find((x) => x.symbol === "B")?.shares).toBe(20);
    expect(later.dividendsNet).toBe(17);
  });
});
