import { describe, expect, it } from "vitest";
import { benchmarkSameFlows, externalFlows, personalPerformance, timeWeightedReturn } from "@/lib/portfolio/performance";
import type { Txn } from "@/lib/portfolio/types";
import type { PriceSeries } from "@/lib/sim/series";

const t = (o: Partial<Txn> & Pick<Txn, "type" | "date">, i: number): Txn => ({ id: `t${i}`, createdAt: i, ...o });
const D = ["2025-01-02", "2025-01-03", "2025-01-06", "2025-01-07"];
const mk = (symbol: string, close: number[], divs: PriceSeries["divs"] = []): PriceSeries => ({ symbol, kind: "etf", dates: D, close, divs, source: "t", fetchedAt: 0 });

describe("개인 수익률: 시간가중(TWR)·금액가중(XIRR)", () => {
  // 100 → 110 (+10%) → 110 (추가 입금·매수) → 99 (−10%)
  const px = [100, 110, 110, 99];
  const closeOf = (_s: string, d: string) => px[D.indexOf(d)] ?? null;
  const txns = [
    t({ type: "deposit", date: D[0], amount: 10_000 }, 1),
    t({ type: "buy", date: D[0], symbol: "X", shares: 100, price: 100 }, 2),
    t({ type: "deposit", date: D[2], amount: 11_000 }, 3),
    t({ type: "buy", date: D[2], symbol: "X", shares: 100, price: 110 }, 4),
  ];

  it("TWR 은 입금 시점과 무관하게 +10% 뒤 −10% = −1%, 손익은 원금 21,000 대비 −1,200", () => {
    const r = personalPerformance({ txns, calendar: D, closeOf });
    if (!r.ok) throw new Error(r.reason);
    expect(r.twrPct).toBeCloseTo(-1, 9);
    expect(r.principal).toBe(21_000);
    expect(r.value).toBe(19_800);
    expect(r.gain).toBe(-1_200);
    // 돈을 더 넣은 뒤 떨어졌으므로 금액가중(XIRR)은 TWR 보다 나쁘다
    expect(r.xirrPct!).toBeLessThan(r.twrPct);
    expect(r.twrAnnualPct).toBeNull(); // 1년 미만은 연환산하지 않음
    expect(Math.abs(r.identityDiff)).toBeLessThan(1e-9);
  });

  it("입금·출금만 있으면 수익 0 (외부 입출금을 수익으로 세지 않음)", () => {
    const r = personalPerformance({
      txns: [t({ type: "deposit", date: D[0], amount: 5_000 }, 1), t({ type: "deposit", date: D[1], amount: 5_000 }, 2), t({ type: "withdraw", date: D[3], amount: 3_000 }, 3)],
      calendar: D,
      closeOf,
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.twrPct).toBeCloseTo(0, 12);
    expect(r.gain).toBe(0);
    expect(r.principal).toBe(7_000);
    expect(r.xirrPct ?? 0).toBeCloseTo(0, 6);
  });

  it("분배금 재투자와 현금 보유를 나눠 집계", () => {
    const r = personalPerformance({
      txns: [
        ...txns.slice(0, 2),
        t({ type: "dividend", date: D[1], symbol: "X", amount: 50, tax: 7.5 }, 5),
        t({ type: "reinvest", date: D[2], symbol: "X", amount: 40, tax: 6, shares: 0.3, price: 110 }, 6),
      ],
      calendar: D,
      closeOf,
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.dividendsAsCash).toBeCloseTo(42.5, 9);
    expect(r.dividendsReinvested).toBeCloseTo(34, 9);
    expect(Math.abs(r.identityDiff)).toBeLessThan(1e-9);
  });

  it("같은 날 같은 금액을 같은 가격 흐름의 벤치마크에 넣으면 결과가 같다", () => {
    const flows = externalFlows(txns);
    const b = benchmarkSameFlows(flows, mk("B", px), D[3])!;
    expect(b.value).toBeCloseTo(19_800, 6);
    expect(b.twrPct).toBeCloseTo(-1, 9);
  });

  it("벤치마크는 분배금을 재투자한 총수익으로 계산", () => {
    const b = benchmarkSameFlows([{ date: D[0], amount: 1000, kind: "deposit" }], mk("B", [100, 100, 100, 100], [{ ex: D[2], pay: null, amount: 2, kind: "regular" }]), D[3])!;
    expect(b.value).toBeCloseTo(1020, 9);
  });

  it("자료가 부족하면 계산하지 않고 이유를 알림", () => {
    expect(personalPerformance({ txns: [], calendar: D, closeOf })).toMatchObject({ ok: false });
    const noFlow = personalPerformance({ txns: [t({ type: "dividend", date: D[0], symbol: "X", amount: 5 }, 1)], calendar: D, closeOf });
    expect(noFlow.ok).toBe(false);
    const oneDay = personalPerformance({ txns: txns.slice(0, 2), calendar: [D[0]], closeOf });
    expect(oneDay.ok).toBe(false);
  });

  it("빈 계좌(전액 출금)인 날은 TWR 계산에서 건너뜀", () => {
    expect(timeWeightedReturn([100, 0, 50, 55], [100, 0, 50, 50])).toBeCloseTo(10, 9);
  });
});
