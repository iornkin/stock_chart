import { describe, expect, it } from "vitest";
import { driftAlerts, fullRebalance, newMoneyRebalance, type RebalPosition } from "@/lib/portfolio/rebalance";

// A 6,000 (60%) · B 3,000 (30%) · 현금 1,000 (10%) = 10,000
const pos: RebalPosition[] = [
  { symbol: "A", shares: 60, price: 100 },
  { symbol: "B", shares: 60, price: 50 },
];
const targets = [
  { symbol: "A", weight: 50 },
  { symbol: "B", weight: 40 },
];

describe("목표 비중 리밸런싱", () => {
  it("전체 리밸런싱(매도 포함): 거래 뒤 정확히 목표 비중, 현금은 남는 비중", () => {
    const r = fullRebalance(pos, 1_000, targets);
    if (!r.ok) throw new Error(r.error);
    const { plan } = r;
    expect(plan.total).toBe(10_000);
    const a = plan.rows.find((x) => x.symbol === "A")!;
    const b = plan.rows.find((x) => x.symbol === "B")!;
    expect(a.currentPct).toBeCloseTo(60, 9);
    expect(a.diffPct).toBeCloseTo(10, 9);
    expect(a.trade).toBeCloseTo(-1_000, 9);
    expect(b.trade).toBeCloseTo(1_000, 9);
    expect(b.shares).toBeCloseTo(20, 9);
    expect(plan.cashAfter).toBeCloseTo(1_000, 9);
    expect(plan.cashTargetPct).toBeCloseTo(10, 9);
    expect(plan.maxDriftAfter).toBeLessThan(1e-9);
  });

  it("목표에 없는 보유 종목은 전부 매도, 보유하지 않은 목표 종목은 새로 매수", () => {
    const r = fullRebalance([...pos, { symbol: "C", shares: 0, price: 20 }], 1_000, [{ symbol: "A", weight: 50 }, { symbol: "C", weight: 50 }]);
    if (!r.ok) throw new Error(r.error);
    expect(r.plan.rows.find((x) => x.symbol === "B")!.trade).toBeCloseTo(-3_000, 9);
    expect(r.plan.rows.find((x) => x.symbol === "C")!.trade).toBeCloseTo(5_000, 9);
    expect(r.plan.cashAfter).toBeCloseTo(0, 9);
  });

  it("수수료를 현금에서 떼고도 현금이 음수가 되지 않음", () => {
    const r = fullRebalance(pos, 1_000, [{ symbol: "A", weight: 50 }, { symbol: "B", weight: 50 }], 0.25);
    if (!r.ok) throw new Error(r.error);
    expect(r.plan.fee).toBeCloseTo(((r.plan.buy + r.plan.sell) * 0.25) / 100, 9);
    expect(r.plan.cashAfter).toBeGreaterThan(-1e-6);
    expect(r.plan.cashAfter).toBeLessThan(0.01);
  });

  it("정수 주: 사는 쪽은 내림, 파는 쪽은 올림 — 현금 부족 없음", () => {
    const r = fullRebalance([{ symbol: "A", shares: 10, price: 33 }, { symbol: "B", shares: 0, price: 70 }], 0, [{ symbol: "A", weight: 50 }, { symbol: "B", weight: 50 }], 0, true);
    if (!r.ok) throw new Error(r.error);
    for (const row of r.plan.rows) expect(Number.isInteger(row.shares)).toBe(true);
    // A 330 → 목표 165 → 5주 매도 (165 ÷ 33 = 5) / B 165 ÷ 70 = 2.36 → 2주
    expect(r.plan.rows.find((x) => x.symbol === "A")!.shares).toBe(-5);
    expect(r.plan.rows.find((x) => x.symbol === "B")!.shares).toBe(2);
    expect(r.plan.cashAfter).toBeGreaterThanOrEqual(0);
  });

  it("신규 투자금만: 매도 없이 모자란 종목에 모자란 금액 비율대로", () => {
    // 1,000 추가 → 총액 11,000. 목표 A 5,500(부족 없음) · B 4,400(부족 1,400) → 1,000 모두 B
    const r = newMoneyRebalance(pos, 1_000, targets, 1_000);
    if (!r.ok) throw new Error(r.error);
    expect(r.plan.sell).toBe(0);
    expect(r.plan.rows.find((x) => x.symbol === "A")!.trade).toBeCloseTo(0, 9);
    expect(r.plan.rows.find((x) => x.symbol === "B")!.trade).toBeCloseTo(1_000, 9);
    expect(r.plan.cashAfter).toBeCloseTo(1_000, 9); // 추가 입금 1,000 은 모두 매수에 사용
  });

  it("신규 투자금이 부족분보다 많으면 남는 돈은 목표 비중대로", () => {
    // 10,000 추가 → 총액 21,000. 부족: A 10,500−6,000=4,500 · B 8,400−3,000=5,400 → 9,900, 남는 100 은 50:40
    const r = newMoneyRebalance(pos, 1_000, targets, 10_000);
    if (!r.ok) throw new Error(r.error);
    expect(r.plan.rows.find((x) => x.symbol === "A")!.trade).toBeCloseTo(4_500 + (100 * 50) / 90, 9);
    expect(r.plan.rows.find((x) => x.symbol === "B")!.trade).toBeCloseTo(5_400 + (100 * 40) / 90, 9);
    expect(r.plan.buy).toBeCloseTo(10_000, 9);
  });

  it("보유 현금·분배금으로 사기: 총액은 그대로, 현금보다 많이 쓸 수 없음", () => {
    const r = newMoneyRebalance(pos, 1_000, targets, 800, { fromCash: true, feePct: 0.25 });
    if (!r.ok) throw new Error(r.error);
    expect(r.plan.total).toBe(10_000);
    expect(r.plan.buy + r.plan.fee).toBeCloseTo(800, 9);
    expect(r.plan.cashAfter).toBeCloseTo(200, 9);
    expect(newMoneyRebalance(pos, 1_000, targets, 1_500, { fromCash: true }).ok).toBe(false);
  });

  it("잘못된 입력은 계산하지 않음", () => {
    expect(fullRebalance(pos, 0, [{ symbol: "A", weight: 70 }, { symbol: "B", weight: 40 }])).toMatchObject({ ok: false });
    expect(fullRebalance(pos, 0, [{ symbol: "A", weight: -5 }])).toMatchObject({ ok: false });
    expect(fullRebalance([{ symbol: "A", shares: 1, price: null }], 0, [{ symbol: "A", weight: 100 }])).toMatchObject({ ok: false });
    expect(newMoneyRebalance(pos, 0, targets, 0)).toMatchObject({ ok: false });
  });

  it("목표 이탈 알림은 현금 비중도 포함", () => {
    const alerts = driftAlerts(pos, 1_000, [{ symbol: "A", weight: 60 }, { symbol: "B", weight: 40 }], 5);
    // A 60/60 (0) · B 30/40 (−10) · 현금 10/0 (+10)
    expect(alerts.map((a) => a.symbol).sort()).toEqual(["B", "현금"]);
    expect(driftAlerts(pos, 1_000, [{ symbol: "A", weight: 60 }, { symbol: "B", weight: 30 }], 1)).toEqual([]);
  });
});
