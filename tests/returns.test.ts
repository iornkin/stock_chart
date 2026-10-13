import { describe, expect, it } from "vitest";
import { portfolioReturns } from "@/lib/portfolio/returns";
import { EMPTY_PORTFOLIO, type PortfolioData, type Txn } from "@/lib/portfolio/types";

const t = (o: Partial<Txn> & Pick<Txn, "type" | "date">, i: number): Txn => ({ id: `t${i}`, createdAt: i, ...o });
const ledger = (txns: Txn[]): PortfolioData => ({ ...EMPTY_PORTFOLIO, mode: "ledger", ledger: txns });

describe("내 자산 수익률 (달러 기준 / 원화 기준)", () => {
  // 입금 1만 달러(1,300원) → QQQ 10주 400달러 매수(1,300원) → 분배금 50(세금 7.5, 1,350원) → 5주 500달러 매도(1,400원) → 현재가 600, 환율 1,450원
  const txns = [
    t({ type: "deposit", date: "2025-01-02", amount: 10_000, fx: 1300 }, 1),
    t({ type: "buy", date: "2025-01-03", symbol: "QQQ", shares: 10, price: 400, fx: 1300 }, 2),
    t({ type: "dividend", date: "2025-03-31", symbol: "QQQ", amount: 50, tax: 7.5, fx: 1350 }, 3),
    t({ type: "sell", date: "2025-06-02", symbol: "QQQ", shares: 5, price: 500, fx: 1400 }, 4),
  ];
  const r = portfolioReturns({ data: ledger(txns), prices: { QQQ: 600 }, today: "2025-10-01", fxNow: 1450, fxOn: () => null });

  it("종목별: 수익률·총수익률 (달러)", () => {
    const h = r.holdings[0].usd;
    expect(h.value).toBe(3000);
    expect(h.unrealized).toBe(1000);
    expect(h.unrealizedPct).toBeCloseTo(50, 9);
    expect(h.realized).toBe(500);
    expect(h.dividends).toBe(42.5);
    expect(h.totalGain).toBe(1542.5);
    // 총수익률 = 총손익 ÷ 총 매수 금액 4,000
    expect(h.totalReturnPct).toBeCloseTo(38.5625, 9);
  });

  it("종목별: 원화 기준과 환율 효과", () => {
    const k = r.holdings[0].krw!;
    expect(k.cost).toBe(2_600_000);
    expect(k.unrealized).toBe(4_350_000 - 2_600_000);
    expect(k.realized).toBe(2500 * 1400 - 2_600_000);
    expect(k.dividends).toBe(42.5 * 1350);
    expect(k.totalGain).toBe(1_750_000 + 900_000 + 57_375);
    expect(k.totalReturnPct).toBeCloseTo((2_707_375 / 5_200_000) * 100, 9);
    expect(k.fxEffect).toBeCloseTo(2_707_375 - 1542.5 * 1450, 6);
  });

  it("계좌 전체: 원금 대비, 현금의 환율 효과까지 포함", () => {
    expect(r.usd.totalAssets).toBe(3000 + 8542.5);
    expect(r.usd.totalGain).toBe(1542.5);
    expect(r.usd.totalReturnPct).toBeCloseTo(15.425, 9);
    expect(r.krw!.totalAssets).toBe(11_542.5 * 1450);
    expect(r.krw!.totalGain).toBe(11_542.5 * 1450 - 13_000_000);
    // 원금 1만 달러를 1,300원에 바꿔 넣었고 지금 1,450원 → 환율 효과 150만 원
    expect(r.krw!.fxEffect).toBeCloseTo(1_500_000, 6);
  });

  it("거래 환율이 없으면 그날 원/달러 종가로 근사, 그것도 없으면 원화 기준 계산 안 함", () => {
    const noFx = txns.map((x) => ({ ...x, fx: null }));
    const est = portfolioReturns({ data: ledger(noFx), prices: { QQQ: 600 }, today: "2025-10-01", fxNow: 1450, fxOn: () => 1300 });
    expect(est.fxEstimated).toBe(4);
    expect(est.krw).not.toBeNull();
    const none = portfolioReturns({ data: ledger(noFx), prices: { QQQ: 600 }, today: "2025-10-01", fxNow: 1450, fxOn: () => null });
    expect(none.krw).toBeNull();
    expect(none.holdings[0].krw).toBeNull();
    expect(none.krwUnavailable.join()).toContain("환율을 알 수 없는 거래 4건");
    expect(none.usd.totalGain).toBe(1542.5);
  });

  it("간편 입력: 최초 매수일 이후 실제 지급 × 수량으로 분배금 추정 (총자산에는 더하지 않음), 환율 하락은 환차손", () => {
    const data: PortfolioData = { ...EMPTY_PORTFOLIO, simple: { holdings: [{ id: "h", symbol: "SCHD", shares: 100, avgCost: 25, firstDate: "2025-01-10" }], cash: 0 } };
    const fxOn = (d: string) => (d < "2025-02-01" ? 1450 : d < "2025-05-01" ? 1470 : 1380);
    const divs = [
      { ex: "2024-12-11", pay: "2024-12-16", amount: 0.6, kind: "regular" },
      { ex: "2025-03-26", pay: "2025-03-31", amount: 0.25, kind: "regular" },
      { ex: "2025-06-25", pay: "2025-06-30", amount: 0.26, kind: "regular" },
    ];
    const s = portfolioReturns({ data, prices: { SCHD: 28 }, today: "2025-10-01", fxNow: 1400, fxOn, divsOf: () => divs });
    expect(s.dividendsEstimated).toBe(true);
    expect(s.usd.totalAssets).toBe(2800);
    expect(s.usd.dividends).toBeCloseTo(0.51 * 100 * 0.85, 9);
    expect(s.usd.totalReturnPct).toBeCloseTo(((300 + 43.35) / 2500) * 100, 9);
    const k = s.krw!;
    expect(k.cost).toBe(2500 * 1450);
    expect(k.dividends).toBeCloseTo(21.25 * 1470 + 22.1 * 1380, 6);
    expect(k.fxEffect!).toBeLessThan(0);
    expect(k.fxEffect).toBeCloseTo(295_000 + 61_735.5 - 343.35 * 1400, 6);
    // 최초 매수일·환율이 모두 없으면 원화 기준 계산 안 함
    const bare = portfolioReturns({ data: { ...data, simple: { holdings: [{ id: "h", symbol: "SCHD", shares: 100, avgCost: 25 }], cash: 0 } }, prices: { SCHD: 28 }, today: "2025-10-01", fxNow: 1400, fxOn });
    expect(bare.krw).toBeNull();
    expect(bare.usd.totalReturnPct).toBeCloseTo(12, 9);
  });
});
